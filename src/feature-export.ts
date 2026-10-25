import { featureSections, featureApplication, selectedFeatures, type FeatureBoard } from '../shared/feature-board';
import type { LayoutDiagram } from '../shared/layout-diagram';
import { layoutPalette } from './LayoutDiagram';

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

function drawLayout(ctx: CanvasRenderingContext2D, diagram: LayoutDiagram, x: number, y: number, width: number, height: number) {
  const diagramHeight = Math.min(height - 24, (width - 24) / diagram.aspectRatio);
  const diagramWidth = diagramHeight * diagram.aspectRatio;
  const left = x + (width - diagramWidth) / 2, top = y + (height - diagramHeight) / 2;
  for (const block of diagram.blocks) {
    const color = layoutPalette[block.role];
    const bx = left + block.x * diagramWidth, by = top + block.y * diagramHeight;
    const bw = block.width * diagramWidth, bh = block.height * diagramHeight;
    ctx.save();
    rect(ctx, bx, by, bw, bh, Math.min(4, bw / 8, bh / 8), color.fill, color.stroke);
    ctx.beginPath(); ctx.rect(bx + 2, by + 2, Math.max(0, bw - 4), Math.max(0, bh - 4)); ctx.clip();
    let size = Math.min(18, Math.max(9, (bh - 6) / 1.3));
    ctx.font = font(size, 600);
    if (Array.from(block.label).length <= 8) {
      while (size > 9 && ctx.measureText(block.label).width > bw - 12) ctx.font = font(--size, 600);
    }
    const lineHeight = size * 1.3;
    ctx.fillStyle = color.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rows = lines(ctx, block.label, Math.max(1, bw - 12));
    const visibleRows = rows.slice(0, Math.max(1, Math.min(2, Math.floor((bh - 4) / lineHeight))));
    if (visibleRows.length < rows.length) {
      let last = visibleRows[visibleRows.length - 1];
      while (last && ctx.measureText(`${last}…`).width > bw - 8) last = Array.from(last).slice(0, -1).join('');
      visibleRows[visibleRows.length - 1] = `${last}…`;
    }
    visibleRows.forEach((row, index) => ctx.fillText(row, bx + bw / 2, by + bh / 2 + (index - (visibleRows.length - 1) / 2) * lineHeight));
    ctx.restore();
  }
}

/** Render from selected structured data only, never a screenshot of the editing interface. */
export async function exportFeatureBoard(board: FeatureBoard): Promise<{ blob: Blob; width: number; height: number }> {
  const selected = selectedFeatures(board);
  if (!selected.length) throw new Error('请先勾选至少一个特征。');
  const layoutSelected = selected.some(card => card.kind === 'layout');
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
    const application = lines(ctx, `应用区域：${featureApplication(card)}`, textWidth);
    const previewHeight = card.kind === 'layout' && card.layout ? 242 : 135;
    const height = 240 + previewHeight - 135 + title.length * 34 + sections.reduce((sum, section) => sum + 34 + section.rows.length * 30 + 16, 0) + application.length * 30;
    return { card, index, title, sections, application, height, previewHeight, x: index % 2 === 0 ? 46 : width - cardWidth - 46, y: 0 };

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
  ctx.font = font(23); ctx.fillStyle = muted; ctx.fillText(`仅迁移编号 1–${selected.length} 的所选特征 · ${layoutSelected ? '按所选布局重组；遵守应用范围' : selected.some(c => c.kind === 'global') ? '整页风格协调' : '其余画面仅作上下文'} · 保留目标网页的业务内容与功能`, 46, 157);
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
    rect(ctx, c.x + 24, y + 8, textWidth, c.previewHeight, 10, '#f2f5f3');
    if (c.card.kind === 'layout' && c.card.layout) {
      drawLayout(ctx, c.card.layout, c.x + 24, y + 8, textWidth, c.previewHeight - 32);
      ctx.font = font(16); ctx.fillStyle = muted; ctx.textAlign = 'center';
      ctx.fillText('布局结构 · 勾选即采用 · 比例为观察估计', c.x + cardWidth / 2, y + c.previewHeight - 3);
      ctx.textAlign = 'left';
    } else {
      const cropX = r.x * image.naturalWidth, cropY = r.y * image.naturalHeight, cropW = r.width * image.naturalWidth, cropH = r.height * image.naturalHeight;
      const ratio = Math.min(textWidth / cropW, 115 / cropH);
      ctx.drawImage(image, cropX, cropY, cropW, cropH, c.x + 24 + (textWidth - cropW * ratio) / 2, y + 18 + (115 - cropH * ratio) / 2, cropW * ratio, cropH * ratio);
    }
    y += c.previewHeight + 35;
    for (const section of c.sections) {
      ctx.font = font(20, 650); ctx.fillStyle = blue; ctx.fillText(section.label, c.x + 24, y); y += 34;
      ctx.font = font(21); ctx.fillStyle = ink; paragraph(ctx, section.rows, c.x + 24, y, 30); y += section.rows.length * 30 + 16;
    }
    ctx.font = font(21); ctx.fillStyle = muted; paragraph(ctx, c.application, c.x + 24, y, 30);
  }
  ctx.font = font(20); ctx.fillStyle = muted; ctx.fillText(`${layoutSelected ? '按所选布局与应用范围重组内容；色块仅表示角色、比例与叠放，不指定目标配色。' : '按内容用途迁移所选关系；未选布局卡片时不主动重排整页。'}数值为观察估计或迁移建议。不适用时说明原因，不为套用特征新增业务模块。`, 46, height - 49);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片导出失败。')), 'image/png'));
  return { blob, width, height };
}
