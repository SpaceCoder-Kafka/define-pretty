import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ModelOption } from '../shared/types.ts';

/** Read the installed CLI's catalog using its existing account and provider. No inference is started. */
export async function readModelCatalog(timeoutMs = 15_000): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server', '--listen', 'stdio://'], { shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    const models = new Map<string, ModelOption>();
    const cursors = new Set<string>();
    let settled = false, requestId = 1;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 1000);
      forceKill.unref();
      child.once('close', () => clearTimeout(forceKill));
      if (error) reject(error);
      else resolve([...models.values()]);
    };
    const timer = setTimeout(() => finish(new Error('读取本地 Codex 模型列表超时，请稍后重启服务重试。')), timeoutMs);
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const list = (cursor?: string) => send({ id: ++requestId, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
    child.on('error', () => finish(new Error('无法启动本地 Codex 模型查询。')));
    child.stdin.on('error', () => finish(new Error('本地 Codex 模型查询连接已关闭。')));
    child.on('close', () => finish(new Error('本地 Codex 在返回模型列表前退出。')));
    lines.on('line', line => {
      if (settled) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || typeof message !== 'object' || message.id !== requestId) return;
      if (message.error) return finish(new Error('本地 Codex 无法读取模型列表，请检查 CLI 配置。'));
      if (requestId === 1) {
        send({ method: 'initialized' });
        list();
        return;
      }
      const result = message.result;
      if (!Array.isArray(result?.data)) return finish(new Error('本地 Codex 返回了无效的模型列表。'));
      for (const entry of result.data) {
        if (!entry || entry.hidden || typeof entry.model !== 'string' || !entry.model || typeof entry.defaultReasoningEffort !== 'string' || !Array.isArray(entry.supportedReasoningEfforts)) continue;
        const efforts = entry.supportedReasoningEfforts.filter((option: unknown): option is { reasoningEffort: string; description?: string } => !!option && typeof option === 'object' && 'reasoningEffort' in option && typeof option.reasoningEffort === 'string' && !!option.reasoningEffort);
        if (!efforts.length) continue;
        models.set(entry.model, {
          model: entry.model, displayName: typeof entry.displayName === 'string' ? entry.displayName : entry.model,
          isDefault: entry.isDefault === true, defaultReasoningEffort: entry.defaultReasoningEffort,
          supportedReasoningEfforts: efforts.map((option: { reasoningEffort: string; description?: string }) => ({ reasoningEffort: option.reasoningEffort, description: typeof option.description === 'string' ? option.description : '' })),
        });
      }
      if (result.nextCursor != null) {
        if (typeof result.nextCursor !== 'string' || !result.nextCursor || cursors.has(result.nextCursor)) return finish(new Error('本地 Codex 模型列表分页无效。'));
        cursors.add(result.nextCursor);
        list(result.nextCursor);
      } else if (!models.size) finish(new Error('本地 Codex 未返回可选模型。'));
      else finish();
    });
    send({ id: requestId, method: 'initialize', params: { clientInfo: { name: 'define_pretty', title: 'Define Pretty', version: '0.1.0' } } });
  });
}
