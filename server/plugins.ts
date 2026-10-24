// Vite plugins for the submissions store and the scoreboard index. The handlers import app code
// from src/ (extensionless TypeScript imports), so they are loaded through Vite's module runner on
// first use instead of being imported by vite.config.ts itself (which must stay loadable by
// Node's native config loader).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { runnerImport, type Plugin } from 'vite';

type Handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

function load<T>(file: string): Promise<T> {
  return runnerImport<T>(join(process.cwd(), 'server', file), { configFile: false, logLevel: 'silent' }).then((r) => r.module);
}

function lazyMiddleware(file: string, name: string): Handler {
  let h: Promise<Handler> | null = null;
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/api/submissions') && !path.startsWith('/api/scoreboard')) return next();
    (h ??= load<Record<string, Handler>>(file).then((m) => m[name])).then((f) => f(req, res, next), next);
  };
}

export function submissionsStore(): Plugin {
  const mw = lazyMiddleware('submissions.ts', 'submissionsHandler');
  return {
    name: 'forecast-submissions',
    configureServer(server) { server.middlewares.use(mw); },
    configurePreviewServer(server) { server.middlewares.use(mw); },
  };
}

const VIRTUAL = 'virtual:scoreboard-index';

/** GET /api/scoreboard, and `virtual:scoreboard-index`: the index built from data/ at build time (static deploy). */
export function scoreboardData(): Plugin {
  const mw = lazyMiddleware('scoreboard.ts', 'scoreboardHandler');
  return {
    name: 'scoreboard-index',
    resolveId: (id) => (id === VIRTUAL ? `\0${VIRTUAL}` : null),
    async load(id) {
      if (id !== `\0${VIRTUAL}`) return null;
      const { liveIndex } = await load<typeof import('./scoreboard')>('scoreboard.ts');
      // Bundled files only (never Blob): this is what the static site shows.
      return `export default ${JSON.stringify(await liveIndex({ readOnly: true, blob: null }))};`;
    },
    configureServer(server) { server.middlewares.use(mw); },
    configurePreviewServer(server) { server.middlewares.use(mw); },
  };
}
