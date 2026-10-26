import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { ModelConfig, Usage } from '../shared/types.ts';
import { inspectWebsite } from './validation.ts';
import { ExecutionProgressTracker, ExecutionProgressWriter } from './execution-progress.ts';
export interface ExecutionOptions {
  run: { id: string };
  cwd: string;
  prompt: string;
  config: ModelConfig;
  referenceFile?: string;
  referenceFiles?: string[];
  signal: AbortSignal;
  outputSchema?: string;
  readOnly?: boolean;
  parallelAgents?: boolean;
}
export interface ExecutionResult { exitCode: number | null; usage?: Usage; summary?: string; error?: string }
export type Executor = (options: ExecutionOptions) => Promise<ExecutionResult>;

const execFileAsync = promisify(execFile);
/** Canonical path + content hash; timestamps and filesystem traversal order do not affect it. */
export async function hashWebsite(directory: string): Promise<string> {
  const files = await inspectWebsite(directory);
  const hash = createHash('sha256');
  for (const file of files) {
    const content = await readFile(path.join(directory, file));
    hash.update(`${file.replaceAll(path.sep, '/')}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

function killProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch { /* A cancelled process can exit between the signal check and kill. */ }
}

/** Run the installed CLI with its existing authentication and provider configuration. */
export const executeCodex: Executor = async options => {
  const version = (await execFileAsync('codex', ['--version'], { timeout: 10000 })).stdout.trim();
  if (options.config.cliVersion && version !== options.config.cliVersion) {
    throw new Error(`Codex CLI 版本已改变（记录：${options.config.cliVersion}；当前：${version}）。请刷新配置后重试。`);
  }
  if (options.signal.aborted) throw new Error('运行已取消。');
  const args = [
    'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', options.readOnly ? 'read-only' : 'workspace-write',
    '-c', 'approval_policy="never"', '-C', options.cwd,
    '--model', options.config.model, '-c', `model_reasoning_effort=${JSON.stringify(options.config.reasoningEffort)}`,
    '-o', path.join(options.cwd, 'final.txt'),
  ];
  // Generation can fetch assets and build dependencies inside its isolated work directory.
  // This does not change the network policy of the finished page's preview.
  if (!options.readOnly) args.push('-c', 'sandbox_workspace_write.network_access=true');
  if (options.parallelAgents) args.push('--enable', 'multi_agent', '-c', 'agents.enabled=true', '-c', 'agents.max_concurrent_threads_per_session=3');
  if (options.config.provider) args.push('-c', `model_provider=${JSON.stringify(options.config.provider)}`);
  if (options.outputSchema) args.push('--output-schema', options.outputSchema);
  for (const file of options.referenceFiles ?? (options.referenceFile ? [options.referenceFile] : [])) args.push('--image', file);
  args.push('--json', '--color', 'never', '-');
  await writeFile(path.join(options.cwd, 'command.json'), JSON.stringify({ executable: 'codex', args, cwd: options.cwd }, null, 2));
  const events = createWriteStream(path.join(options.cwd, 'events.jsonl'), { flags: 'a' });
  const errors = createWriteStream(path.join(options.cwd, 'stderr.log'), { flags: 'a' });
  const child = spawn('codex', args, { cwd: options.cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const progress = new ExecutionProgressTracker();
  const progressWriter = new ExecutionProgressWriter(options.cwd);
  progressWriter.schedule(progress.snapshot());
  let outcome: 'completed' | 'failed' | 'cancelled' = 'failed';
  let buffer = '';
  let usage: Usage | undefined;
  let summary: string | undefined;
  let failure: string | undefined;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const parseLine = (line: string) => {
    try {
      const event = JSON.parse(line);
      if (progress.accept(event)) progressWriter.schedule(progress.snapshot());
      if (event.type === 'turn.completed') {
        if (event.usage) usage = event.usage;
        // The CLI can recover from a transient stream/provider error in the same run.
        // A later completed turn resolves earlier error events; later errors still fail.
        failure = undefined;
      }
      if (event.type === 'turn.failed') failure = typeof event.error === 'string' ? event.error : event.error?.message || 'Codex 返回 turn.failed。';
      if (event.type === 'error') failure = event.message || event.error?.message || 'Codex 返回错误事件。';
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') summary = event.item.text;
    } catch { /* Preserve non-JSON diagnostic lines without treating them as model output. */ }
  };
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    events.write(chunk);
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      parseLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => errors.write(chunk));
  // EPIPE is expected if the CLI exits while the prompt is being delivered.
  child.stdin?.on('error', () => undefined);
  const abort = () => {
    killProcessGroup(child, 'SIGTERM');
    forceKill = setTimeout(() => killProcessGroup(child, 'SIGKILL'), 2000);
    forceKill.unref();
  };
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    const result = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
      child.stdin?.end(options.prompt);
    });
    if (buffer.trim()) parseLine(buffer);
    try { summary = await readFile(path.join(options.cwd, 'final.txt'), 'utf8'); } catch { /* CLI failures may not write a final reply. */ }
    outcome = result === 0 && !failure ? 'completed' : 'failed';
    return { exitCode: result, usage, summary, ...(failure ? { error: failure } : {}) };
  } finally {
    options.signal.removeEventListener('abort', abort);
    // The parent may exit on TERM before descendants with redirected stdio do.
    // Killing the still-addressable process group here prevents those survivors.
    if (options.signal.aborted) killProcessGroup(child, 'SIGKILL');
    if (forceKill) clearTimeout(forceKill);
    progress.finish(options.signal.aborted ? 'cancelled' : outcome);
    await progressWriter.close(progress.snapshot());
    events.end(); errors.end();
    await Promise.all([finished(events), finished(errors)]);
  }
};

