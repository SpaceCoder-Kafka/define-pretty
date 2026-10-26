import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium, type Browser } from 'playwright';
import { previewHeaders, safeFilePath } from './security.ts';
import { chromeExecutable, inspectWebsite } from './validation.ts';
import type { DraftPreview } from '../shared/execution-progress.ts';

export const TASK_PREVIEW_GUIDANCE = `可自主运行 node preview.mjs [width] [height] 检查当前 website/index.html（默认 1440×1000，宽 320–2560、高 240–2000）。该命令使用与正式预览相同的隔离策略，保存 preview.png 和 preview.json 到当前任务目录，并向工作台开放当前草稿供用户查看；JSON 包含加载错误、图片状态、标题实际字号与尺寸及横向溢出信息。截图保留整页，过长页面会截断并在 JSON 中说明。可用读图工具查看截图，对照参考图后自主修改并再次检查；加载无报错不代表视觉还原完成。主代理统一执行截图，避免多个子代理争用同一截图入口。`;

/** A captured draft is viewable, but neither immutable nor accepted as the final result. */
export async function readDraftPreview(cwd: string): Promise<DraftPreview | undefined> {
  try {
    const value = JSON.parse(await readFile(await safeFilePath(cwd, 'draft-preview.json'), 'utf8'));
    if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return;
    const website = path.join(cwd, 'website');
    await safeFilePath(website, 'index.html');
    await inspectWebsite(website);
    return { updatedAt: value.updatedAt };
  } catch { return undefined; }
}

type PreviewOptions = { cwd: string; signal?: AbortSignal; captureTimeoutMs?: number };
type PreviewHandle = { instruction: string; close: () => Promise<void> };
const CAPTURE_TIMEOUT = 30_000;

/** A task-scoped screenshot capability; generated pages never receive its capture credential. */
export async function startTaskPreview({ cwd, signal, captureTimeoutMs = CAPTURE_TIMEOUT }: PreviewOptions): Promise<PreviewHandle> {
  if (signal?.aborted) throw new Error('任务预览已中断。');
  if (!Number.isFinite(captureTimeoutMs) || captureTimeoutMs <= 0 || captureTimeoutMs > CAPTURE_TIMEOUT) throw new Error('截图超时配置无效。');
  const website = path.join(cwd, 'website');
  const routeToken = randomBytes(24).toString('hex');
  const captureToken = randomBytes(32).toString('hex');
  const prefix = `/${routeToken}`;
  const sitePrefix = `${prefix}/site/`;
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  let origin = '', port = 0, busy = false, closed = false;
  let launching: Promise<Browser> | undefined;
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;

  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    signal?.removeEventListener('abort', aborted);
    closing = (async () => {
      server.closeAllConnections();
      const stopped = new Promise<void>(resolve => server.close(() => resolve()));
      // Launch may finish after cancellation; never leave that process behind.
      const launched = await launching?.catch(() => undefined);
      await (browser ?? launched)?.close().catch(() => undefined);
      await stopped;
    })();
    return closing;
  };
  const aborted = () => { void close(); };

  app.use((req, res, next) => {
    if (closed) { res.status(410).end(); return; }
    if (req.headers.host !== `127.0.0.1:${port}` || !req.path.startsWith(`${prefix}/`)) {
      res.status(403).json({ error: '任务预览凭证无效。' }); return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.post(`${prefix}/capture`, async (req, res) => {
    if (req.headers['x-task-preview-token'] !== captureToken || req.headers.origin) {
      res.status(403).json({ error: '截图凭证无效。' }); return;
    }
    const keys = Object.keys(req.query);
    const width = Number(req.query.width ?? 1440), height = Number(req.query.height ?? 1000);
    if (keys.some(key => !['width', 'height'].includes(key)) ||
        (req.query.width !== undefined && typeof req.query.width !== 'string') ||
        (req.query.height !== undefined && typeof req.query.height !== 'string') ||
        !Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 2560 || height < 240 || height > 2000) {
      res.status(400).json({ error: '截图尺寸无效：宽 320–2560，高 240–2000；只接受 width 和 height。' }); return;
    }
    if (busy) { res.status(409).json({ error: '上一张截图尚未完成。' }); return; }
    busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const errors: string[] = [];
    const record = (message: string) => { if (errors.length < 50 && !errors.includes(message)) errors.push(message.slice(0, 1200)); };
    const capture = async () => {
      await safeFilePath(website, 'index.html');
      await inspectWebsite(website);
      if (closed || timedOut) throw new Error('任务预览已中断。');
      launching = chromium.launch({ executablePath: await chromeExecutable(), headless: true, timeout: 10_000 });
      browser = await launching;
      if (closed || timedOut) { await browser.close(); throw new Error('任务预览已中断。'); }
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', acceptDownloads: false });
      const entry = `${origin}${sitePrefix}index.html`;
      await context.route('**/*', async route => {
        const request = route.request(), target = new URL(request.url());
        const local = target.origin === origin && target.pathname.startsWith(sitePrefix);
        const allowed = request.isNavigationRequest()
          ? target.href.split('#')[0] === entry
          : local || ['data:', 'blob:'].includes(target.protocol) ||
            (target.protocol === 'https:' && ['font', 'stylesheet'].includes(request.resourceType()));
        if (!allowed) { record(`禁止加载：${target.href}`); await route.abort(); }
        else await route.continue();
      });
      const page = await context.newPage();
      context.on('page', extra => { if (extra !== page) void extra.close(); });
      page.on('dialog', dialog => { void dialog.dismiss(); });
      page.on('pageerror', error => record(error.message));
      page.on('console', message => { if (message.type() === 'error') record(message.text()); });
      page.on('response', response => { if (response.status() >= 400) record(`资源 HTTP ${response.status()}：${response.url()}`); });
      page.on('requestfailed', request => record(`${request.failure()?.errorText || '请求失败'}：${request.url()}`));
      await page.goto(entry, { waitUntil: 'load', timeout: 15_000 });
      const fontErrors = await page.evaluate(async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([document.fonts.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('字体等待超时。')), 5000); })]);
          return [...document.fonts].filter(font => font.status === 'error').map(font => `字体加载失败：${font.family}`);
        } catch (error) { return [(error as Error).message]; }
        finally { clearTimeout(timer); }
      });
      fontErrors.forEach(record);
      await page.waitForTimeout(200);
      // Off-screen lazy images must be requested before a full-page screenshot.
      // Wait concurrently with one shared deadline, without changing delivered HTML.
      await page.evaluate(async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const images = [...document.images];
        images.forEach(image => { image.loading = 'eager'; });
        try {
          await Promise.race([
            Promise.all(images.map(image => image.decode().catch(() => undefined))),
            new Promise(resolve => { timer = setTimeout(resolve, 5000); }),
          ]);
        } finally { clearTimeout(timer); }
      });
      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        return {
          title: document.title, origin: globalThis.origin,
          viewport: { width: innerWidth, height: innerHeight },
          document: { width: root.scrollWidth, height: root.scrollHeight },
          horizontalOverflow: root.scrollWidth > innerWidth,
          headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 50).map(element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return { tag: element.tagName, text: element.textContent?.slice(0, 100), fontFamily: style.fontFamily,
              fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, width: rect.width, height: rect.height };
          }),
          images: [...document.images].slice(0, 100).map(image => ({ src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0,
            naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })),
        };
      });
      metrics.images.filter(image => !image.loaded).forEach(image => record(`图片未加载：${image.src}`));
      const captureHeight = Math.min(Math.max(height, metrics.document.height), 10_000, Math.floor(16_000_000 / width));
      const screenshot = { width, height: captureHeight, truncated: captureHeight < metrics.document.height };
      const png = await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width, height: captureHeight }, timeout: 10_000 });
      return { image: png.toString('base64'), errors, metrics: { ...metrics, screenshot } };
    };
    const operation = capture();
    let result: Awaited<ReturnType<typeof capture>> | undefined;
    let failure: Error | undefined;
    try {
      result = await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('本次截图超时。请检查页面后重新运行 node preview.mjs。'));
        }, captureTimeoutMs);
      })]);
    } catch (error) {
      failure = error as Error;
    } finally {
      clearTimeout(timer);
      // Keep the slot until both launch and page work have settled. A timeout must
      // not let a late browser from this request interfere with the next capture.
      const launched = await launching?.catch(() => undefined);
      await (browser ?? launched)?.close().catch(() => undefined);
      await operation.catch(() => undefined);
      browser = undefined;
      launching = undefined;
      busy = false;
    }
    if (!closed) {
      if (failure) res.status(timedOut ? 504 : 422).json({ error: failure.message });
      else {
        // A separate atomic sidecar avoids racing terminal run.json writes.
        // Captures with diagnostics are drafts too; this never marks a run complete.
        const checkpoint = path.join(cwd, 'draft-preview.json');
        const temporary = `${checkpoint}.${randomBytes(8).toString('hex')}.tmp`;
        await writeFile(temporary, JSON.stringify({ updatedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
        await rename(temporary, checkpoint);
        res.json(result);
      }
    }
  });

  app.get(`${sitePrefix}*path`, (req, res, next) => previewHeaders(port)(req, res, next), async (req, res) => {
    try {
      const relative = decodeURIComponent(req.path.slice(sitePrefix.length));
      const file = await safeFilePath(website, relative);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.type(path.extname(file));
      res.send(await readFile(file));
    } catch (error) {
      const value = error as Error & { status?: number; code?: string };
      res.status(value.code === 'ENOENT' ? 404 : value.status ?? 403).json({ error: '预览文件不可用。' });
    }
  });
  app.use((_req, res) => { res.status(404).json({ error: '预览接口不存在。' }); });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    port = (server.address() as { port: number }).port;
    origin = `http://127.0.0.1:${port}`;
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) throw new Error('任务预览已中断。');
    const script = `import { writeFile } from 'node:fs/promises';
const endpoint = ${JSON.stringify(`${origin}${prefix}/capture`)};
const token = ${JSON.stringify(captureToken)};
try {
  if (process.argv.length > 4) throw new Error('用法：node preview.mjs [width] [height]');
  const url = new URL(endpoint);
  url.searchParams.set('width', process.argv[2] || '1440');
  url.searchParams.set('height', process.argv[3] || '1000');
  const response = await fetch(url, { method: 'POST', headers: { 'x-task-preview-token': token }, signal: AbortSignal.timeout(35000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '截图失败。');
  const { image, ...diagnostics } = result;
  await writeFile(new URL('./preview.png', import.meta.url), Buffer.from(image, 'base64'));
  await writeFile(new URL('./preview.json', import.meta.url), JSON.stringify(diagnostics, null, 2));
  console.log(JSON.stringify({ screenshot: 'preview.png', diagnostics: 'preview.json', ...diagnostics }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;
    await writeFile(path.join(cwd, 'preview.mjs'), script, { flag: 'wx', mode: 0o600 });
    return { instruction: TASK_PREVIEW_GUIDANCE, close };
  } catch (error) { await close(); throw error; }
}
