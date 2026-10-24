import { randomUUID } from 'node:crypto';
import type { DimensionRule, SpecGeneration } from '../shared/types.ts';

// Writing references, not a source of visual defaults for the user's screenshot:
// https://github.com/material-components/material-web/blob/main/docs/theming/typography.md
// https://developer.apple.com/design/human-interface-guidelines/buttons
const shortText = { type: 'string', minLength: 1, maxLength: 600 };
const list = (minItems: number) => ({ type: 'array', minItems, maxItems: 16, items: shortText });
export const specificationSchema = {
  type: 'object', additionalProperties: false, required: ['dimensions'], properties: {
    dimensions: { type: 'array', minItems: 1, maxItems: 40, items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'scope', 'purpose', 'tokens', 'rules', 'states', 'adaptations', 'checks', 'observations'],
      properties: {
        title: { ...shortText, maxLength: 120 }, scope: shortText, purpose: shortText,
        tokens: { type: 'array', minItems: 1, maxItems: 24, items: {
          type: 'object', additionalProperties: false, required: ['name', 'value', 'usage'],
          properties: { name: { ...shortText, maxLength: 120 }, value: shortText, usage: shortText },
        } },
        rules: list(1), states: list(0), adaptations: list(1), checks: list(1),
        observations: { ...shortText, maxLength: 5000 },
      },
    } },
  },
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成结果的章节无效。原始输出已保留。');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 600): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`生成结果的 ${field} 无效。原始输出已保留。`);
  return value.trim();
}
function items(value: unknown, field: string, min: number, max = 16): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`生成结果的 ${field} 无效。请使用分条规范。原始输出已保留。`);
  return value;
}
function bulletList(value: unknown, field: string, min: number): string {
  return items(value, field, min).map(item => `- ${text(item, field).replace(/\s*\n\s*/g, ' ')}`).join('\n');
}

export function parseSpecification(raw: string, sourceGenerationId: string): {
  dimensions: DimensionRule[]; observations: NonNullable<SpecGeneration['observations']>;
} {
  const data = record(JSON.parse(raw));
  const observations: NonNullable<SpecGeneration['observations']> = [];
  const dimensions = items(data.dimensions, 'dimensions', 1, 40).map(value => {
    const item = record(value);
    const title = text(item.title, 'title', 120);
    const scope = text(item.scope, 'scope');
    const purpose = text(item.purpose, 'purpose');
    const names = new Set<string>();
    const tokens = items(item.tokens, 'tokens', 1, 24).map(value => {
      const token = record(value);
      const name = text(token.name, 'token.name', 120);
      if (names.has(name)) throw new Error(`生成结果的参数 ${name} 重复。原始输出已保留。`);
      names.add(name);
      return `- ${name} = ${text(token.value, 'token.value')}；用于${text(token.usage, 'token.usage')}。`;
    }).join('\n');
    const rules = bulletList(item.rules, 'rules', 1);
    const states = bulletList(item.states, 'states', 0);
    const adaptations = bulletList(item.adaptations, 'adaptations', 1);
    const checks = bulletList(item.checks, 'checks', 1);
    const instructions = `1. 用途与适用条件\n${purpose}\n\n2. 设计参数\n${tokens}\n\n3. 应用规则\n${rules}\n\n4. 状态规则\n${states || '不适用；本维度不定义交互状态。'}\n\n5. 适配规则\n${adaptations}\n\n6. 检查项\n${checks}`;
    text(instructions, 'instructions', 20000);
    const id = `dim-${randomUUID()}`;
    observations.push({ dimensionId: id, title, notes: text(item.observations, 'observations', 5000) });
    return { id, title, scope, instructions, sourceGenerationId };
  });
  return { dimensions, observations };
}

export function parseGeneratedRules(raw: string, sourceGenerationId: string): DimensionRule[] {
  return parseSpecification(raw, sourceGenerationId).dimensions;
}
