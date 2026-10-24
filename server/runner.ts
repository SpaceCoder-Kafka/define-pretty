import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import type { Run, RunConfig, RunInput, Usage, ValidationResult } from '../shared/types.ts';
import type { RunnerController, RunnerStore } from './contracts.ts';
import { buildRunInput } from './prompts.ts';
import { inspectWebsite, validateWebsite, type ValidationOptions } from './validation.ts';

export interface ExecutionOptions {
  run: Run;
  cwd: string;
  prompt: string;
  config: RunConfig;
  referenceFile?: string;
  referenceFiles?: string[];
  signal: AbortSignal;
  outputSchema?: string;
  readOnly?: boolean;
}
export interface ExecutionResult { exitCode: number | null; usage?: Usage; summary?: string; error?: string }
export type Executor = (options: ExecutionOptions) => Promise<ExecutionResult>;
export type Validator = (options: ValidationOptions) => Promise<ValidationResult>;
export interface RunnerOptions {
  store: RunnerStore;
  previewOrigin: string;
  timeoutMs?: number;
  executor?: Executor;
  validator?: Validator;
}

const execFileAsync = promisify(execFile);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const exists = async (file: string) => { try { await access(file); return true; } catch { return false; } };

/** Canonical path + content hash; timestamps and filesystem traversal order do not affect it. */
export async function hashWebsite(directory: string): Promise<string> {
  const files = await inspectWebsite(directory);
  const hash = createHash('sha256');
  for (const file of files) {
    const content = await readFile(path.join(directory, file));
    hash.update(`${file.replaceAll(path.sep, '/')}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

async function fileTree(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  if (!await exists(directory)) return files;
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('不能读取包含符号链接的网页。');
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.set(path.relative(directory, absolute), await readFile(absolute));
    }
  }
  await walk(directory);
  return files;
}

export async function createWebsiteDiff(before: string | undefined, after: string): Promise<string> {
  const oldFiles = before ? await fileTree(before) : new Map<string, Buffer>();
  const newFiles = await fileTree(after);
  const names = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort();
  const patches: string[] = [];
  for (const name of names) {
    const previous = oldFiles.get(name) || Buffer.alloc(0);
    const next = newFiles.get(name) || Buffer.alloc(0);
    if (previous.equals(next)) continue;
    if (previous.includes(0) || next.includes(0) || previous.length + next.length > 2_000_000) {
      patches.push(`Binary or large asset changed: ${name} (${previous.length} → ${next.length} bytes)\n`);
    } else patches.push(createTwoFilesPatch(`baseline/${name}`, `result/${name}`, previous.toString('utf8'), next.toString('utf8')));
  }
  return patches.join('\n') || '网页文件与原始基线一致，未发生代码变化。\n';
}

function killProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch { /* A cancelled process can exit between the signal check and kill. */ }
}

/** Run the installed CLI with its existing authentication and provider configuration. */
export const executeCodex: Executor = async options => {
  const version = (await execFileAsync('codex', ['--version'], { timeout: 10000 })).stdout.trim();
  if (options.config.cliVersion && version !== options.config.cliVersion) {
    throw new Error(`Codex CLI 版本已改变（实验：${options.config.cliVersion}；当前：${version}）。请保存新实验版本后运行。`);
  }
  if (options.signal.aborted) throw new Error('运行已取消。');
  const args = [
    'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', options.readOnly ? 'read-only' : 'workspace-write',
    '-c', 'approval_policy="never"', '-C', options.cwd,
    '--model', options.config.model, '-c', `model_reasoning_effort=${JSON.stringify(options.config.reasoningEffort)}`,
    '-o', path.join(options.cwd, 'final.txt'),
  ];
  if (options.config.provider) args.push('-c', `model_provider=${JSON.stringify(options.config.provider)}`);
  if (options.outputSchema) args.push('--output-schema', options.outputSchema);
  for (const file of options.referenceFiles ?? (options.referenceFile ? [options.referenceFile] : [])) args.push('--image', file);
  args.push('--json', '--color', 'never', '-');
  await writeFile(path.join(options.cwd, 'command.json'), JSON.stringify({ executable: 'codex', args, cwd: options.cwd }, null, 2));
  const events = createWriteStream(path.join(options.cwd, 'events.jsonl'), { flags: 'a' });
  const errors = createWriteStream(path.join(options.cwd, 'stderr.log'), { flags: 'a' });
  const child = spawn('codex', args, { cwd: options.cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let usage: Usage | undefined;
  let summary: string | undefined;
  let failure: string | undefined;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const parseLine = (line: string) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn.completed') {
        if (event.usage) usage = event.usage;
        // The CLI can recover from a transient stream/provider error in the same run.
        // A later completed turn resolves earlier error events; later errors still fail.
        failure = undefined;
      }
      if (event.type === 'turn.failed') failure = typeof event.error === 'string' ? event.error : event.error?.message || 'Codex 返回 turn.failed。';
      if (event.type === 'error') failure = event.message || event.error?.message || 'Codex 返回错误事件。';
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') summary = event.item.text;
    } catch { /* Preserve non-JSON diagnostic lines without treating them as model output. */ }
  };
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    events.write(chunk);
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      parseLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => errors.write(chunk));
  // EPIPE is expected if the CLI exits while the prompt is being delivered.
  child.stdin?.on('error', () => undefined);
  const abort = () => {
    killProcessGroup(child, 'SIGTERM');
    forceKill = setTimeout(() => killProcessGroup(child, 'SIGKILL'), 2000);
    forceKill.unref();
  };
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    const result = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
      child.stdin?.end(options.prompt);
    });
    if (buffer.trim()) parseLine(buffer);
    try { summary = await readFile(path.join(options.cwd, 'final.txt'), 'utf8'); } catch { /* CLI failures may not write a final reply. */ }
    return { exitCode: result, usage, summary, ...(failure ? { error: failure } : {}) };
  } finally {
    options.signal.removeEventListener('abort', abort);
    // The parent may exit on TERM before descendants with redirected stdio do.
    // Killing the still-addressable process group here prevents those survivors.
    if (options.signal.aborted) killProcessGroup(child, 'SIGKILL');
    if (forceKill) clearTimeout(forceKill);
    events.end(); errors.end();
    await Promise.all([finished(events), finished(errors)]);
  }
};

interface QueuedRun { runId: string; versionId: string; concurrency: number }
interface ActiveRun { versionId: string; controller: AbortController; reason?: 'cancelled' | 'interrupted' | 'timeout'; finalizing?: boolean; promise?: Promise<void> }

export class Runner implements RunnerController {
  private readonly store: RunnerStore;
  private readonly executor: Executor;
  private readonly validator: Validator;
  private readonly queue: QueuedRun[] = [];
  private readonly active = new Map<string, ActiveRun>();
  private pumping = false;
  private stopped = false;
  private idleResolvers: (() => void)[] = [];

  constructor(private readonly options: RunnerOptions) {
    this.store = options.store;
    this.executor = options.executor ?? executeCodex;
    this.validator = options.validator ?? validateWebsite;
  }

  async enqueue(runId: string): Promise<void> {
    if (this.stopped) throw new Error('运行服务正在停止。');
    const run = await this.store.getRun(runId);
    if (run.status !== 'queued') throw new Error('仅可将排队状态的运行加入队列。');
    const version = await this.store.getVersion(run.experimentId, run.versionId);
    const concurrency = version.config.concurrency ?? 2;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('并行数量必须是大于或等于 1 的整数。');
    if (this.stopped) throw new Error('运行服务正在停止。');
    if (this.queue.some(item => item.runId === runId) || this.active.has(runId)) return;
    this.queue.push({ runId, versionId: run.versionId, concurrency });
    void this.pump();
  }

  async cancel(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (active) {
      // Once the validated result is being committed, completion wins the race.
      if (active.finalizing) { await active.promise; return; }
      active.reason = 'cancelled';
      active.controller.abort();
      await active.promise;
      return;
    }
    const index = this.queue.findIndex(item => item.runId === runId);
    if (index >= 0) this.queue.splice(index, 1);
    const run = await this.store.getRun(runId);
    if (run.status === 'queued') await this.store.updateRun(runId, { status: 'cancelled', finishedAt: new Date().toISOString(), error: '已取消，未启动 Codex。' });
    this.resolveIdle();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    const queued = this.queue.splice(0);
    await Promise.all(queued.map(item => this.store.updateRun(item.runId, { status: 'interrupted', finishedAt: new Date().toISOString(), error: '本地服务停止，排队任务已中断。' })));
    for (const active of this.active.values()) {
      if (!active.finalizing) { active.reason = 'interrupted'; active.controller.abort(); }
    }
    await Promise.all([...this.active.values()].map(active => active.promise));
    this.resolveIdle();
  }

  /** Test and shutdown helper; no background polling is needed. */
  async waitForIdle(): Promise<void> {
    if (!this.queue.length && !this.active.size && !this.pumping) return;
    await new Promise<void>(resolve => this.idleResolvers.push(resolve));
  }

  private resolveIdle(): void {
    if (this.queue.length || this.active.size || this.pumping) return;
    this.idleResolvers.splice(0).forEach(resolve => resolve());
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (!this.stopped && this.queue.length) {
        // Each immutable experiment version keeps its own scheduling limit.
        // A full version must not block another version with available slots.
        const index = this.queue.findIndex(item =>
          [...this.active.values()].filter(active => active.versionId === item.versionId).length < item.concurrency);
        if (index < 0) break;
        const { runId, versionId } = this.queue.splice(index, 1)[0];
        const active: ActiveRun = { versionId, controller: new AbortController() };
        this.active.set(runId, active);
        active.promise = this.execute(runId, active).catch(async error => {
          // Persist unexpected controller failures instead of leaving a task "running" forever.
          await this.store.updateRun(runId, { status: 'failed', finishedAt: new Date().toISOString(), error: message(error) }).catch(() => undefined);
        }).finally(() => {
          this.active.delete(runId);
          void this.pump();
          this.resolveIdle();
        });
      }
    } finally { this.pumping = false; this.resolveIdle(); }
  }

  private async execute(runId: string, active: ActiveRun): Promise<void> {
    const run = await this.store.getRun(runId);
    const version = await this.store.getVersion(run.experimentId, run.versionId);
    const directory = this.store.runDir(runId);
    const website = path.join(directory, 'website');
    const started = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let baselineDirectory: string | undefined;
    let input: RunInput | undefined;
    let referenceFile: string | undefined;
    let exitCode: number | null | undefined;
    let usage: Usage | undefined;
    let summary: string | undefined;
    try {
      if (run.status !== 'queued') return;
      await this.store.updateRun(runId, { status: 'running', startedAt: new Date(started).toISOString() });
      const timeoutMs = this.options.timeoutMs ?? version.config.timeoutMs ?? 30 * 60 * 1000;
      timeout = setTimeout(() => { active.reason = 'timeout'; active.controller.abort(); }, timeoutMs);
      timeout.unref();
      await mkdir(website, { recursive: true });

      if (run.groupId !== 'baseline') {
        if (!run.baselineRunId) throw new Error('此任务没有绑定冻结基线，请先生成原始页。');
        const baseline = await this.store.getRun(run.baselineRunId);
        if (baseline.groupId !== 'baseline' || baseline.status !== 'completed' || !baseline.artifactHash) throw new Error('绑定的原始页未完成验证。');
        baselineDirectory = this.store.runDir(baseline.id);
        const frozen = path.join(baselineDirectory, 'frozen');
        const actualHash = await hashWebsite(frozen);
        if (actualHash !== baseline.artifactHash || (run.baselineHash && run.baselineHash !== actualHash)) throw new Error('冻结基线的内容校验失败，任务已停止。');
        await cp(frozen, website, { recursive: true, dereference: false });
        run.baselineHash = actualHash;
        await this.store.updateRun(runId, { baselineHash: actualHash });
      }
      const reference = run.groupId === 'baseline' ? undefined : version.referenceId ? await this.store.getReference(version.referenceId) : undefined;
      input = buildRunInput(version, run.groupId, reference, run.baselineHash);
      if (reference) {
        const bytes = await readFile(this.store.referencePath(reference.id));
        if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new Error('参考图片内容与保存的哈希不一致。');
        const extension = reference.mimeType === 'image/jpeg' ? '.jpg' : reference.mimeType === 'image/webp' ? '.webp' : '.png';
        referenceFile = path.join(directory, `reference${extension}`);
        await writeFile(referenceFile, bytes);
      }
      await writeFile(path.join(directory, 'input.json'), JSON.stringify(input, null, 2));
      await writeFile(path.join(directory, 'prompt.txt'), input.prompt);
      if (active.controller.signal.aborted) throw new Error('运行已取消。');
      const result = await this.executor({ run, cwd: directory, prompt: input.prompt, config: version.config, referenceFile, signal: active.controller.signal });
      exitCode = result.exitCode; usage = result.usage; summary = result.summary;
      await this.store.updateRun(runId, { exitCode, usage, summary });
      if (active.controller.signal.aborted) throw new Error('运行已取消。');
      if (result.error) throw new Error(result.error);
      if (exitCode !== 0) throw new Error(`Codex 运行失败，退出码：${exitCode ?? '进程终止'}。请查看运行日志。`);
      // Input snapshots must remain the exact material that was sent to the model.
      if (referenceFile && input.reference) {
        const referenceHash = createHash('sha256').update(await readFile(referenceFile)).digest('hex');
        if (referenceHash !== input.reference.sha256) throw new Error('生成过程修改了参考图片，实验无效。');
      }
      await inspectWebsite(website);
      const artifactHash = await hashWebsite(website);
      await this.store.updateRun(runId, { status: 'checking', artifactHash, hasPreview: true });
      const validation = await this.validator({ runId, runDir: directory, previewOrigin: this.options.previewOrigin, baselineDir: baselineDirectory, signal: active.controller.signal });
      if (active.controller.signal.aborted) throw new Error('检查已取消。');
      const diff = await createWebsiteDiff(baselineDirectory ? path.join(baselineDirectory, 'frozen') : undefined, website);
      await writeFile(path.join(directory, 'diff.txt'), diff);
      await writeFile(path.join(directory, 'validation.json'), JSON.stringify(validation, null, 2));
      if (active.controller.signal.aborted) throw new Error('检查已取消。');
      if (validation.passed && run.groupId === 'baseline') await cp(website, path.join(directory, 'frozen'), { recursive: true, dereference: false });
      if (active.controller.signal.aborted) throw new Error('检查已取消。');
      // No asynchronous gap between the last cancellation check and entering commit.
      active.finalizing = true;
      if (timeout) clearTimeout(timeout);
      await this.store.updateRun(runId, {
        status: validation.passed ? 'completed' : 'failed', validation, artifactHash,
        finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
        ...(validation.passed ? {} : { error: '页面检查未通过。产物与检查证据已保留。' }),
      });
      if (validation.passed && run.groupId === 'baseline') await this.store.bindBaseline(run.experimentId, run.versionId, runId);
    } catch (error) {
      const status = active.reason === 'cancelled' ? 'cancelled' : active.reason === 'interrupted' ? 'interrupted' : 'failed';
      const explanation = active.reason === 'timeout' ? '运行超过时间限制，已终止整个进程组。'
        : active.reason === 'cancelled' ? '运行已取消，已有产物和日志保留。'
          : active.reason === 'interrupted' ? '本地服务停止，运行已中断。' : message(error);
      await this.store.updateRun(runId, {
        status, error: explanation, exitCode, usage, summary,
        hasPreview: await exists(path.join(website, 'index.html')),
        finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      });
      // Retain code evidence even for non-zero CLI exits and failed checks.
      try { await writeFile(path.join(directory, 'diff.txt'), await createWebsiteDiff(baselineDirectory ? path.join(baselineDirectory, 'frozen') : undefined, website)); } catch { /* Preserve the original failure. */ }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (input) {
        await writeFile(path.join(directory, 'input.json'), JSON.stringify(input, null, 2));
        await writeFile(path.join(directory, 'prompt.txt'), input.prompt);
      }
    }
  }
}
