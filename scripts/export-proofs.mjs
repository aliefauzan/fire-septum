// Export every pre-registered forecast in data/register/ as the exact receipt bytes plus
// its OpenTimestamps proof, so anyone can check the timestamps without Fire Septum:
//
//   node scripts/export-proofs.mjs            # writes proofs/<hash>.receipt.json(.ots)
//   pip install opentimestamps-client
//   ots upgrade proofs/*.ots                  # once Bitcoin has confirmed (a few hours)
//   ots verify proofs/<hash>.receipt.json.ots
//
// Daily batches (data/batches/<day>.json) are exported too: proofs/fireseptum-batch-<day>.root.bin
// holds the bytes whose SHA-256 is the batch's Merkle root, next to the root's .ots proof:
//   ots verify proofs/fireseptum-batch-<day>.root.bin.ots
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'data', 'register');
const OUT = join(process.cwd(), 'proofs');

/** Same canonical JSON as src/sim/receipt.ts: sorted keys, undefined dropped. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const e = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const { receipt, receiptSha256, anchor } = e.record;
  const bytes = Buffer.from(canonical(receipt));
  const ok = createHash('sha256').update(bytes).digest('hex') === receiptSha256;
  const name = `fireseptum-${receiptSha256.slice(0, 12)}.receipt.json`;
  writeFileSync(join(OUT, name), bytes);
  if (anchor) writeFileSync(join(OUT, `${name}.ots`), Buffer.from(anchor.otsB64, 'base64'));
  console.log(`${ok ? 'ok ' : 'BAD'} ${e.issuedAt}  ${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}  ${name}${anchor ? ' + .ots' : ' (no timestamp)'}`);
  n++;
}
console.log(`${n} forecast(s) exported to proofs/`);

// --- Daily batches: root preimage (0x01 ‖ left ‖ right, or 0x00 ‖ leaf) + .ots of the root.
const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
/** RFC 6962 tree, level by level (an unpaired node is promoted); returns the root and its preimage. */
function tree(hexLeaves) {
  let level = hexLeaves.map((h) => sha(Buffer.from([0]), Buffer.from(h, 'hex')));
  if (level.length === 1) return { root: level[0], pre: Buffer.concat([Buffer.from([0]), Buffer.from(hexLeaves[0], 'hex')]) };
  let pre;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const p = Buffer.concat([Buffer.from([1]), level[i], level[i + 1]]);
        if (level.length === 2) pre = p;
        next.push(sha(p));
      } else next.push(level[i]);
    }
    level = next;
  }
  return { root: level[0], pre };
}
const BATCHES = join(process.cwd(), 'data', 'batches');
let nb = 0;
for (const f of existsSync(BATCHES) ? readdirSync(BATCHES).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort() : []) {
  const b = JSON.parse(readFileSync(join(BATCHES, f), 'utf8'));
  const { root, pre } = tree(b.leaves);
  const ok = root.toString('hex') === b.root && sha(pre).equals(root);
  const name = `fireseptum-batch-${b.day}.root.bin`;
  writeFileSync(join(OUT, name), pre);
  if (b.ots) writeFileSync(join(OUT, `${name}.ots`), Buffer.from(b.ots.otsB64, 'base64'));
  console.log(`${ok ? 'ok ' : 'BAD'} batch ${b.day}  ${b.leaves.length} record(s)  root ${b.root.slice(0, 16)}…  ${name}${b.ots ? ' + .ots' : ' (no timestamp)'}`);
  nb++;
}
console.log(`${nb} daily batch(es) exported to proofs/`);
