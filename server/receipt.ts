// Vite dev/preview middleware for run receipts.
//   GET  /api/receipt/key                   → this instance's Ed25519 public key
//   POST /api/receipt/sign   {receiptSha256, scheme?} → signature over "<scheme>:<hash>:<signedAt>",
//                                             scheme 'fireseptum-receipt-v2' (default) or 'sekatapi-receipt-v1'
//   POST /api/receipt/anchor {receiptSha256} → OpenTimestamps proof (.ots, base64) for that hash
// The server only ever sees a 64-hex-digit hash, never the scenario. A signature says
// "this Fire Septum instance saw this receipt at signedAt"; whether the numbers are right
// is checked by re-running the simulation, not by trusting the key.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const KEY_FILE = join(process.cwd(), '.cache', 'receipt-ed25519.pem');

class KeyMissing extends Error { constructor() { super('RECEIPT_ED25519_KEY not set'); } }

/** Private key from RECEIPT_ED25519_KEY (PKCS#8 PEM), else a key generated once and kept in .cache/. */
function loadKey(pem: string | undefined): KeyObject {
  if (pem) return createPrivateKey(pem.replace(/\\n/g, '\n'));
  if (existsSync(KEY_FILE)) return createPrivateKey(readFileSync(KEY_FILE, 'utf8'));
  // A hosted instance cannot keep a generated key, and a key that changes on every cold start
  // would make keyIds meaningless, so it signs only with a configured key.
  if (process.env.VERCEL) throw new KeyMissing();
  const { privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return privateKey;
}

/** Raw 32-byte Ed25519 public key (the last 32 bytes of its SPKI DER encoding). */
const rawPublic = (k: KeyObject) => (createPublicKey(k).export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32);

// OpenTimestamps public calendars, tried in order.
const CALENDARS = ['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org', 'https://a.pool.eternitywall.com'];
// .ots file header: magic bytes, version 1, then the SHA-256 file-hash op (0x08).
const OTS_MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');

async function anchor(hex: string): Promise<{ calendar: string; ots: Buffer } | null> {
  const digest = Buffer.from(hex, 'hex');
  for (const cal of CALENDARS) {
    try {
      const r = await fetch(`${cal}/digest`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.opentimestamps.v1', 'User-Agent': 'FireSeptum/0.2 (IEEE ClimateChain hackathon prototype)' },
        body: digest,
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) continue;
      const ts = Buffer.from(await r.arrayBuffer());
      return { calendar: cal, ots: Buffer.concat([OTS_MAGIC, Buffer.from([0x01, 0x08]), digest, ts]) };
    } catch { /* try the next calendar */ }
  }
  return null;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Vercel's Node runtime has already read and parsed the body.
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) return typeof pre === 'string' ? JSON.parse(pre || '{}') : (pre as Record<string, unknown>) ?? {};
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('body too large'); }
  return JSON.parse(body || '{}');
}

const HEX64 = /^[0-9a-f]{64}$/;

export function receiptHandler(getPem: () => string | undefined) {
  let key: KeyObject | null = null;
  const getKey = () => (key ??= loadKey(getPem()));
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/api/receipt/')) return next();
    res.setHeader('content-type', 'application/json');
    const send = (status: number, body: object) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    try {
      const pub = rawPublic(getKey());
      const publicKey = pub.toString('base64');
      const keyId = createHash('sha256').update(pub).digest('hex').slice(0, 16);
      if (path === '/api/receipt/key' && req.method === 'GET') return send(200, { alg: 'Ed25519', publicKey, keyId });
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const body = await readJson(req);
      const hash = String(body.receiptSha256 ?? '');
      if (!HEX64.test(hash)) return send(400, { error: 'receiptSha256 must be 64 lowercase hex digits' });
      if (path === '/api/receipt/sign') {
        // Version 1 records were made under the first name (SekatApi) and keep their prefix.
        const scheme = String(body.scheme ?? 'fireseptum-receipt-v2');
        if (scheme !== 'fireseptum-receipt-v2' && scheme !== 'sekatapi-receipt-v1') return send(400, { error: 'unknown signature scheme' });
        const signedAt = new Date().toISOString();
        const sig = sign(null, Buffer.from(`${scheme}:${hash}:${signedAt}`), getKey()).toString('base64');
        return send(200, { alg: 'Ed25519', scheme, publicKey, keyId, signedAt, sig });
      }
      if (path === '/api/receipt/anchor') {
        const a = await anchor(hash);
        if (!a) return send(502, { error: 'no OpenTimestamps calendar answered' });
        return send(200, { calendar: a.calendar, submittedAt: new Date().toISOString(), otsB64: a.ots.toString('base64') });
      }
      return send(404, { error: 'unknown endpoint' });
    } catch (e) {
      return send(e instanceof KeyMissing ? 503 : 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export function receiptProxy(getPem: () => string | undefined): Plugin {
  const handler = receiptHandler(getPem);
  return {
    name: 'receipt-proxy',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
