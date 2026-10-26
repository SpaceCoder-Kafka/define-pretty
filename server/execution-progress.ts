import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ExecutionProgress } from '../shared/execution-progress.ts';

const MAX_ACTIVE = 16, MAX_AGENTS = 12, MAX_SEEN = 4096;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const idValue = (value: unknown): string | undefined => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(value) ? value : undefined;
const dateValue = (value: unknown): string | undefined => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : undefined;
const counter = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Only public agent messages pass through; tool arguments, outputs and reasoning never do. */
function publicText(value: unknown, limit = 400): string {
  if (typeof value !== 'string') return '';
  return value.replace(/```[\s\S]*?(?:```|$)/g, '[代码已省略]')
    .replace(/\b(?:sk|sess)-[\w-]{8,}/g, '[凭证已隐藏]')
    .replace(/\b(?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+/gi, '[凭证已隐藏]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function actionLabel(item: RecordValue): string | undefined {
  switch (item.type) {
    case 'command_execution': {
      const command = typeof item.command === 'string' ? item.command : '';
      if (/preview\.mjs|playwright|screenshot/.test(command)) return '检查页面与截图';
      if (/apply_patch|writeFile|cat\s*>/.test(command)) return '写入网页文件';
      if (/\bpip\b|\bcurl\b|npm (?:install|ci)|\bwget\b/.test(command)) return '准备素材与依赖';
      return '执行任务步骤';
    }
    case 'file_change': return '更新网页文件';
    case 'mcp_tool_call': return typeof item.tool === 'string' && /imagegen|generate_image/.test(item.tool) ? '生成图片' : '调用任务工具';
    case 'image_generation': return '生成图片';
    case 'web_search': return '查找参考资料';
    case 'collab_tool_call': return item.tool === 'spawn_agent' ? '分配并行任务' : item.tool === 'wait' ? '等待并行任务' : '协调并行任务';
    default: return undefined;
  }
}

function agentStatus(value: unknown): ExecutionProgress['agents'][number]['status'] | undefined {
  switch (value) {
    case 'pending_init': case 'running': return 'running';
    case 'completed': return 'completed';
    case 'errored': case 'failed': return 'failed';
    case 'interrupted': case 'shutdown': case 'not_found': case 'closed': return 'closed';
    default: return undefined;
  }
}

export class ExecutionProgressTracker {
  private value: ExecutionProgress;
  private completed = new Set<string>();
  constructor(startedAt = new Date().toISOString()) {
    this.value = { startedAt, updatedAt: startedAt, message: '正在启动生成任务', completedActions: 0, failedActions: 0, activeActions: [], agents: [] };
  }
  snapshot(): ExecutionProgress { return structuredClone(this.value); }
  accept(eventValue: unknown, at = new Date().toISOString()): boolean {
    const event = record(eventValue);
    if (!event) return false;
    const item = record(event.item);
    if (event.type === 'error' || event.type === 'turn.failed') {
      this.value.updatedAt = at; this.value.message = '任务遇到错误，正在等待执行结果'; return true;
    }
    if (!item || !['item.started', 'item.updated', 'item.completed'].includes(String(event.type))) return false;
    if (item.type === 'agent_message' && event.type === 'item.completed') {
      const message = publicText(item.text);
      if (!message) return false;
      this.value.message = message; this.value.updatedAt = at; return true;
    }
    const label = actionLabel(item), id = idValue(item.id);
    if (!label || !id) return false;
    if (item.type === 'collab_tool_call') this.updateAgents(item);
    if (event.type === 'item.completed') {
      if (this.completed.has(id)) return false;
      this.completed.add(id);
      if (this.completed.size > MAX_SEEN) this.completed.delete(this.completed.values().next().value!);
      this.value.activeActions = this.value.activeActions.filter(action => action.id !== id);
      const failed = item.status === 'failed' || item.status === 'declined' || (typeof item.exit_code === 'number' && item.exit_code !== 0) || Boolean(item.error);
      if (failed) this.value.failedActions++; else this.value.completedActions++;
      this.value.message = failed ? `${label}未成功，等待后续处理` : `${label}已完成`;
    } else if (!this.completed.has(id)) {
      if (!this.value.activeActions.some(action => action.id === id) && this.value.activeActions.length < MAX_ACTIVE) this.value.activeActions.push({ id, label, startedAt: at });
      this.value.message = label;
    } else return false;
    this.value.updatedAt = at;
    return true;
  }
  private updateAgents(item: RecordValue): void {
    const states = record(item.agents_states) ?? {};
    const ids = new Set([...(Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : []), ...Object.keys(states)]);
    for (const rawId of ids) {
      const id = idValue(rawId); if (!id) continue;
      const state = record(states[id]);
      const status = agentStatus(state?.status) ?? (item.status === 'completed' && item.tool === 'close_agent' ? 'closed' : item.tool === 'spawn_agent' && item.status !== 'failed' ? 'running' : undefined);
      if (!status) continue;
      const previous = this.value.agents.find(agent => agent.id === id);
      if (previous) previous.status = status;
      else if (this.value.agents.length < MAX_AGENTS) this.value.agents.push({ id, label: `子代理 ${this.value.agents.length + 1}`, status });
    }
  }
  finish(outcome: 'completed' | 'failed' | 'cancelled', at = new Date().toISOString()): void {
    this.value.updatedAt = at;
    this.value.message = outcome === 'completed' ? '生成执行已结束，准备检查网页' : outcome === 'cancelled' ? '生成任务已停止' : '生成执行未完成';
    this.value.activeActions = [];
    for (const agent of this.value.agents) if (agent.status === 'running') agent.status = 'closed';
  }
}

/** Coalesce bursts, serialize writes, and rename complete JSON so polling never sees half a file. */
export class ExecutionProgressWriter {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: ExecutionProgress;
  private writing: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private cwd: string, private intervalMs = 250) {}
  schedule(progress: ExecutionProgress): void {
    if (this.closed) return;
    this.pending = structuredClone(progress);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.enqueue(); }, this.intervalMs);
  }
  private enqueue(): void {
    const snapshot = this.pending; this.pending = undefined;
    if (!snapshot) return;
    this.writing = this.writing.then(async () => {
      const tmp = path.join(this.cwd, `progress.${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
      await rename(tmp, path.join(this.cwd, 'progress.json'));
    }).catch(() => undefined); // Progress I/O must not interrupt artifact generation.
  }
  async close(progress: ExecutionProgress): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.pending = structuredClone(progress); this.enqueue();
    await this.writing;
  }
}

/** Treat persisted progress as untrusted data and return only this bounded public contract. */
export async function readExecutionProgress(cwd: string): Promise<ExecutionProgress | undefined> {
  try {
    const file = path.join(cwd, 'progress.json'), info = await lstat(file);
    if (!info.isFile() || info.size > 32_768) return undefined;
    const data = await readFile(file, 'utf8');
    if (data.length > 32_768) return undefined;
    const value = record(JSON.parse(data));
    const startedAt = dateValue(value?.startedAt), updatedAt = dateValue(value?.updatedAt);
    if (!value || !startedAt || !updatedAt) return undefined;
    return {
      startedAt, updatedAt, message: publicText(value.message), completedActions: counter(value.completedActions), failedActions: counter(value.failedActions),
      activeActions: (Array.isArray(value.activeActions) ? value.activeActions : []).slice(0, MAX_ACTIVE).flatMap(raw => {
        const action = record(raw), id = idValue(action?.id), startedAt = dateValue(action?.startedAt), label = publicText(action?.label, 80);
        return id && startedAt && label ? [{ id, startedAt, label }] : [];
      }),
      agents: (Array.isArray(value.agents) ? value.agents : []).slice(0, MAX_AGENTS).flatMap((raw, index) => {
        const agent = record(raw), id = idValue(agent?.id), status = agentStatus(agent?.status);
        return id && status ? [{ id, label: `子代理 ${index + 1}`, status }] : [];
      }),
    };
  } catch { return undefined; }
}
