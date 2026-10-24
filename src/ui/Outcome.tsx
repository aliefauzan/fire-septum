import { emissions, fmtTonnes } from '../sim/carbon';
import type { Rates } from '../sim/doctrine';
import { observedEmissions, scenarioNow } from '../sim/frp';
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

/** What the satellites have already seen burn: an estimate from observations, shown apart from the forecast. */
function Observed({ scn, rates }: { scn: Scenario; rates: Rates }) {
  const obs = observedEmissions(scn.landscape, scn.hotspots ?? [], scenarioNow(scn), rates);
  if (!obs) return null;
  const peatPct = Math.round(obs.peatShare * 100);
  return (
    <>
      <p className="muted small observed">Already released, by satellite: ≈ <Counting value={obs.tco2e} fmt={fmtTonnes} /> t CO₂e in the last {obs.windowH} h{peatIsSynthetic(scn) ? ' (peat map synthetic)' : ''}</p>
      <details className="more">
        <summary>How the satellite number is made</summary>
        <p className="muted small">VIIRS fire radiative power from {obs.passes} {obs.passes === 1 ? 'pass' : 'passes'} ({obs.detections} detections), each pass counted until the next one and for at most 12 h, gives {fmtTonnes(obs.freMJ / 1000)} GJ of fire energy, {peatPct}% of it on peat soil. Converted to dry matter with the GFAS factors (peat 5.87 kg/MJ, Kaiser et al. 2012) and to CO₂e with the IPCC emission factors. Smouldering peat radiates little to the sky, so on peat this is a floor. An estimate from observations, not a measurement and not a carbon credit.</p>
      </details>
    </>
  );
}

/** The one answer people come for: how much burns, and how much the plan saves. */
export function OutcomeCard({ scn, base, plan, hasPlan, busy, rates }: { scn: Scenario; base: EnsembleResult | null; plan: EnsembleResult | null; hasPlan: boolean; busy: boolean; rates: Rates }) {
  const H = scn.horizonH;
  if (!base || (hasPlan && !plan)) {
    return (
      <section className="card outcome" aria-label="Outcome" aria-busy>
        <div className="eyebrow">Area burned in {H} h</div>
        <div className="hero muted">Simulating…</div>
      </section>
    );
  }
  const b = burnedBy(base, H);
  const em = emissions(scn.landscape, base, hasPlan ? plan : null, rates, H);
  const [lo, hi] = em.factorRange;
  const factorNote = `IPCC Tier 1 for burned peat, ${fmtTonnes(em.perHa)} t CO₂e/ha. Burn depth could make it ×${lo.toFixed(1)} to ×${hi.toFixed(1)}; on peat that has burned before it is usually lower (Konecny et al. 2016).`;
  // These tonnes are only as good as the spread forecast and the peat map, so say so every time.
  const syntheticPeat = peatIsSynthetic(scn);
  const peatNote = syntheticPeat ? 'The peat map here is synthetic, so this number is illustrative only. ' : 'Peat soil from the Global Forest Watch peatland map, land cover from ESA WorldCover. ';
  const caveat = `${peatNote}A model estimate, not a measurement and not a carbon credit.`;
  if (!hasPlan || !plan) {
    return (
      <section className="card outcome" aria-label="Outcome">
        <div className="eyebrow">Burns in {H} h if nothing is done</div>
        <div className="hero"><Counting value={b.mean} fmt={fmtHa} /> <span className="unit">ha</span></div>
        <p className="muted small">≈ <Counting value={em.base.mean} fmt={fmtTonnes} /> t CO₂e from peat{syntheticPeat ? ' (illustrative)' : ' (forecast)'}</p>
        <details className="more">
          <summary>About these numbers</summary>
          <p className="muted small">Area likely {fmtHa(b.p10)}–{fmtHa(b.p90)} ha. Emissions likely {fmtTonnes(em.base.p10)}–{fmtTonnes(em.base.p90)} t. {factorNote} {caveat}</p>
        </details>
        <Observed scn={scn} rates={rates} />
      </section>
    );
  }
  const p = burnedBy(plan, H);
  const saved = b.mean - p.mean;
  const pct = b.mean > 0 ? Math.round((saved / b.mean) * 100) : 0;
  return (
    <section className={`card outcome ${busy ? 'stale' : ''}`} aria-label="Outcome">
      <div className="eyebrow">Your plan saves, over {H} h</div>
      <div className="hero">
        <span className="saved-ink"><Counting value={Math.max(0, saved)} fmt={fmtHa} /></span> <span className="unit">ha</span>
        {pct !== 0 && <span className="delta">{pct > 0 ? '−' : '+'}{Math.abs(pct)}%</span>}
      </div>
      <DeltaBars base={b.mean} plan={p.mean} />
      <p className="muted small"><Counting value={p.mean} fmt={fmtHa} /> ha burns instead of {fmtHa(b.mean)} ha{em.avoided ? <> · ≈ <Counting value={em.avoided.mean} fmt={fmtTonnes} /> t CO₂e avoided{syntheticPeat ? ' (illustrative)' : ' (forecast)'}</> : ''}</p>
      <details className="more">
        <summary>About these numbers</summary>
        <p className="muted small">With the plan, likely {fmtHa(p.p10)}–{fmtHa(p.p90)} ha burns.{em.avoided ? ` Emissions avoided likely ${fmtTonnes(em.avoided.p10)}–${fmtTonnes(em.avoided.p90)} t, compared run by run with doing nothing (${fmtTonnes(em.base.mean)} t).` : ''} {factorNote} {caveat}</p>
      </details>
      <Observed scn={scn} rates={rates} />
    </section>
  );
}
