import type { FeatureRegion } from './feature-board';
import type { LayoutDiagram } from './layout-diagram';
import type { ModelConfig, RunStatus, Usage } from './types';

export interface FeatureCompletion {
  id: string; boardId: string; cardId: string; revision: number;
  title: string; region: FeatureRegion; config: ModelConfig;
  status: RunStatus; createdAt: string; finishedAt?: string;
  result?: { description: string; effect: string; instruction: string; applicability: string; layout?: LayoutDiagram };
  error?: string; usage?: Usage; exitCode?: number | null;
}
