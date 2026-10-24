// Batch hindcast and event recording, run from the dev server's browser console (the tile
// loaders need the browser's image decoder):
//
//   const b = await import('/src/data/hindcastBatch.ts');
//   const r = await b.runHindcastBatch(b.VALIDATION_EVENTS, [3, 6], (s) => console.log(s));
//   copy(JSON.stringify(r));                       // → docs/hindcast-rerun-<date>.json
//   copy(await b.recordEvent(-2.8179, 110.6934, '2026-10-18'));  // → src/data/events/…json
import { runEnsemble } from '../sim/ensemble';
import { scoreHindcast } from '../sim/hindcast';
import { DEFAULT_PARAMS } from '../sim/model';
import { encode } from '../sim/receipt';
import { buildHindcast, HINDCAST_WINDOW_H } from './hindcast';

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

export interface TauScore { obs: number; pred: number; hits: number; miss: number; fa: number; csi: number; dcsi: number; bss: number; cand: number }
export interface BatchRow extends ValidationEvent {
  t0: string;
  fuel: string;
  peatMap: string;
  obsDet: number;
  warnings: string[];
  /** Keyed by τ in hours, as a string. */
  scores: Record<string, TauScore>;
}
export interface BatchResult { done: number; rows: BatchRow[]; err: string[]; ranAt: string }

export async function runHindcastBatch(events: ValidationEvent[], taus: number[], log: (s: string) => void = () => {}): Promise<BatchResult> {
  const out: BatchResult = { done: 0, rows: [], err: [], ranAt: new Date().toISOString() };
  for (const ev of events) {
    try {
      const { scenario: s, warnings } = await buildHindcast(ev.lat, ev.lon, ev.d);
      const h = s.hindcast!;
      const row: BatchRow = { ...ev, t0: h.t0, fuel: s.provenance.fuel, peatMap: s.provenance.peatMap ?? 'synthetic', obsDet: h.observed.length, warnings, scores: {} };
      for (const tau of taus) {
        const e = runEnsemble(s, [], { ...DEFAULT_PARAMS, tauH: tau });
        const sc = scoreHindcast(s.landscape, s.init, e, h.observed, Math.min(HINDCAST_WINDOW_H, s.horizonH));
        row.scores[String(tau)] = { obs: sc.observed, pred: sc.predicted, hits: sc.hits, miss: sc.misses, fa: sc.falseAlarms, csi: sc.csi, dcsi: sc.distance.csi, bss: sc.brierSkill, cand: sc.candidates };
      }
      out.rows.push(row);
      log(`${ev.isl} ${ev.d}: ${taus.map((t) => `τ${t} CSI ${row.scores[String(t)].csi.toFixed(2)} (dist ${row.scores[String(t)].dcsi.toFixed(2)})`).join(', ')} · ${row.fuel.slice(0, 60)}`);
    } catch (e) {
      out.err.push(`${ev.isl} ${ev.d}: ${e instanceof Error ? e.message : String(e)}`);
      log(`${ev.isl} ${ev.d}: FAILED ${String(e)}`);
    }
    out.done++;
  }
  return out;
}

/** Build a hindcast scenario from live data and return it as the JSON stored under src/data/events/. */
export async function recordEvent(lat: number, lon: number, date: string): Promise<string> {
  const { scenario, warnings } = await buildHindcast(lat, lon, date);
  if (warnings.length) console.warn(warnings);
  return JSON.stringify(encode(scenario));
}
