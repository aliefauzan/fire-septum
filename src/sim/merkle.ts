// Merkle trees for daily batches of sealed records (RFC 6962 / RFC 9162 hashing).
//
//   leaf hash = SHA-256(0x00 ‖ leaf bytes)
//   node hash = SHA-256(0x01 ‖ left ‖ right)
//
// Built level by level: nodes are paired left to right and an unpaired last node is promoted
// to the next level unchanged. That gives exactly the RFC 6962 tree (split at the largest power
// of two below n), so proofs verify with the standard RFC 9162 algorithm. One root commits to
// every record of the day; one timestamp or attestation of that root covers all of them, and
// each record keeps a short inclusion proof.

export const hexToBytes = (h: string): Uint8Array => {
  if (!/^(?:[0-9a-f]{2})*$/.test(h)) throw new Error('not lowercase hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};
export const bytesToHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all as BufferSource));
}

const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

/** RFC 6962 leaf hash of raw leaf bytes. */
export const leafHash = (data: Uint8Array) => sha256([LEAF, data]);
/** RFC 6962 interior node hash. */
export const nodeHash = (l: Uint8Array, r: Uint8Array) => sha256([NODE, l, r]);

/** All levels of the tree, leaf hashes first, root last. */
async function levels(leaves: Uint8Array[]): Promise<Uint8Array[][]> {
  if (!leaves.length) throw new Error('a Merkle tree needs at least one leaf');
  const out: Uint8Array[][] = [await Promise.all(leaves.map(leafHash))];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1], next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? await nodeHash(cur[i], cur[i + 1]) : cur[i]);
    out.push(next);
  }
  return out;
}

/** Root over leaves in the given order (raw bytes). */
export async function rootOf(leaves: Uint8Array[]): Promise<Uint8Array> {
  const lv = await levels(leaves);
  return lv[lv.length - 1][0];
}

/** Audit path for leaf `index`, bottom-up (RFC 9162 §2.1.3). */
export async function auditPath(leaves: Uint8Array[], index: number): Promise<Uint8Array[]> {
  if (index < 0 || index >= leaves.length) throw new Error('leaf index out of range');
  const lv = await levels(leaves);
  const path: Uint8Array[] = [];
  let i = index;
  for (const level of lv.slice(0, -1)) {
    const sib = i % 2 ? i - 1 : i + 1;
    if (sib < level.length) path.push(level[sib]);
    i >>= 1;
  }
  return path;
}

/** RFC 9162 §2.1.3.2: does `path` prove that `leaf` is leaf `index` of a tree of `size` leaves with this root? */
export async function verifyPath(leaf: Uint8Array, index: number, size: number, path: Uint8Array[], root: Uint8Array): Promise<boolean> {
  if (index < 0 || index >= size) return false;
  let fn = index, sn = size - 1;
  let r = await leafHash(leaf);
  for (const p of path) {
    if (sn === 0) return false;
    if (fn & 1 || fn === sn) {
      r = await nodeHash(p, r);
      while (!(fn & 1) && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else {
      r = await nodeHash(r, p);
    }
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 && bytesToHex(r) === bytesToHex(root);
}

// --- Daily batches: leaves are 32-byte record hashes (hex), sorted ascending, no duplicates.

const HEX64 = /^[0-9a-f]{64}$/;

/** Canonical leaf order of a batch: unique 64-hex record hashes, ascending. */
export function batchLeaves(hashes: string[]): string[] {
  for (const h of hashes) if (!HEX64.test(h)) throw new Error(`not a SHA-256 hex digest: ${h}`);
  return [...new Set(hashes)].sort();
}

export interface MerkleBatch {
  leaves: string[];
  root: string;
  /** Audit path (hex, bottom-up) per leaf. */
  proofs: Record<string, string[]>;
}

export async function buildBatchTree(hashes: string[]): Promise<MerkleBatch> {
  const leaves = batchLeaves(hashes);
  const raw = leaves.map(hexToBytes);
  const root = bytesToHex(await rootOf(raw));
  const proofs: Record<string, string[]> = {};
  for (let i = 0; i < leaves.length; i++) proofs[leaves[i]] = (await auditPath(raw, i)).map(bytesToHex);
  return { leaves, root, proofs };
}

/** Check one record's inclusion in a batch: its proof must lead from the record hash to the batch root. */
export async function verifyInclusion(b: Pick<MerkleBatch, 'leaves' | 'root' | 'proofs'>, hash: string): Promise<boolean> {
  const index = b.leaves.indexOf(hash);
  const path = b.proofs[hash];
  if (index < 0 || !path || !HEX64.test(b.root)) return false;
  try {
    return await verifyPath(hexToBytes(hash), index, b.leaves.length, path.map(hexToBytes), hexToBytes(b.root));
  } catch { return false; }
}

/**
 * The bytes whose SHA-256 is the root (0x01 ‖ left ‖ right, or 0x00 ‖ leaf for one record).
 * OpenTimestamps proofs commit to the SHA-256 of a file, so these bytes are that "file" for `ots verify`.
 */
export async function rootPreimage(hashes: string[]): Promise<Uint8Array> {
  const leaves = batchLeaves(hashes).map(hexToBytes);
  if (leaves.length === 1) return new Uint8Array([0, ...leaves[0]]);
  const lv = await levels(leaves);
  const top = lv[lv.length - 2];
  return new Uint8Array([1, ...top[0], ...top[1]]);
}
