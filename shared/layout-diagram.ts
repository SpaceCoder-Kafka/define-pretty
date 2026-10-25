export type LayoutRole = 'navigation' | 'main' | 'support' | 'highlight';
export interface LayoutBlock {
  label: string; x: number; y: number; width: number; height: number; role: LayoutRole;
}
/** Coordinates are normalized to the diagram; blocks are painted back to front. */
export interface LayoutDiagram { aspectRatio: number; blocks: LayoutBlock[] }

const coordinate = { type: 'number', minimum: 0, maximum: 1 };
const dimension = { type: 'number', exclusiveMinimum: 0, maximum: 1 };
const blockProperties = {
  label: { type: 'string', minLength: 1, maxLength: 40 },
  x: coordinate, y: coordinate, width: dimension, height: dimension,
  role: { type: 'string', enum: ['navigation', 'main', 'support', 'highlight'] },
};
export const layoutDiagramSchema = {
  type: 'object', additionalProperties: false, required: ['aspectRatio', 'blocks'],
  properties: {
    aspectRatio: { type: 'number', minimum: 0.4, maximum: 3 },
    blocks: {
      type: 'array', minItems: 2, maxItems: 8,
      items: { type: 'object', additionalProperties: false, required: Object.keys(blockProperties), properties: blockProperties },
    },
  },
};

function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== fields.length || fields.some(field => !Object.hasOwn(item, field))) throw new Error(`${label}字段不完整或包含未知字段。`);
  return item;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

/** Validate untrusted model/API input and return a fresh diagram, without modifying it. */
export function parseLayoutDiagram(value: unknown): LayoutDiagram {
  const diagram = object(value, ['aspectRatio', 'blocks'], '布局比例图');
  if (!finite(diagram.aspectRatio) || diagram.aspectRatio < 0.4 || diagram.aspectRatio > 3) throw new Error('布局比例图的宽高比必须在 0.4–3 之间。');
  if (!Array.isArray(diagram.blocks) || diagram.blocks.length < 2 || diagram.blocks.length > 8) throw new Error('布局比例图必须包含 2–8 个色块。');
  const blocks = diagram.blocks.map((value): LayoutBlock => {
    const item = object(value, Object.keys(blockProperties), '布局色块');
    if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 40) throw new Error('布局色块标签不能为空，且不能超过 40 个字符。');
    const { x, y, width, height } = item;
    if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || x < 0 || y < 0 || x >= 1 || y >= 1 || width <= 0 || height <= 0 || width > 1 || height > 1 || x + width > 1.000001 || y + height > 1.000001) throw new Error('布局色块坐标须归一化为 0–1，尺寸须大于 0，且完整位于图内。');
    if (item.role !== 'navigation' && item.role !== 'main' && item.role !== 'support' && item.role !== 'highlight') throw new Error('布局色块角色必须为 navigation、main、support 或 highlight。');
    return { label: item.label.trim(), x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y), role: item.role };
  });
  return { aspectRatio: diagram.aspectRatio, blocks };
}
