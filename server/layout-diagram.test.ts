import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockProportionLabel, getLayoutProportionNotes, layoutDiagramSchema, parseLayoutDiagram, resolveLayoutDiagram,
  type LayoutBlock, type LayoutDiagram, type LayoutProportion, type RelativeProportion, type SplitProportion,
} from '../shared/layout-diagram.ts';

const block = (label: string, role: LayoutBlock['role'] = 'main'): LayoutBlock => ({ label, role, x: .05, y: .05, width: .2, height: .2 });
const split: SplitProportion = {
  type: 'split', label: '正文分栏', axis: 'horizontal', reference: null,
  region: { x: .1, y: .2, width: .8, height: .6 }, gap: .05,
  members: [{ block: 0, share: 58 }, { block: 1, share: 42 }],
};
const splitDiagram = (): LayoutDiagram => ({ aspectRatio: 1.6, blocks: [block('主要内容'), block('辅助内容', 'support')], proportions: [structuredClone(split)] });
const relative: RelativeProportion = { type: 'relative', block: 1, reference: 0, widthPercent: 69, heightPercent: 36, offsetXPercent: 60, offsetYPercent: 10 };
const relativeDiagram = (): LayoutDiagram => ({ aspectRatio: 1.6, blocks: [{ ...block('主窗口'), x: .1, y: .2, width: .6, height: .5 }, block('重点浮窗', 'highlight')], proportions: [structuredClone(relative)] });
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should equal ${expected}`); }
function rectangle(actual: LayoutBlock, expected: { x: number; y: number; width: number; height: number }) {
  for (const field of ['x', 'y', 'width', 'height'] as const) close(actual[field], expected[field]);
}

// The same nested example can be used for UI/PNG verification: changing navigation
// changes the content container, which changes both 58/42 columns and the floating window.
function nestedDiagram(): LayoutDiagram {
  return { aspectRatio: 1.6, blocks: [
    block('导航', 'navigation'), block('内容容器'), block('主要内容'), block('辅助内容', 'support'), block('重点浮窗', 'highlight'),
  ], proportions: [
    { type: 'split', label: '导航与内容', axis: 'vertical', reference: null, region: { x: 0, y: 0, width: 1, height: 1 }, gap: .02, members: [{ block: 0, share: 10 }, { block: 1, share: 90 }] },
    { type: 'split', label: '内容分栏', axis: 'horizontal', reference: 1, region: { x: .04, y: .04, width: .92, height: .92 }, gap: .04, members: [{ block: 2, share: 58 }, { block: 3, share: 42 }] },
    { ...relative, block: 4, reference: 2 },
  ] };
}

test('58/42 splits the available width after gaps inside a nonzero canvas region', () => {
  const input = splitDiagram(), original = structuredClone(input), result = parseLayoutDiagram(input, { requireProportions: true });
  // Region width .8 - gap .04 = .76; .76 * .58 = .4408, .76 * .42 = .3192.
  rectangle(result.blocks[0], { x: .1, y: .2, width: .4408, height: .6 });
  rectangle(result.blocks[1], { x: .5808, y: .2, width: .3192, height: .6 });
  close(result.blocks[1].x - (result.blocks[0].x + result.blocks[0].width), .04);
  close(result.blocks[1].x + result.blocks[1].width, .9);
  assert.deepEqual(input, original);assert.deepEqual(result.proportions, input.proportions);
  assert.notEqual(result.proportions, input.proportions);
  assert.deepEqual(resolveLayoutDiagram(result), result);
  const notes = getLayoutProportionNotes(input).join('\n');
  assert.match(notes, /每道间距 5% 区域宽/);assert.match(notes, /扣除全部间距后的可用宽/);
  assert.match(notes, /画布内所划区域（宽 80%、高 60%）/);
  assert.match(notes, /“主要内容” 58% \/ “辅助内容” 42%/);
  assert.equal(blockProportionLabel(input, 0), '58%可分配宽');
  assert.equal(blockProportionLabel(input, 1), '42%可分配宽');
});

test('nested splits recompute children and relative windows when their navigation parent changes', () => {
  const diagram = nestedDiagram(), result = resolveLayoutDiagram(diagram);
  rectangle(result.blocks[0], { x: 0, y: 0, width: 1, height: .098 });
  rectangle(result.blocks[1], { x: 0, y: .118, width: 1, height: .882 });
  rectangle(result.blocks[2], { x: .04, y: .15328, width: .512256, height: .81144 });
  rectangle(result.blocks[3], { x: .589056, y: .15328, width: .370944, height: .81144 });
  rectangle(result.blocks[4], { x: .3473536, y: .234424, width: .35345664, height: .2921184 });
  close(result.blocks[2].width / (result.blocks[2].width + result.blocks[3].width), .58);
  assert.deepEqual(result.blocks.map(b => [b.label, b.role]), diagram.blocks.map(b => [b.label, b.role]));
  assert.deepEqual(resolveLayoutDiagram(result), result);

  const changed = structuredClone(result), outer = changed.proportions![0];
  assert.equal(outer.type, 'split');if (outer.type !== 'split') return;
  outer.members[0].share = 25;outer.members[1].share = 75;
  const resized = resolveLayoutDiagram(changed);
  rectangle(resized.blocks[1], { x: 0, y: .265, width: 1, height: .735 });
  rectangle(resized.blocks[2], { x: .04, y: .2944, width: .512256, height: .6762 });
  close(resized.blocks[4].height, .243432);close(resized.blocks[4].y, .36202);
  const note = getLayoutProportionNotes(changed).find(note => note.startsWith('“内容分栏”'))!;
  assert.match(note, /“内容容器”内所划区域/);assert.match(note, /宽 92%、高 92%/);
  assert.match(note, /扣除全部间距后的可用宽/);assert.match(note, /每道间距 4% 区域宽/);
});

test('relative geometry distinguishes offsets, crossing and actual intersection area', () => {
  const diagram = relativeDiagram(), result = resolveLayoutDiagram(diagram);
  rectangle(result.blocks[1], { x: .46, y: .25, width: .414, height: .18 });
  const note = getLayoutProportionNotes(diagram)[0];
  assert.match(note, /相对“主窗口”/);assert.match(note, /宽 69% 参考宽、高 36% 参考高/);
  assert.match(note, /左上偏移：右 60% 参考宽、下 10% 参考高/);
  assert.match(note, /右跨出 29% 参考宽/);
  // Intersection width .24 / floating width .414, not the 60% horizontal offset.
  assert.match(note, /实际交叠占本块面积 57.97%/);assert.match(note, /绘制在参考块前/);
  assert.equal(blockProportionLabel(diagram, 1), '69%参考宽 · 36%参考高');
});

test('negative relative offsets stay valid within the canvas and touching edges have no overlap', () => {
  const diagram: LayoutDiagram = { aspectRatio: 1.4, blocks: [
    { ...block('参考'), x: .3, y: .3, width: .4, height: .5 }, block('左上浮窗', 'highlight'),
  ], proportions: [{ ...relative, widthPercent: 50, heightPercent: 20, offsetXPercent: -25, offsetYPercent: -20 }] };
  rectangle(resolveLayoutDiagram(diagram).blocks[1], { x: .2, y: .2, width: .2, height: .1 });
  const note = getLayoutProportionNotes(diagram)[0];
  assert.match(note, /左上偏移：左 25% 参考宽、上 20% 参考高/);
  assert.match(note, /无交叠/);
});

test('relative chains resolve by dependency rather than block or constraint order', () => {
  const diagram: LayoutDiagram = { aspectRatio: 1.6, blocks: [block('子窗', 'highlight'), block('中间窗', 'support'), { ...block('基准'), x: .1, y: .2, width: .6, height: .6 }], proportions: [
    { type: 'relative', block: 0, reference: 1, widthPercent: 50, heightPercent: 50, offsetXPercent: 100, offsetYPercent: 0 },
    { type: 'relative', block: 1, reference: 2, widthPercent: 40, heightPercent: 50, offsetXPercent: 50, offsetYPercent: 20 },
  ] };
  const result = resolveLayoutDiagram(diagram);
  rectangle(result.blocks[1], { x: .4, y: .32, width: .24, height: .3 });
  rectangle(result.blocks[0], { x: .64, y: .32, width: .12, height: .15 });
  assert.deepEqual(resolveLayoutDiagram({ ...diagram, proportions: [...diagram.proportions!].reverse() }).blocks, result.blocks);
});

test('cycles, duplicate control, invalid references and impossible proportions are rejected', () => {
  const three = { aspectRatio: 1.6, blocks: [block('一'), block('二'), block('三')] };
  const invalid: unknown[][] = [
    [{ ...split, members: [{ block: 0, share: 58 }, { block: 1, share: 41 }] }],
    [{ ...split, members: [{ block: 0, share: 0 }, { block: 1, share: 100 }] }],
    [{ ...split, members: [{ block: 0, share: 50 }, { block: 0, share: 50 }] }],
    [{ ...split, members: [{ block: 0, share: 100 }] }],
    [{ ...split, members: [{ block: 0, share: 30 }, { block: 1, share: 30 }, { block: 2, share: 40 }], gap: .5 }],
    [{ ...split, gap: -.01 }], [{ ...split, gap: Infinity }], [{ ...split, reference: 3 }], [{ ...split, reference: 1.5 }],
    [{ ...split, region: { x: .8, y: 0, width: .5, height: 1 } }],
    [{ ...split, reference: 0 }], // Its own member is the parent.
    [split, { ...relative, block: 2, reference: 2 }],
    [split, { ...relative, block: 1, reference: 2 }], // Duplicate control of member 1.
    [{ ...split, members: [{ block: 1, share: 58 }, { block: 2, share: 42 }], reference: 0 }, { ...relative, block: 0, reference: 1 }],
    [{ ...relative, block: 0, reference: 1 }, { ...relative, block: 1, reference: 0 }],
    [{ ...relative, reference: -1 }], [{ ...relative, reference: 3 }], [{ ...relative, block: .5 }],
    [{ ...relative, widthPercent: 0 }], [{ ...relative, heightPercent: Infinity }], [{ ...relative, offsetYPercent: NaN }],
    [{ ...relative, widthPercent: 1000 }], [{ ...relative, offsetXPercent: -100 }],
    [{ ...relative, extra: true }], [{ type: 'relative', block: 1, reference: 0 }],
  ];
  for (const proportions of invalid) assert.throws(() => parseLayoutDiagram({ ...three, proportions }), JSON.stringify(proportions));
  const withoutReference = { ...split } as Partial<SplitProportion>;delete withoutReference.reference;
  assert.throws(() => parseLayoutDiagram({ ...three, proportions: [withoutReference] }));
});

test('legacy diagrams retain their exact geometry and report only explicit canvas denominators', () => {
  const legacy: LayoutDiagram = { aspectRatio: .75, blocks: [
    { ...block('主要内容约58%'), x: .05, y: .1, width: .9, height: .7 },
    { ...block('补充内容约42%', 'support'), x: .6, y: .5, width: .3, height: .4 },
  ] };
  assert.deepEqual(resolveLayoutDiagram(legacy), legacy);
  assert.deepEqual(parseLayoutDiagram(legacy), legacy);
  assert.equal(Object.hasOwn(resolveLayoutDiagram(legacy), 'proportions'), false);
  assert.equal(blockProportionLabel(legacy, 0), '90%画布宽 · 70%画布高');
  assert.equal(blockProportionLabel(legacy, 1), '30%画布宽 · 40%画布高');
  const notes = getLayoutProportionNotes(legacy);
  assert.equal(notes.length, 3);assert.match(notes[0], /旧图仅按画布宽高估算/);
  assert(notes.slice(1).every(note => note.startsWith('基准') && note.includes('画布宽') && note.includes('画布高')));
  assert(!notes.some(note => note.includes('可分配宽') || note.includes('58% 参考宽')));
  assert.throws(() => parseLayoutDiagram(legacy, { requireProportions: true }), /必须提供/);
  for (const proportions of [null, [], Array(9).fill(relative)]) assert.throws(() => parseLayoutDiagram({ ...legacy, proportions }));
  assert.throws(() => blockProportionLabel(legacy, 2));
});

test('generation schema requires unambiguous proportions and references without changing legacy parsing', () => {
  assert(layoutDiagramSchema.required.includes('proportions'));
  assert.equal(layoutDiagramSchema.properties.proportions.minItems, 1);
  const [splitSchema, relativeSchema] = layoutDiagramSchema.properties.proportions.items.anyOf;
  assert(splitSchema.required.includes('reference'));assert(splitSchema.required.includes('region'));assert(splitSchema.required.includes('gap'));
  assert.equal(splitSchema.additionalProperties, false);assert.equal(relativeSchema.additionalProperties, false);
  const valid: LayoutProportion[] = splitDiagram().proportions!;
  assert.equal(parseLayoutDiagram({ ...splitDiagram(), proportions: valid }, { requireProportions: true }).proportions?.length, 1);
});
