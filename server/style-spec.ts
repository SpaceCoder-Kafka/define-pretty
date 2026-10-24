import { randomUUID } from 'node:crypto';
import type { DimensionRule, SpecGeneration } from '../shared/types.ts';
import { styleGuideKey } from '../shared/style-guide.ts';

const str = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const dimensionSchema = (kind: 'whole-page' | 'attribute') => ({
  type: 'object', additionalProperties: false, required: ['kind', 'title', 'scope', 'rules', 'observations'],
  properties: { kind: { type: 'string', enum: [kind] }, title: kind === 'whole-page' ? { type: 'string', enum: ['整页视觉重点'] } : str(120), scope: str(240),
    rules: { type: 'array', minItems: 3, maxItems: 5, items: str(160) }, observations: str(1600) },
});
export const styleSpecSchema = {
  type: 'object', additionalProperties: false, required: ['dimensions'], properties: {
    dimensions: { type: 'array', minItems: 2, maxItems: 12, items: { anyOf: [dimensionSchema('whole-page'), dimensionSchema('attribute')] } },
  },
};
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}无效或超出长度限制。原始输出已保留。`);
  return value.trim();
}
export function parseStyleSpec(raw: string, sourceGenerationId: string): Pick<SpecGeneration, 'dimensions' | 'observations'> {
  const value = JSON.parse(raw);
  if (value?.direction !== undefined || value?.synthesis !== undefined) throw new Error('整页视觉重点必须是独立维度，不能作为额外全局字段。');
  if (!Array.isArray(value?.dimensions) || value.dimensions.length < 2 || value.dimensions.length > 12) throw new Error('需要 2–12 个独立维度，包含一个整页视觉重点维度。');
  if (value.dimensions.filter((item: any) => item?.kind === 'whole-page').length !== 1) throw new Error('必须且只能有一个整页视觉重点维度。');
  const observations: NonNullable<SpecGeneration['observations']> = [];
  const titles = new Set<string>();
  const dimensions: DimensionRule[] = value.dimensions.map((item: Record<string, unknown>) => {
    if (!item || Object.keys(item).some(key => !['kind', 'title', 'scope', 'rules', 'observations'].includes(key)) || !['whole-page', 'attribute'].includes(String(item.kind))) throw new Error('维度类型无效。');
    const title = text(item.title, 120, '维度名称');
    if ((item.kind === 'whole-page') !== (title === '整页视觉重点') || titles.has(title)) throw new Error('维度名称重复或整页视觉重点类型不匹配。');
    titles.add(title);
    if (!Array.isArray(item.rules) || item.rules.length < 3 || item.rules.length > 5) throw new Error('每个维度需要 3–5 条核心规则。');
    const id = `dim-${randomUUID()}`;
    observations.push({ dimensionId: id, title, notes: text(item.observations, 1600, '观察依据') });
    return { id, title, scope: text(item.scope, 240, '作用范围'), sourceGenerationId,
      instructions: item.rules.map(line => `- ${text(line, 160, '规则').replace(/\s*\n\s*/g, ' ')}`).join('\n') };
  });
  dimensions.sort((a, b) => Number(b.title === '整页视觉重点') - Number(a.title === '整页视觉重点'));
  return { dimensions, observations };
}
// Legacy format remains readable for historical evidence; no new integration jobs are exposed.
export const integrationSchema = { type: 'object', additionalProperties: false, required: ['synthesis', 'observations'], properties: { synthesis: str(2400), observations: str(1600) } };
export const INTEGRATION_PROMPT = '历史整体执行稿整合。';
export function parseIntegration(raw: string, direction: string, dimensions: DimensionRule[]): Pick<SpecGeneration, 'styleGuide' | 'observations'> {
  const value = JSON.parse(raw);
  return { styleGuide: { direction, synthesis: text(value.synthesis, 2400, '历史执行稿'), sourceKey: styleGuideKey(direction, dimensions) }, observations: [{ dimensionId: 'integration', title: '历史整合依据', notes: text(value.observations, 1600, '历史依据') }] };
}
