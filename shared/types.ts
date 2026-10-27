export type RunStatus = 'queued' | 'running' | 'checking' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface ModelConfig { model: string; reasoningEffort: string; provider?: string; cliVersion: string }
export interface ModelOption {
  model: string; displayName: string; isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export interface ReferenceAsset { id: string; name: string; mimeType: string; size: number; sha256: string; url: string; createdAt: string }
export interface Usage { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number; [key: string]: unknown }
export interface RuntimeInfo { codexAvailable: boolean; authenticated: boolean; version: string; error?: string }
export interface Bootstrap { token: string; defaults: { config: ModelConfig }; runtime: RuntimeInfo; previewOrigin: string; models: ModelOption[]; modelCatalogError?: string }
