import type { FeatureBoard } from './feature-board';
import type { ModelConfig, RunStatus, Usage } from './types';
import type { DraftPreview, ExecutionProgress } from './execution-progress';
export interface BuiltinSourceInfo {
  slug: string; description: string; style: 'classic' | 'neon'; order: number;
}
export interface FeatureTestSource {
  experimentId: string; title: string; versionId: string; versionNumber: number; runId: string;
  createdAt: string; hash: string; config: ModelConfig; requirements?: string;
  builtin?: BuiltinSourceInfo;
}
export interface FeatureTest {
  id: string; boardId: string; boardRevision: number; board: FeatureBoard;
  source: FeatureTestSource; config: ModelConfig; prompt: string; imageHash: string;
  /** Frozen, unmarked visual input. Absent on older single-image tests. */
  originalReference?: { filename: string; mimeType: string; sha256: string };
  /** A new attempt based on an earlier result; source remains the original comparison baseline. */
  refinement?: { parentTestId: string; parentArtifactHash: string; feedback: string };
  status: RunStatus; createdAt: string; finishedAt?: string; elapsedMs?: number;
  hasPreview: boolean; changed?: boolean; error?: string; summary?: string; usage?: Usage; exitCode?: number | null;
  progress?: ExecutionProgress; draftPreview?: DraftPreview;
}

export interface FeatureSourceRun {
  id: string; requirements: string; prompt: string; config: ModelConfig;
  status: RunStatus; createdAt: string; finishedAt?: string; elapsedMs?: number;
  source?: FeatureTestSource; error?: string; summary?: string; usage?: Usage; exitCode?: number | null;
  progress?: ExecutionProgress; draftPreview?: DraftPreview;
}
