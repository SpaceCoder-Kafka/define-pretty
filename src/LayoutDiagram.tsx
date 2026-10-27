import { useEffect, useRef, useState } from 'react';
import { resolveLayoutDiagram, getLayoutProportionNotes, blockProportionLabel, type LayoutDiagram as Diagram, type LayoutRole } from '../shared/layout-diagram';

/** These colors identify content roles; they do not prescribe the target page's palette. */
export const layoutPalette: Record<LayoutRole, { fill: string; stroke: string; text: string }> = {
  navigation: { fill: '#344052', stroke: '#263343', text: '#ffffff' },
  main: { fill: '#bad5f3', stroke: '#7ca5d5', text: '#203b60' },
  support: { fill: '#f1dce8', stroke: '#cbaabe', text: '#684659' },
  highlight: { fill: '#386ee7', stroke: '#2758bf', text: '#ffffff' },
};
export const layoutRoleLabels: Record<LayoutRole, string> = {
  navigation: '导航', main: '主要内容', support: '辅助内容', highlight: '重点内容',
};

/** Subtract opaque foreground blocks before deciding whether any label can fit. */
export function layoutLabelCenter(diagram: Diagram, index: number, width: number, height: number): { x: number; y: number } | undefined {
  const block = diagram.blocks[index];
  const center = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width > block.width || height > block.height) return undefined;
  let visible = [{ x: block.x, y: block.y, width: block.width, height: block.height }];
  for (const front of diagram.blocks.slice(index + 1)) {
    visible = visible.flatMap(area => {
      const left = Math.max(area.x, front.x), right = Math.min(area.x + area.width, front.x + front.width);
      const top = Math.max(area.y, front.y), bottom = Math.min(area.y + area.height, front.y + front.height);
      if (left >= right || top >= bottom) return [area];
      return [
        { x: area.x, y: area.y, width: area.width, height: top - area.y },
        { x: area.x, y: bottom, width: area.width, height: area.y + area.height - bottom },
        { x: area.x, y: top, width: left - area.x, height: bottom - top },
        { x: right, y: top, width: area.x + area.width - right, height: bottom - top },
      ].filter(part => part.width > 0 && part.height > 0);
    });
  }
  const candidates = visible.filter(area => area.width >= width && area.height >= height).map(area => ({
    x: Math.max(area.x + width / 2, Math.min(center.x, area.x + area.width - width / 2)),
    y: Math.max(area.y + height / 2, Math.min(center.y, area.y + area.height - height / 2)),
  }));
  return candidates.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))[0];
}

/** Read numeric constraints directly; the full denominator remains in the legend and notes. */
export function shortLayoutProportionLabel(diagram: Diagram, index: number): string {
  const percent = (value: number) => `${Math.abs(value) >= 10000 || (value !== 0 && Math.abs(value) < .01) ? value.toPrecision(3) : Number(value.toFixed(2))}%`;
  for (const proportion of diagram.proportions ?? []) {
    if (proportion.type === 'split') {
      const member = proportion.members.find(member => member.block === index);
      if (member) return percent(member.share);
    } else if (proportion.block === index) return `宽${percent(proportion.widthPercent)}`;
  }
  return `宽${percent(diagram.blocks[index].width * 100)}`;
}

export function fitLayoutBlockLabel(diagram: Diagram, index: number, proportion: string, size: { width: number; height: number }, metrics: { measure: (value: string) => number; lineHeight: number; gap: number; padding: number; numberSize: number }): { rows: string[]; center: { x: number; y: number }; numbered: boolean } | undefined {
  if (size.width <= 0 || size.height <= 0) return undefined;
  const role = `${index + 1} ${layoutRoleLabels[diagram.blocks[index].role]}`, compact = shortLayoutProportionLabel(diagram, index);
  const candidates = [[role, ...proportion.split(/\s*·\s*/)], [`${role} ${proportion}`], [role, compact], [compact]];
  for (const rows of candidates) {
    const width = Math.max(...rows.map(metrics.measure)) + metrics.padding;
    const height = rows.length * metrics.lineHeight + (rows.length - 1) * metrics.gap + metrics.padding;
    const center = layoutLabelCenter(diagram, index, width / size.width, height / size.height);
    if (center) return { rows, center, numbered: false };
  }
  const center = layoutLabelCenter(diagram, index, metrics.numberSize / size.width, metrics.numberSize / size.height);
  return center ? { rows: [String(index + 1)], center, numbered: true } : undefined;
}

export default function LayoutDiagram({ diagram, label = '布局结构示意', compact = false }: { diagram: Diagram; label?: string; compact?: boolean }) {
  const resolved = resolveLayoutDiagram(diagram), notes = getLayoutProportionNotes(diagram);
  const diagramHeight = compact ? 104 : resolved.aspectRatio < 1 ? 200 : 160;
  const proportions = resolved.blocks.map((_, index) => blockProportionLabel(diagram, index));
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  const description = `${label}：${resolved.blocks.map((block, index) => `${index + 1}，${layoutRoleLabels[block.role]}，${block.label}，${proportions[index]}`).join('；')}。${notes.join('；')}。比例为观察估计。`;
  const compactBasis = '观察估计；' + (diagram.proportions?.length ? [
    diagram.proportions.some(proportion => proportion.type === 'split') ? '分栏按所属区域扣除间距后的宽高' : '',
    diagram.proportions.some(proportion => proportion.type === 'relative') ? '浮层尺寸相对参考块' : '',
  ].filter(Boolean).join('；') : '宽高以示意画布为基准') + '。色块仅区分角色。';
  return <figure className={`feature-layout-diagram${compact ? ' is-compact' : ''}`}>
    <div className="feature-layout-diagram-stage" style={{ height: diagramHeight }}>
      <div ref={canvas} className="feature-layout-diagram-canvas" role="img" aria-label={description} style={{ aspectRatio: resolved.aspectRatio, width: `min(100%, ${diagramHeight * resolved.aspectRatio}px)` }}>
        {resolved.blocks.map((block, index) => {
          const color = layoutPalette[block.role];
          const proportion = proportions[index];
          // Use conservative text widths so a cramped block falls back to its full legend entry.
          const textWidth = (value: string) => Array.from(value).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 10 : 6), 0);
          const text = fitLayoutBlockLabel(resolved, index, proportion, size, { measure: textWidth, lineHeight: 12, gap: 2, padding: 6, numberSize: 16 });
          const anchorStyle = text ? { left: `${(text.center.x - block.x) / block.width * 100}%`, top: `${(text.center.y - block.y) / block.height * 100}%` } : undefined;
          return <div key={index} className={`feature-layout-block${text && !text.numbered && text.rows.length > 1 ? ' is-stacked' : ''}`} aria-hidden="true" title={`${index + 1}. ${layoutRoleLabels[block.role]}：${block.label} · ${proportion}`} style={{ left: `${block.x * 100}%`, top: `${block.y * 100}%`, width: `${block.width * 100}%`, height: `${block.height * 100}%`, background: color.fill, borderColor: color.stroke, color: color.text }}>
            {text && (text.numbered ? <span className="feature-layout-block-number" style={{ ...anchorStyle, background: color.fill, borderColor: color.stroke }}>{index + 1}</span> : <span className="feature-layout-block-text" style={anchorStyle}>{text.rows.map((row, rowIndex) => <span key={rowIndex}>{row}</span>)}</span>)}
          </div>;
        })}
      </div>
    </div>
    <figcaption>
      <p className="feature-layout-estimate">{compact ? compactBasis : '比例为观察估计 · 颜色区分角色'}</p>
      {!compact && <ol className="feature-layout-legend">{resolved.blocks.map((block, index) => <li key={index}>
        <span className="feature-layout-legend-number" style={{ background: layoutPalette[block.role].fill, color: layoutPalette[block.role].text, borderColor: layoutPalette[block.role].stroke }}>{index + 1}</span>
        <span><strong>{block.label}</strong><span>{layoutRoleLabels[block.role]} · {proportions[index]}</span></span>
      </li>)}</ol>}
      {!compact && notes.length > 0 && <div className="feature-layout-proportions"><strong>比例基准</strong><ul>{notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
    </figcaption>
  </figure>;
}
