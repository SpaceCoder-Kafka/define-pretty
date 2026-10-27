import { featureFoundation, type FeatureCard } from './feature-board.ts';
import { paletteRoleLabels, type Evidence, type TypographySpec } from './feature-spec.ts';

export interface OverviewRow { label: string; value: string; detail?: string }
export interface OverviewSwatch { label: string; hex: string; role: string; area: string; evidence: string }
export interface FeatureOverview {
  kind: 'style' | 'typography' | 'layout' | 'palette' | 'attributes';
  summary: string;
  rows: OverviewRow[];
  swatches: OverviewSwatch[];
  notes: string[];
  hasMore: boolean;
}

const evidence: Record<Evidence, string> = { annotated: '标注', estimated: '估计', suggested: '建议' };
const number = (value: number) => String(Number(value.toFixed(3)));

/** An explicitly marked excerpt, never a new rule or a replacement for the source. */
function excerpt(value: string, limit = 80): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= limit) return text;
  const sentences = text.match(/[^。！？；;]+[。！？；;]?/gu) ?? [text];
  let result = '';
  for (const sentence of sentences) {
    if (result.length + sentence.length > limit) break;
    result += sentence;
  }
  if (!result) {
    const clauses = text.match(/[^，,]+[，,]?/gu) ?? [text];
    for (const clause of clauses) {
      if (result.length + clause.length > limit) break;
      result += clause;
    }
  }
  // Keep an unusually long, unbroken phrase intact rather than sever a value/unit.
  return result ? result.replace(/[，,；;]$/u, '') + '…' : text;
}

function typographyRows(spec: TypographySpec): TypographySpec['rows'] {
  const roles: TypographySpec['rows'][number]['role'][] = ['page-title', 'section-title', 'body', 'caption', 'label', 'other'];
  const chosen: TypographySpec['rows'] = [];
  for (const role of roles) {
    const row = spec.rows.find(row => row.role === role);
    if (row && chosen.length < 5) chosen.push(row);
  }
  for (const row of spec.rows) if (chosen.length < 5 && !chosen.includes(row)) chosen.push(row);
  return chosen;
}

/** Both the selectable overview and PNG consume this read-only presentation projection. */
export function featureOverview(card: FeatureCard): FeatureOverview {
  const spec = card.spec;
  const kind = card.kind === 'layout' ? 'layout' : featureFoundation(card) === 'style' ? 'style'
    : spec?.kind === 'spacing' ? 'layout' : spec?.kind ?? 'attributes';
  const result: FeatureOverview = { kind, summary: '', rows: [], swatches: [], notes: [], hasMore: true };
  if (!spec) {
    result.summary = card.effect?.trim() ? excerpt(card.effect) : card.description.trim() ? `图中：${excerpt(card.description)}` : '';
    return result;
  }
  if (spec.kind === 'typography') {
    result.rows = typographyRows(spec).map(row => ({
      label: row.label,
      value: `${number(row.sizePx)} / ${number(row.lineHeightPx)}px · ${number(row.weight)} · ${evidence[row.evidence]}`,
      detail: `${row.fontEvidence === 'suggested' ? '候选' : row.fontEvidence === 'estimated' ? '字体估计' : '标注字体'}：${row.fontFamily}`,
    }));
    result.notes = [`字号 / 行高 · 字重；参考宽度 ${number(spec.referenceWidth)}px`];
  } else if (spec.kind === 'palette') {
    result.swatches = spec.colors.filter(color => color.role !== 'reference-backdrop').map(color => ({
      label: color.label, hex: color.hex, role: paletteRoleLabels[color.role],
      area: color.areaPercent === null ? '' : `${color.evidence === 'annotated' ? '' : '约 '}${number(color.areaPercent)}%`,
      evidence: evidence[color.evidence],
    }));
  } else if (spec.kind === 'spacing') {
    result.rows = spec.rows.slice(0, 4).map(row => ({
      label: row.label, value: `${number(row.value)}${row.unit} · ${evidence[row.evidence]}`,
      // Percentage/rem denominators stay visible; conversions and px measurement
      // methodology remain in the full instructions and shared reference-width note.
      detail: row.unit === 'px' ? undefined : row.reference.split(/[；;]/u)[0].trim(),
    }));
    result.notes = [`参考宽度 ${number(spec.referenceWidth)}px`];
  } else {
    result.rows = spec.rows.slice(0, 3).map(row => ({ label: row.property, value: `${row.value} · ${evidence[row.evidence]}` }));
  }
  return result;
}

/** One-based grid coordinates, shared by CSS grid and the measured canvas layout. */
export interface OverviewCell { column: number; row: number; columnSpan: number; rowSpan: number }
export interface OverviewPlacement { columns: number; reference: OverviewCell; cards: OverviewCell[] }
export function overviewPlacement(count: number): OverviewPlacement {
  const cell = (column: number, row: number, columnSpan: number, rowSpan = 1): OverviewCell => ({ column, row, columnSpan, rowSpan });
  const cards: OverviewCell[] = [];
  const result: OverviewPlacement = { columns: 12, reference: cell(1, 1, 12), cards };
  if (count <= 0) return result;
  if (count === 1) {
    result.reference = cell(1, 1, 8);
    cards.push(cell(9, 1, 4));
    return result;
  }
  const fillRow = (items: number, row: number) => {
    const span = 12 / items;
    for (let i = 0; i < items; i++) cards.push(cell(i * span + 1, row, span));
  };
  if (count === 2) {
    fillRow(2, 1);
    result.reference = cell(1, 2, 12);
    return result;
  }
  const topCount = count === 3 ? 1 : count < 7 ? 2 : 3;
  fillRow(topCount, 1);
  const sideRows = count >= 8 ? 2 : 1;
  result.reference = cell(4, 2, 6, sideRows);
  for (let row = 2; row < 2 + sideRows; row++) cards.push(cell(1, row, 3), cell(10, row, 3));
  for (let row = 2 + sideRows; cards.length < count; row++) fillRow(Math.min(4, count - cards.length), row);
  return result;
}
