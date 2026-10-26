export type FeatureTier = 'foundation' | 'signature' | 'detail';
export type FoundationKind = 'style' | 'typography' | 'layout' | 'palette';
export type Evidence = 'annotated' | 'estimated' | 'suggested';
export const FOUNDATION_TITLES: Record<FoundationKind, string> = {
  style: '整体视觉风格', typography: '字体与文字层级', layout: '布局与空间关系', palette: '配色与明暗分配',
};
export const evidenceLabels: Record<Evidence, string> = { annotated: '图中明示', estimated: '观察估计', suggested: '迁移建议' };
export const tierLabels: Record<FeatureTier, string> = { foundation: '一级 · 基础规范', signature: '二级 · 辨识特征', detail: '三级 · 精细细节' };
export interface TypographySpec {
  kind: 'typography'; basis: string; referenceWidth: number;
  rows: { role: 'page-title' | 'section-title' | 'body' | 'caption' | 'label' | 'other'; label: string; fontFamily: string; fontEvidence: Evidence; sizePx: number; weight: number; lineHeightPx: number; letterSpacingEm: number; evidence: Evidence }[];
}
export interface PaletteSpec {
  kind: 'palette'; basis: string;
  colors: { role: 'page-background' | 'surface' | 'text-primary' | 'text-secondary' | 'accent' | 'border' | 'reference-backdrop' | 'other'; label: string; hex: string; usage: string; areaPercent: number | null; evidence: Evidence }[];
}
export interface SpacingSpec {
  kind: 'spacing'; basis: string; referenceWidth: number;
  rows: { label: string; value: number; unit: 'px' | '%' | 'rem'; reference: string; usage: string; evidence: Evidence }[];
}
export interface AttributeSpec {
  kind: 'attributes'; basis: string;
  rows: { property: string; value: string; scope: string; evidence: Evidence }[];
}
export type FeatureSpec = TypographySpec | PaletteSpec | SpacingSpec | AttributeSpec;

const string = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const number = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const enumeration = (values: string[]) => ({ type: 'string', enum: values });
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const array = (items: unknown, minItems: number, maxItems: number) => ({ type: 'array', minItems, maxItems, items });
const evidence = enumeration(['annotated', 'estimated', 'suggested']);
const typographyRoles = ['page-title', 'section-title', 'body', 'caption', 'label', 'other'];
const paletteRoles = ['page-background', 'surface', 'text-primary', 'text-secondary', 'accent', 'border', 'reference-backdrop', 'other'];
export const featureSpecSchemas = {
  typography: object({ kind: enumeration(['typography']), basis: string(240), referenceWidth: number(64, 10000), rows: array(object({
    role: enumeration(typographyRoles), label: string(40), fontFamily: string(100), fontEvidence: evidence,
    sizePx: number(4, 512), weight: number(100, 900), lineHeightPx: number(4, 1024), letterSpacingEm: number(-.2, 2), evidence,
  }), 2, 8) }),
  palette: object({ kind: enumeration(['palette']), basis: string(240), colors: array(object({
    role: enumeration(paletteRoles), label: string(40), hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, usage: string(160),
    areaPercent: { anyOf: [number(0, 100), { type: 'null' }] }, evidence,
  }), 2, 10) }),
  spacing: object({ kind: enumeration(['spacing']), basis: string(240), referenceWidth: number(64, 10000), rows: array(object({
    label: string(40), value: number(0, 2000), unit: enumeration(['px', '%', 'rem']), reference: string(100), usage: string(160), evidence,
  }), 1, 10) }),
  attributes: object({ kind: enumeration(['attributes']), basis: string(240), rows: array(object({ property: string(40), value: string(160), scope: string(160), evidence }), 1, 8) }),
};
export const featureSpecSchema = { anyOf: Object.values(featureSpecSchemas) };

function invalid(message: string): never { throw new Error('视觉规范：' + message); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('需要结构化属性。');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !(key in row))) invalid('属性字段不完整或含未知字段。');
  return row;
}
function readString(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid('文字属性为空或过长。');
  return value.trim();
}
function readNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid('数值超出有效范围。');
  return value;
}
function readEnum<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid('属性类别无效。');
  return value as T;
}
function readEvidence(value: unknown): Evidence { return readEnum(value, ['annotated', 'estimated', 'suggested']); }
function rows(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid('属性行数超出范围。');
  return value;
}
export function parseFeatureSpec(value: unknown): FeatureSpec {
  const kind = readEnum((value as { kind?: unknown } | null)?.kind, ['typography', 'palette', 'spacing', 'attributes']);
  const row = record(value, ['kind', 'basis', ...(kind === 'typography' || kind === 'spacing' ? ['referenceWidth'] : []), kind === 'palette' ? 'colors' : 'rows']);
  const basis = readString(row.basis, 240);
  if (kind === 'typography') {
    const result: TypographySpec = { kind, basis, referenceWidth: readNumber(row.referenceWidth, 64, 10000), rows: rows(row.rows, 2, 8).map(item => {
      const r = record(item, ['role', 'label', 'fontFamily', 'fontEvidence', 'sizePx', 'weight', 'lineHeightPx', 'letterSpacingEm', 'evidence']);
      const sizePx = readNumber(r.sizePx, 4, 512), lineHeightPx = readNumber(r.lineHeightPx, 4, 1024);
      if (lineHeightPx < sizePx * .7 || lineHeightPx > sizePx * 4) invalid('行高必须在字号的 0.7–4 倍内。');
      return { role: readEnum(r.role, typographyRoles as TypographySpec['rows'][number]['role'][]), label: readString(r.label, 40), fontFamily: readString(r.fontFamily, 100), fontEvidence: readEvidence(r.fontEvidence), sizePx, weight: readNumber(r.weight, 100, 900), lineHeightPx, letterSpacingEm: readNumber(r.letterSpacingEm, -.2, 2), evidence: readEvidence(r.evidence) };
    }) };
    if (result.rows.filter(r => r.role === 'body').length !== 1) invalid('文字层级需要唯一的正文基准。');
    return result;
  }
  if (kind === 'palette') {
    const result: PaletteSpec = { kind, basis, colors: rows(row.colors, 2, 10).map(item => {
      const r = record(item, ['role', 'label', 'hex', 'usage', 'areaPercent', 'evidence']);
      if (typeof r.hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r.hex)) invalid('颜色须为六位 HEX 色值。');
      return { role: readEnum(r.role, paletteRoles as PaletteSpec['colors'][number]['role'][]), label: readString(r.label, 40), hex: r.hex.toUpperCase(), usage: readString(r.usage, 160), areaPercent: r.areaPercent === null ? null : readNumber(r.areaPercent, 0, 100), evidence: readEvidence(r.evidence) };
    }) };
    for (const role of ['page-background', 'text-primary']) if (result.colors.filter(r => r.role === role).length !== 1) invalid('配色需要唯一的页面背景与主要文字颜色。');
    return result;
  }
  if (kind === 'spacing') return { kind, basis, referenceWidth: readNumber(row.referenceWidth, 64, 10000), rows: rows(row.rows, 1, 10).map(item => {
    const r = record(item, ['label', 'value', 'unit', 'reference', 'usage', 'evidence']);
    const unit = readEnum(r.unit, ['px', '%', 'rem']);
    return { label: readString(r.label, 40), value: readNumber(r.value, 0, unit === '%' ? 100 : unit === 'rem' ? 125 : 2000), unit, reference: readString(r.reference, 100), usage: readString(r.usage, 160), evidence: readEvidence(r.evidence) };
  }) };
  return { kind, basis, rows: rows(row.rows, 1, 8).map(item => {
    const r = record(item, ['property', 'value', 'scope', 'evidence']);
    return { property: readString(r.property, 40), value: readString(r.value, 160), scope: readString(r.scope, 160), evidence: readEvidence(r.evidence) };
  }) };
}

export const paletteRoleLabels: Record<PaletteSpec['colors'][number]['role'], string> = {
  'page-background': '页面背景', surface: '内容表面', 'text-primary': '主要文字', 'text-secondary': '次要文字', accent: '强调色', border: '边框 / 分隔线', 'reference-backdrop': '外部展示背景', other: '其他用途',
};
export interface SpecTable { title: string; columns: string[]; rows: { cells: string[]; swatch?: string }[]; notes: string[]; summary?: string[] }
const decimal = (value: number) => String(Number(value.toFixed(3)));
export function specTable(spec: FeatureSpec): SpecTable {
  const notes = [spec.basis];
  if (spec.kind === 'typography') {
    const body = spec.rows.find(row => row.role === 'body')!;
    notes.push('参考内容宽度 ' + spec.referenceWidth + 'px；正文基准 ' + body.sizePx + 'px。迁移时按目标宽度与可读性调整，保持文字层级比例。');
    return { title: '字体与文字层级', columns: ['层级', '字体 / 依据', '字号 / 行高', '字重', '字距', '相对正文', '数值依据'], rows: spec.rows.map(row => ({ cells: [row.label, row.fontFamily + '（' + evidenceLabels[row.fontEvidence] + '）', row.sizePx + 'px / ' + row.lineHeightPx + 'px', String(row.weight), row.letterSpacingEm + 'em', decimal(row.sizePx / body.sizePx) + '×', evidenceLabels[row.evidence]] })), summary: spec.rows.map(row => row.label + ' · ' + row.sizePx + 'px / ' + row.weight + ' · 正文 ' + decimal(row.sizePx / body.sizePx) + '×'), notes };
  }
  if (spec.kind === 'palette') {
    notes.push('面积按图中标注或观察估计记录；外部展示背景仅作出处说明，不应用到目标页面。');
    return { title: '配色与明暗分配', columns: ['名称 / 角色', 'HEX', '用途与范围', '面积占比', '依据'], rows: spec.colors.map(row => ({ swatch: row.hex, cells: [row.label + ' · ' + paletteRoleLabels[row.role], row.hex, row.usage, row.areaPercent === null ? '未估计' : (row.evidence === 'annotated' ? '' : '约 ') + row.areaPercent + '%', evidenceLabels[row.evidence]] })), notes };
  }
  if (spec.kind === 'spacing') {
    notes.push('参考内容宽度 ' + spec.referenceWidth + 'px；百分比与 rem 按各行基准计算。窄屏可调整尺寸，保持分组与间距层级。');
    return { title: '空间参数', columns: ['属性', '数值', '计算基准', '用途与范围', '依据'], rows: spec.rows.map(row => ({ cells: [row.label, row.value + row.unit, row.reference, row.usage, evidenceLabels[row.evidence]] })), notes };
  }
  return { title: '特征参数', columns: ['属性', '数值 / 做法', '作用范围', '依据'], rows: spec.rows.map(row => ({ cells: [row.property, row.value, row.scope, evidenceLabels[row.evidence]] })), notes };
}

export function featureSpecInstruction(spec: FeatureSpec): string {
  const table = specTable(spec);
  return table.title + '：\n' + table.notes.join('\n') + '\n' + table.rows.map(row => row.cells.map((cell, i) => table.columns[i] + '：' + cell).join('；')).join('\n') + '\n结构化规范（与卡片表格相同）：' + JSON.stringify(spec);
}

export const SPEC_GUIDANCE = [
  '数值规范使用 spec 结构化数据；同一份数据用于卡片、PNG 和实施指令。正文不要另写与表格冲突的值。basis 说明观察区域、截图缩放或估计依据。evidence="annotated" 仅用于图中明确标注的值；"estimated" 是观察估计；"suggested" 是迁移建议。不得把观察估计说成精确测量；estimated 与 suggested 可在实施时结合原图及实际渲染校准，用户明确固定要求优先。缺乏依据时明确标为建议并在 basis 说明，不用“差不多”“大标题”等空泛词代替参数。',
  '字体 typography：列出可见文字层级，必须有唯一 role="body" 正文行作为比例基准，其他层级以相对正文大小保持关系。referenceWidth 是这些 px 数值对应的参考内容区宽度，不含图片外部展示边框；basis 说明基准。每行给出 fontFamily、fontEvidence、sizePx、weight、lineHeightPx、letterSpacingEm 和数值 evidence。无法确证字体名称时提供相近字体或字体类别，fontEvidence 标 suggested；不要假称识别到了原字体。若图片无可读文字，可以建议适配的文字层级，全部标 suggested 并明确说明。不得将缩放截图上的像素直接当成网页 CSS 尺寸。',
  '配色 palette：明确区分 page-background 页面背景、surface 内容容器表面、text-primary 主要文字、text-secondary 次要文字、accent 强调色、border 边框分隔、reference-backdrop 外部展示背景。必须有唯一页面背景与主要文字颜色，按画面实际需要增加其他行。hex 使用可执行的六位 HEX（#RRGGBB）；观察近似值标 estimated，不伪装为采样测量。usage 写清用途与作用区域，areaPercent 给可观察的面积占比，不可靠时为 null。外部展示背景不能自动迁移到页面背景；拍照的阴影和光照偏色不当作设计颜色。颜色分配与面积关系同样需要保留，不将所有组件平均染成强调色。',
  '布局配套 spacing：布局比例仍由 layout 的 proportions 表达；spec 补充页面内边距、栏间距、模块间距与对齐等可执行空间参数。每行 label/value/unit/reference/usage/evidence 完整；reference 明确 px 对应 referenceWidth、百分比的分母、rem 的根字号。不要用第二组数值改写 layout 中同一个分栏或间距约束；若表达同一距离，必须换算一致。',
  '辨识特征 attributes：逐行写明 property/value/scope/evidence，例如边框 2px solid #111111、阴影偏移 6px 6px 且模糊 0、插画在主区域占宽约 20%。可用 value 描述纹理、渐变、图片层和素材需求，不把表格当作实现技术的限制。只规定该特征需要的参数与范围，与相关基础规范协调，避免引入无关的整页修改。没有图中证据的交互状态不得作为观察事实。',
].join('\n');

