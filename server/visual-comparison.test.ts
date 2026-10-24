import { createServer } from 'node:http';
import { createApp, errorHandler } from './http.ts';
import type { RunnerController } from './contracts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VisualComparisons } from './visual-comparison.ts';
import { hashWebsite } from './runner.ts';
import { FileStore } from './store.ts';
import type { Run } from '../shared/types.ts';

test('capture uses frozen baseline, isolated resources, cached output and refuses active or invalid baselines', { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'pretty-highlight-'));
  const root = path.join(temporary, '.data');
  const runDir = (id: string) => path.join(root, 'runs', id);
  const websiteDir = (id: string) => path.join(runDir(id), 'website');
  const frozen = path.join(runDir('base'), 'frozen');
  const html = '<!doctype html><link rel="stylesheet" href="style.css"><main>Baseline</main>';
  for (const dir of [frozen, websiteDir('base'), websiteDir('edit')]) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), html);
    await writeFile(path.join(dir, 'style.css'), 'body{margin:0;background:white}main{width:100px;height:100px;background:#aaccff}');
  }
  const baselineHash = await hashWebsite(frozen);
  const base = { id: 'base', groupId: 'baseline', status: 'completed', artifactHash: baselineHash } as Run;
  const run = { id: 'edit', groupId: 'color', dimensionIds: ['color'], baselineRunId: 'base', baselineHash, hasPreview: true, status: 'completed' } as Run;
  const store = { root, runDir, websiteDir, getRun: async (id: string) => id === 'base' ? base : run } as unknown as FileStore;
  const service = new VisualComparisons(store, 4173);
  try {
    // The live baseline is intentionally different: the original frozen input must win.
    await writeFile(path.join(websiteDir('base'), 'index.html'), '<h1>WRONG BASELINE</h1>');
    const beforeHash = await hashWebsite(websiteDir('edit'));
    const [result, duplicate] = await Promise.all([service.get('edit'), service.get('edit')]);
    assert.deepEqual(result, duplicate);
    const key = result.resultUrl.split('/').at(-2)!;
    const dir = path.join(service.directory('edit'), key);
    assert.deepEqual(await readFile(path.join(dir, 'baseline.png')), await readFile(path.join(dir, 'result.png')));
    assert.equal(result.baselineHash, baselineHash);
    assert.equal(result.baselineRunId, 'base');
    assert.deepEqual(await service.get('edit'), result);
    // Real storage is under a hidden .data ancestor; sendFile must still return PNG bytes.
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const app = createApp({ store, comparisons: service, runner: {} as RunnerController, consolePort: port, previewOrigin: 'http://127.0.0.1:4174', config: { model: 'fixture', reasoningEffort: 'low', cliVersion: 'test', concurrency: 1, timeoutMs: 1000 }, runtime: { codexAvailable: true, authenticated: true, version: 'test' } });
    app.use(errorHandler);
    server.on('request', app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${result.resultUrl}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /image\/png/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path.join(dir, 'result.png')));
      const denied = await fetch(`http://127.0.0.1:${port}${result.resultUrl}`, { headers: { Origin: 'http://127.0.0.1:4174' } });
      assert.equal(denied.status, 403);
    } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }

    assert.equal(await hashWebsite(frozen), baselineHash);
    assert.equal(await hashWebsite(websiteDir('edit')), beforeHash);
    // Different artifact content cannot reuse old screenshots.
    await writeFile(path.join(websiteDir('edit'), 'style.css'), 'body{margin:0;background:white}main{width:100px;height:100px;background:#ff5555}');
    const changed = await service.get('edit');
    assert.notEqual(changed.resultUrl, result.resultUrl);
    assert.notDeepEqual(await readFile(path.join(service.directory('edit'), changed.resultUrl.split('/').at(-2)!, 'result.png')), await readFile(path.join(dir, 'result.png')));
    run.status = 'running';
    await assert.rejects(service.get('edit'), /生成结束/);
    run.status = 'completed';
    await writeFile(path.join(websiteDir('edit'), 'index.html'), '<img src="http://127.0.0.1:4173/api/health">');
    await assert.rejects(service.get('edit'), /无法完整加载/);
    run.baselineHash = 'wrong';
    await assert.rejects(service.get('edit'), /校验失败/);
  } finally { await service.shutdown(); await rm(temporary, { recursive: true, force: true }); }
});
