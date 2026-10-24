import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { DEFAULT_BUSINESS_BRIEF, DEFAULT_DIMENSIONS } from '../shared/defaults.ts';
import { DIMENSION_IDS, type Experiment, type Run, type ValidationResult } from '../shared/types.ts';
import { FileStore } from './store.ts';
import { Runner, executeCodex, hashWebsite, type ExecutionOptions, type Executor, type Validator } from './runner.ts';

const goodValidation: ValidationResult = { passed: true, checks: [{ id: 'fixture', label: 'test fixture', passed: true }], consoleErrors: [], resourceErrors: [], contentChanges: [] };

async function harness(executor: Executor, options: { timeoutMs?: number; validator?: Validator; concurrency?: number } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-runner-'));
  const store = new FileStore(root);
  await store.initialize();
  const reference = await store.addReference('reference.png', 'image/png', Buffer.from('fixed-reference-bytes'));
  const experiment = await store.createExperiment({
    title: 'Runner tests', businessBrief: DEFAULT_BUSINESS_BRIEF, referenceId: reference.id,
    dimensions: DEFAULT_DIMENSIONS,
    config: { model: 'test', reasoningEffort: 'high', cliVersion: 'test', provider: 'custom', concurrency: options.concurrency ?? 2, timeoutMs: 10000 },
  });
  const runner = new Runner({ store, previewOrigin: 'http://127.0.0.1:9999', executor, validator: options.validator ?? (async () => goodValidation), timeoutMs: options.timeoutMs });
  return { root, store, experiment, runner, cleanup: async () => { await runner.shutdown(); await rm(root, { recursive: true, force: true }); } };
}

async function startBaseline(store: FileStore, experiment: Experiment, runner: Runner): Promise<Run> {
  const [run] = await store.createRuns(experiment.id, experiment.versions[0].id, ['baseline']);
  await runner.enqueue(run.id);
  await runner.waitForIdle();
  return store.getRun(run.id);
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await pause(10); }
  throw new Error('Timed out waiting for test condition');
}

test('all ten modifications start from identical frozen bytes, with at most two concurrent jobs', async () => {
  const initial = '<html><body>FROZEN_BASELINE</body></html>';
  const starts: { group: string; initial: string; reference?: string }[] = [];
  let active = 0;
  let maximum = 0;
  const h = await harness(async options => {
    active++; maximum = Math.max(maximum, active);
    if (options.run.groupId !== 'baseline') starts.push({ group: options.run.groupId, initial: await readFile(path.join(options.cwd, 'website/index.html'), 'utf8'), reference: options.referenceFile });
    else assert.equal(options.referenceFile, undefined);
    if (options.run.groupId === 'direct') {
      assert.equal(options.prompt, 'website/ 中已有一份完整的项目管理网页。请参照所附参考图的风格润色这个网页。');
      assert.equal(await readFile(path.join(options.cwd, 'prompt.txt'), 'utf8'), options.prompt);
      assert.equal(JSON.parse(await readFile(path.join(options.cwd, 'input.json'), 'utf8')).prompt, options.prompt);
    }
    await pause(10);
    await writeFile(path.join(options.cwd, 'website/index.html'), options.run.groupId === 'baseline' ? initial : `<html><body>${options.run.groupId}</body></html>`);
    await writeFile(path.join(options.cwd, 'events.jsonl'), '{"type":"turn.completed"}\n');
    active--;
    return { exitCode: 0, summary: 'fixture complete', usage: { input_tokens: 20, output_tokens: 10 } };
  });
  try {
    const baseline = await startBaseline(h.store, h.experiment, h.runner);
    assert.equal(baseline.status, 'completed');
    assert.equal(await readFile(path.join(h.store.runDir(baseline.id), 'frozen/index.html'), 'utf8'), initial);
    const runs = await h.store.createRuns(h.experiment.id, h.experiment.versions[0].id, ['direct', ...DIMENSION_IDS]);
    await Promise.all(runs.map(run => h.runner.enqueue(run.id)));
    await h.runner.waitForIdle();
    assert.equal(starts.length, 10);
    assert.equal(maximum, 2);
    for (const start of starts) { assert.equal(start.initial, initial); assert.ok(start.reference); }
    for (const run of runs) {
      const saved = await h.store.getRun(run.id);
      assert.equal(saved.status, 'completed');
      assert.equal(saved.baselineHash, baseline.artifactHash);
      const input = JSON.parse(await readFile(path.join(h.store.runDir(run.id), 'input.json'), 'utf8'));
      assert.deepEqual(input.rules.map((rule: { id: string }) => rule.id), run.groupId === 'direct' ? [] : [run.groupId]);
      assert.match(await readFile(path.join(h.store.runDir(run.id), 'diff.txt'), 'utf8'), /FROZEN_BASELINE/);
    }
    assert.equal(await hashWebsite(path.join(h.store.runDir(baseline.id), 'frozen')), baseline.artifactHash);
  } finally { await h.cleanup(); }
});

test('validation failure keeps artifacts but never binds a usable baseline', async () => {
  const h = await harness(async options => {
    await writeFile(path.join(options.cwd, 'website/index.html'), '<p>failed but inspectable</p>');
    return { exitCode: 0 };
  }, { validator: async () => ({ ...goodValidation, passed: false, checks: [{ id: 'search', label: 'search', passed: false, details: 'missing' }] }) });
  try {
    const run = await startBaseline(h.store, h.experiment, h.runner);
    assert.equal(run.status, 'failed');
    assert.equal(run.hasPreview, true);
    assert.equal((await h.store.getVersion(h.experiment.id, run.versionId)).baselineRunId, undefined);
    assert.match(await readFile(path.join(h.store.runDir(run.id), 'validation.json'), 'utf8'), /missing/);
    await assert.rejects(h.store.createRuns(h.experiment.id, run.versionId, ['direct']), /原始页面/);
  } finally { await h.cleanup(); }
});

test('queued and active cancellation are distinct from successful completion', async () => {
  let started = 0;
  const h = await harness(async options => {
    if (options.run.groupId === 'baseline') {
      await writeFile(path.join(options.cwd, 'website/index.html'), '<p>base</p>');
      return { exitCode: 0 };
    }
    started++;
    await new Promise<void>(resolve => {
      if (options.signal.aborted) resolve();
      else options.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return { exitCode: null };
  });
  try {
    await startBaseline(h.store, h.experiment, h.runner);
    const runs = await h.store.createRuns(h.experiment.id, h.experiment.versions[0].id, ['direct', 'layout', 'color']);
    for (const run of runs) await h.runner.enqueue(run.id);
    await waitUntil(() => started === 2);
    await h.runner.cancel(runs[2].id);
    assert.equal((await h.store.getRun(runs[2].id)).status, 'cancelled');
    await Promise.all([h.runner.cancel(runs[0].id), h.runner.cancel(runs[1].id)]);
    await h.runner.waitForIdle();
    assert.equal(started, 2);
    for (const run of runs) assert.equal((await h.store.getRun(run.id)).status, 'cancelled');
  } finally { await h.cleanup(); }
});

test('timeouts fail the attempt and stop the executor through its signal', async () => {
  let aborted = false;
  const h = await harness(async options => {
    await new Promise<void>(resolve => {
      const finish = () => { aborted = true; resolve(); };
      if (options.signal.aborted) finish(); else options.signal.addEventListener('abort', finish, { once: true });
    });
    return { exitCode: null };
  }, { timeoutMs: 75 });
  try {
    const run = await startBaseline(h.store, h.experiment, h.runner);
    assert.equal(run.status, 'failed');
    assert.equal(aborted, true);
    assert.match(run.error || '', /时间限制/);
  } finally { await h.cleanup(); }
});

test('cancelling during browser checks never publishes a successful baseline', async () => {
  let checking = false;
  const h = await harness(async options => {
    await writeFile(path.join(options.cwd, 'website/index.html'), '<p>base</p>');
    return { exitCode: 0 };
  }, { validator: async options => {
    checking = true;
    await new Promise<void>(resolve => options.signal?.aborted ? resolve() : options.signal?.addEventListener('abort', () => resolve(), { once: true }));
    return goodValidation;
  } });
  try {
    const [run] = await h.store.createRuns(h.experiment.id, h.experiment.versions[0].id, ['baseline']);
    await h.runner.enqueue(run.id);
    await waitUntil(() => checking);
    await h.runner.cancel(run.id);
    assert.equal((await h.store.getRun(run.id)).status, 'cancelled');
    assert.equal((await h.store.getVersion(h.experiment.id, run.versionId)).baselineRunId, undefined);
  } finally { await h.cleanup(); }
});

test('a changed frozen baseline is rejected before the model can run', async () => {
  let executions = 0;
  const h = await harness(async options => {
    executions++;
    await writeFile(path.join(options.cwd, 'website/index.html'), '<p>base</p>');
    return { exitCode: 0 };
  });
  try {
    const baseline = await startBaseline(h.store, h.experiment, h.runner);
    await writeFile(path.join(h.store.runDir(baseline.id), 'frozen/index.html'), '<p>tampered</p>');
    const [run] = await h.store.createRuns(h.experiment.id, baseline.versionId, ['direct']);
    await h.runner.enqueue(run.id);
    await h.runner.waitForIdle();
    const saved = await h.store.getRun(run.id);
    assert.equal(saved.status, 'failed');
    assert.match(saved.error || '', /冻结基线/);
    assert.equal(executions, 1);
  } finally { await h.cleanup(); }
});

test('service shutdown marks running and queued attempts interrupted', async () => {
  let started = 0;
  const h = await harness(async options => {
    if (options.run.groupId === 'baseline') {
      await writeFile(path.join(options.cwd, 'website/index.html'), '<p>base</p>');
      return { exitCode: 0 };
    }
    started++;
    await new Promise<void>(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', () => resolve(), { once: true }));
    return { exitCode: null };
  });
  try {
    const baseline = await startBaseline(h.store, h.experiment, h.runner);
    const runs = await h.store.createRuns(h.experiment.id, baseline.versionId, ['direct', 'layout', 'color']);
    for (const run of runs) await h.runner.enqueue(run.id);
    await waitUntil(() => started === 2);
    await h.runner.shutdown();
    for (const run of runs) assert.equal((await h.store.getRun(run.id)).status, 'interrupted');
  } finally { await h.cleanup(); }
});

async function fakeCli(script: string, callback: (cwd: string, options: ExecutionOptions) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-process-'));
  const bin = path.join(directory, 'bin');
  await mkdir(bin);
  const cli = path.join(bin, 'codex');
  await writeFile(cli, `#!/usr/bin/env node\nif(process.argv.includes('--version')) { console.log('fixture-codex'); process.exit(0); }\n${script}\n`);
  await chmod(cli, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  const controller = new AbortController();
  try {
    await callback(directory, {
      run: { id: 'fixture', experimentId: 'experiment', versionId: 'version', groupId: 'baseline', attempt: 1, status: 'running', createdAt: '', hasPreview: false },
      cwd: directory, prompt: 'fixture prompt', config: { model: 'fixture', reasoningEffort: 'high', cliVersion: 'fixture-codex', concurrency: 2, timeoutMs: 1000 }, signal: controller.signal,
    });
  } finally {
    controller.abort();
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('CLI completion resolves transient errors and preserves split UTF-8 output', async () => {
  await fakeCli(`
process.stdout.write(JSON.stringify({type:'error',message:'temporary connection error'})+'\\n');
const text = Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'中文完成'}})+'\\n');
const split = text.indexOf(Buffer.from('中')) + 1;
process.stdout.write(text.subarray(0, split));
setTimeout(() => {
  process.stdout.write(text.subarray(split));
  process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:42}})+'\\n');
}, 10);
`, async (_directory, options) => {
    const result = await executeCodex(options);
    assert.equal(result.exitCode, 0);
    assert.equal(result.error, undefined);
    assert.equal(result.summary, '中文完成');
    assert.equal(result.usage?.input_tokens, 42);
  });
});

test('cancellation kills a TERM-resistant descendant after the CLI parent exits', { skip: process.platform === 'win32' }, async () => {
  await fakeCli(`
const {spawn} = require('node:child_process');
const {writeFileSync} = require('node:fs');
const child = spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
writeFileSync('descendant.pid',String(child.pid));
setInterval(()=>{},1000);
`, async (directory, options) => {
    const controller = new AbortController();
    let pid: number | undefined;
    try {
      const running = executeCodex({ ...options, signal: controller.signal });
      await waitUntil(async () => {
        try { pid = Number(await readFile(path.join(directory, 'descendant.pid'), 'utf8')); return Boolean(pid); }
        catch { return false; }
      });
      await pause(100); // Let the descendant install its TERM handler.
      controller.abort();
      await running;
      await waitUntil(() => {
        try { process.kill(pid!, 0); return false; }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      });
    } finally {
      controller.abort();
      if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ }
    }
  });
});

for (const limit of [1, 4, 10]) {
  test(`saved concurrency ${limit} controls actual parallel execution without a hidden two-job cap`, async () => {
    let active = 0, peak = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const h = await harness(async options => {
      if (options.run.groupId !== 'baseline') {
        active++; peak = Math.max(peak, active);
        await gate;
      }
      await writeFile(path.join(options.cwd, 'website/index.html'), '<p>fixture</p>');
      if (options.run.groupId !== 'baseline') active--;
      return { exitCode: 0 };
    }, { concurrency: limit });
    try {
      await startBaseline(h.store, h.experiment, h.runner);
      const runs = await h.store.createRuns(h.experiment.id, h.experiment.versions[0].id, ['direct', ...DIMENSION_IDS]);
      await Promise.all(runs.map(run => h.runner.enqueue(run.id)));
      await waitUntil(() => active === limit);
      assert.equal(peak, limit);
      release();
      await h.runner.waitForIdle();
      assert.equal(peak, limit);
      for (const run of runs) assert.equal((await h.store.getRun(run.id)).status, 'completed');
    } finally { release(); await h.cleanup(); }
  });
}

test('versions keep separate saved limits and a full version does not block another', async () => {
  const active = new Map<string, number>(), peaks = new Map<string, number>();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await harness(async options => {
    const version = options.run.versionId;
    if (options.run.groupId !== 'baseline') {
      active.set(version, (active.get(version) ?? 0) + 1);
      peaks.set(version, Math.max(peaks.get(version) ?? 0, active.get(version)!));
      await gate;
    }
    await writeFile(path.join(options.cwd, 'website/index.html'), '<p>fixture</p>');
    if (options.run.groupId !== 'baseline') active.set(version, active.get(version)! - 1);
    return { exitCode: 0 };
  }, { concurrency: 1 });
  try {
    const baseline = await startBaseline(h.store, h.experiment, h.runner);
    const original = await h.store.getVersion(h.experiment.id, baseline.versionId);
    const next = await h.store.saveVersion(h.experiment.id, { title: h.experiment.title, businessBrief: original.businessBrief, dimensions: original.dimensions, referenceId: original.referenceId, config: { ...original.config, concurrency: 3 } });
    const newer = next.versions.at(-1)!;
    assert.equal(newer.baselineRunId, baseline.id);
    const first = await h.store.createRuns(h.experiment.id, original.id, ['direct', 'layout']);
    const second = await h.store.createRuns(h.experiment.id, newer.id, ['direct', 'layout', 'spacing', 'color']);
    for (const run of [...first, ...second]) await h.runner.enqueue(run.id);
    await waitUntil(() => active.get(original.id) === 1 && active.get(newer.id) === 3);
    release(); await h.runner.waitForIdle();
    assert.equal(peaks.get(original.id), 1); assert.equal(peaks.get(newer.id), 3);
  } finally { release(); await h.cleanup(); }
});
