// The scoreboard's data: a compact index of the register and the submissions (src/sim/scoreboard.ts).
//   GET /api/scoreboard          → the index from the live stores (files, plus Vercel Blob when hosted)
//   import 'virtual:scoreboard-index'  → the same index built from data/ at build time, so the
//                                  scoreboard works on a static deploy without any API (server/plugins.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { boardIndex } from '../src/sim/scoreboard';
import type { RegisterEntry } from '../src/sim/register';
import type { ForecastSubmission } from '../src/sim/submission';
import { registerCollection } from './register';
import { submissionsCollection } from './submissions';

export async function liveIndex(o: { root?: string; readOnly?: boolean; blob?: null } = {}) {
  const [entries, subs] = await Promise.all([registerCollection(o).list(), submissionsCollection(o).list()]);
  return boardIndex(entries as unknown as RegisterEntry[], subs as ForecastSubmission[]);
}

export function scoreboardHandler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if ((req.url ?? '').split('?')[0] !== '/api/scoreboard') return next();
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error: 'method not allowed' })); return; }
  liveIndex().then(
    (ix) => res.end(JSON.stringify(ix)),
    (e) => { res.statusCode = 500; res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); },
  );
}
