import type { ModelConfig } from '../shared/types.ts';
export function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export function text(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(`${name}不能为空，且长度不能超过 ${max} 个字符。`);
  return value as string;
}
export function modelInput(value: unknown, defaults: ModelConfig): ModelConfig {
  const supplied = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const model = text(supplied.model ?? defaults.model, '模型', 120).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) fail('模型名称包含无效字符。');
  const reasoningEffort = text(supplied.reasoningEffort ?? defaults.reasoningEffort, '推理强度', 30);
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(reasoningEffort)) fail('推理强度无效。');
  return { model, reasoningEffort, provider: defaults.provider, cliVersion: defaults.cliVersion };
}
