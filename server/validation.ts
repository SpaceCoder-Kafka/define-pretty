import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function chromeExecutable(): Promise<string | undefined> {
  const paths = [
    process.env.DEFINE_PRETTY_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of paths) {
    try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ }
  }
  return undefined;
}

/** Reject symlinks and non-static outputs before handing generated code to a browser. */
export async function inspectWebsite(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('生成页面包含符号链接，不能作为静态产物预览。');
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) files.push(path.relative(directory, target));
      if (files.length > 500) throw new Error('生成产物超过 500 个文件，超出静态网页实验范围。');
    }
  }
  await walk(directory);
  if (!files.includes('index.html')) throw new Error('缺少 website/index.html。');
  return files.sort();
}
