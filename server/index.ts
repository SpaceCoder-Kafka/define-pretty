import { DimensionHighlights } from './dimension-highlights.ts';
import { VisualComparisons } from './visual-comparison.ts';
import { SpecGenerator } from './specs.ts';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { createApp, createPreviewApp, errorHandler } from './http.ts';
import { FileStore } from './store.ts';
import { Runner } from './runner.ts';
import { getRuntimeDefaults } from './runtime.ts';
import { acquireDataDirectoryLock } from './data-lock.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FeatureTests } from './feature-tests.ts';
import { FeatureCompletions } from './feature-completions.ts';

function port(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw new Error('本地端口必须是 1024–65535 的整数。');
  return number;
}

async function listen(server: Server, number: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(number, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function startServers() {
  const consolePort = port(process.env.DEFINE_PRETTY_PORT, 4173);
  const previewPort = port(process.env.DEFINE_PRETTY_PREVIEW_PORT, 4174);
  if (consolePort === previewPort) throw new Error('控制台与网页预览必须使用不同端口。');
  const previewOrigin = `http://127.0.0.1:${previewPort}`;
  const store = new FileStore(process.env.DEFINE_PRETTY_DATA_DIR || path.resolve('.data'));
  const dataLock = await acquireDataDirectoryLock(store.root);
  let startup;
  try {
    await store.initialize();
    startup = await getRuntimeDefaults();
  } catch (error) {
    await dataLock.release();
    throw error;
  }
  const { config, runtime } = startup;
  const featureBoards = new FeatureBoards(store);
  try { await featureBoards.initialize(); } catch (error) { await dataLock.release(); throw error; }
  const featureTests = new FeatureTests(featureBoards, path.resolve(process.env.DEFINE_PRETTY_SOURCE_DATA_DIR || '.data'), previewOrigin);
  try { await featureTests.initialize(); } catch (error) { await dataLock.release(); throw error; }
  const featureCompletions = new FeatureCompletions(featureBoards, store);
  try { await featureCompletions.initialize(); } catch (error) { await dataLock.release(); throw error; }
  const runner = new Runner({ store, previewOrigin });
  const generator = new SpecGenerator(store);
  const comparisons = new VisualComparisons(store, consolePort);
  const highlights = new DimensionHighlights(store, comparisons);
  const app = createApp({ featureCompletions, featureTests, featureBoards, highlights, comparisons, store, runner, generator, consolePort, previewOrigin, config, runtime });
  const server = createServer(app);
  const previewServer = createServer(createPreviewApp(store, consolePort, featureTests));
  let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
  try {
    if (process.env.NODE_ENV === 'production') {
      const directory = path.resolve(process.env.DEFINE_PRETTY_DIST_DIR || 'dist');
      app.use(express.static(directory));
      app.get('/{*path}', (_req, res) => res.sendFile(path.join(directory, 'index.html')));
    } else {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({ server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/.data/**'] } }, appType: 'spa' });
      app.use(vite.middlewares);
    }
    app.use(errorHandler);
    await listen(previewServer, previewPort);
    await listen(server, consolePort);
  } catch (error) {
    await Promise.all([close(server), close(previewServer), vite?.close()]);
    await highlights.shutdown();
    await comparisons.shutdown();
    await runner.shutdown();
    await generator.shutdown();
    await featureTests.shutdown();
    await featureCompletions.shutdown();
    await featureBoards.shutdown();
    await dataLock.release();
    throw error;
  }
  console.log(`\n  Define Pretty  →  http://127.0.0.1:${consolePort}\n  网页预览       →  ${previewOrigin}\n  本地数据       →  ${store.root}\n`);
  if (!runtime.codexAvailable || !runtime.authenticated) console.warn(`  Codex: ${runtime.error || '当前不可运行，请检查安装与登录状态。'}\n`);
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    try {
      await highlights.shutdown();
      await comparisons.shutdown();
      await runner.shutdown();
      await generator.shutdown();
      await featureTests.shutdown();
      await featureCompletions.shutdown();
      await featureBoards.shutdown();
      await vite?.close();
      await Promise.all([close(server), close(previewServer)]);
    } finally { await dataLock.release(); }
  })();
  return { app, server, previewServer, store, runner, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServers().then(({ shutdown }) => {
    const stop = () => { void shutdown().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
