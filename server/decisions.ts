// Vite dev/preview middleware (and Vercel handler) for sealed decision records.
//   GET  /api/decisions                                  → every record in data/decisions/
//   POST /api/decisions          {record}                → store a sealed decision (never overwritten)
//   POST /api/decisions/cosign   {decisionSha256, cosignature} → append a verified co-signature
// Same rules as the forecast register (server/register.ts): plain JSON files published with
// the code, a stored decision is never replaced, and the hosted copy is read-only. A
// co-signature can only be added, never removed, and only if it verifies.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const DIR = join(process.cwd(), 'data', 'decisions');
const HEX64 = /^[0-9a-f]{64}$/;
const ROLES = ['forecaster', 'commander', 'bpbd'];
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

const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const list = () => { try { return readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(); } catch { return []; } };
const fileFor = (hash: string) => list().find((f) => f.endsWith(`_${hash.slice(0, 16)}.json`));

interface Cosig { role?: string; name?: string; alg?: string; publicKey?: string; keyId?: string; signedAt?: string; scheme?: string; sig?: string }

/** Same check as verifyCosignature in src/sim/receipt.ts, with node:crypto. */
function cosignatureValid(hash: string, c: Cosig): boolean {
  try {
    if (c.alg !== 'Ed25519' || c.scheme !== 'fireseptum-cosign-v1' || !ROLES.includes(String(c.role)) || !c.signedAt || !c.name) return false;
    const pub = Buffer.from(String(c.publicKey), 'base64');
    if (pub.length !== 32 || sha256(pub).slice(0, 16) !== c.keyId) return false;
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') }, format: 'jwk' });
    return verify(null, Buffer.from(`fireseptum-cosign-v1:${hash}:${c.role}:${c.signedAt}`), key, Buffer.from(String(c.sig), 'base64'));
  } catch { return false; }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) return typeof pre === 'string' ? JSON.parse(pre || '{}') : (pre as Record<string, unknown>) ?? {};
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 200_000) throw new Error('body too large'); }
  return JSON.parse(body || '{}');
}

export function decisionsHandler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/api/decisions' && path !== '/api/decisions/cosign') return next();
  res.setHeader('content-type', 'application/json');
  const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  (async () => {
    if (req.method === 'GET' && path === '/api/decisions') {
      return send(200, { records: list().map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'))) });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (READ_ONLY) return send(405, { error: 'The hosted decision log is read-only. Run Fire Septum locally to store a decision; records are published with the code. You can still download the sealed decision.' });
    mkdirSync(DIR, { recursive: true });
    const body = await readJson(req);
    if (path === '/api/decisions') {
      const r = body.record as { decision?: { kind?: string; decidedAt?: string }; decisionSha256?: string; cosignatures?: Cosig[] } | undefined;
      const hash = String(r?.decisionSha256 ?? '');
      const at = r?.decision?.decidedAt ?? '';
      if (r?.decision?.kind !== 'fireseptum.decision' || !HEX64.test(hash) || Number.isNaN(Date.parse(at))) return send(400, { error: 'not a decision record' });
      if (sha256(canonical(r.decision)) !== hash) return send(400, { error: 'decision does not match its hash' });
      if ((r.cosignatures ?? []).some((c) => !cosignatureValid(hash, c))) return send(400, { error: 'a co-signature does not verify' });
      if (fileFor(hash)) return send(409, { error: 'already stored' });
      const name = `${new Date(at).toISOString().slice(0, 13).replace(/[-:T]/g, '')}_${hash.slice(0, 16)}.json`;
      writeFileSync(join(DIR, name), JSON.stringify(r, null, 1));
      return send(200, { ok: true, file: `data/decisions/${name}` });
    }
    const hash = String(body.decisionSha256 ?? '');
    const f = HEX64.test(hash) ? fileFor(hash) : undefined;
    if (!f) return send(404, { error: 'unknown decision' });
    const c = body.cosignature as Cosig;
    if (!cosignatureValid(hash, c)) return send(400, { error: 'co-signature does not verify' });
    const rec = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    if (rec.decisionSha256 !== hash) return send(409, { error: 'stored file does not match' });
    const cur: Cosig[] = rec.cosignatures ?? [];
    if (cur.some((x) => x.keyId === c.keyId && x.role === c.role)) return send(200, { ok: true, record: rec });
    rec.cosignatures = [...cur, c];
    writeFileSync(join(DIR, f), JSON.stringify(rec, null, 1));
    return send(200, { ok: true, record: rec });
  })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
}

export function decisionsStore(): Plugin {
  return {
    name: 'decision-log',
    configureServer(server) { server.middlewares.use(decisionsHandler); },
    configurePreviewServer(server) { server.middlewares.use(decisionsHandler); },
  };
}
