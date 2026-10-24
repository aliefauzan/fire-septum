import { useMemo } from 'react';
import { BURN_CLASS_LABEL, DRIVER_LABEL, classTdmHa, emissions, fmtTonnes, mainDriver, type Drivers, type EmissionRange, type Quantiles } from '../sim/carbon';
import type { Rates } from '../sim/doctrine';
import { GFED_CROSSCHECK, observedEmissions, scenarioNow } from '../sim/frp';
import type { EnsembleResult, Scenario } from '../sim/types';
import { fmtHa } from './status';
import { useCountUp } from './motion';

/** Mean and 10–90% range of area newly burned by hour `at`, across the ensemble. */
export function burnedBy(e: EnsembleResult, at: number) {
  const xs = e.runs.map((r) => { let c = 0; for (let k = 0; k < r.ign.length; k++) if (r.ign[k] > 0 && r.ign[k] <= at) c++; return c * e.cellHa; }).sort((a, b) => a - b);
  const q = (p: number) => xs[Math.min(xs.length - 1, Math.round((xs.length - 1) * p))] ?? 0;
  return { mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p10: q(0.1), p90: q(0.9) };
}

/** True when the peat soil behind the emission numbers is made up. Older records only carry the text. */
export function peatIsSynthetic(scn: Scenario): boolean {
  const p = scn.provenance;
  return p.peatMap ? p.peatMap === 'synthetic' : /synthetic/i.test(p.fuel);
}

/** A number that is seen to change: counts from its previous value to the new one. */
function Counting({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  return <>{fmt(useCountUp(value))}</>;
}

/** Two bars, same scale: what burns with no action, what burns with the plan, and the gap between them in green. */
function DeltaBars({ base, plan }: { base: number; plan: number }) {
  const b = Math.max(1, base);
  const planPct = Math.min(100, (Math.max(0, plan) / b) * 100);
  return (
    <div className="bars" aria-hidden>
      <div className="bar-row"><span>No action</span><div className="bar"><i className="bar-fill base" style={{ width: '100%' }} /></div></div>
      <div className="bar-row"><span>Your plan</span><div className="bar"><i className="bar-fill plan" style={{ width: `${planPct}%` }} />{plan < base && <i className="bar-fill saved" style={{ left: `${planPct}%`, width: `${100 - planPct}%` }} />}</div></div>
    </div>
  );
}

const pctOf = (x: number) => `${Math.round(x * 100)}%`;
const rangeText = (q: Pick<Quantiles, 'p5' | 'p95'>) => `${fmtTonnes(q.p5)}–${fmtTonnes(q.p95)}`;

/** What the satellites have already seen burn: an estimate from observations, shown apart from the forecast. */
function Observed({ scn, rates }: { scn: Scenario; rates: Rates }) {
  const obs = useMemo(() => observedEmissions(scn.landscape, scn.hotspots ?? [], scenarioNow(scn), rates), [scn, rates]);
  if (!obs) return null;
  const peatPct = Math.round(obs.peatShare * 100);
  const g = GFED_CROSSCHECK;
  return (
    <>
      <p className="muted small observed">Already released, by satellite: ≈ <Counting value={obs.tco2e} fmt={fmtTonnes} /> t CO₂e in the last {obs.windowH} h{obs.range ? ` (likely ${rangeText(obs.range)}, 5–95%)` : ''}{peatIsSynthetic(scn) ? ' (peat map synthetic)' : ''}</p>
      <details className="more">
        <summary>How the satellite number is made</summary>
        <p className="muted small">VIIRS fire radiative power from {obs.passes} {obs.passes === 1 ? 'pass' : 'passes'} ({obs.detections} detections), each pass counted until the next one and for at most 12 h, gives {fmtTonnes(obs.freMJ / 1000)} GJ of fire energy, {peatPct}% of it on peat soil. Converted to dry matter with the GFAS factors (peat 5.87 kg/MJ, Kaiser et al. 2012) and to CO₂e with the IPCC emission factors. The range varies the GFAS conversion (×/÷ 2.7 at 90%; the paper gives no uncertainty, so this is the spread of our cross-check) and the emission factors. Smouldering peat radiates little to the sky, so on peat it misses fire it cannot see and is a floor in that sense; holding each pass for up to 12 h pushes the other way. Against GFED this method ran {g.gfed4Pooled[0].toFixed(1)}–{g.gfed4Pooled[2].toFixed(1)}× GFED4.1s on the busiest cells of 2015–2023 and about {g.gfed5Year[0].toFixed(1)}× GFED5.1 for all of Indonesia ({g.doc}): context, not a correction. An estimate from observations, not a measurement and not a carbon credit.</p>
      </details>
    </>
  );
}

/** Variance shares of the three sources, as one stacked bar and a key. */
function DriverBar({ d }: { d: Drivers }) {
  const parts: { k: keyof Drivers; label: string }[] = [{ k: 'spread', label: 'Fire spread' }, { k: 'depth', label: 'Burn depth' }, { k: 'ef', label: 'Emission factors' }];
  return (
    <>
      <div className="drivers" role="img" aria-label={parts.map((p) => `${p.label} ${pctOf(d[p.k])}`).join(', ')}>
        {parts.map((p) => <i key={p.k} className={p.k} style={{ width: `${d[p.k] * 100}%` }} />)}
      </div>
      <div className="driver-key" aria-hidden>{parts.map((p) => <span key={p.k}><i className={p.k} />{p.label} {pctOf(d[p.k])}</span>)}</div>
    </>
  );
}

const driverSentence = (d: Drivers) => {
  const m = mainDriver(d);
  return m.share > 0 ? `Most of the range comes from ${DRIVER_LABEL[m.key]} (${pctOf(m.share)} of the variance).` : '';
};

/** Burned peat by fire-history class, or why there is none. */
function HistoryClasses({ r, rates }: { r: EmissionRange; rates: Rates }) {
  if (!r.history) {
    return <p className="muted small">This scenario carries no fire history (it was made before 24 Oct 2026 or outside the archive), so every burned peat cell uses the IPCC {Math.round(rates.peatBurntTdmHa)} t/ha of a first-time drought fire. Where the peat has burned before, that is too high (Konecny et al. 2016).</p>;
  }
  const T = classTdmHa(rates);
  const total = r.classHa.base.reduce((a, b) => a + b, 0);
  return (
    <>
      <p className="muted small">Burn depth from fire history: each burned peat cell counts the earlier years NASA FIRMS saw fire on it (2001 onward). A detection is not a burned-area map, so an old detection may not have burned the whole cell.</p>
      <div className="class-list" role="table" aria-label="Burned peat by fire history, no action">
        <div role="row" className="head"><span role="columnheader">Burned peat, no action</span><span role="columnheader">t/ha</span><span role="columnheader">ha</span></div>
        {r.classHa.base.map((ha, c) => (
          <div role="row" key={c}><span role="rowheader">{BURN_CLASS_LABEL[c]}</span><span role="cell">{Math.round(T[c])} {c === 0 ? 'IPCC' : 'Konecny'}</span><span role="cell" className="ha-cell">{fmtHa(ha)}{total > 0 ? ` · ${pctOf(ha / total)}` : ''}</span></div>
        ))}
      </div>
    </>
  );
}

/** The one answer people come for: how much burns, and how much the plan saves. */
export function OutcomeCard({ scn, base, plan, hasPlan, busy, rates }: { scn: Scenario; base: EnsembleResult | null; plan: EnsembleResult | null; hasPlan: boolean; busy: boolean; rates: Rates }) {
  const H = scn.horizonH;
  const ready = !!base && !(hasPlan && !plan);
  const em = useMemo(() => (ready && base ? emissions(scn.landscape, base, hasPlan ? plan : null, rates, H) : null), [ready, scn, base, plan, hasPlan, rates, H]);
  if (!base || !em || (hasPlan && !plan)) {
    return (
      <section className="card outcome" aria-label="Outcome" aria-busy>
        <div className="eyebrow">Area burned in {H} h</div>
        <div className="hero muted">Simulating…</div>
      </section>
    );
  }
  const b = burnedBy(base, H);
  const r = em.range;
  const [lo, hi] = em.factorRange;
  const depthNote = r.history
    ? `Factors: IPCC Tier 1 emission factors; peat burnt ${Math.round(rates.peatBurntTdmHa)} t/ha where no earlier fire was seen (95% CI ×${lo.toFixed(1)}–×${hi.toFixed(1)}) and Konecny et al. 2016 classes where it was.`
    : `IPCC Tier 1 for burned peat, ${fmtTonnes(em.perHa)} t CO₂e/ha (burn depth 95% CI ×${lo.toFixed(1)}–×${hi.toFixed(1)}).`;
  const mcNote = `The range is a Monte Carlo of ${r.samples.toLocaleString('en-US')} draws over the ${base.runs.length} spread runs, burn depth and emission factors (the tropical factors come from one study, so their spread is our assumption).`;
  // These tonnes are only as good as the spread forecast and the peat map, so say so every time.
  const syntheticPeat = peatIsSynthetic(scn);
  const peatNote = syntheticPeat ? 'The peat map here is synthetic, so this number is illustrative only. ' : 'Peat soil from the Global Forest Watch peatland map, land cover from ESA WorldCover. ';
  const caveat = `${peatNote}A model estimate, not a measurement and not a carbon credit.`;
  const label = syntheticPeat ? 'illustrative' : 'forecast';
  if (!hasPlan || !plan) {
    return (
      <section className="card outcome" aria-label="Outcome">
        <div className="eyebrow">Burns in {H} h if nothing is done</div>
        <div className="hero"><Counting value={b.mean} fmt={fmtHa} /> <span className="unit">ha</span></div>
        <p className="muted small"><Counting value={r.base.p5} fmt={fmtTonnes} />–<Counting value={r.base.p95} fmt={fmtTonnes} /> t CO₂e from peat, median {fmtTonnes(r.base.median)} (5–95%, {label})</p>
        <p className="muted small">{driverSentence(r.drivers.base)}</p>
        <details className="more">
          <summary>About these numbers</summary>
          <DriverBar d={r.drivers.base} />
          <HistoryClasses r={r} rates={rates} />
          <p className="muted small">Area likely {fmtHa(b.p10)}–{fmtHa(b.p90)} ha. Emissions 10–90% {rangeText({ p5: r.base.p10, p95: r.base.p90 })} t; from the spread runs alone, with central factors, {fmtTonnes(em.base.p10)}–{fmtTonnes(em.base.p90)} t (mean {fmtTonnes(em.base.mean)}). {mcNote} {depthNote} {caveat}</p>
        </details>
        <Observed scn={scn} rates={rates} />
      </section>
    );
  }
  const p = burnedBy(plan, H);
  const saved = b.mean - p.mean;
  const pct = b.mean > 0 ? Math.round((saved / b.mean) * 100) : 0;
  const av = r.avoided;
  return (
    <section className={`card outcome ${busy ? 'stale' : ''}`} aria-label="Outcome">
      <div className="eyebrow">Your plan saves, over {H} h</div>
      <div className="hero">
        <span className="saved-ink"><Counting value={Math.max(0, saved)} fmt={fmtHa} /></span> <span className="unit">ha</span>
        {pct !== 0 && <span className="delta">{pct > 0 ? '−' : '+'}{Math.abs(pct)}%</span>}
      </div>
      <DeltaBars base={b.mean} plan={p.mean} />
      <p className="muted small"><Counting value={p.mean} fmt={fmtHa} /> ha burns instead of {fmtHa(b.mean)} ha{av ? <> · <Counting value={av.p5} fmt={fmtTonnes} />–<Counting value={av.p95} fmt={fmtTonnes} /> t CO₂e avoided, median {fmtTonnes(av.median)} (5–95%, {label})</> : ''}</p>
      {r.drivers.avoided && <p className="muted small">{driverSentence(r.drivers.avoided)}</p>}
      <details className="more">
        <summary>About these numbers</summary>
        {r.drivers.avoided && <DriverBar d={r.drivers.avoided} />}
        <HistoryClasses r={r} rates={rates} />
        <p className="muted small">With the plan, likely {fmtHa(p.p10)}–{fmtHa(p.p90)} ha burns.{av ? ` Emissions avoided 10–90% ${fmtTonnes(av.p10)}–${fmtTonnes(av.p90)} t, compared run by run and draw by draw with doing nothing (${rangeText(r.base)} t, median ${fmtTonnes(r.base.median)}).` : ''} {mcNote} {depthNote} {caveat}</p>
      </details>
      <Observed scn={scn} rates={rates} />
    </section>
  );
}
