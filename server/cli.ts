import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { startLocalService, type LocalService, type LocalServiceOptions } from './core.ts';
import { configureDevelopmentFrontend } from './development.ts';
import { defaultDataDirectory, resourceRoot } from './paths.ts';
import { getRuntimeDefaults } from './runtime.ts';
import { chromeExecutable } from './validation.ts';

interface Arguments {
  port?: number; previewPort?: number; dataDirectory?: string; sourceDataDirectory?: string;
  open?: boolean; help?: boolean; version?: boolean; doctor?: boolean; installBrowser?: boolean;
}
interface LaunchContext { development?: boolean; version?: string; env?: NodeJS.ProcessEnv; webDirectory?: string }

function port(value: string, flag: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error(`${flag} 必须是 1024–65535 的整数。`);
  return Number(value);
}

export function parseArguments(argv: string[]): Arguments {
  const result: Arguments = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--version' || argument === '-v') result.version = true;
    else if (argument === '--no-open') result.open = false;
    else if (argument === '--doctor') result.doctor = true;
    else if (argument === '--install-browser') result.installBrowser = true;
    else if (['--port', '--preview-port', '--data-dir', '--source-data-dir'].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} 缺少参数。运行 define-pretty --help 查看用法。`);
      if (argument === '--port') result.port = port(value, argument);
      else if (argument === '--preview-port') result.previewPort = port(value, argument);
      else if (argument === '--data-dir') result.dataDirectory = value;
      else result.sourceDataDirectory = value;
    } else throw new Error(`未知参数：${argument}。运行 define-pretty --help 查看用法。`);
  }
  return result;
}

export function launchOptions(args: Arguments, context: LaunchContext = {}): LocalServiceOptions {
  const env = context.env ?? process.env;
  const dataDirectory = path.resolve(args.dataDirectory || env.DEFINE_PRETTY_DATA_DIR || (context.development ? path.join(resourceRoot, '.data', 'visual-cards') : defaultDataDirectory(process.platform, undefined, env)));
  const source = args.sourceDataDirectory || env.DEFINE_PRETTY_SOURCE_DATA_DIR;
  return {
    dataDirectory,
    sourceDataDirectory: source ? path.resolve(source) : context.development ? path.join(resourceRoot, '.data') : dataDirectory,
    consolePort: args.port ?? (env.DEFINE_PRETTY_PORT ? port(env.DEFINE_PRETTY_PORT, 'DEFINE_PRETTY_PORT') : undefined),
    previewPort: args.previewPort ?? (env.DEFINE_PRETTY_PREVIEW_PORT ? port(env.DEFINE_PRETTY_PREVIEW_PORT, 'DEFINE_PRETTY_PREVIEW_PORT') : undefined),
    webDirectory: env.DEFINE_PRETTY_DIST_DIR ? path.resolve(env.DEFINE_PRETTY_DIST_DIR) : context.webDirectory,
    configureFrontend: context.development ? configureDevelopmentFrontend : undefined,
  };
}

const help = `Define Pretty — 本地视觉参考工作台

用法：define-pretty [选项]

  --no-open                 启动服务，但不自动打开浏览器
  --port <端口>             固定控制台端口（默认从 4193 寻找可用端口）
  --preview-port <端口>     固定预览端口（默认从 4194 寻找可用端口）
  --data-dir <目录>         指定数据目录（默认使用固定的用户数据目录）
  --source-data-dir <目录>  只读导入旧实验数据的目录
  --doctor                  检查 Codex 登录、模型列表和截图浏览器后退出
  --install-browser         安装匹配版本的 Chromium 后启动工作台
  -v, --version             显示版本
  -h, --help                显示帮助

需要 Node.js >= 22.12。真实生成任务需要已安装并登录的 Codex CLI。
未登录也能浏览内置使用指引；截图与网页验证需要 Chrome、Edge 或 Chromium。
保持当前终端运行；按 Ctrl+C 安全停止。`;

async function installBrowser(): Promise<void> {
  const require = createRequire(import.meta.url);
  const executable = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [executable, 'install', 'chromium'], { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Chromium 安装失败，请检查网络后重试 --install-browser。')));
  });
}

async function inspectBrowser(): Promise<boolean> {
  try {
    const executable = await chromeExecutable();
    if (executable) { console.log(`  截图浏览器     →  ${executable}`); return true; }
    console.warn('  截图浏览器不可用。安装 Chrome / Edge，或使用相同启动命令加 --install-browser 安装 Chromium。');
  } catch (error) { console.warn(`  截图浏览器：${error instanceof Error ? error.message : error}`); }
  return false;
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export async function runCLI(argv = process.argv.slice(2), context: LaunchContext = {}): Promise<void> {
  const args = parseArguments(argv);
  if (args.help) { console.log(help); return; }
  if (args.version) {
    console.log(context.version ?? JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version);
    return;
  }
  const options = launchOptions(args, context);
  if (args.installBrowser) await installBrowser();
  if (args.doctor) {
    const startup = await getRuntimeDefaults();
    console.log(`  Node.js        →  ${process.version}\n  本地数据       →  ${options.dataDirectory}\n  Codex          →  ${startup.runtime.version || '未安装'}`);
    console.log(`  Codex 登录     →  ${startup.runtime.authenticated ? '已登录' : startup.runtime.error || '未登录'}`);
    if (startup.modelCatalogError) console.warn(`  模型列表：${startup.modelCatalogError}`);
    else console.log(`  可选模型       →  ${startup.models.length} 个`);
    const browserReady = await inspectBrowser();
    if (!startup.runtime.authenticated || !browserReady || startup.modelCatalogError) process.exitCode = 1;
    return;
  }
  console.log('  正在启动 Define Pretty，检查本机 Codex 配置…');
  let service: LocalService | undefined, stopping = false;
  const removeSignals = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); };
  const finish = async () => {
    try { await service?.shutdown(); }
    catch (error) { console.error(error); process.exitCode = 1; }
    finally { removeSignals(); }
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\n  正在停止任务并保存记录…');
    if (service) void finish();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    service = await startLocalService(options);
    if (stopping) { await finish(); return; }
    console.log(`\n  Define Pretty  →  ${service.consoleOrigin}\n  网页预览       →  ${service.previewOrigin}\n  本地数据       →  ${service.dataDirectory}\n`);
    if (!service.runtime.codexAvailable || !service.runtime.authenticated) console.warn(`  Codex：${service.runtime.error || '请检查安装与登录状态。'} 可先体验内置使用指引。`);
    await inspectBrowser();
    console.log('\n  保持当前终端运行，按 Ctrl+C 停止。\n');
    if (!stopping && args.open !== false && !context.development) {
      await openBrowser(service.consoleOrigin).catch(() => console.warn(`  未能自动打开浏览器，请手动访问 ${service!.consoleOrigin}`));
    }
  } catch (error) {
    removeSignals();
    await service?.shutdown();
    throw error;
  }
}
