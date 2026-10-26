import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startTaskPreview, TASK_PREVIEW_GUIDANCE, readDraftPreview } from './task-preview.ts';
import { previewCsp } from './security.ts';

const execute = promisify(execFile);
async function fixture(html = '<h1>Preview</h1>', captureTimeoutMs?: number) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-task-preview-'));
  await mkdir(path.join(cwd, 'website/assets'), { recursive: true });
  await writeFile(path.join(cwd, 'website/index.html'), html);
  const controller = new AbortController();
  const preview = await startTaskPreview({ cwd, signal: controller.signal, captureTimeoutMs });
  const script = await readFile(path.join(cwd, 'preview.mjs'), 'utf8');
  const endpoint = JSON.parse(script.match(/const endpoint = (.*);/)![1]) as string;
  const token = JSON.parse(script.match(/const token = (.*);/)![1]) as string;
  const site = endpoint.replace(/capture$/, 'site/');
  return { cwd, controller, preview, endpoint, token, site,
    capture: (query = '', headers: Record<string, string> = {}) => fetch(endpoint + query, { method: 'POST', headers: { 'x-task-preview-token': token, ...headers } }),
    cleanup: async () => { await preview.close(); await rm(cwd, { recursive: true, force: true }); },
  };
}

test('task screenshot helper renders current local files and returns actual visual diagnostics', { timeout: 40_000 }, async () => {
  const f = await fixture(`<!doctype html><title>Task preview</title>
    <style>body{margin:0;height:1400px;background:#fff}h1{font:700 58px/70px sans-serif}main{width:900px}</style>
    <main><h1>Reference title</h1><img src="assets/art.svg"><img src="missing.png"></main>
    <script type="module" src="assets/main.js"></script><script>throw new Error('fixture error')</script>`);
  try {
    await writeFile(path.join(f.cwd, 'website/assets/art.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="17"><rect width="23" height="17" fill="red"/></svg>');
    await writeFile(path.join(f.cwd, 'website/assets/main.js'), 'document.title = "Module loaded";');
    assert.equal(f.preview.instruction, TASK_PREVIEW_GUIDANCE);
    assert(!f.preview.instruction.includes(f.token));
    await execute(process.execPath, ['preview.mjs', '800', '600'], { cwd: f.cwd, timeout: 35_000 });
    const png = await readFile(path.join(f.cwd, 'preview.png'));
    const result = JSON.parse(await readFile(path.join(f.cwd, 'preview.json'), 'utf8'));
    assert((await readDraftPreview(f.cwd))?.updatedAt, 'even a screenshot with diagnostics is a draft, not final acceptance');
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), 800);
    assert.equal(png.readUInt32BE(20), result.metrics.document.height);
    assert.equal(png.readUInt32BE(20), result.metrics.screenshot.height);
    assert(png.readUInt32BE(20) > 600, 'long-page capture must exceed the viewport');
    assert.equal(result.metrics.title, 'Module loaded');
    assert.equal(result.metrics.origin, 'null', 'capture must retain opaque-origin CSP sandbox');
    assert.equal(result.metrics.horizontalOverflow, true);
    assert.equal(result.metrics.headings[0].fontSize, '58px');
    assert.equal(result.metrics.headings[0].lineHeight, '70px');
    assert.equal(result.metrics.images[0].loaded, true);
    assert.equal(result.metrics.images[0].naturalWidth, 23);
    assert.equal(result.metrics.images[1].loaded, false);
    assert(result.errors.some((error: string) => error.includes('fixture error')));
    assert(result.errors.some((error: string) => error.includes('missing.png')));
    await assert.rejects(readFile(path.join(f.cwd, 'website/preview.png')), { code: 'ENOENT' });
    await writeFile(path.join(f.cwd, 'website/index.html'), '<title>Edited</title><h1>Updated</h1>');
    const second = await (await f.capture('?width=640&height=480')).json();
    assert.equal(second.metrics.title, 'Edited');
    assert.equal(second.metrics.headings[0].text, 'Updated');
  } finally { await f.cleanup(); }
});

test('task preview authenticates capture separately and isolates static paths', async () => {
  const f = await fixture();
  try {
    const origin = new URL(f.endpoint).origin;
    const document = await fetch(f.site + 'index.html');
    assert.equal(document.status, 200);
    assert.equal(document.headers.get('content-security-policy'), previewCsp(Number(new URL(origin).port)));
    assert.equal(document.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(origin + '/wrong/site/index.html')).status, 403);
    assert.equal((await fetch(f.endpoint, { method: 'POST' })).status, 403);
    assert.equal((await fetch(f.endpoint, { method: 'POST', headers: { 'x-task-preview-token': 'wrong' } })).status, 403);
    assert.equal((await f.capture('', { Origin: 'null' })).status, 403);
    assert.equal((await fetch(f.endpoint)).status, 404, 'images and links cannot trigger capture');
    assert.equal((await fetch(origin + '/api/bootstrap')).status, 403);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      request(f.site + 'index.html', { headers: { Host: 'attacker.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject).end();
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(f.site + '../capture')).headers.get('access-control-allow-origin'), null);
    await writeFile(path.join(f.cwd, 'private.txt'), 'private');
    for (const filename of ['%2e%2e%2fprivate.txt', '%2fetc%2fpasswd', '.secret', '..%5cprivate.txt', 'assets/%00bad']) {
      assert((await fetch(f.site + filename)).status >= 400, filename);
    }
    await symlink(path.join(f.cwd, 'private.txt'), path.join(f.cwd, 'website/escape.txt'));
    assert.equal((await fetch(f.site + 'escape.txt')).status, 403);
    const invalidTree = await f.capture();
    assert.equal(invalidTree.status, 422);
    assert.match((await invalidTree.json()).error, /符号链接/);
  } finally { await f.cleanup(); }
});

test('task preview rejects unbounded dimensions, duplicate parameters and arbitrary navigation', async () => {
  const f = await fixture();
  try {
    for (const query of ['?width=0', '?height=0', '?width=2561', '?height=2001', '?width=NaN', '?width=400.5', '?width=800&width=900', '?url=https://example.com', '?path=/etc/passwd']) {
      const response = await f.capture(query);
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    await assert.rejects(execute(process.execPath, ['preview.mjs', '9000'], { cwd: f.cwd }), /截图尺寸无效/);
    await assert.rejects(readFile(path.join(f.cwd, 'preview.png')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('task preview abort stops a live capture, rejects overlap and closes the listener', { timeout: 20_000 }, async () => {
  const f = await fixture('<h1>Running</h1><script>while(true){}</script>');
  try {
    const pending = f.capture().then(response => response.json()).catch(() => undefined);
    // A capture owns its slot before any asynchronous filesystem or browser work.
    let overlap: Response | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      overlap = await f.capture('?width=640');
      if (overlap.status === 409) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(overlap?.status, 409);
    await new Promise(resolve => setTimeout(resolve, 700));
    f.controller.abort();
    await f.preview.close();
    await pending;
    await assert.rejects(fetch(f.site + 'index.html'));
    await f.preview.close();
  } finally { await f.cleanup(); }
});

test('task preview refuses an already aborted task and never overwrites a helper symlink', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-task-preview-'));
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(startTaskPreview({ cwd, signal: controller.signal }), /已中断/);
    await writeFile(path.join(cwd, 'private.txt'), 'unchanged');
    await symlink(path.join(cwd, 'private.txt'), path.join(cwd, 'preview.mjs'));
    await assert.rejects(startTaskPreview({ cwd }), { code: 'EEXIST' });
    assert.equal(await readFile(path.join(cwd, 'private.txt'), 'utf8'), 'unchanged');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('one capture timeout closes its browser and allows a repaired page to be captured', { timeout: 25_000 }, async () => {
  // The timeout should distinguish a hung page from a healthy one even when
  // other browser suites are launching Chromium concurrently on a busy host.
  const f = await fixture('<script>while(true){}</script>', 5000);
  try {
    const response = await f.capture();
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /重新运行/);
    await writeFile(path.join(f.cwd, 'website/index.html'), '<title>Recovered</title><h1>Fixed</h1>');
    const retry = await f.capture('?width=640&height=480');
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).metrics.title, 'Recovered');
  } finally { await f.cleanup(); }
});

test('full-page capture loads offscreen lazy images while preserving real missing-image errors', { timeout: 20_000 }, async () => {
  const html = '<h1>Long page</h1><div style="height:7000px"></div><img loading="lazy" src="assets/lazy.svg"><img loading="lazy" src="missing-lazy.png">';
  const f = await fixture(html);
  try {
    assert.equal(await readDraftPreview(f.cwd), undefined);
    await writeFile(path.join(f.cwd, 'website/assets/lazy.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="orange"/></svg>');
    const response = await f.capture('?width=390&height=844');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.metrics.images[0].loaded, true);
    assert.equal(result.metrics.images[1].loaded, false);
    assert(!result.errors.some((error: string) => error.includes('assets/lazy.svg')));
    assert(result.errors.some((error: string) => error.includes('missing-lazy.png')));
    assert.equal(await readFile(path.join(f.cwd, 'website/index.html'), 'utf8'), html, 'capture must not modify delivered HTML');
    assert((await readDraftPreview(f.cwd))?.updatedAt);
    await symlink(path.join(f.cwd, 'preview.mjs'), path.join(f.cwd, 'website/escape.js'));
    assert.equal(await readDraftPreview(f.cwd), undefined, 'a later unsafe edit invalidates draft exposure');
  } finally { await f.cleanup(); }
});
