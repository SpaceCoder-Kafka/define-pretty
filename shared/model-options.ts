import type { ModelConfig, ModelOption } from './types.ts';

/** Retain supported preferences; a model change must not carry an unsupported effort. */
export function resolveModelConfig(config: ModelConfig, models: ModelOption[]): ModelConfig {
  const model = models.find(option => option.model === config.model);
  if (!model?.supportedReasoningEfforts.length || model.supportedReasoningEfforts.some(option => option.reasoningEffort === config.reasoningEffort)) return config;
  const preferred = model.supportedReasoningEfforts.find(option => option.reasoningEffort === model.defaultReasoningEffort) || model.supportedReasoningEfforts[0];
  return { ...config, reasoningEffort: preferred.reasoningEffort };
}
