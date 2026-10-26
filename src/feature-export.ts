import { featureSections, featureApplication, selectedFeatures, featureTier, type FeatureBoard } from '../shared/feature-board';
import { resolveLayoutDiagram, getLayoutProportionNotes, blockProportionLabel, type LayoutDiagram } from '../shared/layout-diagram';
import { specTable, type FeatureSpec } from '../shared/feature-spec';
import { fitLayoutBlockLabel, layoutPalette, layoutRoleLabels } from './LayoutDiagram';
import { tierLabels } from './FeatureSpecView';

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
  const resolved = resolveLayoutDiagram(diagram);
  const diagramHeight = Math.min(height - 24, (width - 24) / resolved.aspectRatio);
  const diagramWidth = diagramHeight * resolved.aspectRatio;
  const left = x + (width - diagramWidth) / 2, top = y + (height - diagramHeight) / 2;
  for (const [index, block] of resolved.blocks.entries()) {
    const color = layoutPalette[block.role];
    const bx = left + block.x * diagramWidth, by = top + block.y * diagramHeight;
    const bw = block.width * diagramWidth, bh = block.height * diagramHeight;
    ctx.save();
    rect(ctx, bx, by, bw, bh, Math.min(4, bw / 8, bh / 8), color.fill, color.stroke);
    ctx.font = font(13, 600);
    ctx.fillStyle = color.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = fitLayoutBlockLabel(resolved, index, blockProportionLabel(diagram, index), { width: diagramWidth, height: diagramHeight }, { measure: value => ctx.measureText(value).width, lineHeight: 16, gap: 0, padding: 5, numberSize: 22 });
    if (text) {
      const textX = left + text.center.x * diagramWidth, textY = top + text.center.y * diagramHeight;
      if (text.numbered) {
        rect(ctx, textX - 10, textY - 10, 20, 20, 3, color.fill, color.stroke);
        ctx.fillStyle = color.text;
        ctx.fillText(String(index + 1), textX, textY);
      } else {
        text.rows.forEach((row, rowIndex) => ctx.fillText(row, textX, textY + (rowIndex - (text.rows.length - 1) / 2) * 16));
      }
    }
    ctx.restore();
  }
}

/** The export keeps the same columns as the card, with widths fitted to each specification. */
function measureSpec(ctx: CanvasRenderingContext2D, spec: FeatureSpec, width: number, cardTitle: string) {
  const table = specTable(spec);
  const weights = { typography: [.13, .36, .14, .06, .08, .09, .14], palette: [.23, .12, .36, .13, .16], spacing: [.17, .09, .27, .31, .16], attributes: [.18, .42, .24, .16] }[spec.kind];
  const columnWidths = weights.map(weight => width * weight);
  ctx.font = font(22, 650); const title = table.title === cardTitle ? [] : lines(ctx, table.title, width);
  ctx.font = font(18, 600);
  const headers = table.columns.map((label, index) => lines(ctx, label, columnWidths[index] - 22));
  const headerHeight = Math.max(...headers.map(row => row.length)) * 24 + 16;
  ctx.font = font(18);
  const rows = table.rows.map(row => {
    const cells = row.cells.map((value, index) => { ctx.font = font(18, index === 0 ? 600 : 400); return lines(ctx, value || '—', columnWidths[index] - 22 - (index === 0 && row.swatch ? 32 : 0)); });
    return { cells, swatch: row.swatch, height: Math.max(...cells.map(cell => cell.length)) * 24 + 12 };
  });
  ctx.font = font(18);
  const notes = table.notes.map(note => lines(ctx, note, width));
  const titleHeight = title.length ? title.length * 30 + 12 : 0;
  const height = titleHeight + headerHeight + rows.reduce((sum, row) => sum + row.height, 0) + 14 + notes.reduce((sum, row) => sum + row.length * 24 + 6, 0);
  return { title, titleHeight, columnWidths, headers, headerHeight, rows, notes, height };
}
function drawSpec(ctx: CanvasRenderingContext2D, spec: ReturnType<typeof measureSpec>, x: number, top: number, width: number) {
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let y = top;
  ctx.font = font(22, 650); ctx.fillStyle = blue; paragraph(ctx, spec.title, x, y + 22, 30); y += spec.titleHeight;
  const drawRow = (cells: string[][], height: number, header: boolean, swatch?: string, alternate = false) => {
    let left = x;
    for (const [index, cell] of cells.entries()) {
      const cellWidth = spec.columnWidths[index];
      ctx.fillStyle = header ? '#edf3f0' : alternate ? '#f8faf9' : '#ffffff'; ctx.fillRect(left, y, cellWidth, height);
      ctx.lineWidth = 1; ctx.strokeStyle = '#dce5df'; ctx.strokeRect(left, y, cellWidth, height);
      if (index === 0 && swatch) rect(ctx, left + 11, y + 8, 23, 23, 3, swatch, '#c6d1ca');
      ctx.font = font(18, header || index === 0 ? 600 : 400); ctx.fillStyle = header ? '#476351' : ink;
      paragraph(ctx, cell, left + 11 + (index === 0 && swatch ? 32 : 0), y + 24, 24);
      left += cellWidth;
    }
    y += height;
  };
  drawRow(spec.headers, spec.headerHeight, true);
  spec.rows.forEach((row, index) => drawRow(row.cells, row.height, false, row.swatch, index % 2 === 1));
  y += 14; ctx.font = font(18); ctx.fillStyle = muted;
  for (const note of spec.notes) { paragraph(ctx, note, x, y + 18, 24); y += note.length * 24 + 6; }
  ctx.restore();
}

/** Render only selected structured data; the reference and cards are linked by their shared numbers. */
export async function exportFeatureBoard(board: FeatureBoard): Promise<{ blob: Blob; width: number; height: number }> {
  const selected = selectedFeatures(board);
  if (!selected.length) throw new Error('请先勾选至少一个特征。');
  const layoutSelected = selected.some(card => card.kind === 'layout');
  await document.fonts.ready;
  const image = await loadReference(board.reference.url);
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不能生成图片。');
  const width = 2200, margin = 46, gap = 36, cardWidth = (width - margin * 2 - gap) / 2, padding = 28, textWidth = cardWidth - padding * 2, startY = 230;
  const referenceImageHeight = Math.min(1300, textWidth * image.naturalHeight / image.naturalWidth);
  const referenceImageWidth = referenceImageHeight * image.naturalWidth / image.naturalHeight;
  const referenceHeight = referenceImageHeight + 120;
  const cards = selected.map((card, index) => {
    ctx.font = font(28, 700); const title = lines(ctx, card.title, cardWidth - 108);
    const titleHeight = Math.max(40, title.length * 38);
    const sections = featureSections(card).map(section => {
      ctx.font = font(20); return { ...section, rows: lines(ctx, section.text, textWidth) };
    });
    ctx.font = font(19); const application = lines(ctx, `应用区域：${featureApplication(card)}`, textWidth);
    const layout = card.kind === 'layout' && card.layout ? resolveLayoutDiagram(card.layout) : undefined;
    const diagramWidth = 330, infoWidth = textWidth - diagramWidth - 38, diagramHeight = layout && layout.aspectRatio < 1 ? 420 : 240;
    ctx.font = font(17);
    const layoutLegend = layout?.blocks.map((block, i) => ({ role: block.role, rows: lines(ctx, `${block.label}（${layoutRoleLabels[block.role]}） · ${blockProportionLabel(card.layout!, i)}`, infoWidth - 38) })) ?? [];
    const layoutNotes = layout ? getLayoutProportionNotes(card.layout!).map(note => lines(ctx, note, infoWidth)) : [];
    const layoutInfoHeight = layoutLegend.reduce((sum, item) => sum + item.rows.length * 24 + 10, 0) + (layoutNotes.length ? 32 + layoutNotes.reduce((sum, note) => sum + note.length * 24 + 10, 0) : 0);
    const layoutHeight = layout ? Math.max(diagramHeight + 48, layoutInfoHeight) + 28 : 0;
    const spec = card.spec ? measureSpec(ctx, card.spec, textWidth, card.title) : undefined;
    const height = padding + titleHeight + 42 + (layoutHeight ? layoutHeight + 24 : 0) + (spec ? spec.height + 24 : 0)
      + sections.reduce((sum, section) => sum + 30 + section.rows.length * 28 + 14, 0) + application.length * 27 + padding;
    return { card, index, title, titleHeight, sections, application, height, layout, diagramWidth, diagramHeight, layoutLegend, layoutNotes, layoutHeight, spec, x: 0, y: 0 };
  });
  // The reference occupies the first left panel; numbered cards fill the shorter column in order.
  const columns = [startY + referenceHeight + gap, startY];
  for (const card of cards) {
    const column = columns[0] <= columns[1] ? 0 : 1;
    card.x = margin + column * (cardWidth + gap); card.y = columns[column]; columns[column] += card.height + gap;
  }
  const footerText = `${layoutSelected ? '按所选布局与应用范围重组内容；布局色块仅表示角色、比例与叠放，实际配色依据所选配色规则。' : '按内容用途迁移所选关系；未选布局卡片时不主动重排整页。'}请同时附上无标记原图与配套指令；原图仅补充已选特征的视觉依据。区分图中标注、观察估计与迁移建议，估计和建议值可按原图与实际效果校准；保留用户明确要求与业务功能。`;
  ctx.font = font(20); const footer = lines(ctx, footerText, width - margin * 2);
  const contentBottom = Math.max(...columns) - gap, height = contentBottom + 44 + footer.length * 28 + margin;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#f7f9f8'; ctx.fillRect(0, 0, width, height);
  ctx.font = font(20, 600); ctx.fillStyle = blue; ctx.fillText('DEFINE PRETTY  /  视觉参考', margin, 52);
  ctx.font = font(40, 700); ctx.fillStyle = ink;
  const heading = lines(ctx, board.title, width - margin * 2); ctx.fillText(heading[0] + (heading.length > 1 ? '…' : ''), margin, 110);
  ctx.font = font(23); ctx.fillStyle = muted; ctx.fillText(`仅迁移编号 1–${selected.length} 的所选特征 · ${layoutSelected ? '按所选布局重组；遵守应用范围' : selected.some(card => card.kind === 'global') ? '整页风格协调' : '其余画面仅作上下文'} · 保留目标网页的业务内容与功能`, margin, 157);
  ctx.font = font(19); ctx.fillText('检查顺序：基础规范 → 辨识特征 → 精细细节。仅采用已选卡片，估计与建议值可校准；实现手段由模型选择。', margin, 193);

  const imageX = margin + (cardWidth - referenceImageWidth) / 2, imageY = startY + 70;
  rect(ctx, margin, startY, cardWidth, referenceHeight, 18, '#ffffff', '#dfe6e2');
  ctx.font = font(25, 650); ctx.fillStyle = ink; ctx.fillText('参考图 · 按编号对照规范卡片', margin + padding, startY + 42);
  ctx.drawImage(image, imageX, imageY, referenceImageWidth, referenceImageHeight);
  const markers: { x: number; y: number }[] = [];
  for (const [index, card] of selected.entries()) {
    const r = card.region, rx = imageX + r.x * referenceImageWidth, ry = imageY + r.y * referenceImageHeight, rw = r.width * referenceImageWidth, rh = r.height * referenceImageHeight;
    ctx.strokeStyle = blue; ctx.lineWidth = 2; ctx.setLineDash([7, 5]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
    let bx = Math.max(imageX + 20, Math.min(rx + 20, imageX + referenceImageWidth - 20)), by = Math.max(imageY + 20, Math.min(ry + 20, imageY + referenceImageHeight - 20));
    while (markers.some(marker => Math.hypot(marker.x - bx, marker.y - by) < 40)) {
      bx += 42;
      if (bx > imageX + referenceImageWidth - 20) { bx = imageX + 20; by += 42; }
    }
    markers.push({ x: bx, y: by }); badge(ctx, index + 1, bx, by);
  }
  ctx.font = font(18); ctx.fillStyle = muted; ctx.fillText('编号定位参考出处；实施范围与参数以对应的已选卡片为准。', margin + padding, startY + referenceHeight - 22);

  for (const card of cards) {
    rect(ctx, card.x, card.y, cardWidth, card.height, 18, '#ffffff', '#dfe6e2');
    badge(ctx, card.index + 1, card.x + 46, card.y + 46);
    ctx.font = font(28, 700); ctx.fillStyle = ink; paragraph(ctx, card.title, card.x + 78, card.y + padding + 28, 38);
    let y = card.y + padding + card.titleHeight;
    ctx.font = font(18, 650); ctx.fillStyle = blue; ctx.fillText(tierLabels[featureTier(card.card)], card.x + padding, y + 20); y += 42;
    if (card.layout) {
      rect(ctx, card.x + padding, y, textWidth, card.layoutHeight, 10, '#f2f5f3');
      drawLayout(ctx, card.layout, card.x + padding, y + 12, card.diagramWidth, card.diagramHeight);
      ctx.font = font(16); ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.fillText('比例为观察估计 · 色块区分角色', card.x + padding + card.diagramWidth / 2, y + card.diagramHeight + 36); ctx.textAlign = 'left';
      const legendX = card.x + padding + card.diagramWidth + 18;
      let legendY = y + 30;
      for (const [index, entry] of card.layoutLegend.entries()) {
        const color = layoutPalette[entry.role]; rect(ctx, legendX, legendY - 16, 20, 20, 3, color.fill, color.stroke);
        ctx.font = font(13, 600); ctx.fillStyle = color.text; ctx.textAlign = 'center'; ctx.fillText(String(index + 1), legendX + 10, legendY - 1); ctx.textAlign = 'left';
        ctx.font = font(17); ctx.fillStyle = ink; paragraph(ctx, entry.rows, legendX + 30, legendY, 24); legendY += entry.rows.length * 24 + 10;
      }
      if (card.layoutNotes.length) {
        ctx.font = font(17, 650); ctx.fillStyle = blue; ctx.fillText('比例基准', legendX, legendY); legendY += 32;
        ctx.font = font(17); ctx.fillStyle = muted;
        for (const note of card.layoutNotes) { paragraph(ctx, note, legendX, legendY, 24); legendY += note.length * 24 + 10; }
      }
      y += card.layoutHeight + 24;
    }
    if (card.spec) { drawSpec(ctx, card.spec, card.x + padding, y, textWidth); y += card.spec.height + 24; }
    for (const section of card.sections) {
      ctx.font = font(20, 650); ctx.fillStyle = blue; ctx.fillText(section.label, card.x + padding, y + 20); y += 30;
      ctx.font = font(20); ctx.fillStyle = ink; paragraph(ctx, section.rows, card.x + padding, y + 20, 28); y += section.rows.length * 28 + 14;
    }
    ctx.font = font(19); ctx.fillStyle = muted; paragraph(ctx, card.application, card.x + padding, y + 19, 27);
  }
  ctx.font = font(20); ctx.fillStyle = muted; paragraph(ctx, footer, margin, contentBottom + 44, 28);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片导出失败。')), 'image/png'));
  return { blob, width, height };
}
