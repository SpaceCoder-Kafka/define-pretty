import type { ExperimentVersion, ReferenceAsset, Run } from '../shared/types.ts';
export interface RunnerStore {
  runDir(id: string): string;
  referencePath(id: string): string;
  getRun(id: string): Promise<Run>;
  updateRun(id: string, patch: Partial<Run>): Promise<Run>;
  getVersion(experimentId: string, versionId: string): Promise<ExperimentVersion>;
  getReference(id: string): Promise<ReferenceAsset>;
  listRuns(experimentId?: string): Promise<Run[]>;
  bindBaseline(experimentId: string, versionId: string, runId: string): Promise<void>;
}
export interface RunnerController { enqueue(runId: string): void | Promise<void>; cancel(runId: string): Promise<void>; shutdown(): Promise<void> }
