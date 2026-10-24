// Feature and label extraction for the statistical forecaster (docs/forecaster.md).
//
//   npx tsx scripts/ml/extract.ts                         # every split, resumable
//   npx tsx scripts/ml/extract.ts --splits validation --limit 5 --concurrency 4
//
// For every box of the published split (scripts/ml/common.ts loadBoxes) it builds the hindcast
// scenario at t0 with the Node data environment, computes the per-block features
// (src/sim/features.ts, FWI columns left NaN: assemble.ts joins them from data/fwi) and the
// new-fire labels for leads 1–3, and appends one JSON line per box to .cache/ml/boxes.jsonl.
// Boxes already written without error are skipped, so a crashed or stopped run resumes.
//
// FIRMS: 2015–2023 from the yearly VIIRS S-NPP archive files (scripts/lib/firms-archive.ts); the
// 2026 out-of-time events from the FIRMS area API (cached in .cache/firms/), VIIRS S-NPP only for
// split "oot" (the label source of training) and all three VIIRS satellites for "oot_allviirs"
// (what the app reads). Weather is not fetched (features do not use the CA weather); Overpass is
// switched off, so a box outside the OSM snapshot gets no barriers rather than a live query.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DataEnv } from '../../src/data/env.ts';
import type { RawHotspot } from '../../src/data/firms.ts';
import { computeBoxFeatures, FEATURE_NAMES, NF } from '../../src/sim/features.ts';
import { maskToString } from '../../src/sim/forecast.ts';
import { firmsArchive } from '../lib/firms-archive.ts';
import { nodeEnv } from '../lib/node-env.ts';
import { buildBox, firmsWindow, loadBoxes, ML_DIR, nanToNull, pool, readJsonl, ROOT, type MlBox } from './common.ts';

const args = process.argv.slice(2);
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const splits = new Set(arg('splits', 'validation,test,oot,oot_allviirs,train').split(','));
const limit = Number(arg('limit', '0'));
const conc = Number(arg('concurrency', '6'));
const OUT = join(ML_DIR, 'boxes.jsonl');
mkdirSync(ML_DIR, { recursive: true });

const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const base = nodeEnv({ log: (m) => log(`  ${m}`) });
const noOverpass = async () => { throw new Error('Overpass is switched off in batch extraction'); };
const env: DataEnv = { ...base, overpass: noOverpass };
const archive = firmsArchive(join(ROOT, '.cache', 'firms-archive'));

async function detectionsFor(b: MlBox): Promise<{ hs: RawHotspot[]; source: string }> {
  const { from, days } = firmsWindow(b.d);
  const g = (await import('../../src/data/live.ts')).bboxAround(b.lat, b.lon);
  const bbox: [number, number, number, number] = [g.west, g.south, g.east, g.north];
  if (b.split === 'oot' || b.split === 'oot_allviirs') {
    // The area API allows at most 5 days per request: D−2..D+1 (the hindcasts' cached request) + D+2..D+3.
    const a = await base.firms(bbox, 4, from);
    const c = await base.firms(bbox, days - 4, new Date(Date.parse(`${from}T00:00:00Z`) + 4 * 864e5).toISOString().slice(0, 10));
    const r = { hotspots: [...a.hotspots, ...c.hotspots], sources: a.sources };
    return b.split === 'oot'
      ? { hs: r.hotspots.filter((h) => h.satellite === 'N'), source: 'VIIRS_SNPP_NRT (area API)' }
      : { hs: r.hotspots, source: r.sources.join('+') + ' (area API)' };
  }
  const r = await archive.firms(bbox, days, from);
  return { hs: r.hotspots, source: r.sources.join('+') };
}

const done = readJsonl<{ id: string; ok: boolean }>(OUT);
let boxes = loadBoxes().filter((b) => splits.has(b.split) && !done.get(b.id)?.ok);
// Validation, test and out-of-time first, so they are ready early; then train.
const order = ['oot', 'oot_allviirs', 'validation', 'test', 'train'];
boxes.sort((a, b) => order.indexOf(a.split) - order.indexOf(b.split));
if (limit) boxes = boxes.slice(0, limit);
log(`${boxes.length} boxes to extract (${done.size} lines already in ${OUT}), concurrency ${conc}, ${NF} features`);

const t = Date.now();
let n = 0, failed = 0;
await pool(boxes, conc, async (b) => {
  try {
    const { hs, source } = await detectionsFor(b);
    const built = await buildBox(b, hs, env);
    const s = built.scenario;
    const f = computeBoxFeatures({ landscape: s.landscape, init: s.init, hotspots: s.hotspots ?? [], t0: b.t0, fwi: null });
    const cand: number[] = [];
    for (let k = 0; k < f.candidate.length; k++) if (f.candidate[k]) cand.push(k);
    const line = {
      id: b.id, ok: true, split: b.split, island: b.island, d: b.d, t0: b.t0, lat: b.lat, lon: b.lon,
      firms: source, known: (s.hotspots ?? []).length,
      peatMap: s.provenance.peatMap, barriers: s.provenance.barriers,
      drain: !!s.landscape.drainM, fireHistory: !!s.landscape.fireYears,
      fireAtT0: maskToString(f.fireAtT0),
      blocks: cand,
      x: cand.map((k) => Array.from(f.x.subarray(k * NF, (k + 1) * NF), nanToNull)),
      y: built.labels.map((lb) => cand.map((k) => lb.obs[k])),
      detections: built.labels.map((lb) => lb.detections),
      newFires: built.labels.map((lb) => lb.newFires),
      warnings: built.warnings,
    };
    appendFileSync(OUT, JSON.stringify(line) + '\n');
  } catch (e) {
    failed++;
    appendFileSync(OUT, JSON.stringify({ id: b.id, ok: false, split: b.split, error: e instanceof Error ? e.message : String(e) }) + '\n');
    log(`FAILED ${b.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  n++;
  if (n % 25 === 0 || n === boxes.length) {
    const rate = n / ((Date.now() - t) / 1000);
    log(`${n}/${boxes.length} (${failed} failed), ${rate.toFixed(2)} boxes/s, ~${((boxes.length - n) / rate / 60).toFixed(0)} min left; at ${b.split} ${b.id}`);
  }
});
log(`done: ${n} boxes, ${failed} failed, ${((Date.now() - t) / 60000).toFixed(1)} min. Columns: ${FEATURE_NAMES.length} features.`);
