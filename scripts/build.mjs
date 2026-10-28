import { execFileSync } from 'node:child_process';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
for (const directory of ['server', 'shared', 'resources', 'public']) {
  await rm(new URL(`../dist/${directory}`, import.meta.url), { recursive: true, force: true });
}
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.server.json'], { cwd: root, stdio: 'inherit' });
// TypeScript rewrites runtime imports, but preserves .ts specifiers in declarations.
// Consumers receive JavaScript and declarations, so expose .js specifiers in both.
for (const directory of ['server', 'shared']) {
  const base = new URL(`../dist/${directory}/`, import.meta.url);
  for (const file of await readdir(base)) {
    if (!file.endsWith('.d.ts')) continue;
    const location = new URL(file, base);
    const declaration = await readFile(location, 'utf8');
    await writeFile(location, declaration.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2'));
  }
}
await build({ root, build: { outDir: 'dist/visual-cards', emptyOutDir: true } });
await cp(new URL('../resources/onboarding', import.meta.url), new URL('../dist/resources/onboarding', import.meta.url), { recursive: true });
await cp(new URL('../public/builtin-websites', import.meta.url), new URL('../dist/public/builtin-websites', import.meta.url), { recursive: true });
