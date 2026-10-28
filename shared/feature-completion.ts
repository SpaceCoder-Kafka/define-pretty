import type { FeatureRegion } from './feature-board.ts';
import type { LayoutDiagram } from './layout-diagram.ts';
import type { FeatureSpec } from './feature-spec.ts';
import type { ModelConfig, RunStatus, Usage } from './types.ts';

export interface FeatureCompletion {
  id: string; boardId: string; cardId: string; revision: number;
  title: string; region: FeatureRegion; config: ModelConfig;
  status: RunStatus; createdAt: string; finishedAt?: string;
  result?: { description: string; effect: string; instruction: string; applicability: string; layout?: LayoutDiagram; spec?: FeatureSpec | null };
  error?: string; usage?: Usage; exitCode?: number | null;
}
