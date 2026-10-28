import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startLocalService, type LocalService } from './core.ts';
import { acquireDataDirectoryLock } from './data-lock.ts';
import { defaultDataDirectory } from './paths.ts';
import { launchOptions, parseArguments } from './cli.ts';
import { configureDevelopmentFrontend } from './development.ts';

const loadRuntime = async () => ({ config: { model: 'test', reasoningEffort: 'high', cliVersion: 'test' }, runtime: { codexAvailable: false, authenticated: false, version: '', error: 'test' }, models: [] });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'define pretty core '));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Standalone workbench</title>');
  return { root, options: { dataDirectory: path.join(root, 'data'), webDirectory: root, consolePort: 0, previewPort: 0, loadRuntime } };
}

test('standalone core serves shipped resources, isolates previews, and preserves uploads across restarts', async () => {
  const { root, options } = await fixture();
  let service: LocalService | undefined;
  const signalCount = process.listenerCount('SIGTERM');
  try {
    service = await startLocalService(options);
    const { consoleOrigin, previewOrigin } = service;
    assert.notEqual(consoleOrigin, previewOrigin);
    assert.equal(process.listenerCount('SIGTERM'), signalCount);
    assert.match(await (await fetch(consoleOrigin)).text(), /Standalone workbench/);
    const sources = await (await fetch(`${consoleOrigin}/api/feature-tests/sources`)).json();
    assert.equal(sources.length, 8);
    const demo = await fetch(`${consoleOrigin}/api/onboarding-demo`);
    assert.equal(demo.status, 200);
    assert.equal((await demo.json()).board.cards.length, 8);
    const preview = await fetch(`${previewOrigin}/onboarding/v1/optimized/index.html`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy')!, new RegExp(`frame-ancestors ${consoleOrigin}`));
    assert.equal((await fetch(`${previewOrigin}/api/bootstrap`)).status, 404);

    const bootstrap = await (await fetch(`${consoleOrigin}/api/bootstrap`)).json();
    const form = new FormData();
    form.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'reference.png');
    const response = await fetch(`${consoleOrigin}/api/references`, { method: 'POST', headers: { origin: consoleOrigin, 'x-define-pretty-token': bootstrap.token }, body: form });
    assert.equal(response.status, 201);
    const reference = await response.json();
    assert.equal((await fetch(`${consoleOrigin}/api/references`, { method: 'POST', headers: { origin: 'https://example.com', 'x-define-pretty-token': bootstrap.token }, body: new FormData() })).status, 403);
    assert.equal((await fetch(`${consoleOrigin}/api/references`, { method: 'POST', headers: { origin: consoleOrigin }, body: new FormData() })).status, 403);
    await assert.rejects(startLocalService(options), /数据目录已由.*使用/);
    assert.equal((await fetch(`${consoleOrigin}/api/health`)).status, 200);

    await Promise.all([service.shutdown(), service.shutdown()]);
    await assert.rejects(fetch(`${consoleOrigin}/api/health`));
    await assert.rejects(readFile(path.join(options.dataDirectory, '.server-lock', 'owner.json')), { code: 'ENOENT' });
    service = await startLocalService(options);
    const restored = await fetch(`${service.consoleOrigin}/api/references/${reference.id}`);
    assert.equal(restored.status, 200);
    assert.equal((await restored.arrayBuffer()).byteLength, reference.size);
  } finally { await service?.shutdown(); await rm(root, { recursive: true, force: true }); }
});

test('initialization failure releases both bound ports and the data lock', async () => {
  const { root, options } = await fixture();
  let service: LocalService | undefined;
  try {
    const first = await startLocalService(options);
    const consolePort = Number(new URL(first.consoleOrigin).port), previewPort = Number(new URL(first.previewOrigin).port);
    await first.shutdown();
    const fixed = { ...options, consolePort, previewPort };
    await assert.rejects(startLocalService({ ...fixed, loadRuntime: async () => { throw new Error('runtime unavailable'); } }), /runtime unavailable/);
    service = await startLocalService(fixed);
    assert.equal((await fetch(`${service.consoleOrigin}/api/health`)).status, 200);
  } finally { await service?.shutdown(); await rm(root, { recursive: true, force: true }); }
});

test('development adapter serves the source frontend and local API, then closes cleanly', async () => {
  const { root, options } = await fixture();
  let service: LocalService | undefined;
  try {
    service = await startLocalService({ ...options, configureFrontend: configureDevelopmentFrontend });
    const html = await (await fetch(service.consoleOrigin)).text();
    assert.match(html, /\/@vite\/client/);
    assert.match(html, /id="root"/);
    assert.equal((await fetch(`${service.consoleOrigin}/api/bootstrap`)).status, 200);
    assert.equal((await fetch(`${service.consoleOrigin}/src/main.tsx`)).status, 200);
  } finally { await service?.shutdown(); await rm(root, { recursive: true, force: true }); }
});

test('an occupied explicit port fails without recovering or changing existing task records', async () => {
  const { root, options } = await fixture();
  const blocker = createServer();
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const consolePort = (blocker.address() as { port: number }).port;
  try {
    const lock = await acquireDataDirectoryLock(options.dataDirectory);
    await lock.release();
    const record = JSON.stringify({ references: [], runs: [{ id: 'keep', status: 'running' }] });
    await writeFile(path.join(options.dataDirectory, 'store.json'), record);
    await assert.rejects(startLocalService({ ...options, consolePort }), /已被占用/);
    assert.equal(await readFile(path.join(options.dataDirectory, 'store.json'), 'utf8'), record);
    const next = await acquireDataDirectoryLock(options.dataDirectory);
    await next.release();
  } finally {
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('default ports fall back together and security headers use the actual ports', async () => {
  const { root, options } = await fixture();
  const blocker = createServer();
  const ownsPort = await new Promise<boolean>((resolve, reject) => {
    blocker.once('error', (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    blocker.listen(4193, '127.0.0.1', () => resolve(true));
  });
  let service: LocalService | undefined;
  try {
    service = await startLocalService({ ...options, consolePort: undefined, previewPort: undefined });
    assert.notEqual(new URL(service.consoleOrigin).port, '4193');
    assert.notEqual(service.previewOrigin, service.consoleOrigin);
    const bootstrap = await fetch(`${service.consoleOrigin}/api/bootstrap`);
    assert.equal(bootstrap.status, 200);
    assert.equal((await bootstrap.json()).previewOrigin, service.previewOrigin);
  } finally {
    await service?.shutdown();
    if (ownsPort) await new Promise<void>(resolve => blocker.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('published launch paths stay outside the working tree; explicit paths and ports take priority', () => {
  const defaults = launchOptions({}, { env: {} });
  assert.equal(defaults.dataDirectory, defaultDataDirectory(process.platform, undefined, {}));
  assert.equal(defaults.configureFrontend, undefined);
  assert.equal(defaults.consolePort, undefined);
  const chosen = launchOptions(parseArguments(['--data-dir', '/tmp/pretty user', '--port', '4301', '--no-open']), { env: { DEFINE_PRETTY_DATA_DIR: '/tmp/other', DEFINE_PRETTY_PORT: '4401' } });
  assert.equal(chosen.dataDirectory, '/tmp/pretty user');
  assert.equal(chosen.consolePort, 4301);
  assert.equal(defaultDataDirectory('darwin', '/users/example', {}), '/users/example/Library/Application Support/Define Pretty');
  assert.equal(defaultDataDirectory('linux', '/users/example', { XDG_DATA_HOME: '/persistent' }), '/persistent/define-pretty');
  assert.equal(defaultDataDirectory('linux', '/users/example', { XDG_DATA_HOME: 'relative' }), '/users/example/.local/share/define-pretty');
  assert.throws(() => parseArguments(['--port', '0']), /1024/);
  assert.throws(() => parseArguments(['--host', '0.0.0.0']), /未知参数/);
});
