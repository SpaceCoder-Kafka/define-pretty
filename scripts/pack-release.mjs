import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function packRelease() {
  if (!process.env.npm_execpath) throw new Error('请通过 npm run pack:release 或 npm run test:package 运行。');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = path.join(root, '.release');
  await mkdir(output, { recursive: true });
  await execute(process.execPath, [process.env.npm_execpath, 'run', 'build'], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  // Keep lifecycle output separate from npm's JSON manifest (npm versions differ here).
  const { stdout } = await execute(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const [manifest] = JSON.parse(stdout);
  const artifact = path.join(output, 'define-pretty.tgz');
  await copyFile(path.join(output, manifest.filename), artifact);
  const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
  await writeFile(path.join(output, 'SHA256SUMS'), `${digest}  define-pretty.tgz\n`);
  console.log(`发布包：${artifact}（${(manifest.size / 1024 / 1024).toFixed(1)} MiB）`);
  return { artifact, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await packRelease();
}
