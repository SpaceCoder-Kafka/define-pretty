import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileStore } from './store.ts';
import { SpecGenerator, parseGeneratedRules } from './specs.ts';
import { buildRunInput } from './prompts.ts';
import { dimensionsInput, groupsInput, modelInput } from './input.ts';
import type { DimensionRule, SpecGeneration } from '../shared/types.ts';

const config = { model: 'experiment-model', reasoningEffort: 'high', provider: 'custom', cliVersion: 'cli', concurrency: 2, timeoutMs: 1800000 };
const dimensions: DimensionRule[] = ['custom-a', 'custom-b', 'excluded'].map(id => ({ id, title: id, scope: `${id} scope`, instructions: `${id} ONLY_TEXT` }));
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pretty-dynamic-'));
  const store = new FileStore(root); await store.initialize();
  const reference = await store.addReference('ref.png', 'image/png', Buffer.from('image'));
  return { root, store, reference };
}
async function done(store: FileStore, id: string) {
  for (let i = 0; i < 200; i++) { const job = await store.getGeneration(id); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('job did not finish');
}

test('custom dimensions and ordered combinations use only selected rules and frozen baseline across versions', async () => {
  const { root, store, reference } = await fixture();
  try {
    const input = { title: 'custom', businessBrief: 'business', dimensions, groups: [{ id: 'combo', title: 'B + A', dimensionIds: ['custom-b', 'custom-a'] }], config, referenceId: reference.id };
    const exp = await store.createExperiment(input);
    const version = exp.versions[0];
    const [baseline] = await store.createRuns(exp.id, version.id, ['baseline']);
    await store.updateRun(baseline.id, { status: 'completed', artifactHash: 'frozen' }); await store.bindBaseline(exp.id, version.id, baseline.id);
    const [single, combined] = await store.createRuns(exp.id, version.id, ['custom-a', 'combo']);
    assert.equal(single.baselineHash, combined.baselineHash);
    assert.deepEqual(combined.dimensionIds, ['custom-b', 'custom-a']);
    assert.equal(combined.groupTitle, 'B + A');
    const prompt = buildRunInput(version, 'combo', reference, combined.baselineHash);
    assert.deepEqual(prompt.rules.map(rule => rule.id), ['custom-b', 'custom-a']);
    assert.doesNotMatch(prompt.prompt, /excluded ONLY_TEXT/);
    assert.ok(prompt.prompt.indexOf('custom-b ONLY_TEXT') < prompt.prompt.indexOf('custom-a ONLY_TEXT'));
    assert.equal(buildRunInput(version, 'baseline').reference, undefined);
    assert.deepEqual(buildRunInput(version, 'direct', reference).rules, []);
    const next = await store.saveVersion(exp.id, { ...input, dimensions: dimensions.slice(0, 2), generationConfig: { ...config, model: 'vision-model', reasoningEffort: 'low' } });
    assert.equal(next.versions.at(-1)!.baselineRunId, baseline.id);
    assert.equal(next.versions.at(-1)!.config.model, 'experiment-model');
    assert.equal(next.versions[0].dimensions.length, 3);
    await assert.rejects(store.createRuns(exp.id, next.versions.at(-1)!.id, ['excluded']), /有效/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid identifiers, duplicate rules, dangling or singleton combinations are rejected', () => {
  assert.deepEqual(dimensionsInput([]), []);
  assert.throws(() => dimensionsInput([{ ...dimensions[0], id: 'baseline' }]), /标识/);
  assert.throws(() => dimensionsInput([dimensions[0], dimensions[0]]), /重复/);
  for (const ids of [['custom-a'], ['custom-a', 'custom-a'], ['custom-a', 'missing']]) {
    assert.throws(() => groupsInput([{ id: 'combo', title: 'test', dimensionIds: ids }], dimensions), /至少两个/);
  }
  assert.throws(() => groupsInput([{ id: 'custom-a', title: 'test', dimensionIds: ['custom-a', 'custom-b'] }], dimensions), /重复/);
  assert.equal(modelInput({ model: 'vision', reasoningEffort: 'low', provider: 'forged' }, config).provider, 'custom');
  assert.throws(() => parseGeneratedRules('not JSON', 'job'));
  assert.throws(() => parseGeneratedRules('{"dimensions":[{"title":"a"}]}', 'job'), /无效/);
});

test('image generation snapshots distinct model, prompt, image, output and usage; reload keeps result', async () => {
  const { root, store, reference } = await fixture();
  const generator = new SpecGenerator(store, async options => {
    assert.equal(options.config.model, 'vision-model'); assert.equal(options.config.reasoningEffort, 'low');
    assert.equal(options.readOnly, true); assert.ok(options.outputSchema);
    assert.equal((await readFile(options.referenceFile!)).toString(), 'image');
    assert.match(options.prompt, /CUSTOM_PROMPT/);
    return { exitCode: 0, summary: JSON.stringify({ dimensions: [{ kind: 'whole-page', title: '整页视觉重点', scope: '主辅区域',
      rules: ['主区域承载视觉中心。', '辅助区降低视觉权重。', '保留主辅阅读顺序。'], observations: '60% 为估计的迁移参数。' },
      { kind: 'attribute', title: '色彩', scope: '配色', rules: ['背景使用白色。', '文本使用深灰。', '强调色使用橙色。'], observations: '色彩估计。' }] }), usage: { input_tokens: 12 } };

  });
  try {
    const started = await generator.start(reference.id, { ...config, model: 'vision-model', reasoningEffort: 'low' }, 'CUSTOM_PROMPT');
    const result = await done(store, started.id);
    assert.equal(result.status, 'completed'); assert.equal(result.usage?.input_tokens, 12);
    assert.equal(result.dimensions?.[0].sourceGenerationId, result.id);
    assert.equal(result.formatVersion, 4);
    assert.equal(result.observations?.[0].dimensionId, result.dimensions?.[0].id);
    assert.doesNotMatch(result.dimensions![0].instructions, /估计的迁移参数/);
    assert.equal(result.reference.sha256, reference.sha256);
    await generator.shutdown(); // Finish the atomic file write before simulating a restart.
    const restored = new FileStore(root); await restored.initialize(); assert.deepEqual(await restored.getGeneration(result.id), result);
  } finally { await generator.shutdown(); await rm(root, { recursive: true, force: true }); }
});

test('generation failure, cancellation, timeout and restart never become success', async () => {
  const { root, store, reference } = await fixture();
  const failure = new SpecGenerator(store, async () => ({ exitCode: 0, summary: 'invalid output' }));
  const wait = async (options: { signal: AbortSignal }) => { await new Promise<void>(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', () => resolve(), { once: true }); }); return { exitCode: null }; };
  const cancellable = new SpecGenerator(store, wait);
  const timeout = new SpecGenerator(store, wait, 20);
  try {
    assert.equal((await done(store, (await failure.start(reference.id, config, 'prompt')).id)).status, 'failed');
    const started = await cancellable.start(reference.id, config, 'prompt');
    await assert.rejects(cancellable.start(reference.id, config, 'prompt'), /已有规范/);
    await cancellable.cancel(started.id); assert.equal((await store.getGeneration(started.id)).status, 'cancelled');
    assert.equal((await done(store, (await timeout.start(reference.id, config, 'prompt')).id)).status, 'failed');
    const unfinished: SpecGeneration = { id: 'recovery', reference, config, prompt: 'prompt', status: 'running', createdAt: new Date().toISOString() };
    await store.addGeneration(unfinished);
    const restored = new FileStore(root); await restored.initialize(); assert.equal((await restored.getGeneration('recovery')).status, 'interrupted');
  } finally { await Promise.all([failure.shutdown(), cancellable.shutdown(), timeout.shutdown()]); await rm(root, { recursive: true, force: true }); }
});

test('canvas combinations append atomically from observed same-baseline dimensions without losing existing results', async () => {
  const { root, store, reference } = await fixture();
  try {
    const exp = await store.createExperiment({ title: 'canvas', businessBrief: 'business', config, dimensions, referenceId: reference.id });
    const version = exp.versions[0];
    const [base] = await store.createRuns(exp.id, version.id, ['baseline']);
    await store.updateRun(base.id, { status: 'completed', artifactHash: 'base-hash' }); await store.bindBaseline(exp.id, version.id, base.id);
    const [a, b, direct] = await store.createRuns(exp.id, version.id, ['custom-a', 'custom-b', 'direct']);
    await assert.rejects(store.createCombinationRun(exp.id, version.id, 'combo', [a.id, b.id]), /等待/);
    await store.updateRun(a.id, { status: 'completed', hasPreview: true });
    await store.updateRun(b.id, { status: 'failed', hasPreview: true });
    await store.updateRun(direct.id, { status: 'completed', hasPreview: true });
    await store.saveReview(a.id, { adherence: 'followed', scope: 'none', preference: 'better', notes: 'keep me' });
    await assert.rejects(store.createCombinationRun(exp.id, version.id, 'combo', [a.id, direct.id]), /单维度/);
    await assert.rejects(store.createCombinationRun(exp.id, version.id, 'combo', [a.id, a.id]), /不同/);
    await store.updateRun(b.id, { baselineHash: 'other-hash' });
    await assert.rejects(store.createCombinationRun(exp.id, version.id, 'combo', [a.id, b.id]), /不一致/);
    await store.updateRun(b.id, { baselineHash: 'base-hash' });
    const before = await store.listRuns(exp.id);
    const combo = await store.createCombinationRun(exp.id, version.id, 'B + A', [b.id, a.id]);
    assert.equal(combo.status, 'queued'); assert.equal(combo.versionId, version.id); assert.equal(combo.baselineRunId, base.id);
    const saved = await store.getExperiment(exp.id); assert.equal(saved.versions.length, 1);
    assert.deepEqual(saved.versions[0].groups?.[0].sourceRunIds, [b.id, a.id]);
    assert.deepEqual(saved.versions[0].groups?.[0].dimensionIds, ['custom-b', 'custom-a']);
    assert.equal(saved.versions[0].groups?.length, 1);
    for (const old of before) assert.deepEqual(await store.getRun(old.id), old);
    const restored = new FileStore(root); await restored.initialize();
    assert.deepEqual((await restored.getVersion(exp.id, version.id)).groups, saved.versions[0].groups);
    const newVersion = (await store.saveVersion(exp.id, { title: 'new', businessBrief: 'business', config, dimensions, referenceId: reference.id })).versions.at(-1)!;
    await assert.rejects(store.createCombinationRun(exp.id, newVersion.id, 'combo', [a.id, b.id]), /当前版本/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
