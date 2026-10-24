/** Measure preservation and pixel location, not beauty or semantic style quality. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { chromeExecutable } from '../server/validation.ts';

const root = path.resolve(process.argv[2] || '.data/pilots/illustration-20261024');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.samples.some((s: { status: string }) => ['queued', 'running', 'checking'].includes(s.status))) throw new Error('先等待全部样本进入终态；不比较挑选出的部分结果。');
const browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  async function snapshot(id: string) {
    await page.goto(`http://127.0.0.1:4184/runs/${id}/index.html`, { waitUntil: 'load' });
    return page.evaluate(() => {
      const guide = document.querySelector('#guide');
      const box = guide?.getBoundingClientRect();
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelector('#guide')?.remove();
      clone.querySelectorAll('script,style').forEach(e => e.remove());
      return { guideBox: box?.toJSON(), guideText: (guide as HTMLElement)?.innerText.replace(/\s+/g, ' ').trim(), outsideText: clone.textContent?.replace(/\s+/g, ' ').trim(), scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
  }
  const baseline = await snapshot('baseline');
  const results = [];
  for (const sample of [...manifest.samples].sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))) {
    try {
      const current = await snapshot(sample.id);
      await page.goto('http://127.0.0.1:4183/');
      // A raw browser function avoids tsx's __name helper being serialized into page.evaluate.
      const pixels = await page.evaluate('(' + String.raw`async ({ id, baselineBox, currentBox }) => {
        async function decode(url) {
          const image = await createImageBitmap(await (await fetch(url)).blob());
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height);
        }
        const [a, b] = await Promise.all([decode('/runs/baseline/initial.png'), decode('/runs/' + id + '/initial.png')]);
        if (a.width !== b.width || a.height !== b.height) throw new Error('截图尺寸不一致');
        const inside = (x, y, box) => box && x >= box.x - 2 && x < box.x + box.width + 2 && y >= box.y - 2 && y < box.y + box.height + 2;
        let changed = 0, outsideChanged = 0, outsideTotal = 0;
        for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
          const k = (y * a.width + x) * 4;
          const diff = Math.max(Math.abs(a.data[k] - b.data[k]), Math.abs(a.data[k+1] - b.data[k+1]), Math.abs(a.data[k+2] - b.data[k+2])) > 16;
          const outside = !inside(x, y, baselineBox) && !inside(x, y, currentBox);
          if (diff) changed++;
          if (outside) { outsideTotal++; if (diff) outsideChanged++; }
        }
        return { changedPixels: changed, outsideChangedPixels: outsideChanged, outsideTotalPixels: outsideTotal, outsideChangedPercent: 100 * outsideChanged / outsideTotal, tolerance: 'max RGB channel difference > 16; exclude union of original/result #guide boxes with 2px margin' };
      }` + ')(' + JSON.stringify({ id: sample.id, baselineBox: baseline.guideBox, currentBox: current.guideBox }) + ')');
      results.push({ id: sample.id, status: sample.status, functionalChecksPassed: sample.validationPassed, outsideTextUnchanged: current.outsideText === baseline.outsideText, guideTextUnchanged: current.guideText === baseline.guideText, horizontalOverflow: current.scrollWidth > current.viewportWidth, guideBox: current.guideBox, pixels });
    } catch(error) { results.push({ id: sample.id, status: sample.status, error: String(error) }); }
  }
  const result = { createdAt: new Date().toISOString(), method: 'Initial viewport screenshots; RGB threshold outside union of target card boxes. Pixel difference establishes location, not aesthetic quality or rule causality. Text comparison excludes scripts/styles; functional checks are separate.', baseline: { guideBox: baseline.guideBox }, results };
  await writeFile(path.join(root, 'measurements.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
