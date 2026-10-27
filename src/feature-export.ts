import { selectedFeatures, featureTier, type FeatureBoard, type FeatureCard } from '../shared/feature-board';
import { featureOverview, overviewPlacement, type OverviewCell, type OverviewRow } from '../shared/feature-overview';
import { resolveLayoutDiagram, blockProportionLabel, type LayoutDiagram } from '../shared/layout-diagram';
import { fitLayoutBlockLabel, layoutPalette } from './LayoutDiagram';

export function loadReference(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('参考图片无法读取，请重新上传。')); img.src = url; });
}

const ink = '#26322d', blue = '#306ce5', muted = '#68766e';
const font = (size: number, weight = 400) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
function lines(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const result: string[] = []; let line = '';
  // Keep a number and its unit (or a HEX value) together when wrapping labels.
  const tokens = value.match(/#[0-9a-fA-F]{6}|[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vh|vw|%|°|×)?|[^\n]|\n/gu) ?? [];
  for (const ch of tokens) {
    if (ch === '\n') { result.push(line); line = ''; continue; }
    if (line && ctx.measureText(line + ch).width > width) { result.push(line); line = ch; } else line += ch;
  }
  if (line) result.push(line);
  return result;
}
function paragraph(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, lineHeight: number) { rows.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight)); }
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string, stroke?: string) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
function badge(ctx: CanvasRenderingContext2D, n: number, x: number, y: number) {
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fillStyle = blue; ctx.fill();
  ctx.fillStyle = 'white'; ctx.font = font(21, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), x, y + 1); ctx.restore();
}

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
    ctx.font = font(19, 600); ctx.fillStyle = color.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = fitLayoutBlockLabel(resolved, index, blockProportionLabel(diagram, index), { width: diagramWidth, height: diagramHeight }, { measure: value => ctx.measureText(value).width, lineHeight: 23, gap: 0, padding: 6, numberSize: 24 });
    if (text) {
      const textX = left + text.center.x * diagramWidth, textY = top + text.center.y * diagramHeight;
      if (text.numbered) {
        rect(ctx, textX - 12, textY - 12, 24, 24, 3, color.fill, color.stroke);
        ctx.fillStyle = color.text; ctx.fillText(String(index + 1), textX, textY);
      } else text.rows.forEach((row, rowIndex) => ctx.fillText(row, textX, textY + (rowIndex - (text.rows.length - 1) / 2) * 23));
    }
    ctx.restore();
  }
}

/** Fit the complete selected region; never invent a second crop inside the observed evidence. */
function drawCrop(ctx: CanvasRenderingContext2D, image: HTMLImageElement, card: FeatureCard, x: number, y: number, width: number, height: number) {
  const r = card.region, sourceX = r.x * image.naturalWidth, sourceY = r.y * image.naturalHeight;
  const sourceWidth = r.width * image.naturalWidth, sourceHeight = r.height * image.naturalHeight;
  const scale = Math.min(width / sourceWidth, height / sourceHeight), w = sourceWidth * scale, h = sourceHeight * scale;
  rect(ctx, x, y, width, height, 10, '#f2f5f3');
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

function measureRow(ctx: CanvasRenderingContext2D, row: OverviewRow, width: number) {
  ctx.font = font(22, 600); const labelWidth = ctx.measureText(row.label).width;
  ctx.font = font(24, 650); const valueWidth = ctx.measureText(row.value).width;
  const inline = labelWidth + valueWidth + 18 <= width;
  ctx.font = font(22, 600); const label = lines(ctx, row.label, width);
  ctx.font = font(24, 650); const value = lines(ctx, row.value, width);
  ctx.font = font(20); const detail = row.detail ? lines(ctx, row.detail, width) : [];
  const primaryHeight = inline ? 32 : label.length * 28 + value.length * 32 + 3;
  return { label, value, detail, inline, primaryHeight, height: primaryHeight + (detail.length ? detail.length * 27 + 5 : 0) + 15 };
}

function measureCard(ctx: CanvasRenderingContext2D, card: FeatureCard, number: number, width: number) {
  const overview = featureOverview(card), padding = 24, textWidth = width - padding * 2;
  ctx.font = font(29, 700); const title = lines(ctx, card.title, textWidth - 54), titleHeight = Math.max(40, title.length * 38);
  ctx.font = font(24); const summary = lines(ctx, overview.summary, textWidth);
  const visual = card.kind === 'layout' && card.layout ? 'layout' : overview.kind === 'palette' || overview.kind === 'typography' ? undefined : 'crop';
  const visualHeight = visual === 'layout' ? 218 : visual ? 200 : 0;
  const proportions = card.layout?.proportions ?? [], splits = proportions.filter(proportion => proportion.type === 'split');
  const splitAxis = splits.every(split => split.axis === 'horizontal') ? '宽度' : splits.every(split => split.axis === 'vertical') ? '高度' : '宽高';
  const layoutBasis = proportions.length ? [
    splits.length ? `分栏按所属区域扣除间距后的${splitAxis}` : '',
    proportions.some(proportion => proportion.type === 'relative') ? '浮层尺寸相对参考块' : '',
  ].filter(Boolean).join('；') : '宽高以示意画布为基准';
  const layoutCaption = visual === 'layout'
    ? `比例为观察估计；${layoutBasis}。色块仅区分角色。`
    : '';
  ctx.font = font(20); const visualCaption = lines(ctx, layoutCaption, textWidth);
  const rows = overview.rows.map(row => measureRow(ctx, row, textWidth));
  const swatchColumns = Math.min(3, overview.swatches.length), swatchGap = 14;
  const swatchWidth = swatchColumns ? (textWidth - swatchGap * (swatchColumns - 1)) / swatchColumns : 0;
  const swatches = overview.swatches.map(swatch => {
    ctx.font = font(21, 600); const label = lines(ctx, swatch.label, swatchWidth);
    ctx.font = font(19); const detail = lines(ctx, [swatch.role, swatch.area, swatch.evidence].filter(Boolean).join(' · '), swatchWidth);
    return { ...swatch, label, detail, height: 48 + 9 + label.length * 27 + 27 + detail.length * 25 + 18 };
  });
  const swatchRows: { swatches: typeof swatches; height: number }[] = [];
  for (let index = 0; index < swatches.length; index += swatchColumns) {
    const items = swatches.slice(index, index + swatchColumns); swatchRows.push({ swatches: items, height: Math.max(...items.map(swatch => swatch.height)) });
  }
  ctx.font = font(20); const notes = overview.notes.flatMap(note => lines(ctx, note, textWidth));
  const height = padding + titleHeight + 32 + (visualHeight ? visualHeight + 16 : 0)
    + (visualCaption.length ? visualCaption.length * 27 + 15 : 0)
    + (summary.length ? summary.length * 34 + 16 : 0)
    + rows.reduce((sum, row) => sum + row.height, 0)
    + swatchRows.reduce((sum, row) => sum + row.height, 0)
    + (notes.length ? notes.length * 27 + 10 : 0) + 27 + padding;
  return { card, number, width, height, padding, textWidth, title, titleHeight, summary, visual, visualHeight, visualCaption, rows, swatchRows, swatchWidth, swatchGap, notes, x: 0, y: 0 };
}
type MeasuredCard = ReturnType<typeof measureCard>;

function drawCard(ctx: CanvasRenderingContext2D, image: HTMLImageElement, item: MeasuredCard) {
  const { x, y: top, width, height, padding, textWidth } = item, left = x + padding;
  rect(ctx, x, top, width, height, 18, '#ffffff', '#dfe6e2');
  badge(ctx, item.number, left + 20, top + padding + 20);
  ctx.font = font(29, 700); ctx.fillStyle = ink; paragraph(ctx, item.title, left + 54, top + padding + 29, 38);
  let y = top + padding + item.titleHeight;
  ctx.font = font(18, 600); ctx.fillStyle = blue;
  ctx.fillText({ foundation: '基础规范', signature: '辨识特征', detail: '精细细节' }[featureTier(item.card)], left, y + 20); y += 32;
  if (item.visual === 'layout' && item.card.layout) {
    rect(ctx, left, y, textWidth, item.visualHeight, 10, '#f2f5f3'); drawLayout(ctx, item.card.layout, left, y, textWidth, item.visualHeight);
  } else if (item.visual === 'crop') drawCrop(ctx, image, item.card, left, y, textWidth, item.visualHeight);
  if (item.visualHeight) y += item.visualHeight + 16;
  if (item.visualCaption.length) {
    ctx.font = font(20); ctx.fillStyle = muted; paragraph(ctx, item.visualCaption, left, y + 20, 27); y += item.visualCaption.length * 27 + 15;
  }
  if (item.summary.length) {
    ctx.font = font(24); ctx.fillStyle = ink; paragraph(ctx, item.summary, left, y + 24, 34); y += item.summary.length * 34 + 16;
  }
  for (const row of item.rows) {
    ctx.font = font(22, 600); ctx.fillStyle = muted; paragraph(ctx, row.label, left, y + 24, 28);
    ctx.font = font(24, 650); ctx.fillStyle = ink;
    if (row.inline) { ctx.textAlign = 'right'; paragraph(ctx, row.value, left + textWidth, y + 24, 32); ctx.textAlign = 'left'; }
    else paragraph(ctx, row.value, left, y + row.label.length * 28 + 27, 32);
    if (row.detail.length) { ctx.font = font(20); ctx.fillStyle = muted; paragraph(ctx, row.detail, left, y + row.primaryHeight + 25, 27); }
    y += row.height;
  }
  for (const row of item.swatchRows) {
    row.swatches.forEach((swatch, index) => {
      const sx = left + index * (item.swatchWidth + item.swatchGap);
      rect(ctx, sx, y, item.swatchWidth, 48, 6, swatch.hex, '#dce3df');
      ctx.font = font(21, 600); ctx.fillStyle = ink; paragraph(ctx, swatch.label, sx, y + 78, 27);
      const detailY = y + 57 + swatch.label.length * 27;
      ctx.font = font(20, 600); ctx.fillText(swatch.hex, sx, detailY + 20);
      ctx.font = font(19); ctx.fillStyle = muted; paragraph(ctx, swatch.detail, sx, detailY + 47, 25);
    });
    y += row.height;
  }
  if (item.notes.length) { ctx.font = font(20); ctx.fillStyle = muted; paragraph(ctx, item.notes, left, y + 20, 27); y += item.notes.length * 27 + 10; }
  ctx.font = font(18); ctx.fillStyle = '#85928a'; ctx.fillText('完整规则与应用要求见配套指令', left, top + height - padding);
}

function layoutOverview(ctx: CanvasRenderingContext2D, cards: FeatureCard[], availableWidth: number, margin: number, gap: number, startY: number, referenceAspect: number) {
  const placement = overviewPlacement(cards.length), unit = (availableWidth - gap * (placement.columns - 1)) / placement.columns;
  const cellWidth = (cell: OverviewCell) => cell.columnSpan * unit + (cell.columnSpan - 1) * gap;
  const items = cards.map((card, index) => measureCard(ctx, card, index + 1, cellWidth(placement.cards[index])));
  const count = Math.max(...[placement.reference, ...placement.cards].map(cell => cell.row + cell.rowSpan - 1));
  const rowHeights = Array<number>(count).fill(0);
  const cellHeight = (cell: OverviewCell) => rowHeights.slice(cell.row - 1, cell.row + cell.rowSpan - 1).reduce((sum, height) => sum + height, 0) + (cell.rowSpan - 1) * gap;
  const ensureHeight = (cell: OverviewCell, required: number) => {
    const growth = Math.max(0, required - cellHeight(cell)) / cell.rowSpan;
    for (let row = cell.row - 1; row < cell.row + cell.rowSpan - 1; row++) rowHeights[row] += growth;
  };
  items.forEach((item, index) => ensureHeight(placement.cards[index], item.height));
  // Reserve enough height for the complete reference, then let it use any taller side-card rows.
  ensureHeight(placement.reference, Math.max(220, Math.min(800, (cellWidth(placement.reference) - 48) / referenceAspect) + 112));
  const bounds = (cell: OverviewCell) => ({
    x: margin + (cell.column - 1) * (unit + gap),
    y: startY + rowHeights.slice(0, cell.row - 1).reduce((sum, height) => sum + height + gap, 0),
    width: cellWidth(cell), height: cellHeight(cell),
  });
  items.forEach((item, index) => Object.assign(item, bounds(placement.cards[index])));
  return { cards: items, reference: bounds(placement.reference), bottom: startY + rowHeights.reduce((sum, height) => sum + height, 0) + (count - 1) * gap };
}

/** Numbered points locate evidence without covering the reference in overlapping rectangles. */
function drawReferenceMarkers(ctx: CanvasRenderingContext2D, cards: FeatureCard[], bounds: { x: number; y: number; width: number; height: number }, panel: { x: number; width: number }) {
  const placed: { x: number; y: number }[] = [];
  for (const [index, card] of cards.entries()) {
    const r = card.region;
    const anchor = { x: bounds.x + (r.x + Math.min(r.width / 2, .04)) * bounds.width, y: bounds.y + (r.y + Math.min(r.height / 2, .04)) * bounds.height };
    const candidates = [anchor];
    for (let radius = 48; radius <= 240; radius += 48) {
      for (let direction = 0; direction < 12; direction++) {
        const angle = direction * Math.PI / 6; candidates.push({ x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius });
      }
    }
    const constrain = (point: { x: number; y: number }) => ({ x: Math.max(panel.x + 28, Math.min(point.x, panel.x + panel.width - 28)), y: Math.max(bounds.y + 24, Math.min(point.y, bounds.y + bounds.height - 24)) });
    const marker = candidates.map(constrain).find(point => placed.every(other => Math.hypot(other.x - point.x, other.y - point.y) >= 46))
      ?? { x: panel.x + 28 + index * 46, y: bounds.y + 24 };
    if (Math.hypot(marker.x - anchor.x, marker.y - anchor.y) > 24) {
      ctx.strokeStyle = '#7299ec'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(marker.x, marker.y); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(marker.x, marker.y, 24, 0, Math.PI * 2); ctx.fillStyle = '#ffffffdd'; ctx.fill();
    badge(ctx, index + 1, marker.x, marker.y); placed.push(marker);
  }
}

/** The screen and PNG share one summary projection; the canonical instructions stay complete. */
export async function exportFeatureBoard(board: FeatureBoard): Promise<{ blob: Blob; width: number; height: number }> {
  const selected = selectedFeatures(board);
  if (!selected.length) throw new Error('请先勾选至少一个特征。');
  await document.fonts.ready;
  const image = await loadReference(board.reference.url), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不能生成图片。');
  const width = 2200, margin = 48, gap = 24, availableWidth = width - margin * 2;
  ctx.font = font(42, 700); const heading = lines(ctx, board.title, availableWidth);
  const headingHeight = heading.length * 52, contentStart = 126 + headingHeight;
  const overview = layoutOverview(ctx, selected, availableWidth, margin, gap, contentStart + 18, image.naturalWidth / image.naturalHeight);
  const reference = overview.reference;
  const referenceScale = Math.min((reference.width - 48) / image.naturalWidth, (reference.height - 112) / image.naturalHeight);
  const referenceWidth = image.naturalWidth * referenceScale, referenceHeight = image.naturalHeight * referenceScale;
  const referenceImageY = reference.y + 66 + (reference.height - 112 - referenceHeight) / 2;
  const referenceImageX = reference.x + (reference.width - referenceWidth) / 2, contentBottom = overview.bottom;
  ctx.font = font(23);
  const footer = lines(ctx, '视觉摘要 · 完整规则、应用范围与未展示参数见配套指令。请同时提供无标记原图。', availableWidth);
  const height = Math.ceil(contentBottom + 34 + footer.length * 32 + margin);
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#f7f9f8'; ctx.fillRect(0, 0, width, height);
  ctx.font = font(21, 650); ctx.fillStyle = blue; ctx.fillText('DEFINE PRETTY  /  视觉总览', margin, 45);
  ctx.font = font(42, 700); ctx.fillStyle = ink; paragraph(ctx, heading, margin, 102, 52);
  ctx.font = font(24); ctx.fillStyle = muted; ctx.fillText(`${selected.length} 个已选特征 · 编号与配套指令对应 · 数值按标注、估计或建议区分`, margin, 102 + headingHeight);
  overview.cards.forEach(item => drawCard(ctx, image, item));
  rect(ctx, reference.x, reference.y, reference.width, reference.height, 18, '#ffffff', '#dfe6e2');
  ctx.font = font(26, 650); ctx.fillStyle = ink; ctx.fillText('完整参考图', reference.x + 24, reference.y + 40);
  ctx.font = font(21); ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText('编号定位参考出处', reference.x + reference.width - 24, reference.y + 40); ctx.textAlign = 'left';
  ctx.drawImage(image, referenceImageX, referenceImageY, referenceWidth, referenceHeight);
  drawReferenceMarkers(ctx, selected, { x: referenceImageX, y: referenceImageY, width: referenceWidth, height: referenceHeight }, { x: reference.x, width: reference.width });
  ctx.font = font(20); ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.fillText('局部示例见对应特征；完整细节可查看无标记原图。', reference.x + reference.width / 2, reference.y + reference.height - 18); ctx.textAlign = 'left';
  ctx.font = font(23); ctx.fillStyle = muted; paragraph(ctx, footer, margin, contentBottom + 34 + 23, 32);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片导出失败。')), 'image/png'));
  return { blob, width, height };
}
