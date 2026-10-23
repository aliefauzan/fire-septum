import { useMemo } from 'react';
import { scoreHindcast } from '../sim/hindcast';
import type { EnsembleResult, Scenario } from '../sim/types';
import { fmtPct } from './status';

/** How the no-action forecast compares with what satellites saw next. */
export function HindcastCard({ scn, base, showObserved, setShowObserved }: { scn: Scenario; base: EnsembleResult | null; showObserved: boolean; setShowObserved: (v: boolean) => void }) {
  const h = scn.hindcast!;
  const s = useMemo(
    () => (base ? scoreHindcast(scn.landscape, scn.init, base, h.observed, Math.min(h.windowH, scn.horizonH)) : null),
    [scn, base, h],
  );
  return (
    <section className="card outcome" aria-label="Hindcast">
      <div className="eyebrow">Forecast check, next {h.windowH} h</div>
      {!s ? <div className="hero muted">Scoring…</div> : s.observed === 0 ? (
        <p className="muted small">No new fire was detected within {s.reachKm} km of the existing fire, so there is nothing to score.</p>
      ) : (
        <>
          <div className="hero">{s.hits} <span className="unit">of {s.observed} new fire spots caught</span></div>
          <p className="muted small">{s.misses} missed · {fmtPct(s.far)} false alarms · CSI {s.csi.toFixed(2)} vs {s.distance.csi.toFixed(2)} for distance alone</p>
          <label className="switch">
            <input type="checkbox" checked={showObserved} onChange={(e) => setShowObserved(e.target.checked)} />
            <span>Show what satellites saw on the map</span>
          </label>
          <details className="more">
            <summary>How this is scored</summary>
            <p className="muted small">
              Spots are {s.block * 100} m squares, about one satellite pixel. CSI counts hits over hits, misses and false alarms (1 is perfect).
              Distance-only marks the same number of squares nearest the fire, so a higher model score means wind, slope and fuel helped.
              {s.newFires ? ` ${s.newFires} new fires more than ${s.reachKm} km away are not scored.` : ''} Satellites miss fire under smoke, cloud and smouldering peat, so some false alarms may be real.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
