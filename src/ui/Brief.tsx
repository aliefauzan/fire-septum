import { useEffect, useRef, useState } from 'react';
import { quantile } from '../sim/ensemble';
import { DOCTRINE, SOURCES, dropsPerHeliHour } from '../sim/doctrine';
import { actionDurationH, heliCount } from '../sim/model';
import type { RecommendOutput } from '../sim/recommend';
import { KIND_LABEL } from './Panels';
import { fmtHa, fmtHour } from './status';
import { FACILITY_LABEL, type Inventory, type Logistics } from '../sim/resources';
import type { Action, EnsembleResult, Scenario, SimParams } from '../sim/types';
import { FUEL_LIST } from '../sim/fuels';
import { Segmented } from './Controls';
import { PdfBriefButton } from './PdfBrief';

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function burned(e: EnsembleResult) {
  const s = [...e.burnedHa].sort((a, b) => a - b);
  return { meanHa: Math.round(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)), p10Ha: Math.round(quantile(s, 0.1)), p90Ha: Math.round(quantile(s, 0.9)) };
}

function describeAction(a: Action, params: SimParams) {
  const base = { kind: a.kind, label: a.label, startHour: a.startH, durationH: r1(actionDurationH(a, params.rates)) };
  if (a.kind === 'firebreak') return { ...base, lineFromCell: a.from, lineToCell: a.to, builtBy: a.method === 'hand' ? `${a.crews ?? 1} hand crews` : 'dozer' };
  if (a.kind === 'water') return { ...base, centreCell: [a.cx, a.cy], drops: a.drops, helicopters: heliCount(a, params.rates), product: a.product };
  if (a.kind === 'seeding' || a.kind === 'dryice') return { ...base, sorties: a.sorties, area: 'whole map' };
  if (a.kind === 'inject') return { ...base, centreCell: [a.cx, a.cy], crews: a.crews, additive: a.additive };
  return { ...base, centreCell: [a.cx, a.cy], crews: a.crews };
}

/** Compact, numbers-only digest of the current simulation for the LLM. */
export function briefPayload(scn: Scenario, base: EnsembleResult, plan: EnsembleResult, rec: RecommendOutput | null, actions: Action[], params: SimParams, inventory: Inventory, logistics: Logistics | null) {
  const l = scn.landscape;
  const ws = scn.weather.slice(0, scn.horizonH + 1);
  return {
    scenario: {
      title: scn.title, description: scn.description, provenance: scn.provenance, horizonHours: scn.horizonH,
      startLocalTime: ws[0]?.time ?? null, areaKm: `${(l.w * l.cellM) / 1000} x ${(l.h * l.cellM) / 1000}`,
      rainLast72hMm: scn.antecedentRainMm ?? null, ensembleRuns: base.runs.length,
      hazeGroundsHelicopters: !!scn.haze, bmkgCloudPotential: scn.cloudPotential ?? 'medium',
      centre: l.geo ? { lat: +((l.geo.north + l.geo.south) / 2).toFixed(4), lon: +((l.geo.east + l.geo.west) / 2).toFixed(4) } : null,
    },
    weather: {
      now: ws[0],
      maxWindKmh: Math.round(Math.max(...ws.map((w) => w.windKmh))),
      minHumidityPct: Math.round(Math.min(...ws.map((w) => w.rh))),
      rainyHours: ws.filter((w) => w.precipMm > 0).length,
    },
    zones: l.zones.map((z, i) => ({
      id: z.id, name: z.name, asset: z.asset ?? null, valueWeight: z.weight, mainFuel: FUEL_LIST.find((f) => f.id === z.fuel)?.label,
      noAction: { burningNow: base.zoneStats[i].initiallyBurning, pIgnite: r1(base.zoneStats[i].pIgnite), arrivalMedianH: r1(base.zoneStats[i].etaMedian), arrivalP10H: r1(base.zoneStats[i].etaP10), arrivalP90H: r1(base.zoneStats[i].etaP90), burnedHaMean: Math.round(base.zoneStats[i].burnedHaMean) },
      withPlan: { pIgnite: r1(plan.zoneStats[i].pIgnite), arrivalMedianH: r1(plan.zoneStats[i].etaMedian), burnedHaMean: Math.round(plan.zoneStats[i].burnedHaMean) },
    })),
    newlyBurnedAtHorizon: { noAction: burned(base), withPlan: burned(plan) },
    currentPlan: actions.map((a) => describeAction(a, params)),
    resources: {
      inventory: { helicopters: inventory.helicopters ?? 'unknown', handCrews: inventory.crews ?? 'unknown', dozers: inventory.dozers ?? 'unknown', seedingAircraft: inventory.aircraft ?? 'unknown', source: inventory.source === 'synthetic' ? 'synthetic exercise inventory (not real)' : inventory.source === 'user' ? 'entered by the commander' : 'not entered' },
      mappedNearby: logistics ? logistics.facilities.slice(0, 6).map((f) => ({ name: f.name, type: FACILITY_LABEL[f.kind], km: Math.round(f.km) })) : null,
      bucketDipSite: logistics?.dip ? { name: logistics.dip.name, km: r1(logistics.dip.km) } : null,
      mappedDataSource: logistics?.source ?? null,
      dropsPerHelicopterHour: r1(dropsPerHeliHour(params.rates)),
    },
    doctrine: DOCTRINE.map((d) => ({ rule: d.rule, source: SOURCES[d.source].short })),
    recommendations: (rec?.recommendations ?? []).slice(0, 6).map((r) => ({
      id: r.id, rank: r.rank, title: r.title, where: r.where, what: r.what, when: r.when, why: r.why, impact: r.impact, resources: r.resources,
      availability: r.availability, sources: r.citations.map((c) => SOURCES[c].short),
      savedHaMean: Math.round(r.saved.mean), savedHaP10: Math.round(r.saved.p10), savedHaP90: Math.round(r.saved.p90),
      hectaresSavedByStartHour: r.timing.map((t) => ({ startHour: t.startH, savedHa: Math.round(t.savedHa) })),
    })),
    suggestedStrategy: rec?.strategy ? { ids: rec.strategy.ids, actions: rec.strategy.ids.length, savedHa: Math.round(rec.strategy.saved), zonesStillAtRisk: rec.strategy.remainingRisk } : null,
    notes: rec?.notes ?? [],
  };
}

/** A brief's pick, resolved against the suggestions it was written from (they are recomputed once the plan changes). */
export interface BriefPick {
  id: string; startHour: number; reason: string;
  title: string; kind: Action['kind']; savedHa: number; unknown: boolean; actions: Action[]; bestStartH: number;
}

export function BriefPanel(p: {
  scn: Scenario; base: EnsembleResult | null; plan: EnsembleResult | null; rec: RecommendOutput | null; recLoading: boolean; actions: Action[]; params: SimParams; inventory: Inventory; logistics: Logistics | null;
  onApplyPlan: (picks: BriefPick[]) => void;
  /** What the map shows, printed under it in the PDF brief. */
  mapCaption?: string;
}) {
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [lang, setLang] = useState<'id' | 'en'>('id');
  const [text, setText] = useState<string | null>(null);
  const [picks, setPicks] = useState<BriefPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The actions the brief was written for; anything else means the brief is out of date.
  const [writtenFor, setWrittenFor] = useState<Action[] | null>(null);
  const [applied, setApplied] = useState(false);
  const applying = useRef(false);

  useEffect(() => {
    fetch('/api/brief').then((r) => r.json()).then(setStatus).catch(() => setStatus({ enabled: false, model: null }));
  }, []);
  // A brief describes one scenario; drop it when the scenario changes.
  useEffect(() => { setText(null); setPicks([]); setWrittenFor(null); setApplied(false); }, [p.scn]);
  // Applying the brief's own plan keeps the brief current.
  useEffect(() => {
    if (applying.current) { applying.current = false; setWrittenFor(p.actions); }
  }, [p.actions]);
  const stale = text !== null && writtenFor !== p.actions;

  const run = async () => {
    if (!p.base || !p.plan || !p.rec) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lang, data: briefPayload(p.scn, p.base, p.plan, p.rec, p.actions, p.params, p.inventory, p.logistics) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const resolved: BriefPick[] = [];
      for (const x of (j.plan ?? []) as { id: string; startHour: number; reason: string }[]) {
        const r = p.rec?.recommendations.find((q) => q.id === x.id);
        if (!r) continue;
        resolved.push({
          ...x, title: r.title, kind: r.kind, unknown: r.availability === 'unknown', actions: r.actions, bestStartH: r.bestStartH,
          savedHa: r.timing.find((t) => t.startH === x.startHour)?.savedHa ?? r.saved.mean,
        });
      }
      setText(j.text); setPicks(resolved); setWrittenFor(p.actions); setApplied(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const shown = picks;
  // The plan can only be picked from finished suggestions for the current state.
  const ready = !!p.base && !!p.plan && !!p.rec && !p.recLoading;
  const apply = () => { applying.current = true; setApplied(true); p.onApplyPlan(shown); };

  return (
    <section className="section brief" aria-label="Situation brief">
      <header className="section-head">
        <h2>Situation brief</h2>
        <Segmented label="Language" value={lang} onChange={setLang} options={[{ value: 'id', label: 'Bahasa' }, { value: 'en', label: 'English' }]} />
      </header>
      <PdfBriefButton lang={lang} scn={p.scn} base={p.base} plan={p.plan} rec={p.rec} actions={p.actions} params={p.params} inventory={p.inventory} mapCaption={p.mapCaption ?? ''} />
      {status && !status.enabled && <p className="muted small">Not set up. Add <code>LLM_API_KEY</code> to <code>.env</code> and restart.</p>}
      {status?.enabled && (
        <>
          <p className="muted small">A summary and plan for commanders, by {status.model}. It can only pick from the simulated suggestions.</p>
          <button className={`btn wide ${text && !stale ? '' : 'primary'}`} disabled={busy || !ready} onClick={run}>{busy ? 'Writing…' : !ready ? 'Simulating options…' : text ? 'Write again' : 'Write brief and plan'}</button>
        </>
      )}
      {err && <p className="note">Couldn\u2019t write the brief: {err}</p>}
      {text && stale && <p className="note">Your plan changed after this brief was written. Write again to update it.</p>}
      {text && (
        <div className="brief-plan">
          <div className="section-head"><h2>Proposed plan</h2></div>
          {shown.length === 0 ? <p className="muted small">No further actions proposed.</p> : (
            <>
              <ol className="list">
                {shown.map((x, i) => {
                  return (
                    <li key={x.id} className="row-item">
                      <div className="row-head static">
                        <span className="rank">{i + 1}</span>
                        <span className="row-text">
                          <span className="row-title">{x.title}</span>
                          <span className="row-sub">{KIND_LABEL[x.kind]} · start {fmtHour(x.startHour)}{x.unknown && <span className="tag">resources unknown</span>}</span>
                          {x.reason && <span className="row-sub">{x.reason}</span>}
                        </span>
                        <span className="saved">−{fmtHa(Math.max(0, x.savedHa))} ha</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <button className="btn primary wide apply" disabled={applied || stale} onClick={apply}>{applied ? 'Added to your plan' : `Add ${shown.length} action${shown.length > 1 ? 's' : ''} to plan`}</button>
            </>
          )}
        </div>
      )}
      {text && <div className="brief-text">{text}</div>}
    </section>
  );
}
