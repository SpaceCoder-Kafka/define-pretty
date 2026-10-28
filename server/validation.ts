import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

export async function chromeExecutable(): Promise<string | undefined> {
  const canExecute = async (file: string) => {
    try { await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; }
    catch { return false; }
  };
  if (process.env.DEFINE_PRETTY_CHROME) {
    const file = path.resolve(process.env.DEFINE_PRETTY_CHROME);
    if (!await canExecute(file)) throw new Error(`DEFINE_PRETTY_CHROME 指向的浏览器不可执行：${file}`);
    return file;
  }
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium',
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((root): root is string => !!root)
      .flatMap(root => [path.join(root, 'Google/Chrome/Application/chrome.exe'), path.join(root, 'Microsoft/Edge/Application/msedge.exe')]),
    chromium.executablePath(),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of paths) {
    if (await canExecute(candidate)) return candidate;
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
