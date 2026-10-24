// Batch hindcast and event recording. Runs in Node (scripts/hindcast-batch.ts,
// scripts/record-event.ts, with scripts/lib/node-env.ts) or in the dev server's browser console
// (the default env):
//
//   const b = await import('/src/data/hindcastBatch.ts');
//   const r = await b.runHindcastBatch(b.VALIDATION_EVENTS, [3, 6], (s) => console.log(s));
//   copy(JSON.stringify(r));                       // → docs/hindcast-rerun-<date>.json
//   copy(await b.recordEvent(-2.8179, 110.6934, '2026-10-18'));  // → src/data/events/…json
import { runEnsemble } from '../sim/ensemble';
import { scoreHindcast } from '../sim/hindcast';
import { DEFAULT_PARAMS } from '../sim/model';
import { encode } from '../sim/receipt';
import { browserEnv, type DataEnv } from './env';
import { buildHindcast, HINDCAST_WINDOW_H, type HindcastOptions } from './hindcast';

export interface ValidationEvent { isl: 'Kalimantan' | 'Sumatra'; lat: number; lon: number; d: string }

/** The 12 events of docs/hindcast.md: the busiest 6.4 km box per island on 8–18 Oct 2026, every second day. */
export const VALIDATION_EVENTS: ValidationEvent[] = [
  { isl: 'Kalimantan', lat: -2.5235, lon: 113.0298, d: '2026-10-08' },
  { isl: 'Kalimantan', lat: -3.1011, lon: 112.1923, d: '2026-10-10' },
  { isl: 'Kalimantan', lat: -3.3284, lon: 112.1442, d: '2026-10-12' },
  { isl: 'Kalimantan', lat: -2.8114, lon: 110.6903, d: '2026-10-14' },
  { isl: 'Kalimantan', lat: -2.8132, lon: 110.6886, d: '2026-10-16' },
  { isl: 'Kalimantan', lat: -2.8179, lon: 110.6934, d: '2026-10-18' },
  { isl: 'Sumatra', lat: -1.8698, lon: 103.9044, d: '2026-10-08' },
  { isl: 'Sumatra', lat: -3.5741, lon: 105.7519, d: '2026-10-10' },
  { isl: 'Sumatra', lat: -3.5711, lon: 105.7507, d: '2026-10-12' },
  { isl: 'Sumatra', lat: -3.389, lon: 105.2462, d: '2026-10-14' },
  { isl: 'Sumatra', lat: -3.3833, lon: 105.2407, d: '2026-10-16' },
  { isl: 'Sumatra', lat: -3.393, lon: 105.2368, d: '2026-10-18' },
];

/** Named scenario-building variants for comparison runs. */
export const VARIANTS = {
  /** Real peat and land cover, no rivers, canals or roads (as the 24 Oct 2026 re-run). */
  none: { barriers: false },
  /** + OSM snapshot barriers (full and partial), no drained-peat term. */
  barriers: { barriers: true, drainage: false },
  /** + barriers + drained peat near canals and ditches (the app default). */
  'barriers+drainage': { barriers: true, drainage: true },
} satisfies Record<string, HindcastOptions>;
export type VariantKey = keyof typeof VARIANTS;

export interface TauScore { obs: number; pred: number; hits: number; miss: number; fa: number; csi: number; dcsi: number; bss: number; cand: number }
export interface BatchRow extends ValidationEvent {
  /** Scenario-building variant (absent in batches made before the variants existed). */
  variant?: string;
  t0: string;
  fuel: string;
  peatMap: string;
  obsDet: number;
  warnings: string[];
  /** Keyed by τ in hours, as a string. */
  scores: Record<string, TauScore>;
}
export interface BatchResult { done: number; rows: BatchRow[]; err: string[]; ranAt: string }

export async function runHindcastBatch(
  events: ValidationEvent[], taus: number[], log: (s: string) => void = () => {},
  variants: Partial<Record<string, HindcastOptions>> = { default: {} }, env: DataEnv = browserEnv,
): Promise<BatchResult> {
  const out: BatchResult = { done: 0, rows: [], err: [], ranAt: new Date().toISOString() };
  const named = Object.keys(variants).length > 1 || !('default' in variants);
  for (const ev of events) {
    for (const [name, opts] of Object.entries(variants)) {
      try {
        const { scenario: s, warnings } = await buildHindcast(ev.lat, ev.lon, ev.d, opts ?? {}, env);
        const h = s.hindcast!;
        const row: BatchRow = { ...ev, ...(named ? { variant: name } : {}), t0: h.t0, fuel: s.provenance.fuel, peatMap: s.provenance.peatMap ?? 'synthetic', obsDet: h.observed.length, warnings, scores: {} };
        for (const tau of taus) {
          const e = runEnsemble(s, [], { ...DEFAULT_PARAMS, tauH: tau });
          const sc = scoreHindcast(s.landscape, s.init, e, h.observed, Math.min(HINDCAST_WINDOW_H, s.horizonH));
          row.scores[String(tau)] = { obs: sc.observed, pred: sc.predicted, hits: sc.hits, miss: sc.misses, fa: sc.falseAlarms, csi: sc.csi, dcsi: sc.distance.csi, bss: sc.brierSkill, cand: sc.candidates };
        }
        out.rows.push(row);
        log(`${ev.isl} ${ev.d}${named ? ` [${name}]` : ''}: ${taus.map((t) => `τ${t} CSI ${row.scores[String(t)].csi.toFixed(2)} (dist ${row.scores[String(t)].dcsi.toFixed(2)})`).join(', ')}`);
      } catch (e) {
        out.err.push(`${ev.isl} ${ev.d}${named ? ` [${name}]` : ''}: ${e instanceof Error ? e.message : String(e)}`);
        log(`${ev.isl} ${ev.d}${named ? ` [${name}]` : ''}: FAILED ${String(e)}`);
      }
    }
    out.done++;
  }
  return out;
}

/** Build a hindcast scenario from live data and return it as the JSON stored under src/data/events/. */
export async function recordEvent(lat: number, lon: number, date: string, opts: HindcastOptions = {}, env: DataEnv = browserEnv): Promise<string> {
  const { scenario, warnings } = await buildHindcast(lat, lon, date, opts, env);
  if (warnings.length) console.warn(warnings);
  return JSON.stringify(encode(scenario));
}

export interface PooledScore {
  events: number;
  /** Events with at least one new observed square. */
  withFire: number;
  obs: number; pred: number; hits: number;
  pod: number; far: number; csi: number;
  /** CSI of the distance-only forecasts, pooled from their per-event hits. */
  dcsi: number;
  /**
   * Brier skill pooled over events with new fire: 1 − Σ n·BS / Σ n·BS_ref, n = candidate squares,
   * BS_ref = each event's own base-rate reference. Events without new fire have no reference.
   */
  bss: number;
}

/** Pool rows (one τ) into totals. Distance-only hits are recovered from each row's CSI and size. */
export function poolRows(rows: BatchRow[], tau: number): PooledScore {
  let obs = 0, pred = 0, hits = 0, dHits = 0, dPred = 0, bs = 0, ref = 0, withFire = 0;
  for (const r of rows) {
    const s = r.scores[String(tau)];
    if (!s) continue;
    obs += s.obs; pred += s.pred; hits += s.hits;
    // The distance forecast marks max(1, pred) squares; CSI = h / (obs + n − h) gives its hits h.
    const n = Math.max(1, s.pred);
    dHits += Math.round((s.dcsi * (s.obs + n)) / (1 + s.dcsi));
    dPred += n;
    if (s.obs > 0 && s.cand > 0) {
      withFire++;
      const base = s.obs / s.cand, r0 = base * (1 - base);
      ref += s.cand * r0;
      bs += s.cand * (1 - s.bss) * r0;
    }
  }
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    events: rows.length, withFire, obs, pred, hits,
    pod: ratio(hits, obs), far: ratio(pred - hits, pred), csi: ratio(hits, obs + pred - hits),
    dcsi: ratio(dHits, obs + dPred - dHits),
    bss: ref > 0 ? 1 - bs / ref : 0,
  };
}
