export const DIMENSION_IDS = ['layout', 'spacing', 'typography', 'color', 'buttons', 'inputs', 'cards', 'charts', 'icons'] as const;
export type DimensionId = string;
export type GroupId = string;
export const GROUP_IDS: GroupId[] = ['baseline', 'direct', ...DIMENSION_IDS];
export type RunStatus = 'queued' | 'running' | 'checking' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface DimensionRule { id: DimensionId; title: string; scope: string; instructions: string; sourceGenerationId?: string }
export interface StyleGuide { direction: string; synthesis: string; sourceKey: string; referenceId?: string }
export interface ModelConfig { model: string; reasoningEffort: string; provider?: string; cliVersion: string }
export interface ExperimentGroup { id: string; title: string; dimensionIds: string[]; sourceRunIds?: string[] }
export interface SpecGeneration {
  id: string; reference: ReferenceAsset; config: ModelConfig; prompt: string; status: RunStatus;
  createdAt: string; finishedAt?: string; dimensions?: DimensionRule[]; error?: string; usage?: Usage; exitCode?: number | null;
  formatVersion?: number; observations?: { dimensionId: string; title: string; notes: string }[];
  styleGuide?: StyleGuide; integrationSource?: { dimensions: DimensionRule[]; direction: string };
}
export interface RunConfig {
  model: string; reasoningEffort: string; provider?: string; cliVersion: string;
  concurrency: number; timeoutMs: number;
}
export interface ReferenceAsset { id: string; name: string; mimeType: string; size: number; sha256: string; url: string; createdAt: string }
export interface ExperimentVersion {
  id: string; number: number; createdAt: string; businessBrief: string; businessHash: string;
  referenceId?: string; dimensions: DimensionRule[]; styleGuide?: StyleGuide; groups?: ExperimentGroup[]; generationConfig?: ModelConfig; generationPrompt?: string; config: RunConfig; baselineRunId?: string;
}
export interface Experiment { id: string; title: string; createdAt: string; updatedAt: string; versions: ExperimentVersion[] }
export interface ExperimentInput { title: string; businessBrief: string; referenceId?: string; dimensions: DimensionRule[]; styleGuide?: StyleGuide; groups?: ExperimentGroup[]; generationConfig?: ModelConfig; generationPrompt?: string; config: RunConfig }
export interface Usage { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number; [key: string]: unknown }
export interface ValidationCheck { id: string; label: string; passed: boolean; details?: string }
export interface ValidationResult { passed: boolean; checks: ValidationCheck[]; consoleErrors: string[]; resourceErrors: string[]; contentChanges: string[]; screenshot?: string }
export interface Review {
  adherence: '' | 'followed' | 'partial' | 'missed';
  scope: '' | 'none' | 'acceptable' | 'outside';
  preference: '' | 'better' | 'same' | 'worse'; notes: string; updatedAt?: string;
}
export interface Run {
  id: string; experimentId: string; versionId: string; groupId: GroupId; groupTitle?: string; dimensionIds?: string[]; attempt: number;
  status: RunStatus; createdAt: string; startedAt?: string; finishedAt?: string;
  baselineRunId?: string; baselineHash?: string; artifactHash?: string;
  error?: string; exitCode?: number | null; usage?: Usage; validation?: ValidationResult;
  hasPreview: boolean; summary?: string; review?: Review; elapsedMs?: number;
}
export interface RunInput { prompt: string; reference?: ReferenceAsset; rules: DimensionRule[]; designBrief?: { direction: string; synthesis: string }; config: RunConfig; businessBrief: string; baselineHash?: string }
export interface RunDetails { run: Run; input?: RunInput; diff: string; log: string; stderr?: string; lastMessage: string; files: string[] }
export interface ExperimentDetail { experiment: Experiment; runs: Run[] }
export interface RuntimeInfo { codexAvailable: boolean; authenticated: boolean; version: string; error?: string }
export interface Bootstrap { token: string; defaults: { businessBrief: string; dimensions: DimensionRule[]; groups?: ExperimentGroup[]; generationConfig?: ModelConfig; generationPrompt?: string; config: RunConfig }; runtime: RuntimeInfo; previewOrigin: string; capabilities?: { configurableConcurrency: boolean; dynamicDimensions?: boolean; visualChangeHighlights?: boolean; dimensionHighlights?: boolean } }
export interface VisualComparison {
  baselineRunId: string; baselineHash: string; resultHash: string; capturedAt: string;
  width: number; height: number; baselineUrl: string; resultUrl: string;
}
export interface ComponentSnapshot {
  id: string; tag: string; identity: string; text: string; media: string; appearance: string; signature: string;
  box: { x: number; y: number; width: number; height: number };
}
export interface DimensionHighlight {
  componentId: string; baselineComponentId: string | null; label: string; before: string; after: string; rule: string;
  box: ComponentSnapshot['box']; baselineBox?: ComponentSnapshot['box'];
}
export interface DimensionHighlightJob {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  dimension: string; model: string; reasoningEffort: string; createdAt: string; finishedAt?: string;
  comparison: VisualComparison; highlights?: DimensionHighlight[]; note?: string; error?: string; usage?: Usage;
}
