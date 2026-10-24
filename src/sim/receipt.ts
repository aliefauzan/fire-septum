// Run receipts: a tamper-evident record of one decision.
//
// A receipt binds the exact inputs (scenario, weather, fire state, plan, rates, seeds)
// to the exact outputs (every simulated run) with SHA-256. The simulation is
// deterministic, so anyone holding the record can re-run it and must get the same
// output hash. The server then signs the receipt hash (Ed25519) and can submit it to
// OpenTimestamps, which anchors it in a Bitcoin block: proof that the record existed,
// unchanged, at that time. No wallet, token or smart contract is involved.
import { pairedSaving } from './ensemble';
import type { Emissions } from './carbon';
import type { ObservedEmissions } from './frp';
import type { Action, EnsembleResult, Scenario, SimParams } from './types';

type Typed = Uint8Array | Uint16Array | Float32Array;
const TYPED = { Uint8Array, Uint16Array, Float32Array } as const;
type TypedName = keyof typeof TYPED;

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesOf = (a: Typed) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** JSON-safe copy with typed arrays as {$t, b64} (little-endian bytes). */
export function encode(v: unknown): unknown {
  if (v instanceof Uint8Array || v instanceof Uint16Array || v instanceof Float32Array) {
    return { $t: v.constructor.name, b64: toB64(bytesOf(v)) };
  }
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = encode(x);
    return o;
  }
  return v;
}

export function decode<T>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => decode(x)) as T;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$t === 'string' && typeof o.b64 === 'string' && o.$t in TYPED) {
      const bytes = fromB64(o.b64);
      const C = TYPED[o.$t as TypedName];
      return new C(bytes.buffer, 0, bytes.byteLength / C.BYTES_PER_ELEMENT) as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = decode(x);
    return out as T;
  }
  return v as T;
}

/** JSON with object keys sorted, so the same value always gives the same bytes. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Everything the simulation reads. Re-running these gives the recorded outputs. */
export interface RunInputs {
  scenario: Scenario;
  actions: Action[];
  params: SimParams;
  seeds: number[];
}

export const inputsDigest = (i: RunInputs) => sha256Hex(canonical(encode(i)));

/** Hash of every run of both ensembles: ignition time, burn-out time and suppression per cell. */
export async function outputsDigest(base: EnsembleResult, plan: EnsembleResult): Promise<string> {
  const parts: Uint8Array[] = [];
  for (const e of [base, plan]) {
    for (const r of e.runs) parts.push(bytesOf(r.ign), bytesOf(r.out), bytesOf(r.ext));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return sha256Hex(all);
}

/**
 * Record formats this code reads. Version 1 was written under the project's first name,
 * SekatApi; those records, their signatures and their Bitcoin timestamps stay valid, so the
 * old identifiers are kept here and only new records use version 2.
 */
export const RECEIPT_KIND = { 1: 'sekatapi.run-receipt', 2: 'fireseptum.run-receipt' } as const;
export const SIGNATURE_SCHEME = { 1: 'sekatapi-receipt-v1', 2: 'fireseptum-receipt-v2' } as const;
/** Server signatures over decision records (src/sim/decision.ts) use their own prefix, so a receipt signature can never pass as one. */
export const DECISION_SIGNATURE_SCHEME = 'fireseptum-decision-v1';
export type SignatureScheme = (typeof SIGNATURE_SCHEME)[keyof typeof SIGNATURE_SCHEME] | typeof DECISION_SIGNATURE_SCHEME;
export const RECEIPT_VERSION = 2;

export const isRunRecord = (r: unknown): r is RunRecord => {
  const k = (r as RunRecord | null)?.receipt?.kind;
  return k === RECEIPT_KIND[1] || k === RECEIPT_KIND[2];
};

export interface Receipt {
  v: 1 | 2;
  kind: (typeof RECEIPT_KIND)[1 | 2];
  createdAt: string;
  scenario: { id: string; title: string; provenance: Scenario['provenance'] };
  horizonH: number;
  runs: number;
  actions: number;
  inputsSha256: string;
  outputsSha256: string;
  results: {
    burnedHa: { base: number; plan: number };
    savedHa: { mean: number; p10: number; p90: number; pBetter: number };
    tco2e: { base: number; plan: number | null; avoided: number | null; avoidedP10: number | null; avoidedP90: number | null; perHa: number };
    /** Emissions the satellites had already seen when the record was made (FRP method), if there were detections. */
    observed?: { tco2e: number; freMJ: number; detections: number; passes: number; windowH: number; method: string };
  };
  /** Browser engine that produced the outputs; floating-point maths may differ between engines. */
  engine: string;
}

export interface Signature {
  alg: 'Ed25519';
  /** Prefix of the signed message. Unset in version 1 signatures, which used 'sekatapi-receipt-v1'. */
  scheme?: SignatureScheme;
  /** Raw 32-byte public key, base64. */
  publicKey: string;
  /** First 16 hex digits of SHA-256(public key). */
  keyId: string;
  signedAt: string;
  /** Signature over signedMessage(receiptSha256, signedAt), base64. */
  sig: string;
}

export interface Anchor {
  /** OpenTimestamps calendar that accepted the digest. */
  calendar: string;
  submittedAt: string;
  /** Complete .ots proof file for the canonical receipt bytes, base64. Pending until a Bitcoin block confirms it. */
  otsB64: string;
}

/** People who co-sign a record, by role. */
export const COSIGN_ROLES = ['forecaster', 'commander', 'bpbd'] as const;
export type CosignRole = (typeof COSIGN_ROLES)[number];
export const COSIGN_ROLE_LABEL: Record<CosignRole, string> = {
  forecaster: 'Forecaster (analyst)',
  commander: 'Incident commander (Daops Manggala Agni)',
  bpbd: 'BPBD',
};
export const COSIGN_SCHEME = 'fireseptum-cosign-v1';

/**
 * A person's Ed25519 signature over a record hash, made in their own browser with their own key.
 * It attests "I saw and accept this record at this time". It does not say the numbers are right:
 * the re-run checks those. Like `signature`, it sits outside the hashed receipt, so it can be
 * added later without changing the record.
 */
export interface Cosignature {
  role: CosignRole;
  /** Display name the signer gave their key. Self-declared, not verified by anyone. */
  name: string;
  alg: 'Ed25519';
  /** Raw 32-byte public key, base64. */
  publicKey: string;
  /** First 16 hex digits of SHA-256(public key). */
  keyId: string;
  signedAt: string;
  scheme: typeof COSIGN_SCHEME;
  /** Signature over cosignMessage(recordSha256, role, signedAt), base64. */
  sig: string;
}

export const cosignMessage = (recordSha256: string, role: CosignRole, signedAt: string) => `${COSIGN_SCHEME}:${recordSha256}:${role}:${signedAt}`;

/** Verify a co-signature: the key id belongs to the public key and the signature holds for this record hash and role. */
export async function verifyCosignature(recordSha256: string, c: Cosignature): Promise<boolean> {
  try {
    if (c.alg !== 'Ed25519' || c.scheme !== COSIGN_SCHEME || !COSIGN_ROLES.includes(c.role)) return false;
    const pub = fromB64(c.publicKey);
    if ((await sha256Hex(pub)).slice(0, 16) !== c.keyId) return false;
    const key = await crypto.subtle.importKey('raw', pub as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, fromB64(c.sig) as BufferSource, new TextEncoder().encode(cosignMessage(recordSha256, c.role, c.signedAt)) as BufferSource);
  } catch { return false; }
}

/** A shareable record: the receipt, its proofs, and the inputs needed to re-run it. */
export interface RunRecord {
  receipt: Receipt;
  receiptSha256: string;
  signature?: Signature;
  anchor?: Anchor;
  /** Co-signatures by role (forecaster, commander, BPBD). Not part of the receipt hash. */
  cosignatures?: Cosignature[];
  inputs: unknown; // encode(RunInputs)
}

export const signedMessage = (receiptSha256: string, signedAt: string, scheme: SignatureScheme = SIGNATURE_SCHEME[2]) => `${scheme}:${receiptSha256}:${signedAt}`;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export async function buildReceipt(inputs: RunInputs, base: EnsembleResult, plan: EnsembleResult, em: Emissions, engine: string, obs?: ObservedEmissions | null): Promise<{ receipt: Receipt; receiptSha256: string }> {
  const s = pairedSaving(base, plan);
  const hasPlan = inputs.actions.length > 0;
  const receipt: Receipt = {
    v: 2,
    kind: RECEIPT_KIND[2],
    createdAt: new Date().toISOString(),
    scenario: { id: inputs.scenario.id, title: inputs.scenario.title, provenance: inputs.scenario.provenance },
    horizonH: inputs.scenario.horizonH,
    runs: inputs.seeds.length,
    actions: inputs.actions.length,
    inputsSha256: await inputsDigest(inputs),
    outputsSha256: await outputsDigest(base, plan),
    results: {
      burnedHa: { base: round(mean(base.burnedHa)), plan: round(mean(plan.burnedHa)) },
      savedHa: { mean: round(s.mean), p10: round(s.p10), p90: round(s.p90), pBetter: round(s.pBetter, 2) },
      tco2e: {
        base: round(em.base.mean, 0),
        plan: hasPlan && em.plan ? round(em.plan.mean, 0) : null,
        avoided: hasPlan && em.avoided ? round(em.avoided.mean, 0) : null,
        avoidedP10: hasPlan && em.avoided ? round(em.avoided.p10, 0) : null,
        avoidedP90: hasPlan && em.avoided ? round(em.avoided.p90, 0) : null,
        perHa: round(em.perHa, 1),
      },
      ...(obs ? { observed: { tco2e: round(obs.tco2e, 0), freMJ: round(obs.freMJ, 0), detections: obs.detections, passes: obs.passes, windowH: obs.windowH, method: 'VIIRS FRP held to next pass (max 12 h) × GFAS β × IPCC EF' } } : {}),
    },
    engine,
  };
  return { receipt, receiptSha256: await sha256Hex(canonical(receipt)) };
}

function round(x: number, dp = 1) {
  const m = 10 ** dp;
  return Math.round(x * m) / m;
}

/** Verify an Ed25519 signature in the browser (WebCrypto). */
export async function verifySignature(receiptSha256: string, s: Signature): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', fromB64(s.publicKey) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, fromB64(s.sig) as BufferSource, new TextEncoder().encode(signedMessage(receiptSha256, s.signedAt, s.scheme ?? SIGNATURE_SCHEME[1])) as BufferSource);
}

export interface CheckResult {
  receiptHash: boolean;
  inputsHash: boolean;
  /** Null until the re-run finishes. */
  outputsHash: boolean | null;
  signature: boolean | null;
  /** One entry per co-signature, in record order. */
  cosignatures: { role: CosignRole; name: string; keyId: string; ok: boolean }[];
}

export const checkCosignatures = (hash: string, cs: Cosignature[] | undefined) =>
  Promise.all((cs ?? []).map(async (c) => ({ role: c.role, name: c.name, keyId: c.keyId, ok: await verifyCosignature(hash, c) })));

/** Static checks that need no re-run: the receipt and inputs hash to what the record claims, and the signature and co-signatures hold. */
export async function checkRecord(r: RunRecord): Promise<CheckResult> {
  const receiptHash = (await sha256Hex(canonical(r.receipt))) === r.receiptSha256;
  const inputsHash = (await sha256Hex(canonical(r.inputs))) === r.receipt.inputsSha256;
  let signature: boolean | null = null;
  if (r.signature) signature = await verifySignature(r.receiptSha256, r.signature).catch(() => false);
  return { receiptHash, inputsHash, outputsHash: null, signature, cosignatures: await checkCosignatures(r.receiptSha256, r.cosignatures) };
}

/** Short engine label from the user agent (Chromium, Firefox, Safari, Node). */
export function engineLabel(ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node'): string {
  if (/Firefox\//.test(ua)) return 'SpiderMonkey (Firefox)';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'V8 (Chromium)';
  if (/Safari\//.test(ua)) return 'JavaScriptCore (Safari)';
  return /node/i.test(ua) ? 'V8 (Node)' : ua.slice(0, 60);
}

export { fromB64, toB64 };
