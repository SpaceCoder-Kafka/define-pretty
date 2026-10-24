import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_BUSINESS_BRIEF, DEFAULT_DIMENSIONS } from '../shared/defaults.ts';
import type { ExperimentInput } from '../shared/types.ts';
import { createApp, createPreviewApp } from './http.ts';
import { FileStore } from './store.ts';
import { detectImageType, safeFilePath } from './security.ts';

const input: ExperimentInput = { title: 'API test', businessBrief: DEFAULT_BUSINESS_BRIEF, dimensions: DEFAULT_DIMENSIONS, config: { model: 'test-model', reasoningEffort: 'high', provider: 'custom', cliVersion: 'actual-cli', concurrency: 2, timeoutMs: 1800000 } };

test('API rejects foreign origins and missing tokens; snapshots use server runtime identity', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-api-'));
  const root = path.join(temporary, '.data');
  const store = new FileStore(root);
  await store.initialize();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const runner = { enqueue: async () => {}, cancel: async () => {}, shutdown: async () => {} };
  server.on('request', createApp({ store, runner, consolePort: port, previewOrigin: 'http://127.0.0.1:4174', config: input.config, runtime: { codexAvailable: true, authenticated: true, version: 'actual-cli' }, token: 'test-token' }));
  try {
    assert.equal((await fetch(`${origin}/api/bootstrap`, { headers: { Origin: 'https://foreign.example' } })).status, 403);
    const bootstrap = await (await fetch(`${origin}/api/bootstrap`)).json() as { token: string };
    assert.equal(bootstrap.token, 'test-token');
    assert.equal((await fetch(`${origin}/api/experiments`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status, 403);
    const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Define-Pretty-Token': 'test-token' };
    const saved = await fetch(`${origin}/api/experiments`, { method: 'POST', headers, body: JSON.stringify({ ...input, config: { ...input.config, concurrency: 7, provider: 'forged', cliVersion: 'forged' } }) });
    assert.equal(saved.status, 201);
    const body = await saved.json() as { experiment: { id: string; versions: { config: typeof input.config; id: string }[] } };
    assert.equal(body.experiment.versions[0].config.provider, 'custom');
    assert.equal(body.experiment.versions[0].config.cliVersion, 'actual-cli');
    assert.equal(body.experiment.versions[0].config.concurrency, 7);
    const updated = await fetch(`${origin}/api/experiments/${body.experiment.id}/versions`, { method: 'POST', headers, body: JSON.stringify({ ...input, config: { ...input.config, concurrency: 12 } }) });
    assert.equal(updated.status, 201);
    assert.equal((await updated.json()).experiment.versions[1].config.concurrency, 12);
    for (const concurrency of [0, -1, 1.5, '4', null]) {
      const invalid = await fetch(`${origin}/api/experiments`, { method: 'POST', headers, body: JSON.stringify({ ...input, config: { ...input.config, concurrency } }) });
      assert.equal(invalid.status, 400, `invalid concurrency ${concurrency} must be rejected`);
    }
    assert.equal((await fetch(`${origin}/api/experiments/${body.experiment.id}/runs`, { method: 'POST', headers, body: JSON.stringify({ versionId: body.experiment.versions[0].id, groupIds: ['direct'] }) })).status, 400);
    const invalid = new FormData();
    invalid.append('file', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'disguised.png');
    assert.equal((await fetch(`${origin}/api/references`, { method: 'POST', headers: { Origin: origin, 'X-Define-Pretty-Token': 'test-token' }, body: invalid })).status, 400);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fAAAAABJRU5ErkJggg==', 'base64');
    const valid = new FormData();
    valid.append('file', new Blob([png], { type: 'image/png' }), 'reference.png');
    const uploadResponse = await fetch(`${origin}/api/references`, { method: 'POST', headers: { Origin: origin, 'X-Define-Pretty-Token': 'test-token' }, body: valid });
    assert.equal(uploadResponse.status, 201);
    const reference = await uploadResponse.json() as { url: string };
    const imageResponse = await fetch(`${origin}${reference.url}`);
    assert.equal(imageResponse.status, 200, 'reference assets under .data must be served');
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
    const [run] = await store.createRuns(body.experiment.id, body.experiment.versions[0].id, ['baseline']);
    await writeFile(path.join(store.runDir(run.id), 'prompt.txt'), 'actual prompt evidence');
    const artifactResponse = await fetch(`${origin}/api/runs/${run.id}/artifacts/prompt.txt`);
    assert.equal(artifactResponse.status, 200, 'artifact evidence under .data must be served');
    assert.match(artifactResponse.headers.get('content-disposition') ?? '', /attachment/);
    assert.equal(await artifactResponse.text(), 'actual prompt evidence');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(temporary, { recursive: true, force: true }); }
});

test('preview never exposes API or traverses the artifact root and is sandboxed', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-preview-'));
  const root = path.join(temporary, '.data');
  const store = new FileStore(root);
  await store.initialize();
  const experiment = await store.createExperiment(input);
  const [run] = await store.createRuns(experiment.id, experiment.versions[0].id, ['baseline']);
  await mkdir(store.websiteDir(run.id));
  await writeFile(path.join(store.websiteDir(run.id), 'index.html'), '<h1>Preview</h1>');
  await writeFile(path.join(store.runDir(run.id), 'private.txt'), 'private');
  await symlink(path.join(store.runDir(run.id), 'private.txt'), path.join(store.websiteDir(run.id), 'escape.txt'));
  const server = createServer(createPreviewApp(store, 4173));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${origin}/runs/${run.id}/index.html`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox allow-scripts/);
    assert.doesNotMatch(response.headers.get('content-security-policy') ?? '', /allow-same-origin/);
    assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 404);
    assert.equal((await fetch(`${origin}/runs/${run.id}/escape.txt`)).status, 403);
    await assert.rejects(safeFilePath(store.websiteDir(run.id), '../private.txt'));
    await assert.rejects(safeFilePath(store.websiteDir(run.id), '/etc/passwd'));
    assert.equal((await fetch(`${origin}/favicon.ico`)).status, 204);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(temporary, { recursive: true, force: true }); }
});

test('reference uploads distinguish supported image bytes from filename claims', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fAAAAABJRU5ErkJggg==', 'base64');
  assert.equal(detectImageType(png)?.mimeType, 'image/png');
  assert.equal(detectImageType(Buffer.from('<svg/>')), undefined);
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), undefined);
});
