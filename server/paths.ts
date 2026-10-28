import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source modules and compiled modules have the same layout relative to their assets.
export const resourceRoot = fileURLToPath(new URL('../', import.meta.url));
export const bundledWebDirectory = path.join(resourceRoot, 'visual-cards');
export const bundledWebsiteDirectory = path.join(resourceRoot, 'public', 'builtin-websites');
export const bundledOnboardingDirectory = path.join(resourceRoot, 'resources', 'onboarding', 'v1');

export function defaultDataDirectory(platform = process.platform, home = homedir(), env = process.env): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Define Pretty');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Define Pretty');
  const dataHome = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
  return path.join(dataHome, 'define-pretty');
}
