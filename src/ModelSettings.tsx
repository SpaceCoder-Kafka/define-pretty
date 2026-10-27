import type { ModelConfig, ModelOption } from '../shared/types';
import { resolveModelConfig } from '../shared/model-options';

export default function ModelSettings({ config, models, localModel, error, onChange, modelLabel = '模型', disabled = false }: {
  config: ModelConfig; models: ModelOption[]; error?: string;
  localModel?: string;
  onChange: (config: ModelConfig) => void; modelLabel?: string; disabled?: boolean;
}) {
  const selected = models.find(model => model.model === config.model);
  const unlisted = [...new Set([localModel, config.model].filter((model): model is string => !!model && !models.some(option => option.model === model)))];
  return <>
    <label>{modelLabel}{models.length ? <select aria-label={modelLabel} value={config.model} disabled={disabled} onChange={event => onChange(resolveModelConfig({ ...config, model: event.target.value }, models))}>
      {!config.model && <option value="" disabled>请选择模型</option>}
      {unlisted.map(model => <option key={model} value={model}>{model} · 当前配置</option>)}
      {models.map(model => <option key={model.model} value={model.model}>{model.displayName} · {model.model}</option>)}
    </select> : <input aria-label={modelLabel} value={config.model} disabled={disabled} onChange={event => onChange({ ...config, model: event.target.value })}/>}</label>
    <label>推理强度{selected ? <select aria-label="推理强度" value={config.reasoningEffort} disabled={disabled} onChange={event => onChange({ ...config, reasoningEffort: event.target.value })}>
      {selected.supportedReasoningEfforts.map(option => <option key={option.reasoningEffort} value={option.reasoningEffort} title={option.description}>{option.reasoningEffort}</option>)}
    </select> : <input aria-label="推理强度" value={config.reasoningEffort} disabled={disabled} onChange={event => onChange({ ...config, reasoningEffort: event.target.value })}/>}</label>
    {error && <p className="feature-muted" role="status">{error} 当前配置可继续手动填写。</p>}
    {!error && models.length > 0 && !selected && <p className="feature-muted">当前配置的模型未返回推理强度列表，可手动填写。</p>}
  </>;
}
