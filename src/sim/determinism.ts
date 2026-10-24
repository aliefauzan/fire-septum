// Cross-engine reproducibility check, bundled by scripts/determinism.mjs and run in Node,
// Chromium (V8), Firefox (SpiderMonkey) and Safari's engine (JavaScriptCore). It re-runs the
// recorded West Kalimantan fire with and without the deterministic maths and hashes every
// run, exactly as a receipt does. 'det1' must give one hash everywhere; the engine Math
// (records made before 24 Oct 2026) is reported for comparison.
//
// SHA-256 is computed in plain JavaScript here, so the check also runs in bare engine
// shells (SpiderMonkey's js) that have no WebCrypto. It gives the same digest as
// outputsDigest() in receipt.ts.
import event from '../data/events/kalimantan-2026-10-18.json';
import { runEnsemble } from './ensemble';
import { DEFAULT_PARAMS } from './model';
import { decode } from './receipt';
import type { EnsembleResult, Scenario, SimParams } from './types';

export interface DeterminismResult { engine: string; det1: string; native: string; ms: number }

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** FIPS 180-4 SHA-256. */
export function sha256(msg: Uint8Array): string {
  const len = msg.length, total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(msg); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
  const H = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** Same bytes as outputsDigest(e, e): ign, out, ext of every run, base ensemble then "plan". */
function digest(e: EnsembleResult): string {
  const parts: Uint8Array[] = [];
  for (let pass = 0; pass < 2; pass++) for (const r of e.runs) for (const a of [r.ign, r.out, r.ext]) parts.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return sha256(all);
}

declare const navigator: { userAgent: string } | undefined;
const engine = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Firefox\//.test(ua)) return 'SpiderMonkey (Firefox)';
  if (/Chrome\/|Chromium\//.test(ua)) return 'V8 (Chromium)';
  if (/Safari\//.test(ua)) return 'JavaScriptCore (Safari)';
  return typeof (globalThis as { process?: unknown }).process !== 'undefined' ? 'V8 (Node)' : 'SpiderMonkey (js shell)';
};

export function run(): DeterminismResult {
  const t = Date.now();
  const scenario = decode<Scenario>(event);
  const det: SimParams = { ...DEFAULT_PARAMS, math: 'det1' };
  const nat: SimParams = { ...DEFAULT_PARAMS, math: undefined };
  return { engine: engine(), det1: digest(runEnsemble(scenario, [], det)), native: digest(runEnsemble(scenario, [], nat)), ms: Date.now() - t };
}
