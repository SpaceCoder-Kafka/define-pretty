import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startLocalService } from './core.ts';
import { launchOptions, runCLI } from './cli.ts';
import { resourceRoot } from './paths.ts';

const sourceContext = {
  development: process.env.NODE_ENV !== 'production',
  webDirectory: path.join(resourceRoot, 'dist', 'visual-cards'),
};

// Keep the source entry point for npm run dev and existing integrations.
export async function startServers() {
  return startLocalService(launchOptions({}, sourceContext));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version as string;
  runCLI(process.argv.slice(2), { ...sourceContext, version }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
