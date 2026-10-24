import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditPath, buildBatchTree, bytesToHex, hexToBytes, rootOf, rootPreimage, verifyInclusion, verifyPath } from './merkle';

// Certificate Transparency reference vectors (RFC 6962 hashing; merkle_tree_test.cc in
// google/certificate-transparency): roots of the first n of these leaves, in order.
const CT_LEAVES = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'];
const CT_ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

/** RFC 6962 §2.1 MTH, recursive, as an independent reference. */
function mth(d: Uint8Array[]): Buffer {
  const h = (...p: Uint8Array[]) => createHash('sha256').update(Buffer.concat(p)).digest();
  if (d.length === 1) return h(Uint8Array.of(0), d[0]);
  let k = 1;
  while (k * 2 < d.length) k *= 2;
  return h(Uint8Array.of(1), mth(d.slice(0, k)), mth(d.slice(k)));
}

const hashes = (n: number) => Array.from({ length: n }, (_, i) => createHash('sha256').update(`record ${i}`).digest('hex'));

describe('Merkle tree (RFC 6962)', () => {
  it('matches the Certificate Transparency test vectors', async () => {
    for (let n = 1; n <= CT_LEAVES.length; n++) {
      expect(bytesToHex(await rootOf(CT_LEAVES.slice(0, n).map(hexToBytes)))).toBe(CT_ROOTS[n - 1]);
    }
  });

  it('equals the recursive RFC 6962 definition for every size up to 33 (odd counts promote the unpaired node)', async () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = hashes(n).map(hexToBytes);
      expect(bytesToHex(await rootOf(leaves))).toBe(mth(leaves).toString('hex'));
    }
  });

  it('every inclusion proof verifies, for even and odd counts', async () => {
    for (const n of [1, 2, 3, 5, 6, 7, 8, 9, 13]) {
      const b = await buildBatchTree(hashes(n));
      for (const leaf of b.leaves) expect(await verifyInclusion(b, leaf)).toBe(true);
      // A tree of n leaves has proofs of at most ceil(log2 n) hashes.
      expect(Math.max(...Object.values(b.proofs).map((p) => p.length))).toBe(Math.ceil(Math.log2(n)));
    }
  });

  it('a tampered leaf, proof, root or position fails', async () => {
    const b = await buildBatchTree(hashes(7));
    const leaf = b.leaves[4];
    const other = createHash('sha256').update('not in the batch').digest('hex');
    expect(await verifyInclusion(b, other)).toBe(false);
    expect(await verifyInclusion({ ...b, root: b.leaves[0] }, leaf)).toBe(false);
    const bent = { ...b, proofs: { ...b.proofs, [leaf]: [...b.proofs[leaf]] } };
    bent.proofs[leaf][0] = bent.proofs[leaf][0].replace(/^./, (c) => (c === '0' ? '1' : '0'));
    expect(await verifyInclusion(bent, leaf)).toBe(false);
    // Right proof, wrong index or tree size.
    const raw = b.leaves.map(hexToBytes);
    const path = await auditPath(raw, 4);
    expect(await verifyPath(raw[4], 4, 7, path, hexToBytes(b.root))).toBe(true);
    expect(await verifyPath(raw[4], 5, 7, path, hexToBytes(b.root))).toBe(false);
    expect(await verifyPath(raw[4], 4, 5, path, hexToBytes(b.root))).toBe(false);
  });

  it('sorts and de-duplicates leaves, so the root does not depend on file order', async () => {
    const h = hashes(5);
    const a = await buildBatchTree(h);
    const b = await buildBatchTree([...h].reverse().concat(h[2]));
    expect(a.leaves).toEqual([...h].sort());
    expect(b.root).toBe(a.root);
    await expect(buildBatchTree(['XYZ'])).rejects.toThrow();
  });

  it('root preimage hashes to the root (what an .ots proof of the root commits to)', async () => {
    for (const n of [1, 2, 6]) {
      const h = hashes(n);
      const b = await buildBatchTree(h);
      expect(createHash('sha256').update(await rootPreimage(h)).digest('hex')).toBe(b.root);
    }
  });
});
