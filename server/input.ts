import type { DimensionRule, ExperimentGroup, ModelConfig, StyleGuide } from '../shared/types.ts';
import { styleGuideKey } from '../shared/style-guide.ts';
export function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export function text(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(`${name}不能为空，且长度不能超过 ${max} 个字符。`);
  return value as string;
}
function identifier(value: unknown): string {
  const id = text(value, '标识', 120);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || ['baseline', 'direct', 'all-rules', 'reference-constrained'].includes(id)) fail('维度或组合组标识无效。');
  return id;
}
export function styleGuideInput(value: unknown, dimensions: DimensionRule[], referenceId?: unknown): StyleGuide | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') fail('整体执行稿无效。');
  const item = value as Record<string, unknown>;
  const direction = text(item.direction, '整页视觉重点', 600, true);
  const synthesis = text(item.synthesis, '整体执行稿', 2400, true);
  const sourceKey = text(item.sourceKey, '整合来源', 300000, true);
  if (synthesis && sourceKey !== styleGuideKey(direction, dimensions)) fail('整体执行稿已过期，请重新整合当前维度。');
  if (synthesis && item.referenceId !== referenceId) fail('整体执行稿使用的参考图不同，请重新整合。');
  return { direction, synthesis, sourceKey, referenceId: typeof referenceId === 'string' ? referenceId : undefined };
}
export function modelInput(value: unknown, defaults: ModelConfig): ModelConfig {
  const supplied = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const model = text(supplied.model ?? defaults.model, '模型', 120).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) fail('模型名称包含无效字符。');
  const reasoningEffort = text(supplied.reasoningEffort ?? defaults.reasoningEffort, '推理强度', 30);
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(reasoningEffort)) fail('推理强度无效。');
  return { model, reasoningEffort, provider: defaults.provider, cliVersion: defaults.cliVersion };
}
export function dimensionsInput(value: unknown): DimensionRule[] {
  if (!Array.isArray(value) || value.length > 100) fail('维度列表无效，最多支持 100 个维度。');
  const dimensions = (value as Record<string, unknown>[]).map(rule => ({
    id: identifier(rule?.id), title: text(rule?.title, '规范标题', 120),
    scope: text(rule?.scope, '修改范围', 5000, true), instructions: text(rule?.instructions, '规范内容', 20000, true),
    ...(rule?.sourceGenerationId ? { sourceGenerationId: text(rule.sourceGenerationId, '生成记录标识', 120) } : {}),
  }));
  if (new Set(dimensions.map(rule => rule.id)).size !== dimensions.length) fail('维度标识不能重复。');
  return dimensions;
}
export function groupsInput(value: unknown, dimensions: DimensionRule[]): ExperimentGroup[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) fail('组合组列表无效，最多支持 100 个组合组。');
  const ids = new Set(dimensions.map(rule => rule.id));
  return (value as Record<string, unknown>[]).map(group => {
    const id = identifier(group?.id);
    if (ids.has(id)) fail('组合组与维度标识不能重复。');
    ids.add(id);
    const dimensionIds = group.dimensionIds;
    if (!Array.isArray(dimensionIds) || dimensionIds.length < 2 || new Set(dimensionIds).size !== dimensionIds.length || dimensionIds.some(id => !dimensions.some(rule => rule.id === id))) fail('组合组需选择至少两个不同的有效维度。');
    return { id, title: text(group.title, '组合组名称', 120), dimensionIds: dimensionIds as string[], ...(Array.isArray(group.sourceRunIds) ? { sourceRunIds: group.sourceRunIds.map(id => text(id, '来源运行标识', 120)) } : {}) };
  });
}
