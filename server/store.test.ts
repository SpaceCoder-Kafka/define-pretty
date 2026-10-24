import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_BUSINESS_BRIEF, DEFAULT_DIMENSIONS } from '../shared/defaults.ts';
import { DIMENSION_IDS, type ExperimentInput } from '../shared/types.ts';
import { FileStore } from './store.ts';

const config = { model: 'test-model', reasoningEffort: 'high', provider: 'custom', cliVersion: 'test-cli', concurrency: 2, timeoutMs: 1800000 };
const input = (): ExperimentInput => ({ title: '实验', businessBrief: DEFAULT_BUSINESS_BRIEF, dimensions: structuredClone(DEFAULT_DIMENSIONS), config: { ...config } });

test('versions reuse only compatible frozen baselines and every group gets the same source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-store-'));
  try {
    const store = new FileStore(root);
    await store.initialize();
    const reference = await store.addReference('reference.png', 'image/png', Buffer.from('fixture'));
    const setup = { ...input(), referenceId: reference.id };
    const experiment = await store.createExperiment(setup);
    setup.dimensions[0].instructions = 'An external mutation must not alter saved input';
    assert.notEqual((await store.getVersion(experiment.id, experiment.versions[0].id)).dimensions[0].instructions, setup.dimensions[0].instructions);
    const version = experiment.versions[0];
    const [baseline] = await store.createRuns(experiment.id, version.id, ['baseline']);
    await assert.rejects(store.createRuns(experiment.id, version.id, ['direct']), /原始页面/);
    await store.updateRun(baseline.id, { status: 'completed', artifactHash: 'frozen-hash', hasPreview: true });
    await store.bindBaseline(experiment.id, version.id, baseline.id);
    const runs = await store.createRuns(experiment.id, version.id, ['direct', ...DIMENSION_IDS]);
    assert.equal(runs.length, 10);
    assert.ok(runs.every((run) => run.baselineRunId === baseline.id && run.baselineHash === 'frozen-hash'));
    await assert.rejects(store.createRuns(experiment.id, version.id, ['direct']), /正在运行/);
    await store.updateRun(runs[0].id, { status: 'failed', error: 'fixture failure' });
    const [retry] = await store.createRuns(experiment.id, version.id, ['direct']);
    assert.equal(retry.attempt, 2);
    assert.notEqual(retry.id, runs[0].id);
    assert.equal((await store.getRun(runs[0].id)).status, 'failed');

    const edited = await store.saveVersion(experiment.id, setup);
    assert.equal(edited.versions.at(-1)?.baselineRunId, baseline.id);
    const changedBusiness = await store.saveVersion(experiment.id, { ...setup, businessBrief: '新的业务需求' });
    assert.equal(changedBusiness.versions.at(-1)?.baselineRunId, undefined);
    const changedModel = await store.saveVersion(experiment.id, { ...setup, config: { ...config, model: 'another-model' } });
    assert.equal(changedModel.versions.at(-1)?.baselineRunId, undefined);
    assert.equal((await store.getRun(runs[0].id)).baselineRunId, baseline.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restart preserves failures, reviews and history while interrupting unfinished work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-recovery-'));
  try {
    const store = new FileStore(root);
    await store.initialize();
    const experiment = await store.createExperiment(input());
    const [run] = await store.createRuns(experiment.id, experiment.versions[0].id, ['baseline']);
    await store.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() });
    const recovered = new FileStore(root);
    await recovered.initialize();
    assert.equal((await recovered.getRun(run.id)).status, 'interrupted');
    assert.match((await recovered.getRun(run.id)).error ?? '', /重启/);
    await recovered.saveReview(run.id, { adherence: 'partial', scope: 'outside', preference: 'worse', notes: '留下失败记录' });
    const [retry] = await recovered.createRuns(experiment.id, experiment.versions[0].id, ['baseline']);
    assert.equal(retry.attempt, 2);
    const again = new FileStore(root);
    await again.initialize();
    assert.equal((await again.getRun(run.id)).review?.notes, '留下失败记录');
    assert.equal((await again.getRun(retry.id)).status, 'interrupted');
    assert.equal((await again.listRuns(experiment.id)).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent version saves remain atomic and do not lose history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-concurrency-'));
  try {
    const store = new FileStore(root);
    await store.initialize();
    const experiment = await store.createExperiment(input());
    await Promise.all(Array.from({ length: 5 }, (_, index) => store.saveVersion(experiment.id, { ...input(), title: `实验 ${index}` })));
    const saved = await store.getExperiment(experiment.id);
    assert.deepEqual(saved.versions.map((version) => version.number), [1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(saved.versions.map((version) => version.id)).size, 6);
  } finally { await rm(root, { recursive: true, force: true }); }
});
