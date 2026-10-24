import { featureSections, selectedFeatures, type FeatureBoard } from '../shared/feature-board';

export function loadReference(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('参考图片无法读取，请重新上传。')); img.src = url; });
}
const ink = '#26322d', blue = '#306ce5', muted = '#68766e';
const font = (size: number, weight = 400) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
function lines(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const result: string[] = []; let line = '';
  for (const ch of value) {
    if (ch === '\n') { result.push(line); line = ''; continue; }
    if (line && ctx.measureText(line + ch).width > width) { result.push(line); line = ch; } else line += ch;
  }
  if (line) result.push(line);
  return result;
}
function paragraph(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, lineHeight: number) { rows.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight)); }
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string, stroke?: string) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
function badge(ctx: CanvasRenderingContext2D, n: number, x: number, y: number) { ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fillStyle = blue; ctx.fill(); ctx.fillStyle = 'white'; ctx.font = font(19, 700); ctx.textAlign = 'center'; ctx.fillText(String(n), x, y + 7); ctx.textAlign = 'left'; }

/** Render from selected structured data only, never a screenshot of the editing interface. */
export async function exportFeatureBoard(board: FeatureBoard): Promise<{ blob: Blob; width: number; height: number }> {
  const selected = selectedFeatures(board);
  if (!selected.length) throw new Error('请先勾选至少一个特征。');
  await document.fonts.ready;
  const image = await loadReference(board.reference.url);
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不能生成图片。');
  const width = 2200, cardWidth = 470, textWidth = cardWidth - 48, startY = 210;
  const cards = selected.map((card, index) => {
    ctx.font = font(25, 700); const title = lines(ctx, card.title, textWidth - 42);
    const sections = featureSections(card).map(section => {
      ctx.font = font(21); return { ...section, rows: lines(ctx, section.text, textWidth) };
    });
    ctx.font = font(21);
    const application = lines(ctx, card.application ? `指定区域：${card.application}` : '应用区域：按组件用途匹配现有界面', textWidth);
    const height = 240 + title.length * 34 + sections.reduce((sum, section) => sum + 34 + section.rows.length * 30 + 16, 0) + application.length * 30;
    return { card, index, title, sections, application, height, x: index % 2 === 0 ? 46 : width - cardWidth - 46, y: 0 };

  });
  const columns = [startY, startY];
  for (const c of cards) { c.y = columns[c.index % 2]; columns[c.index % 2] += c.height + 24; }
  const imageWidth = 1020, imageHeight = Math.min(1550, imageWidth * image.naturalHeight / image.naturalWidth);
  const actualWidth = imageHeight * image.naturalWidth / image.naturalHeight;
  const contentBottom = Math.max(...columns, startY + imageHeight + 90);
  const height = contentBottom + 120;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#f7f9f8'; ctx.fillRect(0, 0, width, height);
  ctx.font = font(20, 600); ctx.fillStyle = blue; ctx.fillText('DEFINE PRETTY  /  视觉参考', 46, 52);
  ctx.font = font(40, 700); ctx.fillStyle = ink;
  const heading = lines(ctx, board.title, width - 100); ctx.fillText(heading[0] + (heading.length > 1 ? '…' : ''), 46, 110);
  ctx.font = font(23); ctx.fillStyle = muted; ctx.fillText(`仅迁移编号 1–${selected.length} 的所选特征 · 其余画面仅作上下文 · 保留目标网页的业务内容与功能`, 46, 157);
  const imageX = (width - actualWidth) / 2, imageY = startY + (contentBottom - startY - imageHeight) / 2;
  rect(ctx, imageX - 14, imageY - 14, actualWidth + 28, imageHeight + 28, 20, '#ffffff', '#dfe6e2');
  ctx.drawImage(image, imageX, imageY, actualWidth, imageHeight);
  ctx.fillStyle = muted; ctx.font = font(20); ctx.fillText('参考图 · 引线指向特征出处', imageX, imageY - 32);
  for (const c of cards) {
    const r = c.card.region; const rx = imageX + r.x * actualWidth, ry = imageY + r.y * imageHeight, rw = r.width * actualWidth, rh = r.height * imageHeight;
    const left = c.index % 2 === 0, sx = left ? c.x + cardWidth : c.x, sy = c.y + 45, ex = left ? rx : rx + rw, ey = ry + rh / 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); const bend = left ? imageX - 28 : imageX + actualWidth + 28; ctx.lineTo(bend, sy); ctx.lineTo(bend, ey); ctx.lineTo(ex, ey); ctx.strokeStyle = '#7fa7f0'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = blue; ctx.setLineDash([7, 5]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
    badge(ctx, c.index + 1, Math.max(imageX + 19, Math.min(rx + 18, imageX + actualWidth - 19)), Math.max(imageY + 19, Math.min(ry + 18, imageY + imageHeight - 19)));
    rect(ctx, c.x, c.y, cardWidth, c.height, 18, '#ffffff', '#dfe6e2');
    badge(ctx, c.index + 1, c.x + 38, c.y + 39);
    ctx.font = font(25, 700); ctx.fillStyle = ink; paragraph(ctx, c.title, c.x + 68, c.y + 47, 34);
    let y = c.y + 36 + c.title.length * 34;
    const cropX = r.x * image.naturalWidth, cropY = r.y * image.naturalHeight, cropW = r.width * image.naturalWidth, cropH = r.height * image.naturalHeight;
    const ratio = Math.min(textWidth / cropW, 115 / cropH);
    rect(ctx, c.x + 24, y + 8, textWidth, 135, 10, '#f2f5f3');
    ctx.drawImage(image, cropX, cropY, cropW, cropH, c.x + 24 + (textWidth - cropW * ratio) / 2, y + 18 + (115 - cropH * ratio) / 2, cropW * ratio, cropH * ratio);
    y += 170;
    for (const section of c.sections) {
      ctx.font = font(20, 650); ctx.fillStyle = blue; ctx.fillText(section.label, c.x + 24, y); y += 34;
      ctx.font = font(21); ctx.fillStyle = ink; paragraph(ctx, section.rows, c.x + 24, y, 30); y += section.rows.length * 30 + 16;
    }
    ctx.font = font(21); ctx.fillStyle = muted; paragraph(ctx, c.application, c.x + 24, y, 30);
  }
  ctx.font = font(20); ctx.fillStyle = muted; ctx.fillText('按适用对象匹配现有组件；数值为观察估计或迁移建议，非精确测量。不适用时说明原因，不为套用特征新增业务模块。', 46, height - 49);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片导出失败。')), 'image/png'));
  return { blob, width, height };
}
