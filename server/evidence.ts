// Store for carbon-project reversal evidence (src/sim/evidence.ts), same pattern as the forecast
// register (server/register.ts).
//   GET  /api/evidence            → every stored evidence bundle in data/evidence/
//   POST /api/evidence {bundle}   → store a sealed bundle; never overwritten (409 when it exists)
// Bundles are plain JSON, published with the code, so anyone can re-check the hash, the
// signature, the .ots proof and the FIRMS rows. Read-only on serverless hosts.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const DIR = join(process.cwd(), 'data', 'evidence');
const HEX64 = /^[0-9a-f]{64}$/;
const READ_ONLY = !!process.env.VERCEL;

/** Same canonical JSON as src/sim/receipt.ts: sorted keys, undefined dropped. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) return typeof pre === 'string' ? JSON.parse(pre || '{}') : (pre as Record<string, unknown>) ?? {};
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) throw new Error('body too large'); }
  return JSON.parse(body || '{}');
}

const list = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : []);

export function evidenceHandler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/api/evidence') return next();
  res.setHeader('content-type', 'application/json');
  const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  (async () => {
    if (req.method === 'GET') return send(200, { entries: list().map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'))) });
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (READ_ONLY) return send(405, { error: 'The hosted evidence store is read-only. Download the JSON, or run Fire Septum locally to keep evidence in data/evidence/.' });
    const body = await readJson(req);
    const b = body.bundle as { evidence?: { kind?: string; createdAt?: string; project?: { id?: string } }; evidenceSha256?: string } | undefined;
    const hash = String(b?.evidenceSha256 ?? '');
    const e = b?.evidence;
    const pid = String(e?.project?.id ?? '');
    if (e?.kind !== 'fireseptum.reversal-evidence' || !HEX64.test(hash) || !e.createdAt || Number.isNaN(Date.parse(e.createdAt)) || !/^[a-z0-9-]{1,32}$/.test(pid)) return send(400, { error: 'not a reversal evidence bundle' });
    if (createHash('sha256').update(canonical(e)).digest('hex') !== hash) return send(400, { error: 'evidence does not match its hash' });
    mkdirSync(DIR, { recursive: true });
    if (list().some((f) => f.endsWith(`_${hash.slice(0, 16)}.json`))) return send(409, { error: 'already stored' });
    const name = `${e.createdAt.slice(0, 13).replace(/[-:T]/g, '')}_${pid}_${hash.slice(0, 16)}.json`;
    writeFileSync(join(DIR, name), JSON.stringify(b, null, 1), { flag: 'wx' });
    return send(200, { ok: true, file: `data/evidence/${name}` });
  })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
}

export function evidenceStore(): Plugin {
  return {
    name: 'reversal-evidence',
    configureServer(server) { server.middlewares.use(evidenceHandler); },
    configurePreviewServer(server) { server.middlewares.use(evidenceHandler); },
  };
}
