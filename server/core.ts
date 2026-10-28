import { createServer, type Server } from 'node:http';
import { access } from 'node:fs/promises';
import path from 'node:path';
import express, { type Express } from 'express';
import { createApp, createPreviewApp, errorHandler } from './http.ts';
import { FileStore } from './store.ts';
import { getRuntimeDefaults } from './runtime.ts';
import { acquireDataDirectoryLock } from './data-lock.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FeatureTests } from './feature-tests.ts';
import { FeatureCompletions } from './feature-completions.ts';
import { bundledOnboardingDirectory, bundledWebDirectory, bundledWebsiteDirectory } from './paths.ts';

export interface LocalServiceOptions {
  dataDirectory: string;
  sourceDataDirectory?: string;
  /** Omit to find an available port starting at 4193/4194; use 0 for an OS-assigned port. */
  consolePort?: number;
  previewPort?: number;
  webDirectory?: string;
  builtinDirectory?: string;
  onboardingDirectory?: string;
  /** Host adapter, used by the development entry point for Vite middleware. */
  configureFrontend?: (app: Express, server: Server) => Promise<() => Promise<void>>;
  loadRuntime?: typeof getRuntimeDefaults;
}

export interface LocalService {
  consoleOrigin: string;
  previewOrigin: string;
  dataDirectory: string;
  runtime: Awaited<ReturnType<typeof getRuntimeDefaults>>['runtime'];
  shutdown(): Promise<void>;
}

async function listen(server: Server, requested: number | undefined, preferred: number, excluded?: number): Promise<number> {
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 0 || requested > 65535 || (requested > 0 && requested < 1024))) {
    throw new Error('本地端口必须是 1024–65535 的整数，或由运行核心使用 0 自动分配。');
  }
  const first = requested ?? preferred;
  for (let candidate = first; candidate <= Math.min(65535, first + (requested === undefined ? 49 : 0)); candidate += 1) {
    if (candidate !== 0 && candidate === excluded) continue;
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        server.listen(candidate, '127.0.0.1');
      });
      return (server.address() as { port: number }).port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      if (requested !== undefined) throw new Error(`本地端口 ${requested} 已被占用，请关闭占用程序或选择另一个端口。`, { cause: error });
    }
  }
  throw new Error(`无法找到可用的本地端口，请通过启动参数指定端口（从 ${preferred} 开始查找）。`);
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

/** Local execution service. Importing it does not start servers, open a browser, or install signal handlers. */
export async function startLocalService(options: LocalServiceOptions): Promise<LocalService> {
  if (options.consolePort !== undefined && options.consolePort !== 0 && options.consolePort === options.previewPort) {
    throw new Error('控制台与网页预览必须使用不同端口。');
  }
  const dataDirectory = path.resolve(options.dataDirectory);
  const webDirectory = path.resolve(options.webDirectory ?? bundledWebDirectory);
  if (!options.configureFrontend) {
    try { await access(path.join(webDirectory, 'index.html')); }
    catch { throw new Error(`未找到已构建的界面：${webDirectory}。源码用户请先运行 npm run build；发布包用户请重新安装。`); }
  }
  // Lock before binding or recovering records: another instance must not mutate active work.
  const dataLock = await acquireDataDirectoryLock(dataDirectory);
  let stopping = false;
  let consoleApp: Express | undefined, previewApp: Express | undefined;
  const server = createServer((req, res) => {
    if (!consoleApp || stopping) { res.writeHead(503).end('本地服务正在启动或关闭。'); return; }
    consoleApp(req, res);
  });
  const previewServer = createServer((req, res) => {
    if (!previewApp || stopping) { res.writeHead(503).end('本地服务正在启动或关闭。'); return; }
    previewApp(req, res);
  });
  let boards: FeatureBoards | undefined, tests: FeatureTests | undefined, completions: FeatureCompletions | undefined;
  let closeFrontend: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    stopping = true;
    const results = await Promise.allSettled([
      tests?.shutdown(), completions?.shutdown(), boards?.shutdown(),
      closeFrontend?.(), close(server), close(previewServer),
    ]);
    await dataLock.release();
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, '关闭本地服务时发生错误。');
  })();

  try {
    const consolePort = await listen(server, options.consolePort, 4193, options.previewPort);
    const previewPort = await listen(previewServer, options.previewPort, 4194, consolePort);
    const consoleOrigin = `http://127.0.0.1:${consolePort}`, previewOrigin = `http://127.0.0.1:${previewPort}`;
    const store = new FileStore(dataDirectory);
    await store.initialize();
    const startup = await (options.loadRuntime ?? getRuntimeDefaults)();
    boards = new FeatureBoards(store);
    await boards.initialize();
    tests = new FeatureTests(boards, path.resolve(options.sourceDataDirectory ?? dataDirectory), previewOrigin, undefined, undefined, undefined, options.builtinDirectory ?? bundledWebsiteDirectory);
    await tests.initialize();
    completions = new FeatureCompletions(boards, store);
    await completions.initialize();
    const onboardingDirectory = options.onboardingDirectory ?? bundledOnboardingDirectory;
    const app = createApp({ featureCompletions: completions, featureTests: tests, featureBoards: boards, store, consolePort, previewOrigin, onboardingDirectory, ...startup });
    if (options.configureFrontend) closeFrontend = await options.configureFrontend(app, server);
    else {
      app.use(express.static(webDirectory));
      app.get('/{*path}', (_req, res) => res.sendFile(path.join(webDirectory, 'index.html')));
    }
    app.use(errorHandler);
    previewApp = createPreviewApp(consolePort, tests, onboardingDirectory);
    consoleApp = app;
    return { consoleOrigin, previewOrigin, dataDirectory, runtime: startup.runtime, shutdown };
  } catch (error) {
    try { await shutdown(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], '本地服务启动失败，清理时发生错误。'); }
    throw error;
  }
}
