export type LayoutRole = 'navigation' | 'main' | 'support' | 'highlight';
export interface LayoutBlock {
  label: string; x: number; y: number; width: number; height: number; role: LayoutRole;
}
export interface LayoutProportionRegion { x: number; y: number; width: number; height: number }
export interface SplitProportion {
  type: 'split'; label: string; axis: 'horizontal' | 'vertical'; reference: number | null; region: LayoutProportionRegion;
  /** Fraction of the region's width or height, reserved between adjacent members. */
  gap: number; members: { block: number; share: number }[];
}
export interface RelativeProportion {
  type: 'relative'; block: number; reference: number;
  widthPercent: number; heightPercent: number; offsetXPercent: number; offsetYPercent: number;
}
export type LayoutProportion = SplitProportion | RelativeProportion;
/** Coordinates are normalized to the diagram; blocks are painted back to front. */
export interface LayoutDiagram { aspectRatio: number; blocks: LayoutBlock[]; proportions?: LayoutProportion[] }

const coordinate = { type: 'number', minimum: 0, maximum: 1 };
const dimension = { type: 'number', exclusiveMinimum: 0, maximum: 1 };
const blockIndex = { type: 'integer', minimum: 0, maximum: 7 };
const geometryProperties = { x: coordinate, y: coordinate, width: dimension, height: dimension };
const blockProperties = {
  label: { type: 'string', minLength: 1, maxLength: 40 },
  ...geometryProperties,
  role: { type: 'string', enum: ['navigation', 'main', 'support', 'highlight'] },
};
const splitProperties = {
  type: { type: 'string', enum: ['split'] }, label: { type: 'string', minLength: 1, maxLength: 80 },
  axis: { type: 'string', enum: ['horizontal', 'vertical'] }, reference: { anyOf: [blockIndex, { type: 'null' }] },
  region: { type: 'object', additionalProperties: false, required: Object.keys(geometryProperties), properties: geometryProperties },
  gap: { type: 'number', minimum: 0, exclusiveMaximum: 1 },
  members: {
    type: 'array', minItems: 2, maxItems: 8,
    items: { type: 'object', additionalProperties: false, required: ['block', 'share'], properties: { block: blockIndex, share: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } },
  },
};
const relativeProperties = {
  type: { type: 'string', enum: ['relative'] }, block: blockIndex, reference: blockIndex,
  widthPercent: { type: 'number', exclusiveMinimum: 0 }, heightPercent: { type: 'number', exclusiveMinimum: 0 },
  offsetXPercent: { type: 'number' }, offsetYPercent: { type: 'number' },
};
export const layoutDiagramSchema = {
  type: 'object', additionalProperties: false, required: ['aspectRatio', 'blocks', 'proportions'],
  properties: {
    aspectRatio: { type: 'number', minimum: 0.4, maximum: 3 },
    blocks: {
      type: 'array', minItems: 2, maxItems: 8,
      items: { type: 'object', additionalProperties: false, required: Object.keys(blockProperties), properties: blockProperties },
    },
    proportions: {
      type: 'array', minItems: 1, maxItems: 8,
      items: { anyOf: [
        { type: 'object', additionalProperties: false, required: Object.keys(splitProperties), properties: splitProperties },
        { type: 'object', additionalProperties: false, required: Object.keys(relativeProperties), properties: relativeProperties },
      ] },
    },
  },
};

function object(value: unknown, fields: string[], label: string, optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(field => !fields.includes(field) && !optional.includes(field)) || fields.some(field => !Object.hasOwn(item, field))) throw new Error(`${label}字段不完整或包含未知字段。`);
  return item;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function label(value: unknown, limit: number, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${name}不能为空，且不能超过 ${limit} 个字符。`);
  return value.trim();
}
function index(value: unknown, count: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= count) throw new Error('比例约束必须引用存在的色块索引。');
  return value;
}
const roundingTolerance = 1e-9;
function geometry(value: Record<string, unknown>, name: string, computed = false): LayoutProportionRegion {
  const { x, y, width, height } = value;
  const tolerance = computed ? roundingTolerance : 0;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || x < -tolerance || y < -tolerance || x >= 1 || y >= 1 || width <= 0 || height <= 0 || width > 1 + tolerance || height > 1 + tolerance || x + width > 1 + roundingTolerance || y + height > 1 + roundingTolerance) throw new Error(`${name}坐标须归一化为 0–1，尺寸须大于 0，且完整位于画布内。`);
  const left = Math.max(0, x), top = Math.max(0, y);
  return { x: left, y: top, width: Math.min(width, 1 - left), height: Math.min(height, 1 - top) };
}

function proportionsInput(value: unknown, blockCount: number): LayoutProportion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('布局比例约束必须包含 1–8 项。');
  return Array.from(value, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('布局比例约束必须是对象。');
    if (value.type === 'split') {
      const item = object(value, Object.keys(splitProperties), '分栏比例约束');
      if (item.axis !== 'horizontal' && item.axis !== 'vertical') throw new Error('分栏方向必须为 horizontal 或 vertical。');
      const region = geometry(object(item.region, Object.keys(geometryProperties), '分栏区域'), '分栏区域');
      if (!Array.isArray(item.members) || item.members.length < 2 || item.members.length > 8) throw new Error('分栏必须包含 2–8 个成员。');
      const members = Array.from(item.members, value => {
        const member = object(value, ['block', 'share'], '分栏成员');
        if (!finite(member.share) || member.share <= 0 || member.share > 100) throw new Error('分栏比例须大于 0 且不超过 100。');
        return { block: index(member.block, blockCount), share: member.share };
      });
      if (Math.abs(members.reduce((sum, member) => sum + member.share, 0) - 100) > 1e-6) throw new Error('同组分栏比例之和必须为 100。');
      if (!finite(item.gap) || item.gap < 0 || item.gap >= 1 || item.gap * (members.length - 1) >= 1) throw new Error('分栏间距不能为负，也不能占满整个分栏区域。');
      return { type: 'split', label: label(item.label, 80, '分栏名称'), axis: item.axis, reference: item.reference === null ? null : index(item.reference, blockCount), region, gap: item.gap, members } as SplitProportion;
    }
    if (value.type === 'relative') {
      const item = object(value, Object.keys(relativeProperties), '相对比例约束');
      if (!finite(item.widthPercent) || !finite(item.heightPercent) || item.widthPercent <= 0 || item.heightPercent <= 0) throw new Error('相对宽高百分比必须为大于 0 的有限数值。');
      if (!finite(item.offsetXPercent) || !finite(item.offsetYPercent)) throw new Error('相对偏移必须为有限数值。');
      const block = index(item.block, blockCount), reference = index(item.reference, blockCount);
      if (block === reference) throw new Error('相对比例不能引用自身。');
      return { type: 'relative', block, reference, widthPercent: item.widthPercent, heightPercent: item.heightPercent, offsetXPercent: item.offsetXPercent, offsetYPercent: item.offsetYPercent } as RelativeProportion;
    }
    throw new Error('比例约束类型必须为 split 或 relative。');
  });
}

type Controller = { proportion: SplitProportion; member: number } | { proportion: RelativeProportion };
function solve(diagram: LayoutDiagram): LayoutDiagram {
  const controllers = new Map<number, Controller>();
  for (const proportion of diagram.proportions ?? []) {
    const entries: [number, Controller][] = proportion.type === 'split'
      ? proportion.members.map((member, position) => [member.block, { proportion, member: position }])
      : [[proportion.block, { proportion }]];
    for (const [block, controller] of entries) {
      if (controllers.has(block)) throw new Error('同一色块不能被多个比例约束或重复成员控制。');
      controllers.set(block, controller);
    }
  }
  const blocks = diagram.blocks.map(block => ({ ...block })), states = new Array<number>(blocks.length).fill(0);
  function resolveBlock(block: number): LayoutBlock {
    if (states[block] === 2) return blocks[block];
    if (states[block] === 1) throw new Error('布局比例约束存在循环引用。');
    states[block] = 1;
    const controller = controllers.get(block);
    if (controller) {
      const proportion = controller.proportion;
      let computed: LayoutProportionRegion;
      if (proportion.type === 'split') {
        const parent = proportion.reference === null ? { x: 0, y: 0, width: 1, height: 1 } : resolveBlock(proportion.reference);
        const region = {
          x: parent.x + parent.width * proportion.region.x, y: parent.y + parent.height * proportion.region.y,
          width: parent.width * proportion.region.width, height: parent.height * proportion.region.height,
        };
        const member = (controller as { member: number }).member;
        const total = proportion.members.reduce((sum, item) => sum + item.share, 0);
        const before = proportion.members.slice(0, member).reduce((sum, item) => sum + item.share, 0) / total;
        const available = 1 - proportion.gap * (proportion.members.length - 1);
        const offset = available * before + proportion.gap * member;
        const fraction = available * proportion.members[member].share / total;
        computed = proportion.axis === 'horizontal'
          ? { x: region.x + region.width * offset, y: region.y, width: region.width * fraction, height: region.height }
          : { x: region.x, y: region.y + region.height * offset, width: region.width, height: region.height * fraction };
      } else {
        const reference = resolveBlock(proportion.reference);
        computed = {
          x: reference.x + reference.width * proportion.offsetXPercent / 100,
          y: reference.y + reference.height * proportion.offsetYPercent / 100,
          width: reference.width * proportion.widthPercent / 100,
          height: reference.height * proportion.heightPercent / 100,
        };
      }
      blocks[block] = { ...blocks[block], ...geometry({ ...computed }, `“${blocks[block].label}”按比例求解后的`, true) };
    }
    states[block] = 2;
    return blocks[block];
  }
  blocks.forEach((_, block) => resolveBlock(block));
  return { ...diagram, blocks };
}

/** Validate untrusted model/API input and return a fresh diagram, without modifying it. */
export function parseLayoutDiagram(value: unknown, options: { requireProportions?: boolean } = {}): LayoutDiagram {
  const diagram = object(value, ['aspectRatio', 'blocks'], '布局比例图', ['proportions']);
  if (!finite(diagram.aspectRatio) || diagram.aspectRatio < 0.4 || diagram.aspectRatio > 3) throw new Error('布局比例图的宽高比必须在 0.4–3 之间。');
  if (!Array.isArray(diagram.blocks) || diagram.blocks.length < 2 || diagram.blocks.length > 8) throw new Error('布局比例图必须包含 2–8 个色块。');
  const blocks = Array.from(diagram.blocks, (value): LayoutBlock => {
    const item = object(value, Object.keys(blockProperties), '布局色块');
    if (item.role !== 'navigation' && item.role !== 'main' && item.role !== 'support' && item.role !== 'highlight') throw new Error('布局色块角色必须为 navigation、main、support 或 highlight。');
    return { label: label(item.label, 40, '布局色块标签'), ...geometry(item, '布局色块'), role: item.role };
  });
  if (diagram.proportions === undefined && options.requireProportions) throw new Error('新布局比例图必须提供明确的比例约束。');
  const proportions = diagram.proportions === undefined ? undefined : proportionsInput(diagram.proportions, blocks.length);
  return solve({ aspectRatio: diagram.aspectRatio, blocks, ...(proportions ? { proportions } : {}) });
}

/** Resolve legacy and saved diagrams with exactly the same validation and geometry rules. */
export function resolveLayoutDiagram(diagram: LayoutDiagram): LayoutDiagram { return parseLayoutDiagram(diagram); }

function percent(value: number): string {
  return Math.abs(value) >= 10000 || (value !== 0 && Math.abs(value) < .01) ? value.toPrecision(3) : String(Number(value.toFixed(2)));
}
function canvasNote(block: LayoutBlock): string {
  return `基准“${block.label}”：宽 ${percent(block.width * 100)}% 画布宽、高 ${percent(block.height * 100)}% 画布高。`;
}

/** Human-readable denominators and geometry shared by UI, PNG export and copied instructions. */
export function getLayoutProportionNotes(diagram: LayoutDiagram): string[] {
  const resolved = resolveLayoutDiagram(diagram), proportions = resolved.proportions ?? [], controlled = new Set<number>();
  const notes = proportions.map(proportion => {
    if (proportion.type === 'split') {
      const axis = proportion.axis === 'horizontal' ? '宽' : '高';
      const reference = proportion.reference === null ? '画布' : `“${resolved.blocks[proportion.reference].label}”`;
      const region = proportion.region, gaps = proportion.members.length - 1;
      proportion.members.forEach(member => controlled.add(member.block));
      const shares = proportion.members.map(member => `“${resolved.blocks[member.block].label}” ${percent(member.share)}%`).join(' / ');
      const range = region.x === 0 && region.y === 0 && region.width === 1 && region.height === 1
        ? `${reference}全区` : `${reference}内所划区域（宽 ${percent(region.width * 100)}%、高 ${percent(region.height * 100)}%）`;
      return `“${proportion.label}”（估计）：${shares}（扣除全部间距后的可用${axis}）；每道间距 ${percent(proportion.gap * 100)}% 区域${axis}（${gaps} 道）。范围：${range}。`;
    }
    controlled.add(proportion.block);
    const block = resolved.blocks[proportion.block], reference = resolved.blocks[proportion.reference];
    const crossing: string[] = [];
    const edges: [string, number, number, string][] = [
      ['左', reference.x - block.x, reference.width, '宽'],
      ['右', block.x + block.width - reference.x - reference.width, reference.width, '宽'],
      ['上', reference.y - block.y, reference.height, '高'],
      ['下', block.y + block.height - reference.y - reference.height, reference.height, '高'],
    ];
    for (const [edge, distance, base, dimension] of edges) if (distance > roundingTolerance) crossing.push(`${edge}跨出 ${percent(distance / base * 100)}% 参考${dimension}`);
    const intersectionWidth = Math.max(0, Math.min(block.x + block.width, reference.x + reference.width) - Math.max(block.x, reference.x));
    const intersectionHeight = Math.max(0, Math.min(block.y + block.height, reference.y + reference.height) - Math.max(block.y, reference.y));
    const overlap = Math.min(1, intersectionWidth / block.width) * Math.min(1, intersectionHeight / block.height);
    const intersection = overlap > 0
      ? `实际交叠占本块面积 ${percent(overlap * 100)}%（绘制在参考块${proportion.block > proportion.reference ? '前' : '后'}）`
      : '与参考块无交叠';
    const offsetX = `${proportion.offsetXPercent < 0 ? '左' : '右'} ${percent(Math.abs(proportion.offsetXPercent))}% 参考宽`;
    const offsetY = `${proportion.offsetYPercent < 0 ? '上' : '下'} ${percent(Math.abs(proportion.offsetYPercent))}% 参考高`;
    return `“${block.label}”相对“${reference.label}”（估计）：宽 ${percent(proportion.widthPercent)}% 参考宽、高 ${percent(proportion.heightPercent)}% 参考高；左上偏移：${offsetX}、${offsetY}。${crossing.length ? crossing.join('、') : '位于参考范围内'}；${intersection}。`;
  });
  if (!proportions.length) notes.push('旧图仅按画布宽高估算，没有显式分组或相对比例约束。');
  resolved.blocks.forEach((block, index) => { if (!controlled.has(index)) notes.push(canvasNote(block)); });
  return notes;
}

/** Compact labels retain their denominator; detailed notes name the actual reference region. */
export function blockProportionLabel(diagram: LayoutDiagram, block: number): string {
  const resolved = resolveLayoutDiagram(diagram);
  index(block, resolved.blocks.length);
  for (const proportion of resolved.proportions ?? []) {
    if (proportion.type === 'split') {
      const member = proportion.members.find(member => member.block === block);
      if (member) return `${percent(member.share)}%可分配${proportion.axis === 'horizontal' ? '宽' : '高'}`;
    } else if (proportion.block === block) return `${percent(proportion.widthPercent)}%参考宽 · ${percent(proportion.heightPercent)}%参考高`;
  }
  return `${percent(resolved.blocks[block].width * 100)}%画布宽 · ${percent(resolved.blocks[block].height * 100)}%画布高`;
}
