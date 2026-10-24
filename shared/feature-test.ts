import type { FeatureBoard } from './feature-board';
import type { ModelConfig, RunStatus, Usage } from './types';
export interface FeatureTestSource {
  experimentId: string; title: string; versionId: string; versionNumber: number; runId: string;
  createdAt: string; hash: string; config: ModelConfig;
}
export interface FeatureTest {
  id: string; boardId: string; boardRevision: number; board: FeatureBoard;
  source: FeatureTestSource; config: ModelConfig; prompt: string; imageHash: string;
  status: RunStatus; createdAt: string; finishedAt?: string; elapsedMs?: number;
  hasPreview: boolean; changed?: boolean; error?: string; summary?: string; usage?: Usage; exitCode?: number | null;
}
