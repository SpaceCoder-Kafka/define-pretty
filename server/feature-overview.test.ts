import test from 'node:test';
import assert from 'node:assert/strict';
import { featureOverview, overviewPlacement } from '../shared/feature-overview.ts';
import { featureInstruction, selectedFeatures, type FeatureBoard, type FeatureCard } from '../shared/feature-board.ts';
import type { TypographySpec } from '../shared/feature-spec.ts';

function card(overrides: Partial<FeatureCard> = {}): FeatureCard {
  return { id: 'card', title: '设计特征', description: '参考图中可见细节。', effect: '强调内容主次。', instruction: '完整实施规则，保留真实内容。', applicability: '适合当前业务区域。', application: '仅主区域；保留导航。', selected: true, region: { x: 0, y: 0, width: 1, height: 1 }, ...overrides };
}
function board(cards: FeatureCard[]): FeatureBoard {
  return { id: 'board', title: '规范', cards, revision: 1, config: { model: 'test', reasoningEffort: 'medium', cliVersion: 'test' }, reference: { id: 'ref', name: 'ref.png', size: 1, sha256: 'test', mimeType: 'image/png', url: '/ref.png', createdAt: '' }, createdAt: '', updatedAt: '', status: 'completed' };
}

test('summary leaves full instructions, source values and the board snapshot untouched', () => {
  const chosen = card({ tier: 'signature', kind: 'local', spec: { kind: 'attributes', basis: 'OBSERVATION-BASIS', rows: [
    { property: '边框', value: '2px solid #111111', scope: '仅内容卡片', evidence: 'annotated' },
    { property: '阴影', value: '6px 6px 0 #000000', scope: '仅主卡片', evidence: 'estimated' },
    { property: '交互', value: 'focus-visible 使用 2px 描边', scope: '键盘焦点', evidence: 'suggested' },
    { property: '完整细节', value: 'DETAIL-ONLY-IN-INSTRUCTIONS', scope: '特定按钮', evidence: 'suggested' },
  ] } });
  const input = board([chosen]), before = structuredClone(input), instruction = featureInstruction(input);
  const overview = featureOverview(chosen);
  assert.equal(overview.rows.length, 3);
  assert(!JSON.stringify(overview).includes('DETAIL-ONLY-IN-INSTRUCTIONS'));
  assert(!JSON.stringify(overview).includes(chosen.instruction));
  assert.match(overview.rows[0].value, /2px solid #111111.*标注/);
  assert.match(overview.rows[1].value, /6px 6px 0 #000000.*估计/);
  assert.match(overview.rows[2].value, /建议/);
  assert.equal(featureInstruction(input), instruction);
  assert(instruction.includes('DETAIL-ONLY-IN-INSTRUCTIONS'));
  assert(instruction.includes(chosen.application));
  assert.deepEqual(input, before);
  overview.rows[0].value = 'presentation-only change';
  assert.deepEqual(input, before);
});

test('typography keeps the body among many headings and labels candidate fonts honestly', () => {
  const row: TypographySpec['rows'][number] = { role: 'page-title', label: '标题', fontFamily: 'Example Sans, sans-serif', fontEvidence: 'suggested', sizePx: 32, weight: 700, lineHeightPx: 40, letterSpacingEm: .01, evidence: 'estimated' };
  const rows: TypographySpec['rows'] = [
    ...Array.from({ length: 6 }, (_, i) => ({ ...row, label: `大标题 ${i}` })),
    { ...row, role: 'body', label: '正文', sizePx: 16, lineHeightPx: 24, weight: 400 },
    { ...row, role: 'caption', label: '辅助说明', sizePx: 12, lineHeightPx: 18, weight: 400 },
  ];
  const original = structuredClone(rows);
  const overview = featureOverview(card({ spec: { kind: 'typography', basis: '内容区', referenceWidth: 1200, rows } }));
  assert.equal(overview.rows.length, 5);
  assert(overview.rows.some(row => row.label === '正文' && row.value.includes('16 / 24px')));
  assert(overview.rows.some(row => row.label === '辅助说明'));
  assert(overview.rows.every(row => row.detail?.startsWith('候选：')));
  assert(overview.notes.some(note => note.includes('1200px')));
  assert.deepEqual(rows, original);
});

test('palette excludes external backdrop without confusing unknown and zero area', () => {
  const overview = featureOverview(card({ spec: { kind: 'palette', basis: '图中依据', colors: [
    { label: '纸白', role: 'page-background', hex: '#FAFAF0', usage: '页面', areaPercent: 80, evidence: 'estimated' },
    { label: '墨色', role: 'text-primary', hex: '#111111', usage: '文字', areaPercent: null, evidence: 'estimated' },
    { label: '强调', role: 'accent', hex: '#0066FF', usage: '重点', areaPercent: 0, evidence: 'annotated' },
    { label: '拍照背景', role: 'reference-backdrop', hex: '#888888', usage: '外部', areaPercent: 10, evidence: 'estimated' },
  ] } }));
  assert.equal(overview.swatches.length, 3);
  assert.equal(overview.swatches[0].role, '页面背景');
  assert.equal(overview.swatches[0].area, '约 80%');
  assert.equal(overview.swatches[1].area, '');
  assert.equal(overview.swatches[2].area, '0%');
  assert(!JSON.stringify(overview).includes('#888888'));
});

test('spacing retains reference denominators and does not truncate numeric attribute values', () => {
  const overview = featureOverview(card({ spec: { kind: 'spacing', basis: '空间关系', referenceWidth: 1440, rows: [
    { label: '左右留白', value: 5, unit: '%', reference: '主内容区宽度（不含导航）；1440px时为72px', usage: '内容区域', evidence: 'estimated' },
    { label: '纵向间距', value: 1.5, unit: 'rem', reference: '根字号 16px', usage: '内容区域', evidence: 'suggested' },
  ] } }));
  assert.equal(overview.rows[0].detail, '主内容区宽度（不含导航）');
  assert.match(overview.rows[0].value, /5%.*估计/);
  assert.match(overview.rows[1].value, /1.5rem.*建议/);
  const value = '保持素材细节，'.repeat(20) + '最后的阴影值为 12px 24px 0 #112233';
  const attribute = featureOverview(card({ spec: { kind: 'attributes', basis: '依据', rows: [{ property: '阴影', value, scope: '插画', evidence: 'estimated' }] } }));
  assert(attribute.rows[0].value.includes(value));
});

test('overview supports unfinished UI cards without making them selected export requirements', () => {
  const source = board([
    card({ id: 'hidden', selected: false, kind: 'global' }),
    card({ id: 'legacy' }),
    card({ id: 'detail', discovery: 'detail' }),
    card({ id: 'unfinished', kind: 'local', tier: 'foundation', foundation: 'typography', spec: undefined }),
  ]);
  assert.equal(overviewPlacement(source.cards.length).cards.length, 4);
  assert.equal(featureOverview(source.cards[3]).rows.length, 0);
  const selected = selectedFeatures(source);
  assert.equal(overviewPlacement(selected.length).cards.length, selected.length);
  assert.deepEqual(selected.map(card => card.id), ['legacy', 'detail']);
});

test('legacy cards use visual evidence as observation and never invent missing specs', () => {
  const overview = featureOverview(card({ effect: undefined, spec: undefined }));
  assert(overview.summary.startsWith('图中：'));
  assert.equal(overview.rows.length, 0);
  assert.equal(overview.swatches.length, 0);
  const effect = '保持清晰的文字主次。' + '后续详细效果。'.repeat(30);
  const concise = featureOverview(card({ effect }));
  assert(concise.summary.startsWith('保持清晰的文字主次。'));
  assert(concise.summary.endsWith('…'));
  assert(concise.summary.length < effect.length / 2);
});

test('overview surrounds the reference with every card once and never overlaps grid cells', () => {
  for (let count = 0; count <= 13; count++) {
    const placement = overviewPlacement(count);
    assert.equal(placement.cards.length, count);
    const occupied = new Set<string>();
    for (const cell of [placement.reference, ...placement.cards]) {
      assert(cell.column >= 1 && cell.column + cell.columnSpan - 1 <= placement.columns);
      for (let x = cell.column; x < cell.column + cell.columnSpan; x++) for (let y = cell.row; y < cell.row + cell.rowSpan; y++) {
        const key = `${x},${y}`;
        assert(!occupied.has(key), `overlap at ${key} with ${count} cards`);
        occupied.add(key);
      }
    }
    if (count >= 5) {
      const reference = placement.reference;
      assert(placement.cards.some(cell => cell.row < reference.row));
      assert(placement.cards.some(cell => cell.row >= reference.row + reference.rowSpan));
      assert(placement.cards.some(cell => cell.column < reference.column && cell.row === reference.row));
      assert(placement.cards.some(cell => cell.column >= reference.column + reference.columnSpan && cell.row === reference.row));
    }
  }
});
