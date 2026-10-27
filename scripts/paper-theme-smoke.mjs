// Browser QA against a separate worktree server, with copied local board data.
// Usage: node scripts/paper-theme-smoke.mjs [http://127.0.0.1:4293]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.argv[2] || 'http://127.0.0.1:4293';
const output = 'docs/visual-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.DEFINE_PRETTY_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [], failedRequests = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
const check = name => checks.push(name);
const saved = async action => {
  const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/api/feature-boards/'));
  await action();
  assert.equal((await response).status(), 200);
  await page.locator('.feature-save').filter({ hasText: '已保存到本地' }).waitFor();
};

try {
  await page.goto(origin);
  await page.locator('.feature-card').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await page.locator('.feature-intro-art').evaluate(async image => {
    await image.decode();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await page.evaluate(() => document.fonts.check('900 60px "Pretty Noto"', '把喜欢的设计选出来')), true);

  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
  const platformFonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  assert.ok(platformFonts.some(font => font.isCustomFont && font.familyName.includes('Noto')));
  check('Local Noto font loaded and actually renders the Chinese heading');

  await page.getByRole('button', { name: '生成设置', exact: true }).click();
  await page.getByRole('dialog', { name: '生成设置' }).waitFor();
  await page.screenshot({ path: `${output}/settings-desktop.png` });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  check('Settings opens and closes with Escape');

  const checkbox = page.locator('.feature-card input[type=checkbox]').first();
  const originalChecked = await checkbox.isChecked();
  const originalCount = await page.locator('.feature-selected-count').innerText();
  await saved(() => checkbox.click());
  assert.notEqual(await checkbox.isChecked(), originalChecked);
  await saved(() => checkbox.click());
  assert.equal(await page.locator('.feature-selected-count').innerText(), originalCount);
  check('Card selection persists and restores the original selection');

  await page.getByRole('button', { name: '编辑整体视觉风格', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑特征卡片' });
  await editor.waitFor();
  await page.screenshot({ path: `${output}/editor-desktop.png` });
  await saved(() => editor.getByRole('button', { name: '保存修改' }).click());
  assert.equal(await editor.count(), 0);
  check('Card editor saves the existing rules and closes');

  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await page.getByRole('dialog', { name: '参考原图预览' }).waitFor();
  assert.ok(await page.getByAltText('无标记参考原图').evaluate(image => image.naturalWidth > 0));
  await page.getByRole('button', { name: '关闭原图预览' }).click();
  check('Original reference preview opens with the original image');

  await page.locator('.feature-selection').getByRole('button', { name: '复制配套指令' }).click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(clipboard.includes('整体视觉风格') && clipboard.includes('粗纤维'));
  await page.getByRole('status').filter({ hasText: '配套指令已复制' }).waitFor({ state: 'hidden' });
  check('Copy instruction writes the selected feature instructions');

  await page.getByRole('button', { name: '预览并导出图片' }).click();
  const exporter = page.getByRole('dialog', { name: '导出图片预览' });
  await exporter.waitFor();
  await page.getByAltText('仅包含已选特征的视觉总览图').evaluate(async image => { if (!image.complete) await image.decode(); });
  await page.screenshot({ path: `${output}/export-desktop.png` });
  const downloadEvent = page.waitForEvent('download');
  await exporter.getByRole('link', { name: '下载总览 PNG' }).click();
  const download = await downloadEvent;
  await download.saveAs(`${output}/exported-selected-features.png`);
  assert.equal(await download.failure(), null);
  await page.getByRole('button', { name: '关闭导出' }).click();
  check('Selected feature overview renders and downloads as PNG');

  const sourceTitle = await page.locator('.feature-test-source').innerText();
  await page.getByRole('button', { name: '更换网页', exact: true }).click();
  await page.getByRole('dialog', { name: '选择原始网页' }).waitFor();
  assert.equal(await page.locator('.feature-builtin-card').count(), 8);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/source-picker-desktop.png` });
  await page.getByRole('button', { name: '关闭网页选择' }).click();
  assert.equal(await page.locator('.feature-test-source').innerText(), sourceTitle);
  check('Source picker shows all 8 functional built-in sources without changing the selection');

  await page.locator('.feature-toolbar').scrollIntoViewIfNeeded();
  const fileChooser = page.waitForEvent('filechooser');
  await page.locator('.feature-toolbar').getByRole('button', { name: '新参考图' }).click();
  const chooser = await fileChooser;
  assert.equal(await chooser.element().getAttribute('accept'), 'image/png,image/jpeg,image/webp');
  check('Upload entry opens an image file chooser (no upload or AI job submitted)');

  await page.mouse.move(0, 0); await page.locator('.feature-header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/after-desktop.png` });
  await page.screenshot({ path: `${output}/after-desktop-full.png`, fullPage: true });
  await page.locator('.feature-overview-reference').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/board-desktop.png` });
  const typography = await page.evaluate(() => Object.fromEntries(['h1', '.feature-intro p', '.feature-validation h2', '.feature-button'].map(selector => {
    const style = getComputedStyle(document.querySelector(selector));
    return [selector, { size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, family: style.fontFamily }];
  })));
  const tape = await page.locator('.feature-card').first().evaluate(card => {
    const style = getComputedStyle(card, '::after');
    return { width: style.width, height: style.height, cardWidth: card.clientWidth, cardHeight: card.clientHeight, transform: style.transform };
  });
  const viewports = [];
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(100);
    const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.equal(size.document, size.viewport, `Horizontal overflow at ${width}`);
    viewports.push(size);
    if (width === 390) {
      await page.screenshot({ path: `${output}/after-mobile.png` });
      await page.locator('.feature-card').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/board-mobile.png` });
      await page.getByRole('button', { name: '生成设置', exact: true }).click();
      await page.screenshot({ path: `${output}/settings-mobile.png` });
      await page.keyboard.press('Escape');
    }
  }
  check('360 / 390 / 768 / 1024 / 1440px layouts have no document overflow');

  // Inspect the empty state without writing or discarding any real board data.
  const emptyPage = await context.newPage();
  await emptyPage.route('**/api/feature-boards', route => route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue());
  await emptyPage.goto(origin); await emptyPage.locator('.feature-empty').waitFor();
  await emptyPage.evaluate(() => document.fonts.ready);
  await emptyPage.screenshot({ path: `${output}/empty-desktop.png` });
  await emptyPage.close();
  check('Empty upload state renders (read-only empty board fixture)');

  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  const palette = await page.evaluate(() => ({ background: getComputedStyle(document.querySelector('.feature-app')).backgroundColor, ink: getComputedStyle(document.querySelector('h1')).color, board: getComputedStyle(document.querySelector('.feature-overview-board')).backgroundColor }));
  assert.equal(palette.background, 'rgb(243, 240, 232)');
  assert.equal(palette.ink, 'rgb(43, 45, 48)');
  assert.equal(palette.board, 'rgb(84, 137, 167)');
  await writeFile(`${output}/checks.json`, JSON.stringify({ origin, checks, errors, failedRequests, platformFonts, typography, palette, tape, viewports, unverified: ['Live paid AI generation and completion were not started', 'Actual new image upload was not submitted'] }, null, 2));
  console.log(JSON.stringify({ checks, platformFonts, typography, tape, viewports, errors, failedRequests }, null, 2));
} finally {
  await browser.close();
}
