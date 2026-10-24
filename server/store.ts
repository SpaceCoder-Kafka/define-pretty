import { experimentGroups, groupRules } from '../shared/groups.ts';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Experiment, type ExperimentInput, type ExperimentVersion, type GroupId, type ReferenceAsset, type Review, type Run, type RunConfig, type SpecGeneration } from '../shared/types.ts';
import type { RunnerStore } from './contracts.ts';
import { requireSafeId } from './security.ts';

interface StoreData { experiments: Experiment[]; runs: Run[]; references: ReferenceAsset[]; generations?: SpecGeneration[] }
const ACTIVE = new Set(['queued', 'running', 'checking']);
const clone = <T>(value: T): T => structuredClone(value);
const missing = (message: string) => Object.assign(new Error(message), { status: 404 });
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sameConfig = (a: RunConfig, b: RunConfig) => a.model === b.model && a.reasoningEffort === b.reasoningEffort && a.provider === b.provider && a.cliVersion === b.cliVersion;

export class FileStore extends EventEmitter implements RunnerStore {
  readonly root: string;
  private data: StoreData = { experiments: [], runs: [], references: [] };
  private tail: Promise<unknown> = Promise.resolve();

  constructor(root = path.resolve('.data')) { super(); this.root = path.resolve(root); }

  async initialize(): Promise<void> {
    await Promise.all([mkdir(this.root, { recursive: true }), mkdir(path.join(this.root, 'runs'), { recursive: true }), mkdir(path.join(this.root, 'references'), { recursive: true })]);
    try {
      const parsed = JSON.parse(await readFile(path.join(this.root, 'store.json'), 'utf8')) as StoreData;
      if (!Array.isArray(parsed.experiments) || !Array.isArray(parsed.runs) || !Array.isArray(parsed.references)) throw new Error('本地数据文件格式不正确。');
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    let recovered = false;
    for (const job of this.data.generations ?? []) {
      if (ACTIVE.has(job.status)) { job.status = 'interrupted'; job.finishedAt = new Date().toISOString(); job.error = '服务重启，规范生成中断。'; recovered = true; }
    }
    for (const run of this.data.runs) {
      if (ACTIVE.has(run.status)) {
        run.status = 'interrupted';
        run.finishedAt = new Date().toISOString();
        run.error = '本地服务已重启，运行中断。请手动重跑；原记录已保留。';
        recovered = true;
      }
    }
    if (recovered) await this.persist();
  }

  private async persist(): Promise<void> {
    const temp = path.join(this.root, `store-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(temp, path.join(this.root, 'store.json'));
    this.emit('update');
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  runDir(id: string): string { return path.join(this.root, 'runs', requireSafeId(id)); }
  websiteDir(id: string): string { return path.join(this.runDir(id), 'website'); }

  referencePath(id: string): string {
    const reference = this.data.references.find((item) => item.id === requireSafeId(id));
    if (!reference) throw missing('参考图不存在。');
    const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[reference.mimeType];
    if (!extension) throw bad('参考图格式不支持。');
    return path.join(this.root, 'references', `${reference.id}${extension}`);
  }

  async addReference(name: string, mimeType: string, bytes: Buffer): Promise<ReferenceAsset> {
    return this.mutate(async () => {
      const reference: ReferenceAsset = { id: randomUUID(), name: path.basename(name).slice(0, 200), mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: '', createdAt: new Date().toISOString() };
      reference.url = `/api/references/${reference.id}`;
      this.data.references.push(reference);
      try { await writeFile(this.referencePath(reference.id), bytes, { flag: 'wx', mode: 0o600 }); await this.persist(); }
      catch (error) { this.data.references = this.data.references.filter((item) => item.id !== reference.id); throw error; }
      return clone(reference);
    });
  }

  async getReference(id: string): Promise<ReferenceAsset> {
    const value = this.data.references.find((item) => item.id === requireSafeId(id));
    if (!value) throw missing('参考图不存在。');
    return clone(value);
  }

  async listExperiments(): Promise<Experiment[]> { return clone([...this.data.experiments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async getExperiment(id: string): Promise<Experiment> {
    const value = this.data.experiments.find((item) => item.id === requireSafeId(id));
    if (!value) throw missing('实验不存在。');
    return clone(value);
  }
  async getVersion(experimentId: string, versionId: string): Promise<ExperimentVersion> {
    const experiment = await this.getExperiment(experimentId);
    const value = experiment.versions.find((item) => item.id === requireSafeId(versionId));
    if (!value) throw missing('实验版本不存在。');
    return value;
  }
  async getRun(id: string): Promise<Run> {
    const value = this.data.runs.find((item) => item.id === requireSafeId(id));
    if (!value) throw missing('运行记录不存在。');
    return clone(value);
  }
  async listRuns(experimentId?: string): Promise<Run[]> {
    if (experimentId) requireSafeId(experimentId);
    return clone(this.data.runs.filter((run) => !experimentId || run.experimentId === experimentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async createExperiment(input: ExperimentInput): Promise<Experiment> {
    return this.mutate(async () => {
      if (input.referenceId) await this.getReference(input.referenceId);
      const now = new Date().toISOString();
      const experiment: Experiment = { id: randomUUID(), title: input.title, createdAt: now, updatedAt: now, versions: [this.makeVersion(input, 1)] };
      this.data.experiments.push(experiment);
      await this.persist();
      return clone(experiment);
    });
  }

  private makeVersion(input: ExperimentInput, number: number): ExperimentVersion {
    return { id: randomUUID(), number, createdAt: new Date().toISOString(), businessBrief: input.businessBrief, businessHash: hash(input.businessBrief), referenceId: input.referenceId, dimensions: clone(input.dimensions), styleGuide: clone(input.styleGuide), groups: clone(input.groups ?? []), generationConfig: clone(input.generationConfig ?? input.config), generationPrompt: input.generationPrompt, config: clone(input.config) };
  }

  async saveVersion(experimentId: string, input: ExperimentInput): Promise<Experiment> {
    return this.mutate(async () => {
      if (input.referenceId) await this.getReference(input.referenceId);
      const experiment = this.data.experiments.find((item) => item.id === requireSafeId(experimentId));
      if (!experiment) throw missing('实验不存在。');
      const version = this.makeVersion(input, experiment.versions.length + 1);
      const previous = [...experiment.versions].reverse().find((item) => item.businessHash === version.businessHash && sameConfig(item.config, version.config) && item.baselineRunId && this.data.runs.some((run) => run.id === item.baselineRunId && run.status === 'completed' && run.artifactHash));
      if (previous) version.baselineRunId = previous.baselineRunId;
      experiment.title = input.title;
      experiment.updatedAt = version.createdAt;
      experiment.versions.push(version);
      await this.persist();
      return clone(experiment);
    });
  }

  async createCombinationRun(experimentId: string, versionId: string, title: string, sourceRunIds: string[]): Promise<Run> {
    return this.mutate(async () => {
      const experiment = this.data.experiments.find(item => item.id === requireSafeId(experimentId));
      const version = experiment?.versions.find(item => item.id === requireSafeId(versionId));
      if (!experiment || !version) throw missing('实验版本不存在。');
      if (!title.trim() || title.length > 120) throw bad('请填写组合组名称（最多 120 字）。');
      if (!Array.isArray(sourceRunIds) || sourceRunIds.length < 2 || sourceRunIds.length > 100 || new Set(sourceRunIds).size !== sourceRunIds.length) throw bad('请选择至少两个不同维度的结果。');
      if ((version.groups?.length ?? 0) >= 100) throw bad('最多支持 100 个组合组。');
      const baseline = this.data.runs.find(run => run.id === version.baselineRunId);
      if (!version.referenceId || baseline?.status !== 'completed' || !baseline.artifactHash) throw bad('需要有效参考图和已冻结的原始网页。');
      const sources = sourceRunIds.map(id => {
        const run = this.data.runs.find(item => item.id === id);
        if (!run || run.experimentId !== experimentId || run.versionId !== versionId || !version.dimensions.some(rule => rule.id === run.groupId)) throw bad('只能选择当前版本的单维度结果。');
        if (!run.hasPreview || ACTIVE.has(run.status)) throw bad('请先等待单维度运行结束并查看网页结果。');
        if (run.baselineRunId !== baseline.id || run.baselineHash !== baseline.artifactHash) throw bad('所选结果与当前原始网页不一致，请先基于当前原始页运行这些维度。');
        if (!version.dimensions.find(rule => rule.id === run.groupId)?.instructions.trim()) throw bad('所选维度的规范为空。');
        return run;
      });
      if (new Set(sources.map(run => run.groupId)).size !== sources.length) throw bad('同一维度只能选择一次。');
      const group = { id: `group-${randomUUID()}`, title: title.trim(), dimensionIds: sources.map(run => run.groupId), sourceRunIds: [...sourceRunIds] };
      const run: Run = { id: randomUUID(), experimentId, versionId, groupId: group.id, groupTitle: group.title, dimensionIds: group.dimensionIds,
        attempt: 1, status: 'queued', createdAt: new Date().toISOString(), baselineRunId: baseline.id, baselineHash: baseline.artifactHash, hasPreview: false };
      await mkdir(this.runDir(run.id), { recursive: true });
      (version.groups ??= []).push(group); this.data.runs.push(run); experiment.updatedAt = run.createdAt;
      await this.persist(); return clone(run);
    });
  }

  async createRuns(experimentId: string, versionId: string, groupIds: GroupId[]): Promise<Run[]> {
    return this.mutate(async () => {
      const version = await this.getVersion(experimentId, versionId);
      if (!groupIds.length || groupIds.some((group) => !experimentGroups(version).some(item => item.id === group)) || new Set(groupIds).size !== groupIds.length) throw bad('请选择有效且不重复的实验组。');
      if (groupIds.includes('baseline') && groupIds.length !== 1) throw bad('请先单独生成原始页面，再运行修改组。');
      if (this.data.runs.some((run) => run.experimentId === experimentId && run.versionId === versionId && groupIds.includes(run.groupId) && ACTIVE.has(run.status))) throw bad('所选实验组正在运行，请等待完成或取消。', 409);
      let baseline: Run | undefined;
      if (!groupIds.includes('baseline')) {
        if (!version.referenceId) throw bad('请先上传参考 UI 截图并保存实验版本。');
        if (!version.baselineRunId) throw bad('请先生成并通过检查的原始页面。');
        baseline = await this.getRun(version.baselineRunId);
        if (baseline.status !== 'completed' || !baseline.artifactHash) throw bad('原始页面尚未通过检查。');
        if (groupIds.includes('all-rules') && !version.dimensions.length) throw bad('请先保存至少一个维度。');
        for (const groupId of groupIds) {
          if (groupId !== 'direct' && groupRules(version, groupId).some(rule => !rule.instructions.trim())) throw bad('所选规范组没有填写规范，请编辑并保存新版本。');
        }
      }
      const createdAt = new Date().toISOString();
      const runs = groupIds.map((groupId): Run => ({ id: randomUUID(), experimentId, versionId, groupId, groupTitle: experimentGroups(version).find(item => item.id === groupId)!.title, dimensionIds: groupRules(version, groupId).map(rule => rule.id), attempt: this.data.runs.filter((run) => run.experimentId === experimentId && run.versionId === versionId && run.groupId === groupId).length + 1, status: 'queued', createdAt, baselineRunId: baseline?.id, baselineHash: baseline?.artifactHash, hasPreview: false }));
      for (const run of runs) await mkdir(this.runDir(run.id), { recursive: true });
      this.data.runs.push(...runs);
      await this.persist();
      return clone(runs);
    });
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<Run> {
    return this.mutate(async () => {
      const run = this.data.runs.find((item) => item.id === requireSafeId(id));
      if (!run) throw missing('运行记录不存在。');
      // Run identity and its frozen baseline input may not change after creation.
      const { id: _id, experimentId: _experimentId, versionId: _versionId, groupId: _groupId, groupTitle: _groupTitle, dimensionIds: _dimensionIds, attempt: _attempt, createdAt: _createdAt, baselineRunId: _baselineRunId, ...mutable } = patch;
      Object.assign(run, mutable);
      await this.persist();
      return clone(run);
    });
  }

  async bindBaseline(experimentId: string, versionId: string, runId: string): Promise<void> {
    await this.mutate(async () => {
      const run = await this.getRun(runId);
      if (run.groupId !== 'baseline' || run.status !== 'completed' || !run.artifactHash || run.experimentId !== experimentId || run.versionId !== versionId) throw bad('只有通过检查的本版本原始页可以冻结为基线。');
      const experiment = this.data.experiments.find((item) => item.id === experimentId);
      const version = experiment?.versions.find((item) => item.id === versionId);
      if (!version) throw missing('实验版本不存在。');
      version.baselineRunId = runId;
      if (experiment) experiment.updatedAt = new Date().toISOString();
      await this.persist();
    });
  }

  generationDir(id: string) { return path.join(this.root, 'generations', requireSafeId(id)); }
  async listGenerations(): Promise<SpecGeneration[]> { return clone([...(this.data.generations ?? [])].reverse()); }
  async getGeneration(id: string): Promise<SpecGeneration> {
    const job = this.data.generations?.find(item => item.id === requireSafeId(id));
    if (!job) throw missing('规范生成记录不存在。');
    return clone(job);
  }
  async addGeneration(job: SpecGeneration): Promise<void> {
    await this.mutate(async () => { (this.data.generations ??= []).push(clone(job)); await this.persist(); });
  }
  async updateGeneration(id: string, patch: Partial<SpecGeneration>): Promise<SpecGeneration> {
    return this.mutate(async () => {
      const job = this.data.generations?.find(item => item.id === id);
      if (!job) throw missing('规范生成记录不存在。');
      Object.assign(job, patch); await this.persist(); return clone(job);
    });
  }

  async saveReview(id: string, review: Review): Promise<Run> { return this.updateRun(id, { review: { ...review, updatedAt: new Date().toISOString() } }); }
}
