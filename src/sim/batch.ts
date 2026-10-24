// Daily batches: one Merkle root per UTC day over every record sealed that day.
//
// The root is timestamped with OpenTimestamps (Bitcoin) and can be attested with EAS on Base.
// A batch file is written once and never rewritten. A record that reaches the store after its
// day was sealed goes into the next batch that is built, so nothing is ever left out and no
// sealed root ever changes.
import type { Anchor } from './receipt';
import { buildBatchTree, verifyInclusion } from './merkle';

export const BATCH_KIND = 'fireseptum.daily-batch';

export interface EasAttestation {
  network: 'base-sepolia' | 'base';
  chainId: number;
  schemaUid: string;
  attestationUid: string;
  txHash: string;
  attestedAt: string;
  /** easscan page of the attestation. */
  explorer: string;
}

export interface DailyBatch {
  v: 1;
  kind: typeof BATCH_KIND;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  sealedAt: string;
  /** Record hashes (receipt / decision SHA-256), unique and ascending. */
  leaves: string[];
  root: string;
  proofs: Record<string, string[]>;
  /** OpenTimestamps proof of the root (the "file" is the root's preimage, see merkle.rootPreimage). */
  ots?: Anchor;
  /** EAS attestation of the root on Base (an array once it is attested on more than one network). Added after sealing; not part of the root. */
  eas?: EasAttestation | EasAttestation[];
}

/** A sealed record known to the store: its hash and when it was sealed. */
export interface SealedLeaf { hash: string; sealedAt: string; source: string }

export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Leaves for day `day`: every record sealed on or before that day that is not in any existing
 * batch. Returns null when that day already has a batch (it is never rebuilt).
 */
export function planBatch(day: string, records: SealedLeaf[], existing: Pick<DailyBatch, 'day' | 'leaves'>[]): SealedLeaf[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`not a day: ${day}`);
  if (existing.some((b) => b.day === day)) return null;
  const done = new Set(existing.flatMap((b) => b.leaves));
  const seen = new Set<string>();
  return records.filter((r) => {
    if (done.has(r.hash) || seen.has(r.hash) || utcDay(r.sealedAt) > day) return false;
    seen.add(r.hash);
    return true;
  });
}

export async function buildBatch(day: string, leaves: SealedLeaf[], sealedAt = new Date().toISOString()): Promise<DailyBatch> {
  const t = await buildBatchTree(leaves.map((l) => l.hash));
  return { v: 1, kind: BATCH_KIND, day, sealedAt, leaves: t.leaves, root: t.root, proofs: t.proofs };
}

export const easList = (b: Pick<DailyBatch, 'eas'>): EasAttestation[] => (b.eas ? (Array.isArray(b.eas) ? b.eas : [b.eas]) : []);

export interface Inclusion {
  batch: DailyBatch;
  /** The record's proof leads to the batch root (checked here, in this browser). */
  proofOk: boolean;
}

export async function findInclusion(batches: DailyBatch[], hash: string): Promise<Inclusion | null> {
  const b = batches.find((x) => x.leaves.includes(hash));
  if (!b) return null;
  return { batch: b, proofOk: await verifyInclusion(b, hash) };
}

// --- OpenTimestamps proof status, read from the .ots bytes without a full parser.

const BITCOIN_TAG = [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];
const PENDING_TAG = [0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e];

function findTag(b: Uint8Array, tag: number[], from = 0): number {
  outer: for (let i = from; i + tag.length <= b.length; i++) {
    for (let j = 0; j < tag.length; j++) if (b[i + j] !== tag[j]) continue outer;
    return i;
  }
  return -1;
}

function varuint(b: Uint8Array, at: number): [number, number] {
  let v = 0, shift = 0, i = at;
  for (; i < b.length; i++) {
    v += (b[i] & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(b[i] & 0x80)) return [v, i + 1];
  }
  return [NaN, i];
}

export interface OtsStatus {
  /** 'bitcoin' once the proof has been upgraded with a block header attestation. */
  state: 'bitcoin' | 'pending' | 'unknown';
  /** Block height of the first Bitcoin attestation. */
  height?: number;
}

/** Whether an .ots proof holds a Bitcoin block attestation yet (after `ots upgrade`) or only calendar promises. */
export function otsStatus(ots: Uint8Array): OtsStatus {
  const bi = findTag(ots, BITCOIN_TAG);
  if (bi >= 0) {
    // Attestation: tag, varbytes payload (length, then varuint height).
    const [, at] = varuint(ots, bi + 8);
    const [height] = varuint(ots, at);
    return { state: 'bitcoin', height: Number.isFinite(height) ? height : undefined };
  }
  return { state: findTag(ots, PENDING_TAG) >= 0 ? 'pending' : 'unknown' };
}
