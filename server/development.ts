import type { LocalServiceOptions } from './core.ts';
import { resourceRoot } from './paths.ts';

export const configureDevelopmentFrontend: NonNullable<LocalServiceOptions['configureFrontend']> = async (app, server) => {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: resourceRoot, server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/.data/**'] } }, appType: 'spa' });
  app.use(vite.middlewares);
  return async () => {
    // Vite 7 can leave pending transforms waiting on its optimizer if closed
    // mid-crawl. Let the current import crawl settle before cancelling builds.
    await vite.environments.client.waitForRequestsIdle();
    await vite.close();
  };
};
