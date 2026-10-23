// Vercel serverless entry: every /api/* request lands here and is passed down the same
// handlers the Vite dev server uses (server/), so hosted and local behave alike.
//   /api/firms, /api/osm, /api/osm-resources   live data (needs FIRMS_MAP_KEY for hotspots)
//   /api/receipt/key|sign|anchor               Ed25519 signing (RECEIPT_ED25519_KEY) and OpenTimestamps
//   /api/register[/score]                      forecast register (read-only when hosted)
//   /api/brief                                 LLM situation brief (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { briefHandler } from '../server/brief';
import { firmsHandler, osmHandler } from '../server/firmsProxy';
import { receiptHandler } from '../server/receipt';
import { registerHandler } from '../server/register';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>;

const chain: Handler[] = [
  firmsHandler(() => process.env.FIRMS_MAP_KEY),
  osmHandler(),
  receiptHandler(() => process.env.RECEIPT_ED25519_KEY),
  registerHandler,
  briefHandler(() => ({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL })),
];

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
    let i = 0;
    const next = (): void => {
      const h = chain[i++];
      if (!h) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: `no handler for ${(req.url ?? '').split('?')[0]}` }));
        return;
      }
      Promise.resolve(h(req, res, next)).catch((e) => {
        if (res.headersSent) { res.end(); return; }
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      });
    };
    next();
  });
}
