import { collectComponents } from './component-snapshot.ts';
import { createHash } from 'node:crypto';
import type { ComponentSnapshot } from '../shared/types.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { VisualComparison } from '../shared/types.ts';
import { FileStore } from './store.ts';
import { hashWebsite } from './runner.ts';
import { chromeExecutable } from './validation.ts';
import { previewCsp, requireSafeId, safeFilePath } from './security.ts';

/** Derived, read-only views. Never reuse validation screenshots taken after interaction tests. */
export class VisualComparisons {
  private pending = new Map<string, Promise<VisualComparison>>();
  private tail: Promise<unknown> = Promise.resolve();
  private browser?: Browser;
  private stopped = false;
  constructor(private store: FileStore, private consolePort: number) {}
  directory(id: string) { return path.join(this.store.root, 'visual-comparisons', requireSafeId(id)); }
  get(id: string): Promise<VisualComparison> {
    requireSafeId(id);
    const existing = this.pending.get(id);
    if (existing) return existing;
    if (this.stopped) return Promise.reject(new Error('服务正在关闭，请稍后重试。'));
    if (this.pending.size >= 20) return Promise.reject(new Error('对比画面正在排队，请稍后重试。'));
    const job = this.tail.then(() => this.capture(id));
    this.pending.set(id, job);
    this.tail = job.catch(() => undefined);
    void job.finally(() => this.pending.delete(id)).catch(() => undefined);
    return job;
  }
  async shutdown() {
    this.stopped = true;
    await this.browser?.close();
    await this.tail;
  }
  private async capture(id: string): Promise<VisualComparison> {
    if (this.stopped) throw new Error('服务正在关闭。');
    const run = await this.store.getRun(id);
    if (!run.hasPreview || ['queued', 'running', 'checking'].includes(run.status)) throw new Error('网页生成结束后才能比较变化。');
    if (!run.baselineRunId || !run.baselineHash) throw new Error('此运行没有可核验的原始网页。');
    const baseline = await this.store.getRun(run.baselineRunId);
    const frozen = path.join(this.store.runDir(baseline.id), 'frozen');
    const baselineHash = await hashWebsite(frozen);
    if (baseline.groupId !== 'baseline' || baseline.status !== 'completed' || baselineHash !== run.baselineHash || baselineHash !== baseline.artifactHash) throw new Error('原始网页校验失败，无法可靠高亮。');
    const resultHash = await hashWebsite(this.store.websiteDir(id));
    // Includes capture protocol version. Never bind to the experiment's latest baseline.
    const key = `v2-${baselineHash}-${resultHash}`;
    const directory = path.join(this.directory(id), key);
    try { return JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true, timeout: 15000 });
    const browser = this.browser;
    const deadline = setTimeout(() => { void browser.close(); }, 45000);
    try {
      if (this.stopped) throw new Error('服务正在关闭。');
      await mkdir(directory, { recursive: true });
      const components: Record<string, ComponentSnapshot[]> = {};
      for (const [label, root] of [['baseline', frozen], ['result', this.store.websiteDir(id)]] as const) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light', reducedMotion: 'reduce' });
        const errors: string[] = [];
        try {
          // Serve only this output tree in an opaque-origin sandbox. No control API or network.
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== 'http://preview.invalid' || !url.pathname.startsWith('/website/')) { errors.push('页面请求了本地资源目录以外的内容'); return route.abort(); }
            try {
              const file = await safeFilePath(root, decodeURIComponent(url.pathname.slice('/website/'.length)) || 'index.html');
              await route.fulfill({ path: file, headers: { 'Content-Security-Policy': previewCsp(this.consolePort), 'X-Content-Type-Options': 'nosniff' } });
            } catch { errors.push(`资源无法读取：${url.pathname}`); await route.abort(); }
          });
          const page = await context.newPage();
          page.on('pageerror', error => errors.push(error.message));
          page.on('requestfailed', request => errors.push(`资源加载失败：${request.url()}`));
          await page.goto('http://preview.invalid/website/index.html', { waitUntil: 'load', timeout: 15000 });
          await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
          await page.waitForTimeout(400);
          if (errors.length) throw new Error(`${label === 'baseline' ? '原始页' : '结果页'}无法完整加载：${errors[0]}`);
          components[label] = (await page.evaluate(collectComponents, label === 'baseline' ? 'B' : 'R')).map(item => ({ ...item, signature: createHash('sha256').update(item.signature).digest('hex') }));
          await page.screenshot({ path: path.join(directory, `${label}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 10000 });
        } finally { await context.close(); }
      }
      const prefix = `/api/runs/${id}/visual-comparison/${key}`;
      const result: VisualComparison = { baselineRunId: baseline.id, baselineHash, resultHash, capturedAt: new Date().toISOString(), width: 1440, height: 1000, baselineUrl: `${prefix}/baseline.png`, resultUrl: `${prefix}/result.png` };
      await writeFile(path.join(directory, 'components.json'), JSON.stringify(components));
      await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(result));
      return result;
    } finally { clearTimeout(deadline); await browser.close(); this.browser = undefined; }
  }
}
