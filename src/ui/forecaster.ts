// The statistical forecaster in the app: "Tomorrow" view of the map (src/sim/gbm.ts).
//
// Loads the shipped model once, fetches the FWI System at t0 for real places (src/data/fwiLive.ts)
// and computes the next-24 h chance of new fire per 400 m block from the scenario on screen. The
// simulation is untouched: this layer answers "where", the simulation "what if we act".
import { useEffect, useState } from 'react';
import { fetchFwiAt, type LiveFwi } from '../data/fwiLive';
import { FEATURE_BLOCK } from '../sim/features';
import { GBM_MODEL_PATH, gbmForecast, gbmT0, parseGbmModel, type GbmModel } from '../sim/gbm';
import type { Scenario } from '../sim/types';
import type { ForecastLayer } from './render';

let modelP: Promise<GbmModel> | null = null;
const loadModel = () =>
  (modelP ??= fetch(`/${GBM_MODEL_PATH}`).then((r) => {
    if (!r.ok) throw new Error(`forecaster model: HTTP ${r.status}`);
    return r.json();
  }).then(parseGbmModel).catch((e) => { modelP = null; throw e; }));

const fwiCache = new Map<string, Promise<LiveFwi>>();
function fwiFor(lat: number, lon: number, t0: string): Promise<LiveFwi> {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)},${t0.slice(0, 10)}`;
  let p = fwiCache.get(k);
  if (!p) { p = fetchFwiAt(lat, lon, t0); fwiCache.set(k, p); p.catch(() => fwiCache.delete(k)); }
  return p;
}

export interface ForecasterState {
  layer: ForecastLayer | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  t0?: string;
  /** Fire weather used, or why there is none. */
  fwi?: LiveFwi;
  fwiNote?: string;
  maxP?: number;
  synthetic: boolean;
}

export function useForecaster(s: Scenario, enabled: boolean): ForecasterState {
  const synthetic = s.provenance.kind === 'synthetic' || !s.landscape.geo;
  const [st, setSt] = useState<ForecasterState>({ layer: null, status: 'idle', synthetic });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setSt({ layer: null, status: 'loading', synthetic });
    const t0 = gbmT0(s);
    const g = s.landscape.geo;
    const fwiP: Promise<LiveFwi | null> = g && !synthetic ? fwiFor((g.north + g.south) / 2, (g.east + g.west) / 2, t0) : Promise.resolve(null);
    Promise.all([loadModel(), fwiP.catch((e) => e as Error)]).then(([model, f]) => {
      if (!live) return;
      const fwi = f instanceof Error || !f ? null : f;
      const fwiNote = f instanceof Error ? `fire weather unavailable (${f.message}); the model used its missing-value branches` : !f ? 'no location: fire weather unknown' : undefined;
      const r = gbmForecast(s, fwi?.values ?? null, { model, t0 });
      let maxP = 0;
      for (const p of r.probabilities) if (p > maxP) maxP = p;
      setSt({ layer: { probabilities: r.probabilities, fireAtT0: r.fireAtT0, block: FEATURE_BLOCK }, status: 'ready', t0, fwi: fwi ?? undefined, fwiNote, maxP, synthetic });
    }).catch((e) => { if (live) setSt({ layer: null, status: 'error', error: e instanceof Error ? e.message : String(e), synthetic }); });
    return () => { live = false; };
    // The scenario object changes identity on every rebuild; landscape + init + hotspots are what the features read.
  }, [enabled, s.landscape, s.init, s.hotspots, s.hindcast?.t0, synthetic]);
  return st;
}
