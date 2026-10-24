import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseStyleSpec } from './style-spec.ts';
import { currentGenerationPrompt } from '../shared/generation-prompt.ts';
import { FileStore } from './store.ts';
import { SpecGenerator, DEFAULT_GENERATION_PROMPT } from './specs.ts';
import { buildRunInput } from './prompts.ts';
import { experimentGroups } from '../shared/groups.ts';

const output = { dimensions: [
  { kind: 'whole-page', title: '整页视觉重点', scope: '整页主次关系', rules: ['GLOBAL_PRIORITY_A', 'GLOBAL_PRIORITY_B', 'GLOBAL_PRIORITY_C'], observations: '整页观察。' },
  { kind: 'attribute', title: '文字', scope: '文本属性', rules: ['LOCAL_TYPE_A', 'LOCAL_TYPE_B', 'LOCAL_TYPE_C'], observations: 'OBSERVATION_ONLY' },
] };
test('whole-page direction is exactly one selectable dimension; all rules have 3–5 items without synthesis or adaptation sections', () => {
  const parsed = parseStyleSpec(JSON.stringify(output), 'job');
  assert.equal(parsed.dimensions?.[0].title, '整页视觉重点');
  assert.equal(parsed.dimensions?.length, 2);
  assert.doesNotMatch(parsed.dimensions![1].instructions, /GLOBAL_PRIORITY|OBSERVATION_ONLY|必要适配/);
  assert.ok(!('styleGuide' in parsed));
  assert.throws(() => parseStyleSpec(JSON.stringify({ ...output, direction: 'leak' }), 'job'), /独立维度/);
  assert.throws(() => parseStyleSpec(JSON.stringify({ dimensions: [output.dimensions[1], output.dimensions[1]] }), 'job'), /只能有一个/);
  assert.throws(() => parseStyleSpec(JSON.stringify({ dimensions: [output.dimensions[0], output.dimensions[0]] }), 'job'), /只能有一个/);
  assert.throws(() => parseStyleSpec(JSON.stringify({ dimensions: [output.dimensions[0], { ...output.dimensions[1], rules: Array(6).fill('too many') }] }), 'job'), /3–5/);
});
test('known former default migrates in the editor, custom prompts remain intact', () => {
  assert.equal(currentGenerationPrompt('从参考图提炼一份精简的风格迁移规范。direction：old synthesis：old', DEFAULT_GENERATION_PROMPT), DEFAULT_GENERATION_PROMPT);
  assert.equal(currentGenerationPrompt('我的自定义提示词', DEFAULT_GENERATION_PROMPT), '我的自定义提示词');
});
test('generated independent dimensions persist, reuse baseline, run separately or together; C3 is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pretty-independent-'));
  const store = new FileStore(root); await store.initialize();
  const config = { model: 'experiment', reasoningEffort: 'medium', cliVersion: 'test', concurrency: 2, timeoutMs: 1000 };
  const reference = await store.addReference('ref.png', 'image/png', Buffer.from('image'));
  const generator = new SpecGenerator(store, async options => {
    assert.equal(options.config.model, 'generation'); assert.equal(options.readOnly, true);
    assert.match(options.prompt, /输出契约/);
    return { exitCode: 0, summary: JSON.stringify(output) };
  });
  try {
    const started = await generator.start(reference.id, { ...config, model: 'generation' }, DEFAULT_GENERATION_PROMPT);
    for (let i = 0; i < 100 && (await store.getGeneration(started.id)).status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const job = await store.getGeneration(started.id);
    assert.equal(job.status, 'completed'); assert.equal(job.formatVersion, 4); assert.equal(job.styleGuide, undefined);
    const dimensions = job.dimensions!;
    const input = { title: 'independent', businessBrief: 'business', config, dimensions, referenceId: reference.id };
    const exp = await store.createExperiment(input); const v1 = exp.versions[0];
    const [base] = await store.createRuns(exp.id, v1.id, ['baseline']);
    await store.updateRun(base.id, { status: 'completed', artifactHash: 'baseline-hash' }); await store.bindBaseline(exp.id, v1.id, base.id);
    const updated = await store.saveVersion(exp.id, { ...input, groups: [{ id: 'combo', title: '重点＋文字', dimensionIds: dimensions.map(d => d.id) }] });
    const v2 = updated.versions.at(-1)!;
    assert.equal(v2.baselineRunId, base.id);
    assert.ok(!experimentGroups(v2).some(g => g.id === 'reference-constrained'));
    await assert.rejects(store.createRuns(exp.id, v2.id, ['reference-constrained']), /有效/);
    const runs = await store.createRuns(exp.id, v2.id, ['all-rules', ...dimensions.map(d => d.id), 'combo']);
    assert.ok(runs.every(r => r.baselineHash === 'baseline-hash'));
    assert.equal(buildRunInput(v2, 'all-rules', reference).rules.length, 2);
    assert.equal(buildRunInput(v2, 'combo', reference).rules.length, 2);
    const single = buildRunInput(v2, dimensions[1].id, reference);
    assert.doesNotMatch(single.prompt, /GLOBAL_PRIORITY|OBSERVATION_ONLY/);
    assert.equal(single.rules.length, 1);
    const restored = new FileStore(root); await restored.initialize();
    assert.deepEqual((await restored.getVersion(exp.id, v2.id)).dimensions, dimensions);
  } finally { await generator.shutdown(); await rm(root, { recursive: true, force: true }); }
});
