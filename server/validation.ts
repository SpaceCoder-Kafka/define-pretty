import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { ValidationCheck, ValidationResult } from '../shared/types.ts';

export interface ValidationOptions {
  runId: string;
  runDir: string;
  previewOrigin: string;
  baselineDir?: string;
  signal?: AbortSignal;
}

interface SemanticSnapshot {
  tasks: { id: string; title: string; status: string }[];
  text: string;
}

export async function chromeExecutable(): Promise<string | undefined> {
  const paths = [
    process.env.DEFINE_PRETTY_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of paths) {
    try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ }
  }
  return undefined;
}

/** Reject symlinks and non-static outputs before handing generated code to a browser. */
export async function inspectWebsite(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('生成页面包含符号链接，不能作为静态产物预览。');
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) files.push(path.relative(directory, target));
      if (files.length > 500) throw new Error('生成产物超过 500 个文件，超出静态网页实验范围。');
    }
  }
  await walk(directory);
  if (!files.includes('index.html')) throw new Error('缺少 website/index.html。');
  return files.sort();
}

export async function validateWebsite(options: ValidationOptions): Promise<ValidationResult> {
  const checks: ValidationCheck[] = [];
  const consoleErrors: string[] = [];
  const resourceErrors: string[] = [];
  const contentChanges: string[] = [];
  let browser: Browser | undefined;
  let screenshot: string | undefined;
  const check = async (id: string, label: string, action: () => Promise<string | void>) => {
    if (options.signal?.aborted) throw new Error('检查已取消。');
    try { checks.push({ id, label, passed: true, details: (await action()) || undefined }); }
    catch (error) { checks.push({ id, label, passed: false, details: error instanceof Error ? error.message : String(error) }); }
  };
  try {
    if (options.signal?.aborted) throw new Error('检查已取消。');
    await inspectWebsite(path.join(options.runDir, 'website'));
    browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true });
    options.signal?.addEventListener('abort', () => { void browser?.close(); }, { once: true });
    if (options.signal?.aborted) throw new Error('检查已取消。');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    // Validate only isolated static outputs. Never let a generated page call the control API.
    const previewOrigin = new URL(options.previewOrigin).origin;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== previewOrigin) {
        resourceErrors.push(`阻止外部请求：${url.origin}${url.pathname}`);
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', request => resourceErrors.push(`${request.url()}: ${request.failure()?.errorText || '请求失败'}`));
    page.on('response', response => { if (response.status() >= 400) resourceErrors.push(`${response.url()}: HTTP ${response.status()}`); });

    const response = await page.goto(`${previewOrigin}/runs/${encodeURIComponent(options.runId)}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(200);
    checks.push({ id: 'load', label: '入口正常加载', passed: Boolean(response?.ok()), details: `HTTP ${response?.status() ?? '无响应'}` });
    await check('dashboard', '主内容和任务可见', async () => {
      await page.getByTestId('dashboard').waitFor({ state: 'visible' });
      if (!await page.getByTestId('task-row').count()) throw new Error('页面没有可验证的任务条目。');
    });

    const snapshot: SemanticSnapshot = {
      tasks: await page.getByTestId('task-row').evaluateAll(elements => elements.map(element => ({
        id: element.getAttribute('data-task-id') || '',
        title: element.getAttribute('data-title') || '',
        status: element.getAttribute('data-status') || '',
      })).sort((a, b) => a.id.localeCompare(b.id))),
      text: await page.locator('body').innerText(),
    };
    await writeFile(path.join(options.runDir, 'semantic.json'), JSON.stringify(snapshot, null, 2));
    await check('task-metadata', '任务身份和筛选数据完整', async () => {
      if (!snapshot.tasks.length || snapshot.tasks.some(task => !task.id || !task.title || !task.status)) throw new Error('任务缺少 data-task-id、data-title 或 data-status。');
      if (new Set(snapshot.tasks.map(task => task.id)).size !== snapshot.tasks.length) throw new Error('任务标识不唯一。');
    });
    const rows = () => page.locator('[data-testid="task-row"]:visible');
    await check('search', '搜索与清空恢复', async () => {
      const search = page.getByTestId('search');
      await search.fill('DEFINE_PRETTY_NO_MATCH_7284');
      await page.waitForTimeout(250);
      if (await rows().count() !== 0) throw new Error('输入不存在的标题后仍有任务显示。');
      await search.fill('');
      await page.waitForTimeout(250);
      if (await rows().count() !== snapshot.tasks.length) throw new Error('清空搜索后未恢复全部任务。');
      const title = snapshot.tasks[0]?.title;
      if (title) {
        await search.fill(title);
        await page.waitForTimeout(250);
        const visibleTitles = await rows().evaluateAll(elements => elements.map(element => element.getAttribute('data-title') || ''));
        if (!visibleTitles.length || visibleTitles.some(value => !value.includes(title))) throw new Error('按已有标题搜索未得到对应任务。');
      }
    });
    await page.getByTestId('search').fill('').catch(() => undefined);
    await check('filter', '状态筛选与恢复', async () => {
      const select = page.getByTestId('status-filter');
      const status = snapshot.tasks[0]?.status;
      if (!status) throw new Error('没有可测试的任务状态。');
      await select.selectOption(status);
      await page.waitForTimeout(250);
      const visibleStatuses = await rows().evaluateAll(elements => elements.map(element => element.getAttribute('data-status')));
      const expected = snapshot.tasks.filter(task => task.status === status).length;
      if (visibleStatuses.length !== expected || visibleStatuses.some(value => value !== status)) throw new Error('筛选结果与任务状态不一致。');
      await select.selectOption('all');
      await page.waitForTimeout(250);
      if (await rows().count() !== snapshot.tasks.length) throw new Error('切换“全部”后未恢复全部任务。');
    });
    await page.getByTestId('status-filter').selectOption('all').catch(() => undefined);
    await check('action', '详情操作与关闭', async () => {
      const firstRow = rows().first();
      const title = await firstRow.getAttribute('data-title');
      await firstRow.getByTestId('primary-action').click();
      const dialog = page.getByTestId('details-dialog');
      await dialog.waitFor({ state: 'visible' });
      if (!title || !(await dialog.innerText()).includes(title)) throw new Error('详情未显示所选任务的标题。');
      await page.getByTestId('details-close').click();
      await dialog.waitFor({ state: 'hidden' });
    });
    if (options.baselineDir) {
      try {
        const original: SemanticSnapshot = JSON.parse(await readFile(path.join(options.baselineDir, 'semantic.json'), 'utf8'));
        if (JSON.stringify(original.tasks) !== JSON.stringify(snapshot.tasks)) contentChanges.push('任务的身份、标题、状态或数量与冻结基线不同。');
        // Text changes may include reordered labels, so expose evidence rather than claiming semantic equivalence.
        const normalize = (value: string) => value.split(/\s+/).filter(Boolean).sort().join('\n');
        if (normalize(original.text) !== normalize(snapshot.text)) contentChanges.push('页面可见文字与基线不同，请结合代码差异检查文案、数值及排列变化。');
        checks.push({ id: 'task-preservation', label: '保留任务身份与数据', passed: JSON.stringify(original.tasks) === JSON.stringify(snapshot.tasks), details: contentChanges[0] });
      } catch (error) {
        checks.push({ id: 'task-preservation', label: '保留任务身份与数据', passed: false, details: `无法读取基线内容记录：${String(error)}` });
      }
    }
    checks.push({ id: 'runtime', label: '无脚本错误', passed: !consoleErrors.length, details: consoleErrors.slice(0, 5).join('\n') || undefined });
    checks.push({ id: 'resources', label: '本地资源正常加载', passed: !resourceErrors.length, details: resourceErrors.slice(0, 5).join('\n') || undefined });
    await mkdir(options.runDir, { recursive: true });
    await page.screenshot({ path: path.join(options.runDir, 'screenshot.png'), fullPage: false });
    screenshot = 'screenshot.png';
  } catch (error) {
    checks.push({ id: 'validation', label: '浏览器检查可执行', passed: false, details: error instanceof Error ? error.message : String(error) });
  } finally { await browser?.close().catch(() => undefined); }
  const result: ValidationResult = {
    passed: checks.length > 0 && checks.every(item => item.passed), checks,
    consoleErrors: [...new Set(consoleErrors)], resourceErrors: [...new Set(resourceErrors)], contentChanges,
    ...(screenshot ? { screenshot } : {}),
  };
  await writeFile(path.join(options.runDir, 'validation.json'), JSON.stringify(result, null, 2));
  return result;
}
