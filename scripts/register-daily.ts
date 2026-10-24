// The forecast register's daily job (run by .github/workflows/register.yml, or by hand):
//
//   npx tsx scripts/register-daily.ts --dry-run      # everything computed and printed; nothing signed, anchored or written
//   npx tsx scripts/register-daily.ts                # the real thing
//   npx tsx scripts/register-daily.ts --no-seal      # only score what is due (+ batch, attest)
//
// Steps, each idempotent (safe to re-run any time):
//   0. pull   with BLOB_READ_WRITE_TOKEN: copy register entries, submissions and scores that the
//             hosted app stored in Vercel Blob into data/ (new files only; a score is attached once)
//   1. score  every register entry and submission whose 24 h window is in FIRMS (window + 6 h):
//             re-run the sealed inputs (must reproduce the sealed output hash), fetch the FIRMS
//             detections of (issuedAt, issuedAt + 24 h], score new fire only, and write the score
//             once, exactly as POST /api/register/score would (src/data/register.ts computeScore)
//   2. seal   new forecasts: the top 3 FIRMS clusters of the last 24 h per island (Kalimantan,
//             Sumatra) by the app's fixed rule (clusterHotspots), one set per island per UTC day.
//             Signed in-process with RECEIPT_ED25519_KEY and timestamped with OpenTimestamps;
//             refuses to seal without a key or when no calendar answers, like the app
//   3. batch  the previous UTC day's Merkle batch (scripts/lib/seal.ts), never rewritten
//   4. proofs receipts, submissions and batch roots with their .ots files into proofs/
//   5. attest the batches on Base with EAS, only when EAS_PRIVATE_KEY is set
//
// Options: --dry-run, --no-pull, --no-score, --no-seal, --no-batch, --no-attest,
//          --allow-cache-key (sign with the local .cache/ dev key when RECEIPT_ED25519_KEY is unset),
//          --regions Kalimantan,Sumatra
// Needs FIRMS_MAP_KEY (environment, .env.local or .env).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KALIMANTAN_BBOX, SUMATRA_BBOX, clusterHotspots } from '../src/data/firms';
import { computeScore, sealForecast, type Runner, type Sealer } from '../src/data/register';
import { computeSubmissionScore } from '../src/data/submissions';
import { runEnsemble } from '../src/sim/ensemble';
import { canonical, type Signature } from '../src/sim/receipt';
import { dueAt, type RegisterEntry } from '../src/sim/register';
import { submissionDueAt, type ForecastSubmission } from '../src/sim/submission';
import { anchor, cachedKeyPem, signReceiptHash } from '../server/receipt';
import { entryFileName, registerCollection } from '../server/register';
import { blobFromEnv, type BlobLike, type Collection } from '../server/store';
import { submissionsCollection } from '../server/submissions';
import { nodeEnv } from './lib/node-env';
import { sealDay, sealedRecords } from './lib/seal';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = flag('dry-run');
const ROOT = process.cwd();
const PER_REGION = 3;
const REGIONS: Record<string, [number, number, number, number]> = { Kalimantan: KALIMANTAN_BBOX, Sumatra: SUMATRA_BBOX };

const log = (m: string) => console.log(m);
let failures = 0;
const fail = (m: string) => { failures++; console.error(`ERROR ${m}`); };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const env = nodeEnv({ log: (m) => log(`   ${m}`) });
const run: Runner = async (scn, params) => runEnsemble(scn, [], params);
type Entry = RegisterEntry & { score?: unknown };
const register = registerCollection({ readOnly: false, blob: null }) as unknown as Collection<Entry>;
const submissions = submissionsCollection({ readOnly: false, blob: null });
const f2 = (x: number) => x.toFixed(2);
const why = (r: { status: number; error?: string }) => r.error ?? `HTTP ${r.status}`;

/** 0. Copy what the hosted app stored in Blob into data/ (write-once on both sides). */
async function pull(blob: BlobLike): Promise<number> {
  let n = 0;
  for (const [prefix, coll] of [['register', register], ['submissions', submissions]] as const) {
    const c = coll as unknown as Collection<{ score?: unknown }>;
    for (const p of await blob.list(`${prefix}/records/`)) {
      const name = p.slice(`${prefix}/records/`.length);
      const body = await blob.read(p);
      if (!body) continue;
      const rec = JSON.parse(body);
      const hash: string = prefix === 'register' ? rec.record?.receiptSha256 : rec.sha256;
      if (!hash || (await c.find(hash))) continue;
      if (DRY) { log(`pull: would add data/${prefix}/${name}`); continue; }
      const r = await c.add(name, rec);
      if (r.status === 200) n++;
      log(`pull: ${r.status === 200 ? `added ${r.file}` : `skipped ${name} (${r.error})`}`);
    }
    for (const p of await blob.list(`${prefix}/scores/`)) {
      const h16 = p.slice(`${prefix}/scores/`.length, -'.json'.length);
      const rec = await c.find(h16);
      if (!rec || rec.score) continue;
      const body = await blob.read(p);
      if (!body) continue;
      if (DRY) { log(`pull: would attach the score ${p}`); continue; }
      const r = await c.addScore(h16, JSON.parse(body));
      log(`pull: score ${h16} ${r.status === 200 ? 'attached' : `skipped (${why(r)})`}`);
    }
  }
  return n;
}

/** 1. Score everything that is due. */
async function score(now: number) {
  const entries = (await register.list()).filter((e) => !e.score && now >= dueAt(e));
  if (!entries.length) log('score: no register entry is due');
  for (const e of entries) {
    const tag = `${e.issuedAt.slice(0, 16)} ${e.lat.toFixed(3)}, ${e.lon.toFixed(3)} (${e.record.receiptSha256.slice(0, 12)})`;
    try {
      const s = await computeScore(e, run, env.firms);
      const m = s.benchmark!.models;
      log(`score: ${tag}: re-run ${s.reproduced ? 'reproduces the sealed hash' : 'DIFFERS from the sealed hash'}, ${s.detections} detections, ` +
        `new ${s.result.observed}, forecast ${s.result.predicted}, caught ${s.result.hits}; CSI ${f2(s.result.csi)} (distance-only ${f2(s.result.distance.csi)}), ` +
        `Brier ${s.result.brier.toFixed(3)}; distance model CSI ${f2(m.distance.csi)}, climatology Brier ${m.climatology.brier.toFixed(3)}`);
      if (!s.reproduced) fail(`${tag}: the sealed inputs do not reproduce the sealed output hash`);
      if (DRY) continue;
      const r = await register.addScore(e.record.receiptSha256, s);
      if (r.status !== 200) fail(`${tag}: score not written (${why(r)})`);
    } catch (err) { fail(`score ${tag}: ${msg(err)}`); }
  }
  const subs = (await submissions.list()).filter((s) => !s.score && now >= submissionDueAt(s));
  if (!subs.length) log('score: no submission is due');
  for (const s of subs as ForecastSubmission[]) {
    const tag = `${s.forecast.model.id} ${s.forecast.issuedAt} (${s.sha256.slice(0, 12)})`;
    try {
      const sc = await computeSubmissionScore(s, env.firms);
      for (const b of sc.boxes) log(`score: ${tag} @ ${b.box.lat}, ${b.box.lon}: ${Object.entries(b.models).map(([k, v]) => `${k} CSI ${f2(v.csi)} Brier ${v.brier.toFixed(3)}`).join('; ')}`);
      if (DRY) continue;
      const r = await submissions.addScore(s.sha256, sc);
      if (r.status !== 200) fail(`${tag}: score not written (${why(r)})`);
    } catch (err) { fail(`score ${tag}: ${msg(err)}`); }
  }
}

/** The in-process sealer: Ed25519 with the configured key, OpenTimestamps through the public calendars. */
function sealer(): Sealer | null {
  if (DRY) {
    return {
      sign: async () => ({ alg: 'Ed25519', scheme: 'fireseptum-receipt-v2', publicKey: '', keyId: 'dry-run', signedAt: new Date().toISOString(), sig: '' }),
      anchor: async () => ({ calendar: 'dry-run', submittedAt: new Date().toISOString(), otsB64: '' }),
    };
  }
  const pem = process.env.RECEIPT_ED25519_KEY || (flag('allow-cache-key') ? cachedKeyPem() : undefined);
  if (!pem) return null;
  return {
    sign: async (h) => signReceiptHash(pem, h) as Signature,
    anchor: async (h) => {
      const a = await anchor(h);
      if (!a) throw new Error('no OpenTimestamps calendar answered; the forecast is not stored');
      return { calendar: a.calendar, submittedAt: new Date().toISOString(), otsB64: a.ots.toString('base64') };
    },
  };
}

/** 2. Seal today's forecasts (one set per island per UTC day). */
async function seal(now: number): Promise<number> {
  const s = sealer();
  if (!s) { fail('seal: RECEIPT_ED25519_KEY is not set; refusing to seal (use --allow-cache-key for a local dev key)'); return 0; }
  const today = new Date(now).toISOString().slice(0, 10);
  const existing = await register.list();
  let sealed = 0;
  for (const region of opt('regions', Object.keys(REGIONS).join(',')).split(',')) {
    const bbox = REGIONS[region];
    if (!bbox) { fail(`seal: unknown region ${region}`); continue; }
    const done = existing.filter((e) => e.issuedAt.slice(0, 10) === today && (e.region === region || e.rule.includes(` in ${region} `)));
    if (done.length) { log(`seal: ${region} already has ${done.length} forecast(s) sealed today (UTC); skipping`); continue; }
    try {
      const { hotspots } = await env.firms(bbox, 1);
      const top = clusterHotspots(hotspots).slice(0, PER_REGION);
      if (!top.length) { log(`seal: no fires detected in ${region} in the last 24 h`); continue; }
      const rule = `Top ${PER_REGION} FIRMS clusters in ${region} (last 24 h, ranked by detections + FRP/50), picked automatically at issue time.`;
      for (const c of top) {
        const tag = `${region} ${c.lat.toFixed(3)}, ${c.lon.toFixed(3)} (${c.count} detections, FRP ${c.frpSum.toFixed(0)} MW)`;
        try {
          const e = await sealForecast(c.lat, c.lon, rule, run, { env, sealer: s, region });
          if (DRY) { log(`seal: ${tag}: would store receipt ${e.record.receiptSha256.slice(0, 16)} (dry run: not signed, anchored or written)`); continue; }
          const r = await register.add(entryFileName(e.issuedAt, e.record.receiptSha256), e);
          if (r.status === 200) { sealed++; log(`seal: ${tag}: ${r.file}, timestamped via ${e.record.anchor!.calendar}`); }
          else fail(`seal ${tag}: ${r.error}`);
        } catch (err) { fail(`seal ${tag}: ${msg(err)}`); }
      }
    } catch (err) { fail(`seal ${region}: ${msg(err)}`); }
  }
  return sealed;
}

/** 4. proofs/: receipts (export-proofs.mjs) and submissions, each with its .ots file. */
async function exportProofs() {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'export-proofs.mjs')], { stdio: 'inherit', cwd: ROOT });
  const out = join(ROOT, 'proofs');
  mkdirSync(out, { recursive: true });
  for (const s of await submissions.list()) {
    const name = `fireseptum-forecast-${s.sha256.slice(0, 12)}.json`;
    if (existsSync(join(out, name))) continue;
    writeFileSync(join(out, name), canonical(s.forecast));
    if (s.anchor) writeFileSync(join(out, `${name}.ots`), Buffer.from(s.anchor.otsB64, 'base64'));
    log(`proofs: ${name}${s.anchor ? ' + .ots' : ''}`);
  }
}

async function main() {
  const now = Date.now();
  let pulled = 0;
  log(`register-daily ${new Date(now).toISOString()}${DRY ? ' (dry run: nothing is signed, anchored or written)' : ''}`);
  const blob = blobFromEnv();
  if (blob && !flag('no-pull')) { try { pulled = await pull(blob); } catch (e) { fail(`pull: ${msg(e)}`); } }
  if (!flag('no-score')) await score(now);
  let changed = 0;
  if (!flag('no-seal')) changed += await seal(now);
  if (!flag('no-batch')) {
    const yesterday = new Date(now - 864e5).toISOString().slice(0, 10);
    try {
      const r = await sealDay(yesterday, await sealedRecords(ROOT), { root: ROOT, dryRun: DRY, log: (m) => log(`batch: ${m}`) });
      if (r === 'sealed') changed++;
    } catch (e) { fail(`batch: ${msg(e)}`); }
  }
  // Submissions pulled from Blob count as changes too, so their proofs are exported on the same run.
  if (!DRY && (changed || pulled)) { try { await exportProofs(); } catch (e) { fail(`proofs: ${msg(e)}`); } }
  if (!flag('no-attest') && !DRY) {
    if (process.env.EAS_PRIVATE_KEY) {
      try { execFileSync(process.execPath, [join(ROOT, 'scripts', 'attest.mjs'), '--all'], { stdio: 'inherit', cwd: ROOT }); } catch (e) { fail(`attest: ${msg(e)}`); }
    } else log('attest: EAS_PRIVATE_KEY not set; skipped');
  }
  log(`done: ${failures ? `${failures} problem(s)` : 'no problems'}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(msg(e)); process.exit(1); });
