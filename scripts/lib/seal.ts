// Daily Merkle batches from Node (used by scripts/seal-day.ts and scripts/register-daily.ts).
//
// Leaves are the record hashes of the day: register entries (receipt hash), forecast submissions
// (SHA-256 of the canonical forecast), decision records (decision hash) and the plan run records
// they point at (receipt hash), sorted ascending. The root goes to the OpenTimestamps calendars;
// the batch file data/batches/<day>.json is written only if that succeeds, and is never rewritten.
// A record that arrives after its day was sealed is put into the next batch that is built.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anchor } from '../../server/receipt';
import { buildBatch, planBatch, type DailyBatch, type SealedLeaf } from '../../src/sim/batch';
import { canonical, sha256Hex } from '../../src/sim/receipt';

const readDir = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).sort() : []);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
/** JSON files under d, one level of sub-folders deep (data/submissions/<day>/…), as relative paths. */
const readTree = (d: string) => (existsSync(d) ? readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? readDir(join(d, f)).map((x) => `${f}/${x}`) : f.endsWith('.json') ? [f] : [])) : []);

/** Every sealed record in the store, checked against its own hash. */
export async function sealedRecords(root = process.cwd(), warn: (m: string) => void = console.warn): Promise<SealedLeaf[]> {
  const out: SealedLeaf[] = [];
  for (const f of readDir(join(root, 'data', 'register'))) {
    const e = readJson(join(root, 'data', 'register', f));
    const h = e.record?.receiptSha256;
    if ((await sha256Hex(canonical(e.record.receipt))) !== h) { warn(`skip ${f}: receipt does not match its hash`); continue; }
    out.push({ hash: h, sealedAt: e.issuedAt, source: `data/register/${f}` });
  }
  for (const f of readTree(join(root, 'data', 'submissions'))) {
    const s = readJson(join(root, 'data', 'submissions', f));
    if ((await sha256Hex(canonical(s.forecast))) !== s.sha256) { warn(`skip ${f}: forecast does not match its hash`); continue; }
    out.push({ hash: s.sha256, sealedAt: s.receivedAt, source: `data/submissions/${f}` });
  }
  for (const f of readDir(join(root, 'data', 'decisions'))) {
    const r = readJson(join(root, 'data', 'decisions', f));
    if ((await sha256Hex(canonical(r.decision))) !== r.decisionSha256) { warn(`skip ${f}: decision does not match its hash`); continue; }
    out.push({ hash: r.decisionSha256, sealedAt: r.decision.decidedAt, source: `data/decisions/${f}` });
    out.push({ hash: r.decision.planReceiptSha256, sealedAt: r.decision.decidedAt, source: `data/decisions/${f} (plan run record)` });
  }
  return out;
}

export const existingBatches = (root = process.cwd()): DailyBatch[] =>
  readDir(join(root, 'data', 'batches')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => readJson(join(root, 'data', 'batches', f)));

export type SealOutcome = 'sealed' | 'exists' | 'empty' | 'dry-run';

/** Seal one UTC day. With dryRun, only reports what would go into the batch (no anchoring, no file). */
export async function sealDay(day: string, records: SealedLeaf[], o: { root?: string; dryRun?: boolean; log?: (m: string) => void } = {}): Promise<SealOutcome> {
  const root = o.root ?? process.cwd(), log = o.log ?? console.log;
  const dir = join(root, 'data', 'batches');
  const leaves = planBatch(day, records, existingBatches(root));
  if (leaves === null) { log(`${day}: already sealed (data/batches/${day}.json is never rewritten)`); return 'exists'; }
  if (!leaves.length) { log(`${day}: no new records`); return 'empty'; }
  const batch = await buildBatch(day, leaves);
  if (o.dryRun) {
    log(`${day}: would seal ${batch.leaves.length} record(s), root ${batch.root} (dry run: not anchored, not written)`);
    for (const l of leaves) log(`   ${l.hash.slice(0, 16)}…  ${l.source}`);
    return 'dry-run';
  }
  const a = await anchor(batch.root);
  if (!a) throw new Error(`${day}: no OpenTimestamps calendar answered; nothing written (try again later)`);
  batch.ots = { calendar: a.calendar, submittedAt: new Date().toISOString(), otsB64: a.ots.toString('base64') };
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${day}.json`);
  if (existsSync(file)) throw new Error(`${file} appeared while sealing; not overwriting`);
  writeFileSync(file, JSON.stringify(batch, null, 1) + '\n', { flag: 'wx' });
  log(`${day}: sealed ${batch.leaves.length} record(s), root ${batch.root}`);
  for (const l of leaves) log(`   ${l.hash.slice(0, 16)}…  ${l.source}`);
  log(`   OpenTimestamps: ${a.calendar} (pending until a Bitcoin block confirms it)`);
  return 'sealed';
}
