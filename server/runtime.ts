import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { ModelConfig, RuntimeInfo } from '../shared/types.ts';

const execute = promisify(execFile);
export async function getRuntimeDefaults(): Promise<{ config: ModelConfig; runtime: RuntimeInfo }> {
  let local: Record<string, unknown> = {};
  try { local = parse(await readFile(path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'config.toml'), 'utf8')); } catch { /* Unconfigured CLI remains visible in health. */ }
  let version = '', authenticated = false, error: string | undefined;
  let codexAvailable = false;
  try {
    const result = await execute('codex', ['--version'], { timeout: 10_000 });
    version = result.stdout.trim(); codexAvailable = true;
    const login = await execute('codex', ['login', 'status'], { timeout: 10_000 });
    authenticated = /logged in/i.test(login.stdout + login.stderr);
    if (!authenticated) error = '请先在本机运行 codex login。';
  } catch (cause) { error = codexAvailable ? '无法确认 Codex 登录状态，请运行 codex login status。' : '未找到 Codex CLI。请安装并登录后重启服务。'; }
  return {
    config: {
      model: typeof local.model === 'string' ? local.model : '',
      reasoningEffort: typeof local.model_reasoning_effort === 'string' ? local.model_reasoning_effort : 'medium',
      provider: typeof local.model_provider === 'string' ? local.model_provider : undefined,
      cliVersion: version,
    },
    runtime: { codexAvailable, authenticated, version, error },
  };
}
