// Join the FWI System values to the extracted boxes and write the training tables.
//
//   npx tsx scripts/ml/assemble.ts            # needs .cache/ml/boxes.jsonl (extract.ts)
//
// FWI: data/fwi/era5-<year>.json.gz (ml/forecast/era5.py), read with src/data/fwiArchive.ts at the
// nearest 0.5° point on fwiDateAt(t0) (the latest 05 UTC value at or before t0), and written into
// the FWI columns with fwiFeatureValues, the same function live inference uses. Years without an
// FWI file keep NaN there (reported in the manifest).
//
// Output (.cache/ml/): rows_<split>.csv (one row per candidate block: id, split, island, year,
// block, the features in FEATURE_NAMES order, y1 y2 y3; NaN as an empty field, numbers written in
// JavaScript's shortest round-trip form) and manifest.json (counts, failures, FWI coverage).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fwiArchiveFrom, parseFwiArchiveYear, type FwiArchiveYear } from '../../src/data/fwiArchive.ts';
import { FEATURE_NAMES, FWI_FEATURES, fwiDateAt, fwiFeatureValues, NF } from '../../src/sim/features.ts';
import { LEADS, loadBoxes, ML_DIR, readJsonl, ROOT } from './common.ts';

interface Line {
  id: string; ok: boolean; split: string; island?: string; d?: string; t0?: string; lat?: number; lon?: number; error?: string;
  blocks?: number[]; x?: (number | null)[][]; y?: number[][]; detections?: number[]; newFires?: number[];
  peatMap?: string; barriers?: string; drain?: boolean; fireHistory?: boolean; known?: number; firms?: string;
}

const lines = readJsonl<Line>(join(ML_DIR, 'boxes.jsonl'));
const expected = loadBoxes();
const years = [...new Set([...lines.values()].filter((l) => l.ok).map((l) => Number(l.d!.slice(0, 4))))].sort();
const docs: FwiArchiveYear[] = [];
const fwiFiles: Record<string, string | null> = {};
for (const y of years) {
  const f = join(ROOT, 'data', 'fwi', `era5-${y}.json.gz`);
  if (!existsSync(f)) { fwiFiles[y] = null; continue; }
  const buf = readFileSync(f);
  fwiFiles[y] = createHash('sha256').update(buf).digest('hex');
  docs.push(await parseFwiArchiveYear(new Uint8Array(buf)));
}
const fwi = fwiArchiveFrom(docs);
const fwiCol = FWI_FEATURES.map(([n]) => FEATURE_NAMES.indexOf(n));

const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : String(v));
const header = ['id', 'split', 'island', 'year', 'block', ...FEATURE_NAMES, ...LEADS.map((l) => `y${l}`)].join(',');
const bySplit = new Map<string, string[]>();
const stats: Record<string, any> = {};
const fwiMissing: string[] = [];
const fwiDist: number[] = [];
for (const b of expected) {
  const st = (stats[b.split] ??= { boxesExpected: 0, boxesOk: 0, boxesFailed: 0, failures: {} as Record<string, number>, boxesNoCandidates: 0, rows: 0, positives: [0, 0, 0], boxesWithNewFire: [0, 0, 0], boxesFwi: 0, boxesNoDrain: 0, boxesNoFireHistory: 0, barriers: {} as Record<string, number>, peatMap: {} as Record<string, number> });
  st.boxesExpected++;
  const l = lines.get(b.id);
  if (!l) { st.failures['not extracted'] = (st.failures['not extracted'] ?? 0) + 1; st.boxesFailed++; continue; }
  if (!l.ok) {
    const why = (l.error ?? 'unknown').replace(/[0-9.,-]{6,}/g, '…').slice(0, 120);
    st.failures[why] = (st.failures[why] ?? 0) + 1; st.boxesFailed++; continue;
  }
  st.boxesOk++;
  st.barriers[l.barriers ?? '?'] = (st.barriers[l.barriers ?? '?'] ?? 0) + 1;
  st.peatMap[l.peatMap ?? '?'] = (st.peatMap[l.peatMap ?? '?'] ?? 0) + 1;
  if (!l.drain) st.boxesNoDrain++;
  if (!l.fireHistory) st.boxesNoFireHistory++;
  if (!l.blocks!.length) { st.boxesNoCandidates++; continue; }
  const v = fwi.at(l.lat!, l.lon!, fwiDateAt(l.t0!));
  if (v) { st.boxesFwi++; fwiDist.push(v.distKm); } else fwiMissing.push(l.id);
  const fv = fwiFeatureValues(v);
  const rows = bySplit.get(l.split) ?? bySplit.set(l.split, []).get(l.split)!;
  l.blocks!.forEach((blk, i) => {
    const x = l.x![i];
    if (x.length !== NF) throw new Error(`${l.id}: ${x.length} features, expected ${NF} (re-extract after changing features.ts)`);
    const row = x.slice();
    fwiCol.forEach((c, j) => { row[c] = Number.isFinite(fv[j]) ? fv[j] : null; });
    const ys = LEADS.map((_, k) => l.y![k][i]);
    ys.forEach((y, k) => { st.positives[k] += y; });
    rows.push([l.id, l.split, l.island, l.d!.slice(0, 4), blk, ...row.map(fmt), ...ys].join(','));
  });
  LEADS.forEach((_, k) => { if (l.y![k].some((y) => y)) st.boxesWithNewFire[k]++; });
  st.rows += l.blocks!.length;
}
for (const [split, rows] of bySplit) writeFileSync(join(ML_DIR, `rows_${split}.csv`), header + '\n' + rows.join('\n') + '\n');
const eventsSha = createHash('sha256').update(readFileSync(join(ROOT, 'data', 'validation', 'events.json'))).digest('hex');
const trainSha = createHash('sha256').update(readFileSync(join(ROOT, 'data', 'validation', 'train-boxes.json'))).digest('hex');
fwiDist.sort((a, b) => a - b);
const manifest = {
  kind: 'fireseptum.forecaster-tables', v: 1, builtAt: new Date().toISOString(),
  eventsSha256: eventsSha, trainBoxesSha256: trainSha,
  features: FEATURE_NAMES, leads: LEADS, fwiFiles,
  fwiNearestPointKm: fwiDist.length ? { median: fwiDist[Math.floor(fwiDist.length / 2)], max: fwiDist.at(-1) } : null,
  fwiMissingBoxes: fwiMissing.length, splits: stats,
};
writeFileSync(join(ML_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
for (const [s, st] of Object.entries(stats)) console.log(`${s.padEnd(13)} boxes ${st.boxesOk}/${st.boxesExpected} ok, ${st.boxesFailed} failed, ${st.boxesNoCandidates} without candidates, FWI ${st.boxesFwi}; rows ${st.rows}; positives ${st.positives.join('/')}`);
console.log(`FWI files: ${JSON.stringify(Object.fromEntries(Object.entries(fwiFiles).map(([y, h]) => [y, h ? 'ok' : 'missing'])))}`);
