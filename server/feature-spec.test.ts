import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeatureSpec, specTable, type FeatureSpec, type TypographySpec, type PaletteSpec, type SpacingSpec, type AttributeSpec } from '../shared/feature-spec.ts';
import { featureApplication, featureFoundation, featureInstruction, featureReady, featureTier, selectedFeatures, STYLE_TRANSFER_GUIDANCE, type FeatureBoard, type FeatureCard } from '../shared/feature-board.ts';

const typeSpec: TypographySpec = { kind: 'typography', basis: '以内容区宽度估计；字体为建议候选。', referenceWidth: 960, rows: [
  { role: 'page-title', label: '页面标题', fontFamily: 'Arial, sans-serif', fontEvidence: 'suggested', sizePx: 48, weight: 700, lineHeightPx: 56, letterSpacingEm: .02, evidence: 'estimated' },
  { role: 'body', label: '正文', fontFamily: 'Arial, sans-serif', fontEvidence: 'suggested', sizePx: 16, weight: 400, lineHeightPx: 24, letterSpacingEm: 0, evidence: 'estimated' },
] };
const palette: PaletteSpec = { kind: 'palette', basis: '纸面背景与外部展示底色分别记录。', colors: [
  { role: 'page-background', label: '纸面', hex: '#f9f7ef', usage: '实际页面底色', areaPercent: 70, evidence: 'estimated' },
  { role: 'text-primary', label: '正文', hex: '#292727', usage: '主要文字', areaPercent: null, evidence: 'estimated' },
  { role: 'reference-backdrop', label: '拍照背景', hex: '#a0a0a0', usage: '仅外部展示，不应用于页面', areaPercent: 15, evidence: 'estimated' },
] };
const spacing: SpacingSpec = { kind: 'spacing', basis: '以页面内容宽度估计。', referenceWidth: 960, rows: [
  { label: '页边距', value: 5, unit: '%', reference: '页面内容区宽度', usage: '页面左右内边距', evidence: 'estimated' },
] };
const attributes: AttributeSpec = { kind: 'attributes', basis: '硬边投影。', rows: [{ property: '阴影', value: '6px 6px 0 #111111', scope: '重点卡片', evidence: 'estimated' }] };
function card(overrides: Partial<FeatureCard> = {}): FeatureCard {
  return { id: 'a', title: '属性', description: '图中依据', effect: '效果', instruction: '实现规则', applicability: '整页', region: { x: 0, y: 0, width: 1, height: 1 }, selected: true, application: '', ...overrides };
}
function board(cards: FeatureCard[]): FeatureBoard {
  return { id: 'board', title: '规范', cards, revision: 1, config: { model: 'test', reasoningEffort: 'medium', cliVersion: 'test' }, reference: { id: 'ref', name: 'ref.png', size: 1, sha256: 'test', mimeType: 'image/png', url: '/ref.png', createdAt: '' }, createdAt: '', updatedAt: '', status: 'completed' };
}
test('typed specs preserve units, normalize swatches, derive body ratios, and share presentation evidence', () => {
  for (const spec of [typeSpec, palette, spacing, attributes]) {
    const parsed = parseFeatureSpec(spec);
    assert.notEqual(parsed, spec);
    assert.deepEqual(parseFeatureSpec(parsed), parsed);
    assert(specTable(parsed).notes.includes(spec.basis));
  }
  const parsed = parseFeatureSpec(palette) as PaletteSpec;
  assert.equal(parsed.colors[0].hex, '#F9F7EF');
  assert.equal(specTable(parsed).rows[0].swatch, parsed.colors[0].hex);
  const table = specTable(typeSpec);
  assert.equal(table.rows[0].cells[5], '3×');
  const enlargedBody = structuredClone(typeSpec); enlargedBody.rows[1].sizePx = 20;
  assert.equal(specTable(enlargedBody).rows[0].cells[5], '2.4×');
  assert.match(table.rows[0].cells[1], /迁移建议/);
  assert.equal(table.rows[0].cells[6], '观察估计');
  assert.equal(specTable(spacing).rows[0].cells[1], '5%');
});
test('malformed numeric and semantic spec contracts cannot silently enter prompts or tables', () => {
  const invalid: unknown[] = [null, {}, { ...spacing, extra: true }, { ...spacing, rows: [] }, { ...spacing, referenceWidth: NaN },
    { ...typeSpec, rows: [typeSpec.rows[0], typeSpec.rows[0]] },
    { ...typeSpec, rows: [typeSpec.rows[1], typeSpec.rows[1]] },
    { ...palette, colors: palette.colors.filter(c => c.role !== 'page-background') },
    { ...palette, colors: [palette.colors[0], palette.colors[0], palette.colors[1]] },
  ];
  for (const [key, value] of [['sizePx', '16'], ['sizePx', Infinity], ['weight', 950], ['lineHeightPx', 2], ['lineHeightPx', 500], ['letterSpacingEm', -1], ['fontEvidence', 'verified']] as const) {
    invalid.push({ ...typeSpec, rows: [{ ...typeSpec.rows[0], [key]: value }, typeSpec.rows[1]] });
  }
  for (const [key, value] of [['hex', 'red'], ['hex', '#FFFFFF;url(x)'], ['areaPercent', 101], ['evidence', 'verified'], ['usage', '']] as const) {
    invalid.push({ ...palette, colors: [{ ...palette.colors[0], [key]: value }, palette.colors[1]] });
  }
  invalid.push({ ...spacing, rows: [{ ...spacing.rows[0], value: 101 }] });
  for (const spec of invalid) assert.throws(() => parseFeatureSpec(spec), /视觉规范/);
});
test('old cards retain readiness, selection and inferred tiers without inventing parameters', () => {
  const old = card(), oldGlobal = card({ id: 'g', kind: 'global' }), oldDetail = card({ id: 'd', discovery: 'detail' });
  const before = JSON.stringify([old, oldGlobal, oldDetail]);
  assert.equal(featureTier(old), 'signature'); assert.equal(featureTier(oldGlobal), 'foundation'); assert.equal(featureTier(oldDetail), 'detail');
  assert.equal(featureFoundation(oldGlobal), 'style');
  assert.equal(selectedFeatures(board([old, oldGlobal, oldDetail])).length, 3);
  assert.equal(JSON.stringify([old, oldGlobal, oldDetail]), before);
  assert.equal(featureReady(card({ tier: 'foundation', foundation: 'typography', kind: 'local' })), false);
  assert.equal(featureReady(card({ tier: 'foundation', foundation: 'typography', kind: 'local', spec: typeSpec })), true);
  assert.equal(featureReady(card({ tier: 'signature', kind: 'local' })), false);
  assert.equal(featureReady(card({ tier: 'signature', kind: 'local', spec: attributes })), true);
});
test('only selected specs enter instructions with scope and evidence preserved for calibration', () => {
  const color = card({ tier: 'foundation', foundation: 'palette', kind: 'local', title: '配色与明暗分配', spec: parseFeatureSpec(palette) });
  const hidden = card({ id: 'hidden', tier: 'foundation', foundation: 'typography', kind: 'local', selected: false, spec: { ...typeSpec, basis: 'SECRET-TYPOGRAPHY-SPEC' } });
  const signature = card({ id: 'shadow', tier: 'signature', kind: 'local', spec: attributes });
  const prompt = featureInstruction(board([color, hidden, signature]));
  assert(prompt.includes(JSON.stringify(color.spec)));
  assert(prompt.includes(JSON.stringify(attributes)));
  assert(!prompt.includes('SECRET-TYPOGRAPHY-SPEC'));
  assert.match(prompt, /estimated.*观察估计/);
  assert.match(prompt, /suggested.*迁移建议/);
  assert.match(prompt, /可根据原图.*实际渲染校准/);
  assert.match(prompt, /未选中布局结构卡/);
  assert.match(prompt, /外部展示背景/);
  assert.match(prompt, /要求值、实际应用值/);
  assert.match(featureApplication(color), /^整页背景/);
  assert.match(featureApplication(hidden), /^整页文字/);
  assert.equal(featureApplication({ ...color, application: '仅文章区域' }), '仅文章区域');
});

test('explicit user requirements and mixed parameter evidence reach the model without rewriting the source', () => {
  const spec: AttributeSpec = { kind: 'attributes', basis: '图中标注与观察分开记录', rows: [
    { property: '描边', value: '2px', scope: '插画外轮廓', evidence: 'annotated' },
    { property: '纸张纹理', value: '低对比纤维与细颗粒，可使用本地图片层', scope: '插画背景', evidence: 'estimated' },
    { property: '图片格式', value: 'PNG 或 WebP', scope: '插画素材', evidence: 'suggested' },
  ] };
  const chosen = card({ tier: 'signature', kind: 'local', spec, application: '仅课程首屏插画；保留本站猫头鹰吉祥物，描边固定为 2px，不改变已有导航。' });
  const input = board([chosen]);
  const before = JSON.stringify(input);
  const prompt = featureInstruction(input);
  assert(prompt.includes(JSON.stringify(spec)));
  assert(prompt.includes(chosen.application));
  assert(prompt.includes(STYLE_TRANSFER_GUIDANCE));
  assert.match(prompt, /用户明确的应用区域、固定值及禁改要求优先/);
  assert.match(prompt, /原图仅补充已选特征/);
  assert.match(prompt, /适合生图时可直接调用/);
  assert.equal(JSON.stringify(input), before);
});

test('legacy refinement describes only available visual inputs without expanding selected scope', () => {
  const selected = card({ instruction: '参考中的人物坐在桌旁，使用细黑轮廓线与平涂橙色色块。', application: '仅主视觉插画，表达本站课程学习过程，不修改导航。' });
  const input = board([selected, card({ id: 'hidden', selected: false, instruction: 'UNSELECTED-DETAIL' })]);
  const before = JSON.stringify(input);
  const prompt = featureInstruction(input, { hasOriginalReference: false });
  assert.match(prompt, /本次仅附所选卡片图/);
  assert(!prompt.includes('第二张为无标记原图'));
  assert(prompt.includes(selected.application));
  assert(prompt.includes(STYLE_TRANSFER_GUIDANCE));
  assert(!prompt.includes('UNSELECTED-DETAIL'));
  assert.match(prompt, /未选中布局结构卡/);
  assert.equal(JSON.stringify(input), before);
});

