/** Public progress contains activity labels only, never reasoning or raw tool payloads. */
export interface ExecutionProgress {
  startedAt: string;
  updatedAt: string;
  message: string;
  completedActions: number;
  failedActions: number;
  activeActions: { id: string; label: string; startedAt: string }[];
  agents: { id: string; label: string; status: 'running' | 'completed' | 'failed' | 'closed' }[];
}

export interface DraftPreview {
  /** Changes only after a newly rendered checkpoint is available. */
  updatedAt: string;
}
