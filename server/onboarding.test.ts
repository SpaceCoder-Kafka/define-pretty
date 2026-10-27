import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { onboardingDirectory, readOnboardingDemo } from './onboarding-demo.ts';
import { createApp, createPreviewApp } from './http.ts';
import { FileStore } from './store.ts';
import { inspectWebsite } from './validation.ts';
import { featureInstruction, selectedFeatures } from '../shared/feature-board.ts';

test('bundled demo is complete, portable and has eight exportable features', async () => {
  const demo = await readOnboardingDemo();
  assert.equal(selectedFeatures(demo.board).length, 8);
  assert.equal(demo.board.id, 'onboarding-v1');
  assert.equal(demo.board.reference.url, '/api/onboarding-demo/reference');
  const reference = await readFile(path.join(onboardingDirectory, 'reference.jpg'));
  assert.equal(createHash('sha256').update(reference).digest('hex'), demo.board.reference.sha256);
  assert(featureInstruction(demo.board).includes('炭黑短笔触'));
  for (const name of ['original', 'optimized']) {
    const files = await inspectWebsite(path.join(onboardingDirectory, name));
    assert(!files.some(file => /(^|\/)(run\.json|prompt\.txt|command\.json|progress\.json)$/.test(file)));
    for (const file of files.filter(file => /\.(html|css|js|json)$/.test(file))) {
      const text = await readFile(path.join(onboardingDirectory, name, file), 'utf8');
      assert(!/\/Users\/|127\.0\.0\.1|\.data\//.test(text), `Non-portable resource: ${file}`);
    }
  }
});

test('onboarding read-only API works without Codex authentication or saved boards', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pretty-onboarding-'));
  const store = new FileStore(root); await store.initialize();
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as {port:number}).port;
  server.on('request', createApp({ store, consolePort: port, previewOrigin: 'http://127.0.0.1:4294', config: {model:'test',reasoningEffort:'high',cliVersion:'test'}, runtime: {codexAvailable:false,authenticated:false,version:'unavailable'} }));
  const origin = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${origin}/api/onboarding-demo`); assert.equal(response.status, 200);
    assert.equal((await response.json() as {version:number}).version, 1);
    const reference = await fetch(`${origin}/api/onboarding-demo/reference`); assert.equal(reference.status, 200); assert.match(reference.headers.get('content-type')!, /image\/jpeg/);
    assert.deepEqual(await (await fetch(`${origin}/api/onboarding-availability`)).json(), {busy:false});
    assert.equal((await fetch(`${origin}/api/onboarding-demo`, {method:'POST'})).status, 403);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, {recursive:true,force:true}); }
});

test('demo previews keep sandbox policy and reject file traversal and non-preview paths', async () => {
  const server = createServer(createPreviewApp(4293)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    for (const page of ['original', 'optimized']) {
      const response = await fetch(`${origin}/onboarding/v1/${page}/index.html`); assert.equal(response.status, 200);
      assert.match(response.headers.get('content-security-policy')!, /sandbox allow-scripts/);
      assert.doesNotMatch(response.headers.get('content-security-policy')!, /allow-same-origin/);
    }
    assert.equal((await fetch(`${origin}/onboarding/v1/optimized/assets/fonts/noto-sans-sc-variable.woff2`)).status, 200);
    assert.equal((await fetch(`${origin}/onboarding/v1/optimized/%2e%2e%2fdemo.json`)).status, 400);
    assert.equal((await fetch(`${origin}/onboarding/v1/optimized/.secret`)).status, 400);
    assert.equal((await fetch(`${origin}/onboarding/v1/demo.json`)).status, 404);
    assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('incomplete demo metadata is rejected instead of starting a real generation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pretty-onboarding-invalid-'));
  try {
    const demo = await readOnboardingDemo(); demo.board.cards.pop();
    await writeFile(path.join(root, 'demo.json'), JSON.stringify(demo));
    await assert.rejects(readOnboardingDemo(root), {status:503});
  } finally { await rm(root, {recursive:true,force:true}); }
});
