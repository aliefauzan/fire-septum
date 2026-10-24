// Vite dev/preview middleware for the forecast register (pre-registered forecasts).
//   GET  /api/register                       → every entry in data/register/
//   POST /api/register        {entry}        → store a new sealed forecast (never overwritten)
//   POST /api/register/score  {receiptSha256, score} → attach the score once
// Entries are plain JSON files, so the register can be published with the code and
// anyone can re-check it: the receipt hash, the signature, the .ots proof and the re-run.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const DIR = join(process.cwd(), 'data', 'register');
const HEX64 = /^[0-9a-f]{64}$/;

/** Same canonical JSON as src/sim/receipt.ts: sorted keys, undefined dropped. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const fileFor = (hash: string) => readdirSync(DIR).find((f) => f.endsWith(`_${hash.slice(0, 16)}.json`));

// Serverless hosts have a read-only filesystem: the register can be read there, but entries are
// added and scored from a local run and published with the code.
const READ_ONLY = !!process.env.VERCEL;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) return typeof pre === 'string' ? JSON.parse(pre || '{}') : (pre as Record<string, unknown>) ?? {};
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4_000_000) throw new Error('body too large'); }
  return JSON.parse(body || '{}');
}

export function registerHandler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/api/register' && path !== '/api/register/score') return next();
  res.setHeader('content-type', 'application/json');
  const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  (async () => {
    if (!READ_ONLY) mkdirSync(DIR, { recursive: true });
    if (req.method === 'GET' && path === '/api/register') {
      const entries = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
      return send(200, { entries });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (READ_ONLY) return send(405, { error: 'The hosted register is read-only. Run Fire Septum locally to seal or score a forecast; entries are published with the code.' });
    const body = await readJson(req);
    if (path === '/api/register') {
      const e = body.entry as { kind?: string; issuedAt?: string; record?: { receipt?: unknown; receiptSha256?: string } } | undefined;
      const hash = String(e?.record?.receiptSha256 ?? '');
      if ((e?.kind !== 'fireseptum.preregistered-forecast' && e?.kind !== 'sekatapi.preregistered-forecast') || !HEX64.test(hash) || !e.issuedAt || Number.isNaN(Date.parse(e.issuedAt))) return send(400, { error: 'not a register entry' });
      // The record must hash to what it claims, so a stored entry is self-consistent.
      if (createHash('sha256').update(canonical(e.record!.receipt)).digest('hex') !== hash) return send(400, { error: 'receipt does not match its hash' });
      if (fileFor(hash)) return send(409, { error: 'already registered' });
      const name = `${e.issuedAt.slice(0, 13).replace(/[-:T]/g, '')}_${hash.slice(0, 16)}.json`;
      writeFileSync(join(DIR, name), JSON.stringify(e, null, 1));
      return send(200, { ok: true, file: `data/register/${name}` });
    }
    const hash = String(body.receiptSha256 ?? '');
    const f = HEX64.test(hash) ? fileFor(hash) : undefined;
    if (!f) return send(404, { error: 'unknown forecast' });
    const entry = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    // A score is written once. Anyone can recompute it from FIRMS; nobody can quietly replace it.
    if (entry.score) return send(409, { error: 'already scored', score: entry.score });
    entry.score = body.score;
    writeFileSync(join(DIR, f), JSON.stringify(entry, null, 1));
    return send(200, { ok: true });
  })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
}

export function registerStore(): Plugin {
  return {
    name: 'forecast-register',
    configureServer(server) { server.middlewares.use(registerHandler); },
    configurePreviewServer(server) { server.middlewares.use(registerHandler); },
  };
}
