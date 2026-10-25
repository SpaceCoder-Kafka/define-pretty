import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FeatureBoards } from './feature-boards.ts';
import { allowedPreviewResource, type FeatureTests } from './feature-tests.ts';

import { createApp, createPreviewApp } from './http.ts';
import { FileStore } from './store.ts';
import { detectImageType, safeFilePath } from './security.ts';

const config = { model: 'test-model', reasoningEffort: 'high', provider: 'custom', cliVersion: 'actual-cli' };

test('API rejects foreign origins and missing tokens; snapshots use server runtime identity', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-api-'));
  const root = path.join(temporary, '.data');
  const store = new FileStore(root);
  await store.initialize();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const featureBoards = new FeatureBoards(store); await featureBoards.initialize();
  server.on('request', createApp({ store, featureBoards, consolePort: port, previewOrigin: 'http://127.0.0.1:4174', config, runtime: { codexAvailable: true, authenticated: true, version: 'actual-cli' }, token: 'test-token' }));
  try {
    assert.equal((await fetch(`${origin}/api/bootstrap`, { headers: { Origin: 'https://foreign.example' } })).status, 403);
    const bootstrap = await (await fetch(`${origin}/api/bootstrap`)).json() as { token: string };
    assert.equal(bootstrap.token, 'test-token');
    assert.equal((await fetch(`${origin}/api/feature-boards`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Define-Pretty-Token': 'test-token' };
    for (const route of ['/experiments', '/runs/old', '/generations', '/dimension-templates', '/events']) {
      assert.equal((await fetch(`${origin}/api${route}`)).status, 404);
      assert.equal((await fetch(`${origin}/api${route}`, { method: 'POST', headers, body: '{}' })).status, 404);
    }
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
    const saved = await fetch(`${origin}/api/feature-boards`, { method: 'POST', headers, body: JSON.stringify({ referenceId: reference.url.split('/').at(-1), title: '卡片', config: { ...config, provider: 'forged', cliVersion: 'forged' } }) });
    assert.equal(saved.status, 201);
    const board = await saved.json();
    assert.equal(board.config.provider, 'custom');
    assert.equal(board.config.cliVersion, 'actual-cli');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(temporary, { recursive: true, force: true }); }
});

test('preview never exposes API or traverses the artifact root and is sandboxed', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-preview-'));
  const root = path.join(temporary, '.data');
  const website = path.join(root, 'website');
  await mkdir(website, { recursive: true });
  await writeFile(path.join(website, 'index.html'), '<h1>Preview</h1>');
  await writeFile(path.join(root, 'private.txt'), 'private');
  await symlink(path.join(root, 'private.txt'), path.join(website, 'escape.txt'));
  const tests = { get: async () => ({ hasPreview: true, status: 'completed' }), websiteDirectory: () => website } as unknown as FeatureTests;
  const server = createServer(createPreviewApp(4193, tests));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${origin}/feature-tests/runs/result/index.html`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
    assert.match(response.headers.get('content-security-policy') ?? '', /font-src 'self' data: https:/);
    assert.match(response.headers.get('content-security-policy') ?? '', /style-src 'self' 'unsafe-inline' https:/);
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self' 'unsafe-inline';/);
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox allow-scripts/);
    assert.doesNotMatch(response.headers.get('content-security-policy') ?? '', /allow-same-origin/);
    assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 404);
    assert.equal((await fetch(`${origin}/feature-tests/runs/result/escape.txt`)).status, 403);
    await assert.rejects(safeFilePath(website, '../private.txt'));
    await assert.rejects(safeFilePath(website, '/etc/passwd'));
    assert.equal((await fetch(`${origin}/favicon.ico`)).status, 204);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(temporary, { recursive: true, force: true }); }
});

test('reference uploads distinguish supported image bytes from filename claims', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fAAAAABJRU5ErkJggg==', 'base64');
  assert.equal(detectImageType(png)?.mimeType, 'image/png');
  assert.equal(detectImageType(Buffer.from('<svg/>')), undefined);
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), undefined);
});


test('runtime checks allow HTTPS font resources while rejecting unrelated remote requests', () => {
  const origin = 'http://127.0.0.1:4194';
  for (const type of ['font', 'stylesheet']) {
    assert(allowedPreviewResource(new URL('https://fonts.example/resource'), origin, type));
    assert(!allowedPreviewResource(new URL('http://fonts.example/resource'), origin, type));
  }
  for (const type of ['script', 'image', 'fetch', 'xhr', 'document']) {
    assert(!allowedPreviewResource(new URL('https://fonts.example/resource'), origin, type));
    assert(allowedPreviewResource(new URL(origin + '/resource'), origin, type));
  }
});
