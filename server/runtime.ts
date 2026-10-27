import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { ModelConfig, ModelOption, RuntimeInfo } from '../shared/types.ts';
import { readModelCatalog } from './model-catalog.ts';

const execute = promisify(execFile);
export async function getRuntimeDefaults(): Promise<{ config: ModelConfig; runtime: RuntimeInfo; models: ModelOption[]; modelCatalogError?: string }> {
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
  let models: ModelOption[] = [], modelCatalogError: string | undefined;
  if (codexAvailable) {
    try { models = await readModelCatalog(); }
    catch (cause) { modelCatalogError = cause instanceof Error ? cause.message : '无法读取本地 Codex 模型列表。'; }
  } else modelCatalogError = error;
  return {
    models, modelCatalogError,
    config: {
      model: typeof local.model === 'string' ? local.model : (models.find(model => model.isDefault) || models[0])?.model || '',
      reasoningEffort: 'high',
      provider: typeof local.model_provider === 'string' ? local.model_provider : undefined,
      cliVersion: version,
    },
    runtime: { codexAvailable, authenticated, version, error },
  };
}
