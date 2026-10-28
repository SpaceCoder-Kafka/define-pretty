import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { packRelease } from './pack-release.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const { artifact, manifest } = await packRelease();
const files = manifest.files.map(file => file.path);
for (const required of ['bin/define-pretty.js', 'dist/server/core.js', 'dist/server/core.d.ts', 'dist/visual-cards/index.html', 'dist/resources/onboarding/v1/reference.jpg', 'dist/public/builtin-websites/dashboard/index.html']) {
  assert(files.includes(required), `Package is missing ${required}`);
}
assert(!files.some(file => /(^|\/)(\.data|\.test-data|\.git|node_modules|\.env)(\/|$)|\.test\.|\.jsonl$/.test(file)), 'Package contains private data, dependencies, or tests');
assert(files.every(file => ['package.json', 'README.md', 'README.en.md'].includes(file) || /^(bin|dist)\//.test(file)), 'Unexpected package contents');
console.log('✓ 发布包完整，未包含工作数据、日志或开发源码。');

const sandbox = await mkdtemp(path.join(tmpdir(), 'define pretty package '));
const consumer = path.join(sandbox, 'consumer'), unrelated = path.join(sandbox, 'unrelated directory');
const fakeBin = path.join(sandbox, 'bin'), dataDirectory = path.join(sandbox, 'persistent user data');
const openerRecord = path.join(sandbox, 'opened.json'), codexRecord = path.join(sandbox, 'codex.jsonl');
let running, browser;
async function npm(args, cwd = consumer) {
  return execute(process.execPath, [process.env.npm_execpath, ...args], { cwd, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
}
async function waitFor(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
try {
  await Promise.all([consumer, unrelated, fakeBin].map(directory => mkdir(directory, { recursive: true })));
  await writeFile(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  // No real Codex tasks or account changes: simulate a machine without the CLI.
  await writeFile(path.join(fakeBin, 'codex'), `#!/usr/bin/env node\nimport('node:fs').then(fs => { fs.appendFileSync(${JSON.stringify(codexRecord)}, JSON.stringify(process.argv.slice(2))+'\\n'); process.exitCode=1; });\n`, { mode: 0o755 });
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  await writeFile(path.join(fakeBin, opener), `#!/usr/bin/env node\nimport('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(openerRecord)}, JSON.stringify(process.argv.slice(2))));\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  for (const key of Object.keys(env)) if (key.startsWith('DEFINE_PRETTY_')) delete env[key];

  // Exercise the exact npx/npm-exec tarball entry point without relying on a registry publication.
  const version = await npm(['exec', '--yes', '--cache', path.join(sandbox, 'cache'), `--package=${artifact}`, '--', 'define-pretty', '--version'], unrelated);
  assert.equal(version.stdout.trim(), manifest.version);
  await npm(['install', '--omit=dev', '--no-audit', '--no-fund', artifact]);
  const installed = path.join(consumer, 'node_modules', 'define-pretty');
  for (const dependency of ['vite', 'tsx', 'typescript', 'react']) {
    await assert.rejects(access(path.join(consumer, 'node_modules', dependency)), { code: 'ENOENT' });
  }
  const imported = await execute(process.execPath, ['--input-type=module', '-e', 'const before = process.listenerCount("SIGTERM"); const {startLocalService} = await import("define-pretty/core"); if(typeof startLocalService !== "function" || before !== process.listenerCount("SIGTERM")) process.exit(1);'], { cwd: consumer });
  assert.equal(imported.stderr, '');
  await writeFile(path.join(consumer, 'probe.mts'), 'import { startLocalService, type LocalServiceOptions } from "define-pretty/core";\nasync function probe(options: LocalServiceOptions) { const service = await startLocalService(options); await service.shutdown(); }\n');
  await execute(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', path.join(consumer, 'probe.mts')], { cwd: consumer });
  console.log('✓ npx 从 tarball 启动成功；仅安装生产依赖即可导入运行核心，类型声明可用。');

  const consolePort = await unusedPort();
  let previewPort = await unusedPort();
  while (previewPort === consolePort) previewPort = await unusedPort();
  const bin = path.join(installed, 'bin/define-pretty.js');
  const doctorDirectory = path.join(sandbox, 'doctor should not create data');
  const doctor = await execute(process.execPath, [bin, '--doctor', '--data-dir', doctorDirectory], { cwd: unrelated, env })
    .then(() => assert.fail('Doctor should report missing Codex'), error => error);
  assert.equal(doctor.code, 1);
  assert.match(doctor.stdout, /未安装/);
  await assert.rejects(access(doctorDirectory), { code: 'ENOENT' });
  const args = ['--data-dir', dataDirectory, '--port', String(consolePort), '--preview-port', String(previewPort)];
  const origin = `http://127.0.0.1:${consolePort}`, previewOrigin = `http://127.0.0.1:${previewPort}`;
  async function launch(extra = []) {
    const child = spawn(process.execPath, [bin, ...args, ...extra], { cwd: unrelated, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const state = { child, closed: false, output: '' };
    running = state;
    child.stdout.on('data', chunk => { state.output += chunk; });
    child.stderr.on('data', chunk => { state.output += chunk; });
    child.once('error', error => { state.closed = true; state.output += error.message; });
    child.once('close', () => { state.closed = true; });
    await waitFor(() => {
      if (state.closed) throw new Error(`Packaged CLI exited before startup:\n${state.output}`);
      return state.output.includes(`Define Pretty  →  ${origin}`);
    }, 'Packaged CLI did not become ready');
    return state;
  }
  async function stop() {
    if (!running || running.closed) return;
    running.child.kill('SIGTERM');
    await waitFor(() => running.closed, 'CLI did not stop gracefully');
    assert.equal(running.child.exitCode, 0, running.output);
    await assert.rejects(access(path.join(dataDirectory, '.server-lock')), { code: 'ENOENT' });
  }
  await launch();
  await waitFor(async () => { try { await access(openerRecord); return true; } catch { return false; } }, 'Browser opener was not called');
  assert.deepEqual(JSON.parse(await readFile(openerRecord, 'utf8')), [origin]);
  const bootstrap = await (await fetch(`${origin}/api/bootstrap`)).json();
  assert.equal(bootstrap.runtime.codexAvailable, false);
  assert.equal(bootstrap.previewOrigin, previewOrigin);
  assert.equal((await (await fetch(`${origin}/api/feature-tests/sources`)).json()).length, 8);
  assert.equal((await (await fetch(`${origin}/api/onboarding-demo`)).json()).board.cards.length, 8);
  for (const asset of ['/onboarding/v1/original/index.html', '/onboarding/v1/optimized/index.html', '/onboarding/v1/optimized/assets/fonts/noto-sans-sc-variable.woff2']) {
    assert.equal((await fetch(previewOrigin + asset)).status, 200, asset);
  }
  const image = await (await fetch(`${origin}/api/onboarding-demo/reference`)).blob();
  const form = new FormData(); form.set('file', image, 'reference.jpg');
  const upload = await fetch(`${origin}/api/references`, { method: 'POST', headers: { origin, 'x-define-pretty-token': bootstrap.token }, body: form });
  assert.equal(upload.status, 201);
  const reference = await upload.json();
  const duplicate = await execute(process.execPath, [bin, ...args, '--no-open'], { cwd: unrelated, env }).then(() => assert.fail('Duplicate startup should fail'), error => error);
  assert.match(duplicate.stderr, /数据目录已由.*使用/);
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);

  if (process.env.DEFINE_PRETTY_PACKAGE_BROWSER_TEST === '1') {
    const { chromeExecutable } = await import('../dist/server/validation.js');
    browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('.onboarding-tip h2').waitFor();
    const screenshots = path.join(root, '.test-data/package-qa');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'installed-desktop.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '使用指引', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await browser.close(); browser = undefined;
    console.log('✓ 安装包中的真实界面与使用指引可在浏览器加载。');
  }
  await stop();
  await launch(['--no-open']);
  assert.equal((await fetch(`${origin}/api/references/${reference.id}`)).status, 200);
  await stop();
  assert.deepEqual(await readdir(unrelated), [], 'Launching from another directory wrote working files there');
  const commands = (await readFile(codexRecord, 'utf8')).trim().split('\n').map(JSON.parse);
  assert(commands.every(args => args[0] === '--version'), 'Smoke test invoked a real task');
  console.log('✓ 任意目录启动、自动打开浏览器、未登录体验、重复启动保护、数据持久化与优雅退出均通过。');
} finally {
  await browser?.close();
  if (running && !running.closed) {
    running.child.kill('SIGKILL');
    await waitFor(() => running.closed, 'Package smoke child did not exit');
  }
  await rm(sandbox, { recursive: true, force: true });
}
