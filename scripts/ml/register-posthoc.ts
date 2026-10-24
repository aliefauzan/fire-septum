// POST HOC, NOT PRE-REGISTERED: the GBM forecaster on the six sealed register boxes of 20 Oct 2026.
//
//   npx tsx scripts/ml/register-posthoc.ts          # writes .cache/ml/register-posthoc.json
//
// The register entries (data/register/*.json) were sealed with the cellular automaton's forecast
// before their windows opened. The GBM did not exist then. Here it is run afterwards on the very
// inputs sealed in each record (scenario, detections known at issue time) with the FWI values of
// the issue day (data/fwi/era5-2026.json.gz, when present), and scored with the record's own
// fire-at-t0 mask and window detections by scoreForecast, next to the scores the record already
// holds for the CA and the two references. It is context, not a prospective result.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fwiArchiveFrom, parseFwiArchiveYear } from '../../src/data/fwiArchive.ts';
import { fwiDateAt } from '../../src/sim/features.ts';
import { BOX_GRID, detectionsInWindow, maskFromString, maskToString, scoreForecast } from '../../src/sim/forecast.ts';
import { observedBlocks } from '../../src/sim/hindcast.ts';
import { gbmBoxForecast, gbmForecastAll, parseGbmModel } from '../../src/sim/gbm.ts';
import { decode, type RunInputs } from '../../src/sim/receipt.ts';
import type { RegisterEntry } from '../../src/sim/register.ts';
import { ML_DIR, ROOT } from './common.ts';

const model = parseGbmModel(JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'forecaster', 'gbm-v1.json'), 'utf8')));
const fwiFile = join(ROOT, 'data', 'fwi', 'era5-2026.json.gz');
const fwi = existsSync(fwiFile) ? fwiArchiveFrom([await parseFwiArchiveYear(new Uint8Array(readFileSync(fwiFile)))]) : null;

const dir = join(ROOT, 'data', 'register');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows: any[] = [];
const vs = join(ROOT, 'docs', 'validation-scale.json');
/** CSI-optimal threshold of the calibrated GBM, lead 1, chosen on validation (evaluate.py). */
const thr: number | null = existsSync(vs) ? (JSON.parse(readFileSync(vs, 'utf8')).thresholds?.gbm_iso?.['1'] ?? null) : null;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const e = JSON.parse(readFileSync(join(dir, f), 'utf8')) as RegisterEntry;
  const bm = e.score?.benchmark;
  if (!bm) { rows.push({ file: f, skipped: 'not scored yet' }); continue; }
  const inputs = decode<RunInputs>(e.record.inputs);
  const s = inputs.scenario;
  const v = fwi?.at(e.lat, e.lon, fwiDateAt(e.issuedAt)) ?? null;
  const [f1] = gbmForecastAll(s, v, { model, t0: e.issuedAt, leads: [1] });
  const [r1] = gbmForecastAll(s, v, { model, t0: e.issuedAt, leads: [1], raw: true });
  const mask = maskFromString(bm.fireAtT0);
  const box = { lat: e.lat, lon: e.lon };
  const cal = scoreForecast(gbmBoxForecast(model, box, e.issuedAt, f1.probabilities), bm.observed, mask);
  const raw = scoreForecast(gbmBoxForecast(model, box, e.issuedAt, r1.probabilities), bm.observed, mask);
  const pick = (x: { csi: number; pod: number; far: number; brier: number; brierSkill: number; hits: number; misses: number; falseAlarms: number; candidates: number; observed: number }) =>
    ({ csi: x.csi, pod: x.pod, far: x.far, brier: x.brier, brierSkillOwnBaseRate: x.brierSkill, hits: x.hits, misses: x.misses, falseAlarms: x.falseAlarms, candidates: x.candidates, observed: x.observed });
  // CSI at the validation threshold (scoreForecast uses p >= 0.5).
  let atThr = null;
  if (thr !== null) {
    const { obs } = observedBlocks(BOX_GRID, mask, detectionsInWindow({ issuedAt: e.issuedAt, windowH: e.windowH, box }, bm.observed));
    let h = 0, m = 0, fa = 0;
    for (let b = 0; b < 256; b++) {
      if (!f1.candidate[b]) continue;
      const yes = f1.probabilities[b] >= thr;
      if (yes && obs[b]) h++; else if (!yes && obs[b]) m++; else if (yes) fa++;
    }
    atThr = { threshold: thr, csi: h / Math.max(1, h + m + fa), hits: h, misses: m, falseAlarms: fa };
  }
  rows.push({
    file: f, issuedAt: e.issuedAt, lat: e.lat, lon: e.lon, region: e.region,
    maskAgrees: maskToString(f1.fireAtT0) === bm.fireAtT0,
    fwi: v ? { date: fwiDateAt(e.issuedAt), dc: v.dc, dmc: v.dmc, ffmc: v.ffmc, fwi: v.fwi, distKm: v.distKm } : null,
    detectionsKnown: (s.hotspots ?? []).length, layers: { drainM: !!s.landscape.drainM, fireYears: !!s.landscape.fireYears },
    gbmIso: pick(cal), gbmRaw: pick(raw), gbmIsoAtValidationThreshold: atThr,
    sealed: Object.fromEntries(Object.entries(bm.models).map(([k, x]) => [k, pick(x)])),
    probabilities: { gbmIso: Array.from(f1.probabilities, (p) => Number(p.toFixed(6))) },
  });
}

// Pooled over the boxes: Brier skill against each box's own base rate pooled as in poolRows (Σ n·BS / Σ n·BS_ref), CSI from summed counts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pool = (get: (r: any) => any) => {
  let h = 0, m = 0, fa = 0, bs = 0, ref = 0;
  for (const r of rows) {
    const x = get(r);
    if (!x) continue;
    h += x.hits; m += x.misses; fa += x.falseAlarms;
    const base = x.observed / Math.max(1, x.candidates);
    bs += x.candidates * x.brier; ref += x.candidates * base * (1 - base);
  }
  return { csi: h / Math.max(1, h + m + fa), pod: h / Math.max(1, h + m), far: fa / Math.max(1, h + fa), hits: h, misses: m, falseAlarms: fa, bssOwnBaseRate: ref > 0 ? 1 - bs / ref : null };
};
const scored = rows.filter((r) => r.gbmIso);
const out = {
  kind: 'fireseptum.register-gbm-posthoc', v: 1, generatedAt: new Date().toISOString(),
  label: 'POST HOC — NOT PRE-REGISTERED. The GBM was trained after these forecasts were sealed and scored; this is context only.',
  model: { path: 'public/data/forecaster/gbm-v1.json', createdAt: model.createdAt },
  fwiFile: fwi ? 'data/fwi/era5-2026.json.gz' : null,
  note: 'Sealed inputs include all three VIIRS satellites (the app\'s live FIRMS), while the model was trained on VIIRS S-NPP only.',
  boxes: rows,
  pooled: {
    boxes: scored.length,
    gbmIso: pool((r) => r.gbmIso), gbmRaw: pool((r) => r.gbmRaw),
    gbmIsoAtValidationThreshold: thr === null ? null : (() => {
      const t = scored.reduce((a, r) => ({ h: a.h + r.gbmIsoAtValidationThreshold.hits, m: a.m + r.gbmIsoAtValidationThreshold.misses, fa: a.fa + r.gbmIsoAtValidationThreshold.falseAlarms }), { h: 0, m: 0, fa: 0 });
      return { threshold: thr, csi: t.h / Math.max(1, t.h + t.m + t.fa), hits: t.h, misses: t.m, falseAlarms: t.fa };
    })(),
    ...Object.fromEntries(['fire-septum-ca', 'distance', 'climatology'].map((k) => [k, pool((r) => r.sealed?.[k])])),
  },
};
writeFileSync(join(ML_DIR, 'register-posthoc.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.pooled, null, 1));
for (const r of scored) console.log(`${r.file}: mask ${r.maskAgrees ? 'same' : 'DIFFERS'}, FWI ${r.fwi ? `DC ${r.fwi.dc.toFixed(0)}` : 'none'}; GBM CSI ${r.gbmIso.csi.toFixed(3)} vs CA ${r.sealed['fire-septum-ca']?.csi.toFixed(3)} vs distance ${r.sealed.distance?.csi.toFixed(3)}`);
