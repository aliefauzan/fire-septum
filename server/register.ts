// Vite dev/preview middleware for the forecast register (pre-registered forecasts).
//   GET  /api/register                       → every entry in data/register/
//   POST /api/register        {entry}        → store a new sealed forecast (never overwritten)
//   POST /api/register/score  {receiptSha256, score} → attach the score once
// Hosted (read-only filesystem) the register is the bundled files, plus Vercel Blob when
// BLOB_READ_WRITE_TOKEN is set; the write-once rules are the same (server/store.ts).
// Entries are plain JSON files, so the register can be published with the code and
// anyone can re-check it: the receipt hash, the signature, the .ots proof and the re-run.
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { blobFromEnv, collection, type BlobLike, type Collection } from './store.ts';

const HEX64 = /^[0-9a-f]{64}$/;
const READ_ONLY_ERROR = 'The hosted register is read-only. Run Fire Septum locally to seal or score a forecast; entries are published with the code.';

/** Same canonical JSON as src/sim/receipt.ts: sorted keys, undefined dropped. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

interface StoredEntry { kind?: string; issuedAt?: string; record?: { receipt?: unknown; receiptSha256?: string }; score?: unknown }

/** File name of an entry: <UTC hour>_<first 16 hex digits of the receipt hash>.json. */
export const entryFileName = (issuedAt: string, hash: string) => `${issuedAt.slice(0, 13).replace(/[-:T]/g, '')}_${hash.slice(0, 16)}.json`;

/**
 * The register store. Serverless hosts have a read-only filesystem: there the register is the
 * bundled files, plus Vercel Blob when BLOB_READ_WRITE_TOKEN is set (server/store.ts).
 */
export function registerCollection(o: { root?: string; readOnly?: boolean; blob?: BlobLike | null } = {}): Collection<StoredEntry> {
  return collection<StoredEntry>({
    dir: join(o.root ?? process.cwd(), 'data', 'register'), rel: 'data/register', prefix: 'register',
    hashOf: (e) => String(e.record?.receiptSha256 ?? ''),
    readOnly: o.readOnly ?? !!process.env.VERCEL,
    blob: o.blob === undefined ? blobFromEnv() : o.blob,
    readOnlyError: READ_ONLY_ERROR,
  });
}

export async function readJson(req: IncomingMessage, limit = 4_000_000): Promise<Record<string, unknown>> {
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) return typeof pre === 'string' ? JSON.parse(pre || '{}') : (pre as Record<string, unknown>) ?? {};
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > limit) throw new Error('body too large'); }
  return JSON.parse(body || '{}');
}

/** Checks a new entry: kind, receipt hash, issue time. Returns an error message or null. */
export function checkEntry(e: StoredEntry | undefined): string | null {
  const hash = String(e?.record?.receiptSha256 ?? '');
  if ((e?.kind !== 'fireseptum.preregistered-forecast' && e?.kind !== 'sekatapi.preregistered-forecast') || !HEX64.test(hash) || !e.issuedAt || Number.isNaN(Date.parse(e.issuedAt))) return 'not a register entry';
  // The record must hash to what it claims, so a stored entry is self-consistent.
  if (createHash('sha256').update(canonical(e.record!.receipt)).digest('hex') !== hash) return 'receipt does not match its hash';
  return null;
}

export function makeRegisterHandler(getStore: () => Collection<StoredEntry>) {
  let store: Collection<StoredEntry> | null = null;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/api/register' && path !== '/api/register/score') return next();
    res.setHeader('content-type', 'application/json');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    (async () => {
      store ??= getStore();
      if (req.method === 'GET' && path === '/api/register') return send(200, { entries: await store.list() });
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      if (store.mode === 'read-only') return send(405, { error: READ_ONLY_ERROR });
      const body = await readJson(req);
      if (path === '/api/register') {
        const e = body.entry as StoredEntry | undefined;
        const bad = checkEntry(e);
        if (bad) return send(400, { error: bad });
        const hash = e!.record!.receiptSha256!;
        const r = await store.add(entryFileName(e!.issuedAt!, hash), e!);
        return r.status === 200 ? send(200, { ok: true, file: r.file }) : send(r.status, { error: r.error });
      }
      const hash = String(body.receiptSha256 ?? '');
      if (!HEX64.test(hash)) return send(404, { error: 'unknown forecast' });
      const r = await store.addScore(hash, body.score);
      return r.status === 200 ? send(200, { ok: true }) : send(r.status, 'score' in r ? { error: r.error, score: r.score } : { error: r.error });
    })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
  };
}

export const registerHandler = makeRegisterHandler(() => registerCollection());

export function registerStore(): Plugin {
  return {
    name: 'forecast-register',
    configureServer(server) { server.middlewares.use(registerHandler); },
    configurePreviewServer(server) { server.middlewares.use(registerHandler); },
  };
}
