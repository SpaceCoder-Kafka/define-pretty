import { evidenceLabels, specTable, tierLabels, type Evidence, type FeatureSpec, type FeatureTier } from '../shared/feature-spec';

export { tierLabels };
export const tierDescriptions: Record<FeatureTier, string> = {
  foundation: '优先落实整体风格、文字、布局与配色',
  signature: '在基础规范上保留这张图的辨识度',
  detail: '需要更高还原度时按需补充',
};

export default function FeatureSpecView({ spec }: { spec: FeatureSpec }) {
  const table = specTable(spec);
  return <section className={`feature-spec feature-spec-${spec.kind}`} aria-label={table.title}>
    <div className="feature-spec-head"><strong>{table.title}</strong>{table.columns.length > 3 && <small>横向滑动查看全部属性</small>}</div>
    {spec.kind === 'palette' && <div className="feature-palette-strip" aria-hidden="true">{spec.colors.map((color, index) => <span key={index} title={`${color.label} ${color.hex}`} style={{ backgroundColor: color.hex }}/>)}</div>}
    {table.summary?.length && <><p className="feature-type-summary-title">字号 / 字重 · 相对正文</p><ul className="feature-type-summary" aria-label="字体层级摘要">{table.summary.map((summary, index) => <li key={index}>{summary}</li>)}</ul></>}
    <div className="feature-spec-scroll" role="region" aria-label={`${table.title}表格`} tabIndex={0}>
      <table><thead><tr>{table.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead><tbody>
        {table.rows.map((row, index) => <tr key={index}>{row.cells.map((cell, column) => column === 0
          ? <th key={column} scope="row">{row.swatch && <span className="feature-spec-swatch" style={{ backgroundColor: row.swatch }} aria-hidden="true"/>}{cell}</th>
          : <td key={column}>{cell}</td>)}</tr>)}
      </tbody></table>
    </div>
    <div className="feature-spec-notes">{table.notes.map((note, index) => <p key={index}>{note}</p>)}</div>
  </section>;
}

type Field = { key: string; label: string; type?: 'number' | 'color'; min?: number; max?: number; step?: number; nullable?: boolean; options?: Record<string, string> };
const evidence: Field = { key: 'evidence', label: '数值依据', options: evidenceLabels };
const typographyFields: Field[] = [
  { key: 'label', label: '文字用途' },
  { key: 'role', label: '文字层级', options: { 'page-title': '页面标题', 'section-title': '模块标题', body: '正文', caption: '辅助说明', label: '标签', other: '其他文字' } },
  { key: 'fontFamily', label: '字体 / 字体类别' },
  { key: 'fontEvidence', label: '字体依据', options: evidenceLabels },
  { key: 'sizePx', label: '字号（px）', type: 'number', min: 4, max: 512 },
  { key: 'weight', label: '字重', type: 'number', min: 100, max: 900, step: 1 },
  { key: 'lineHeightPx', label: '行高（px）', type: 'number', min: 4, max: 1024 },
  { key: 'letterSpacingEm', label: '字距（em）', type: 'number', min: -.2, max: 2, step: .01 }, evidence,
];
const paletteFields: Field[] = [
  { key: 'label', label: '颜色名称' },
  { key: 'role', label: '颜色角色', options: { 'page-background': '页面背景', surface: '内容表面', 'text-primary': '主要文字', 'text-secondary': '辅助文字', accent: '强调色', border: '边框 / 分隔线', 'reference-backdrop': '截图外部展示背景', other: '其他用途' } },
  { key: 'hex', label: '颜色 HEX', type: 'color' },
  { key: 'usage', label: '作用区域与使用方法' },
  { key: 'areaPercent', label: '面积占比（%，未知可留空）', type: 'number', min: 0, max: 100, nullable: true }, evidence,
];
const spacingFields: Field[] = [
  { key: 'label', label: '空间属性' }, { key: 'value', label: '数值', type: 'number', min: 0 },
  { key: 'unit', label: '单位', options: { px: 'px', '%': '%', rem: 'rem' } },
  { key: 'reference', label: '计算基准' }, { key: 'usage', label: '作用区域与使用方法' }, evidence,
];
const attributeFields: Field[] = [
  { key: 'property', label: '属性' }, { key: 'value', label: '属性值（含单位）' }, { key: 'scope', label: '作用区域' }, evidence,
];

/** Edits the canonical values used by the card, export and instruction together. */
export function FeatureSpecEditor({ spec, onChange }: { spec: FeatureSpec; onChange: (spec: FeatureSpec) => void }) {
  const rows = spec.kind === 'palette' ? spec.colors : spec.rows;
  const fields = spec.kind === 'typography' ? typographyFields : spec.kind === 'palette' ? paletteFields : spec.kind === 'spacing' ? spacingFields : attributeFields;
  function change(index: number, field: Field, value: string) {
    const next = structuredClone(spec);
    const target = (next.kind === 'palette' ? next.colors : next.rows)[index];
    Object.assign(target, { [field.key]: field.type === 'number' ? (field.nullable && value === '' ? null : Number(value)) : value });
    onChange(next);
  }
  return <details className="feature-spec-editor"><summary>编辑具体属性值</summary>
    <p>调整这里的数值后，卡片、导出图和配套指令会一起更新。观察估计与迁移建议请保留对应标记。</p>
    <label>数值基准与适配说明<textarea value={spec.basis} required maxLength={240} onChange={event => onChange({ ...spec, basis: event.target.value })}/></label>
    {'referenceWidth' in spec && <label>参考设计宽度（px）<input type="number" min={64} max={10000} required value={spec.referenceWidth} onChange={event => onChange({ ...spec, referenceWidth: Number(event.target.value) })}/></label>}
    {rows.map((row, index) => <fieldset className="feature-spec-editor-row" key={index}><legend>{index + 1}．{'label' in row ? row.label : row.property}</legend>
      <div className="feature-spec-editor-grid">{fields.map(field => {
        const value = (row as unknown as Record<string, string | number | Evidence | null>)[field.key];
        return <label key={field.key}>{field.label}{field.key === 'role' && field.options ? <input readOnly value={field.options[String(value)]}/> : field.options
          ? <select value={String(value ?? '')} onChange={event => change(index, field, event.target.value)}>{Object.entries(field.options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          : <input type={field.type === 'number' ? 'number' : 'text'} min={field.min} max={field.max} step={field.step ?? 'any'} pattern={field.type === 'color' ? '#[0-9a-fA-F]{6}' : undefined} maxLength={field.key === 'label' || field.key === 'property' ? 40 : field.key === 'fontFamily' || field.key === 'reference' ? 100 : 160} value={value ?? ''} required={!field.nullable} onChange={event => change(index, field, event.target.value)}/>}</label>;
      })}</div>
    </fieldset>)}
  </details>;
}
