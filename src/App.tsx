import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KALIMANTAN_BBOX, clusterHotspots, fetchHotspots } from './data/firms';
import { fetchLogistics } from './data/logistics';
import { buildHindcast } from './data/hindcast';
import { buildLiveScenario } from './data/live';
import { ALL_PRESETS as PRESETS } from './data/presets';
import { SATELLITE_ATTRIBUTION, loadSatellite } from './data/satellite';
import { SimClient, Superseded } from './sim/client';
import { cloneState, igniteDisc } from './sim/landscape';
import { DEFAULT_RATES, type Rates } from './sim/doctrine';
import { DEFAULT_PARAMS, actionDurationH, dropHa, helicoptersFor, lineCellsPerHour } from './sim/model';
import { SYNTHETIC_INVENTORY, UNKNOWN_INVENTORY, type Inventory, type Logistics } from './sim/resources';
import type { RunInputs } from './sim/receipt';
import type { Recommendation, RecommendOutput } from './sim/recommend';
import type { Action, CloudPotential, EnsembleResult, Scenario, WeatherHour } from './sim/types';
import { BriefPanel, type BriefPick } from './ui/Brief';
import { HindcastCard } from './ui/HindcastCard';
import { LivePanel } from './ui/LivePanel';
import { Map3D, createCamSync } from './ui/Map3D';
import { MapView, type Tool } from './ui/MapView';
import { Menu, Segmented, Sheet } from './ui/Controls';
import { OutcomeCard, burnedBy } from './ui/Outcome';
import { reducedMotion } from './ui/motion';
import { PlanPanel, RecPanel, TOOLS, ZoneTable } from './ui/Panels';
import { RecordPanel } from './ui/Record';
import { RegisterPanel } from './ui/Register';
import { ResourcesPanel, type LogiStatus } from './ui/Resources';
import type { FireView } from './ui/render';
import { fmtHa, isProtected, zoneProbAt, zoneStatus } from './ui/status';
import { Timeline } from './ui/Timeline';

const client = new SimClient();
let actionSeq = 0;

/** Shift the weather series forward, padding with the same hours one day earlier (keeps the diurnal cycle). */
function shiftWeather(ws: WeatherHour[], hours: number, horizon: number): WeatherHour[] {
  const out: WeatherHour[] = [];
  for (let t = 0; t <= horizon; t++) {
    let i = t + hours;
    while (i >= ws.length) i -= 24;
    out.push({ ...ws[Math.max(0, i)], t });
  }
  return out;
}

function medianRunIndex(e: EnsembleResult): number {
  const order = e.burnedHa.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  return order[Math.floor(order.length / 2)]?.[1] ?? 0;
}

export default function App() {
  const [presetId, setPresetId] = useState('live');
  const [scn, setScn] = useState<Scenario>(() => PRESETS[0].make());
  const [actions, setActions] = useState<Action[]>([]);
  const [baseRaw, setBase] = useState<EnsembleResult | null>(null);
  const [planRaw, setPlan] = useState<EnsembleResult | null>(null);
  const [rec, setRec] = useState<RecommendOutput | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [t, setT] = useState(12);
  const [playing, setPlaying] = useState(false);
  // Playback stops here instead of at the horizon (used by the one-off autoplay when a forecast first appears).
  const [playTo, setPlayTo] = useState<number | null>(null);
  // Bumped whenever a new plan result lands, so the "saved by the plan" layer flashes once.
  const [flashKey, setFlashKey] = useState(0);
  const [view, setView] = useState<FireView>('probability');
  const [dim, setDim] = useState<'2d' | '3d'>('2d');
  const camSync = useRef(createCamSync());
  const [tool, setTool] = useState<Tool>('inspect');
  const [ghost, setGhost] = useState<Action[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [windAdj, setWindAdj] = useState({ dir: 0, speed: 1 });
  const [cond, setCond] = useState<{ haze: boolean; clouds: CloudPotential }>({ haze: false, clouds: 'medium' });
  const [liveLoading, setLiveLoading] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  // One important message shown above the page (e.g. live data fell back to the recording).
  const [notice, setNotice] = useState<string | null>(null);
  const [satellite, setSatellite] = useState<HTMLCanvasElement | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  // Open on today's fire: the app starts by finding the most active cluster in the latest passes.
  const [booting, setBooting] = useState(true);
  const [showObserved, setShowObserved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [inventory, setInventory] = useState<Inventory>(UNKNOWN_INVENTORY);
  const [logistics, setLogistics] = useState<Logistics | null>(null);
  const [logiStatus, setLogiStatus] = useState<LogiStatus>({ state: 'idle' });
  const [dipFromOsm, setDipFromOsm] = useState(false);
  const [tab, setTab] = useState<'plan' | 'resources' | 'brief' | 'record'>('plan');
  const params = useMemo(() => ({ ...DEFAULT_PARAMS, rates }), [rates]);

  // Conditions the user can override ("what if the wind changes?").
  const eff = useMemo<Scenario>(() => {
    const withCond = { ...scn, haze: cond.haze, cloudPotential: cond.clouds };
    if (windAdj.dir === 0 && windAdj.speed === 1) return withCond;
    return {
      ...withCond,
      weather: scn.weather.map((w) => ({ ...w, windFromDeg: (w.windFromDeg + windAdj.dir + 360) % 360, windKmh: w.windKmh * windAdj.speed })),
    };
  }, [scn, windAdj, cond]);

  // Results computed for a previous scenario can arrive (or linger for one render) after a
  // switch; ignore any whose zone layout or grid no longer matches.
  const fits = (e: EnsembleResult | null) =>
    e && e.zoneStats.length === eff.landscape.zones.length && e.runs[0]?.ign.length === eff.landscape.w * eff.landscape.h ? e : null;
  const base = fits(baseRaw);
  const plan = fits(planRaw);

  // Baseline: no action.
  useEffect(() => {
    setBase(null);
    client.baseline(eff, params).then(setBase).catch((e) => { if (!(e instanceof Superseded)) setError(String(e)); });
  }, [eff, params]);

  // Plan scenario.
  useEffect(() => {
    if (actions.length === 0) { setPlan(baseRaw); setPlanBusy(false); return; }
    setPlanBusy(true);
    client.ensemble(eff, actions, params)
      .then((p) => { setPlan(p); setPlanBusy(false); })
      .catch((e) => { if (!(e instanceof Superseded)) { setError(String(e)); setPlanBusy(false); } });
  }, [eff, actions, baseRaw, params]);

  // Recommendations, relative to the current plan (so they answer "what else should we do?").
  const recTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(recTimer.current);
    setRecLoading(true);
    recTimer.current = window.setTimeout(() => {
      client.recommend(eff, actions, params, { inventory, logistics }, (d, n) => setProgress([d, n]))
        .then((r) => { setRec(r); setRecLoading(false); setProgress(null); })
        .catch((e) => { if (!(e instanceof Superseded)) { setError(String(e)); setRecLoading(false); } });
    }, 500);
  }, [eff, actions, params, inventory, logistics]);

  // Playback.
  useEffect(() => {
    if (!playing) return;
    const end = playTo ?? eff.horizonH;
    const id = window.setInterval(() => {
      setT((v) => {
        if (v >= end) { setPlaying(false); setPlayTo(null); return v; }
        return Math.min(end, v + 0.5);
      });
    }, 110);
    return () => window.clearInterval(id);
  }, [playing, playTo, eff.horizonH]);

  // Play the spread forward once when a forecast first appears for a scenario, and once more when
  // its first plan lands and the maps split, so the fire is seen to grow rather than shown as a still.
  const playedFor = useRef<{ scn: Scenario | null; base: boolean; plan: boolean }>({ scn: null, base: false, plan: false });
  const autoplay = useCallback(() => {
    if (reducedMotion()) return;
    setT(0); setPlayTo(12); setPlaying(true);
  }, []);
  useEffect(() => {
    if (booting) return;
    const m = playedFor.current;
    if (m.scn !== scn) { playedFor.current = { scn, base: false, plan: false }; return; }
    if (base && !m.base) { m.base = true; autoplay(); }
    else if (base && hasPlan && plan && plan !== base && !planBusy && !m.plan) { m.plan = true; autoplay(); }
  });
  useEffect(() => { if (planRaw) setFlashKey((k) => k + 1); }, [planRaw]);

  const loadPreset = (id: string) => {
    if (id === '__pick') { setShowLive(true); return; }
    if (id === 'live') { loadToday(); return; }
    const p = PRESETS.find((x) => x.id === id)!;
    setPresetId(id); setNotice(null);
    setScn(p.make());
    setActions([]); setApplied(new Set()); setRec(null); setSatellite(null); setWarnings([]); setHistory([]);
    setWindAdj({ dir: 0, speed: 1 }); setCond({ haze: false, clouds: 'medium' });
    setT(12);
    setInventory(SYNTHETIC_INVENTORY); setLogistics(null); setLogiStatus({ state: 'idle' });
    setRates(DEFAULT_RATES); setDipFromOsm(false); setShowObserved(false);
    satSeq.current++;
    if (id === 'recorded') showRecorded(p.make());
  };

  // Imagery arrives late; only the latest request may set it (a slow tile set must not land on a newer scenario).
  const satSeq = useRef(0);
  const showSatellite = (g: NonNullable<Scenario['landscape']['geo']>, onFail?: () => void) => {
    const n = ++satSeq.current;
    loadSatellite(g).then((c) => { if (n === satSeq.current) setSatellite(c); }).catch(() => { if (n === satSeq.current) onFail?.(); });
  };

  // A recorded real event: never assume resources, and show it on satellite imagery.
  const showRecorded = (s: Scenario) => {
    setInventory(UNKNOWN_INVENTORY);
    if (s.landscape.geo) showSatellite(s.landscape.geo);
    loadLogistics(s);
  };

  // Today's most active fire in Kalimantan, from the last 24 h of NASA FIRMS passes.
  // Falls back to the recorded event when FIRMS is unreachable or quiet.
  const loadToday = async () => {
    setBooting(true); setError(null); setNotice(null);
    let why = '';
    try {
      const r = await fetchHotspots(KALIMANTAN_BBOX, 1);
      const top = clusterHotspots(r.hotspots)[0];
      if (top) { if (await loadLive(top.lat, top.lon)) { setBooting(false); return; } why = 'the fire data could not be loaded'; }
      else why = 'no fires were detected in Kalimantan in the last 24 h';
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    const rec = PRESETS[0];
    setPresetId('recorded'); setScn(rec.make()); setActions([]); setApplied(new Set()); setRec(null); setHistory([]);
    setT(12);
    setError(null);
    setWarnings([]);
    setNotice(`Today's fires could not be loaded (${why}). Showing the recorded fire from 18 Oct instead.`);
    showRecorded(rec.make());
    setBooting(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadToday(); }, []);

  // Mapped bases, landing sites and dip sites around the live fire (OpenStreetMap).
  const logiReq = useRef<AbortController | null>(null);
  const loadLogistics = (s: Scenario) => {
    const g = s.landscape.geo;
    if (!g) return;
    logiReq.current?.abort();
    const ctl = new AbortController();
    logiReq.current = ctl;
    setLogiStatus({ state: 'loading' });
    fetchLogistics((g.north + g.south) / 2, (g.east + g.west) / 2, ctl.signal)
      .then((lg) => {
        if (ctl.signal.aborted) return;
        setLogistics(lg); setLogiStatus({ state: 'ok' });
        if (lg.dip) { setRates((r) => ({ ...r, dipKm: Math.max(0.2, Math.round(lg.dip!.km * 10) / 10) })); setDipFromOsm(true); }
      })
      .catch((e) => { if (!ctl.signal.aborted) setLogiStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) }); });
  };

  const loadLive = async (lat: number, lon: number, date?: string): Promise<boolean> => {
    setLiveLoading(true); setError(null);
    try {
      const { scenario, warnings } = date ? await buildHindcast(lat, lon, date) : await buildLiveScenario({ lat, lon });
      setPresetId(date ? 'hindcast' : 'live');
      setScn(scenario); setActions([]); setApplied(new Set()); setRec(null); setWarnings(warnings); setHistory([]);
      setWindAdj({ dir: 0, speed: 1 });
      setT(12);
      setSatellite(null);
      // Live data: never assume resources. The commander enters what is actually available.
      setInventory(UNKNOWN_INVENTORY); setLogistics(null); setRates(DEFAULT_RATES); setDipFromOsm(false);
      loadLogistics(scenario);
      setShowLive(false); setShowObserved(false); setNotice(null);
      showSatellite(scenario.landscape.geo!, () => setWarnings((w) => [...w, 'Satellite imagery is unavailable, so the map shows fuel types instead.']));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally { setLiveLoading(false); }
  };

  // Load a sealed record's exact inputs, so the map shows what was decided.
  const openRecord = (r: RunInputs) => {
    setPresetId('record');
    setScn(r.scenario); setActions(r.actions); setRates(r.params.rates);
    setCond({ haze: !!r.scenario.haze, clouds: r.scenario.cloudPotential ?? 'medium' });
    setWindAdj({ dir: 0, speed: 1 });
    setApplied(new Set()); setRec(null); setSatellite(null); setWarnings([]); setHistory([]);
    setInventory(UNKNOWN_INVENTORY); setLogistics(null); setDipFromOsm(false);
    setT(Math.min(12, r.scenario.horizonH));
    setShowObserved(false);
    if (r.scenario.landscape.geo) showSatellite(r.scenario.landscape.geo); else satSeq.current++;
  };

  const addAction = useCallback((a: Action) => setActions((xs) => [...xs, a]), []);

  const onPlace = (kind: Tool, c: [number, number], c2?: [number, number]) => {
    const id = `u${++actionSeq}`;
    const startH = 0; // adjust in the plan panel
    // Sizes follow the rates and the entered inventory (not fixed numbers).
    if (kind === 'firebreak' && c2) {
      const method = inventory.dozers === 0 ? 'hand' : 'dozer';
      const crews = method === 'hand' ? Math.max(1, Math.min(2, inventory.crews ?? 2)) : 1;
      addAction({ id, kind: 'firebreak', from: c, to: c2, method, crews: method === 'hand' ? crews : undefined, cellsPerHour: lineCellsPerHour(scn.landscape, c, c2, rates, method, crews), startH, source: 'user' });
    }
    if (kind === 'water') {
      const drops = Math.max(4, Math.ceil((Math.PI * 4 * scn.landscape.cellM ** 2) / 1e4 / dropHa(rates)));
      const helicopters = Math.max(1, Math.min(helicoptersFor(drops, rates), inventory.helicopters || Infinity));
      addAction({ id, kind: 'water', cx: c[0], cy: c[1], radius: 2, drops, helicopters, product: 'water', startH, source: 'user' });
    }
    if (kind === 'crew') addAction({ id, kind: 'crew', cx: c[0], cy: c[1], radius: 6, crews: Math.max(1, Math.min(3, inventory.crews || 3)), durationH: 12, startH, source: 'user' });
    if (kind === 'inject') addAction({ id, kind: 'inject', cx: c[0], cy: c[1], radius: 4, crews: Math.max(1, Math.min(2, inventory.crews || 2)), durationH: 12, additive: 'water', startH, source: 'user' });
    if (kind === 'wet') addAction({ id, kind: 'wet', cx: c[0], cy: c[1], radius: 3, crews: Math.max(1, Math.min(2, inventory.crews || 2)), durationH: 10, startH, source: 'user' });
    if (kind === 'ignite') {
      const init = cloneState(scn.init);
      igniteDisc(scn.landscape, init, c[0], c[1], 1.5, params.dtH);
      setScn({ ...scn, init, provenance: { ...scn.provenance, hotspots: `${scn.provenance.hotspots} + hand-placed ignition` } });
    }
  };

  const addAirOp = (kind: 'seeding' | 'dryice') => addAction({ id: `u${++actionSeq}`, kind, sorties: 2, startH: 0, source: 'user' });

  const applyRec = (r: Recommendation) => {
    setActions((xs) => [...xs, ...r.actions.map((a) => ({ ...a, id: `r${++actionSeq}` }))]);
    setApplied((s) => new Set([...s, r.id]));
    setGhost([]);
  };
  // Add the actions the AI brief picked, each at the start hour it chose (all were simulated).
  const applyBriefPlan = (picks: BriefPick[]) => {
    const add: Action[] = [];
    for (const x of picks) {
      if (applied.has(x.id)) continue;
      add.push(...x.actions.map((a) => ({ ...a, id: `r${++actionSeq}`, startH: Math.max(0, a.startH - x.bestStartH + x.startHour) })));
    }
    setActions((xs) => [...xs, ...add]);
    setApplied((s) => new Set([...s, ...picks.map((x) => x.id)]));
    setGhost([]);
  };
  // The whole plan at once: the confirmed strategy, else the draft built with unknown resources.
  // Parts already in the plan are skipped so nothing is added twice.
  const applyStrategy = () => {
    const whole = rec?.strategy ?? rec?.draft;
    if (!whole || !rec) return;
    const add = rec.recommendations.filter((r) => whole.ids.includes(r.id) && !applied.has(r.id));
    setActions((xs) => [...xs, ...add.flatMap((r) => r.actions.map((a) => ({ ...a, id: `r${++actionSeq}` })))]);
    setApplied((s) => new Set([...s, ...whole.ids]));
    setGhost([]);
  };

  // Start every scenario with a plan: once the first suggestions for it arrive, add the best
  // combination (or, when resources are unknown, the best single well-evidenced action).
  // Runs once per scenario; anything the user adds, edits or clears is never overridden.
  const autoFor = useRef<Scenario | null>(null);
  const [autoPlan, setAutoPlan] = useState<string | null>(null);
  useEffect(() => {
    if (autoFor.current === scn || booting) return;
    if (actions.length > 0) { autoFor.current = scn; setAutoPlan(null); return; }
    if (!rec || recLoading || !fits(rec.baseline)) return;
    autoFor.current = scn;
    const whole = rec.strategy ?? rec.draft;
    if (whole?.actions.length) {
      applyStrategy();
      setAutoPlan(`${whole.ids.length} action${whole.ids.length > 1 ? 's' : ''} together, about ${Math.round(whole.saved)} ha saved.${rec.draft && !rec.strategy && rec.draft.unconfirmed.length ? ` Confirm ${rec.draft.unconfirmed.join(', ')} are available.` : ''}`);
      return;
    }
    const top = rec.recommendations.find((r) => r.saved.mean >= 1 && r.evidence !== 'speculative');
    if (top) { applyRec(top); setAutoPlan(`${top.title}, about ${Math.round(top.saved.mean)} ha saved.`); }
    else setAutoPlan(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, recLoading, actions.length, scn, booting]);

  // Advance the clock: take one plan member as the "simulated observation", make it the new present.
  const advance = async (hours: number) => {
    if (!plan) return;
    const seed = plan.seeds[medianRunIndex(plan)];
    try {
      const final = await client.advance(eff, actions, params, hours, seed);
      const next: Scenario = {
        ...eff,
        title: `${scn.title.replace(/ \(\+\d+ h\)$/, '')} (+${hours * (history.length + 1)} h)`,
        init: final,
        weather: shiftWeather(eff.weather, hours, eff.horizonH),
        provenance: { ...scn.provenance, hotspots: `${scn.provenance.hotspots}; then advanced ${hours} h using simulated run #${seed} (not an observation)` },
      };
      const shifted = actions
        .map((a) => ({ ...a, startH: a.startH - hours }))
        .filter((a) => a.kind === 'firebreak' || a.startH + actionDurationH(a, rates) > 0);
      setHistory((h) => [...h, `+${hours} h`]);
      setWindAdj({ dir: 0, speed: 1 });
      setScn(next);
      setActions(shifted);
      setT(Math.min(12, next.horizonH));
    } catch (e) {
      if (!(e instanceof Superseded)) setError(String(e));
    }
  };

  const zoneLabels = (e: EnsembleResult | null, other?: EnsembleResult | null) =>
    eff.landscape.zones.map((_, zi) => {
      if (!e) return { status: 'not-reached' as const, p: 0, protectedZone: false };
      const s = e.zoneStats[zi];
      const p = zoneProbAt(e, eff.landscape, zi, t);
      const status = s.initiallyBurning ? 'burning' as const : zoneStatus({ ...s, pIgnite: p });
      return { status, p, protectedZone: !!other && isProtected(other.zoneStats[zi], s) };
    });

  const sampleIdx = base ? medianRunIndex(base) : 0;
  const noUseful = !!rec && !rec.strategy && !rec.draft && !rec.recommendations.some((r) => r.saved.mean >= 1 && r.evidence !== 'speculative');
  const hasPlan = actions.length > 0;
  const mapA: React.ComponentProps<typeof MapView> = {
    title: 'No action',
    subtitle: '',
    scn: eff, ens: base, t, view, sampleRun: base?.runs[sampleIdx] ?? null,
    actions: [], ghost: [], hotspots: eff.hotspots, satellite,
    zoneLabels: zoneLabels(base), tool: tool === 'ignite' ? 'ignite' : 'inspect', interactive: tool === 'ignite',
    onPlace, busy: !base, accent: 'base', showObserved,
  };
  const mapB: React.ComponentProps<typeof MapView> = {
    title: hasPlan ? 'With your plan' : '',
    subtitle: '',
    scn: eff, ens: plan, t, view, sampleRun: plan?.runs[sampleIdx] ?? null,
    actions, ghost, hotspots: eff.hotspots, satellite,
    zoneLabels: zoneLabels(plan, hasPlan ? base : undefined), tool, interactive: true,
    onPlace, busy: planBusy || !plan, accent: 'plan', showObserved,
    savedFrom: hasPlan ? base : null, flashKey,
  };
  const burnNow = base && plan && hasPlan && !planBusy ? { base: burnedBy(base, t).mean, plan: burnedBy(plan, t).mean } : null;
  const isLive = presetId === 'live' || presetId === 'hindcast' || presetId === 'recorded';
  const dataChip = presetId === 'live' ? 'Live' : presetId === 'recorded' ? 'Recorded' : presetId === 'hindcast' ? 'Past day' : presetId === 'record' ? 'Saved record' : 'Example';
  const prov = eff.provenance;
  const windChanged = windAdj.dir !== 0 || windAdj.speed !== 1;
  const pickTool = (id: Tool) => setTool(id);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 13 12H1Z" fill="currentColor" /></svg>
          </span>
          <span className="brand-name">Fire Septum</span>
        </div>
        <div className="toolbar-main">
          <select className="select" aria-label="Scenario" value={presetId} onChange={(e) => loadPreset(e.target.value)} disabled={booting}>
            <option value="live">Today's most active fire</option>
            <optgroup label="Recorded">
              <option value={PRESETS[0].id}>{PRESETS[0].title.replace(/^Recorded: /, '')}</option>
            </optgroup>
            <optgroup label="Training examples">
              {PRESETS.slice(1).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </optgroup>
            {presetId === 'record' && <option value="record" disabled>Saved record</option>}
            {presetId === 'hindcast' && <option value="hindcast" disabled>Past day</option>}
            <option value="__pick">Choose another fire…</option>
          </select>
        </div>
        {!booting && <details className="popover">
          <summary className={`chip ${presetId === 'live' ? 'live' : ''}`}>{dataChip}{warnings.length > 0 && <span className="chip-count" aria-label={`${warnings.length} data notes`}>{warnings.length}</span>}</summary>
          <div className="popover-body">
            <dl>
              <dt>Weather</dt><dd>{prov.weather}</dd>
              <dt>Fires</dt><dd>{prov.hotspots}</dd>
              <dt>Fuel</dt><dd>{prov.fuel}</dd>
            </dl>
            {warnings.length > 0 && <ul className="notes">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
        </details>}
      </header>

      <Sheet open={showLive} onClose={() => setShowLive(false)} title="Choose a fire">
        <LivePanel onLoad={(a, b) => { loadLive(a, b); }} onHindcast={(a, b, d) => { loadLive(a, b, d); }} loading={liveLoading} />
      </Sheet>

      <Sheet open={showRegister} onClose={() => setShowRegister(false)} title="Forecast register">
        <RegisterPanel run={(s, prm) => client.forecast(s, prm)} onOpen={(r) => { openRecord(r); setShowRegister(false); }} />
      </Sheet>

      {(error || notice) && (
        <div className="banners">
          {error && <div className="banner" role="alert"><span>{error}</span><button className="btn plain small" onClick={() => setError(null)}>Dismiss</button></div>}
          {notice && <div className="banner"><span>{notice}</span><button className="btn plain small" onClick={() => setNotice(null)}>Dismiss</button></div>}
        </div>
      )}

      {booting ? (
        <main className="boot" aria-busy>
          <span className="spinner large" aria-hidden />
          <h1>Finding today's fires</h1>
          <p className="muted">Reading the latest NASA satellite passes over Kalimantan, then loading weather and terrain for the most active fire.</p>
        </main>
      ) : (
      <main className="layout">
        <div className="primary">
          <div className="page-head">
            <h1>{eff.title}</h1>
            <p className="muted">{eff.description}</p>
          </div>

          <section className="card map-card" aria-label="Map">
            <div className="map-toolbar">
              {hasPlan
                ? <span className="map-state" title="Same fire, same weather: left without action, right with your plan.">
                    {burnNow
                      ? <>By +{t} h: <b className="base">{fmtHa(burnNow.base)} ha</b> without action, <b>{fmtHa(burnNow.plan)} ha</b> with your plan{burnNow.base - burnNow.plan >= 1 && <span className="saved-pill">{fmtHa(burnNow.base - burnNow.plan)} ha saved</span>}</>
                      : 'Same fire, same weather: left without action, right with your plan.'}
                  </span>
                : <span className="map-state">{recLoading ? <><span className="spinner" aria-hidden /> Finding a starting plan…</> : noUseful ? 'No suggested action saves area here' : 'No action yet'}</span>}
              <div className="map-toolbar-end">
                {(planBusy || !base) && <span className="spinner" aria-label="Simulating" />}
                <Menu label="View">
                  {() => (
                    <div className="menu-pad">
                      <span className="menu-label">Fire</span>
                      <Segmented full label="Fire display" value={view} onChange={setView} options={[{ value: 'probability', label: 'Chance' }, { value: 'sample', label: 'One example' }]} />
                      <span className="menu-label">Map</span>
                      <Segmented full label="Map style" value={dim} onChange={setDim} options={[{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }]} />
                    </div>
                  )}
                </Menu>
                <Menu primary label="Add action">
                  {(close) => (
                    <>
                      {TOOLS.filter((x) => x.id !== 'inspect' && x.id !== 'ignite').map((x) => (
                        <button key={x.id} className="menu-item" onClick={() => { pickTool(x.id); close(); }}>
                          <b>{x.label}</b><span>{x.hint}</span>
                        </button>
                      ))}
                      <hr />
                      <button className="menu-item" onClick={() => { addAirOp('seeding'); close(); }}>
                        <b>Cloud seeding</b><span>Whole area. Adds rain only when clouds can grow.</span>
                      </button>
                      <button className="menu-item" onClick={() => { addAirOp('dryice'); close(); }}>
                        <b>Dry ice</b><span>Whole area. Clears haze so helicopters can fly.</span>
                      </button>
                    </>
                  )}
                </Menu>
              </div>
            </div>
            <div className="map-stage">
              {tool !== 'inspect' && (
                <div className="tool-banner" role="status">
                  <span>{TOOLS.find((x) => x.id === tool)?.hint}</span>
                  <button className="btn small" onClick={() => setTool('inspect')}>Done</button>
                </div>
              )}
              {/* Side by side once there is a plan, so the difference is visible at a glance. */}
              <div className={`maps ${hasPlan ? 'dual' : 'single'}`}>
                {dim === '3d' ? (
                  <>
                    {hasPlan && <Map3D key="a3" {...mapA} sync={camSync.current} />}
                    <Map3D key="b3" {...mapB} sync={camSync.current} />
                  </>
                ) : (
                  <>
                    {hasPlan && <MapView key="a2" {...mapA} />}
                    <MapView key="b2" {...mapB} />
                  </>
                )}
              </div>
            </div>
            <Timeline scn={eff} t={t} setT={setT} playing={playing} setPlaying={setPlaying} actions={actions} baseZones={base?.zoneStats ?? null} planZones={hasPlan ? plan?.zoneStats ?? null : null} />
            <ul className="legend" aria-label="Map key">
              <li><i className="sw burn" />{view === 'probability' ? `Chance of burning by +${t} h` : `Burning by +${t} h`}</li>
              <li><i className="sw scar" />Already burned</li>
              {hasPlan && <li><i className="sw saved" />Saved by the plan</li>}
              <li><i className="edge" />Seen by satellite, last 24 h</li>
              {showObserved && <li><i className="ring" />Seen in the next 24 h</li>}
            </ul>
          </section>

          <ZoneTable scn={eff} base={base} plan={plan} hasPlan={hasPlan} />

          <details className="card disclosure">
            <summary>What if conditions change?</summary>
            <div className="cond-row two">
              <label className="field stacked">
                <span>Haze</span>
                <Segmented label="Haze" value={cond.haze ? 'on' : 'off'} onChange={(v) => setCond((c) => ({ ...c, haze: v === 'on' }))} options={[{ value: 'off', label: 'Aircraft can fly' }, { value: 'on', label: 'Thick haze, grounded' }]} />
              </label>
              <label className="field stacked">
                <span>Cloud potential for seeding (BMKG)</span>
                <Segmented label="Cloud potential" value={cond.clouds} onChange={(v) => setCond((c) => ({ ...c, clouds: v }))} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
              </label>
            </div>
            <div className="cond-row">
              <label className="field stacked">
                <span>Wind direction <b>{windAdj.dir > 0 ? '+' : ''}{windAdj.dir}°</b></span>
                <input type="range" min={-90} max={90} step={15} value={windAdj.dir} onChange={(e) => setWindAdj((w) => ({ ...w, dir: Number(e.target.value) }))} />
              </label>
              <label className="field stacked">
                <span>Wind speed <b>×{windAdj.speed.toFixed(2)}</b></span>
                <input type="range" min={0.5} max={2} step={0.25} value={windAdj.speed} onChange={(e) => setWindAdj((w) => ({ ...w, speed: Number(e.target.value) }))} />
              </label>
              {windChanged && <button className="btn small" onClick={() => setWindAdj({ dir: 0, speed: 1 })}>Reset</button>}
            </div>
            <div className="advance">
              <button className="btn" onClick={() => pickTool('ignite')}>Add a fire on the map</button>
              <span className="muted small">Then click where a new fire starts.</span>
            </div>
            <div className="advance">
              <button className="btn" onClick={() => advance(6)} disabled={!plan}>Skip ahead 6 h</button>
              <span className="muted small">Plays the plan forward 6 hours, then plans again from there.{history.length ? ` Skipped ${history.length * 6} h so far.` : ''}</span>
            </div>
          </details>
        </div>

        <aside className="sidebar">
          {eff.hindcast && <HindcastCard scn={eff} base={base} showObserved={showObserved} setShowObserved={setShowObserved} />}
          <OutcomeCard scn={eff} base={base} plan={plan} hasPlan={hasPlan} busy={planBusy} rates={rates} />
          <Segmented full label="Sidebar" value={tab} onChange={setTab} options={[
            { value: 'plan', label: hasPlan ? `Plan · ${actions.length}` : 'Plan' },
            { value: 'resources', label: 'Resources' },
            { value: 'brief', label: 'Brief' },
            { value: 'record', label: 'Record' },
          ]} />
          <div className="card sidebar-body">
            <div hidden={tab !== 'plan'}>

                <PlanPanel
                  scn={eff} actions={actions} params={params} inventory={inventory}
                  onChange={(a) => setActions((xs) => xs.map((x) => (x.id === a.id ? a : x)))}
                  onRemove={(id) => setActions((xs) => xs.filter((x) => x.id !== id))}
                  subtitle={autoPlan ? `Picked by the simulator: ${autoPlan}` : undefined}
                  onClear={() => { autoFor.current = scn; setAutoPlan(null); setActions([]); setApplied(new Set()); }}
                />
                <RecPanel
                  rec={rec} loading={recLoading} progress={progress}
                  onApply={applyRec} onApplyStrategy={applyStrategy} planSize={actions.length}
                  onHover={(r) => setGhost(r ? r.actions : [])} applied={applied}
                />
            </div>
            <div hidden={tab !== 'resources'}>
              <ResourcesPanel
                inventory={inventory} setInventory={setInventory} rates={rates}
                setRates={(r) => { if (r.dipKm !== rates.dipKm) setDipFromOsm(false); setRates(r); }}
                logistics={logistics} logiStatus={logiStatus} onRetry={() => loadLogistics(scn)}
                isLive={isLive} dipFromOsm={dipFromOsm}
              />
            </div>
            <div hidden={tab !== 'record'}>
              <button className="btn wide register-btn" onClick={() => setShowRegister(true)}>Open forecast register</button>
              <RecordPanel client={client} scn={eff} actions={actions} params={params} base={base} plan={plan} busy={planBusy} onOpen={openRecord} />
            </div>
            <div hidden={tab !== 'brief'}>
              <BriefPanel scn={eff} base={base} plan={plan} rec={rec} recLoading={recLoading} actions={actions} params={params} inventory={inventory} logistics={logistics} onApplyPlan={applyBriefPlan} />
            </div>
          </div>
        </aside>
      </main>
      )}

      {!booting && <footer className="footer muted small">
        <p>Research prototype using a simplified fire model. Not operational guidance: follow BPBD, Manggala Agni and incident command.</p>
        {isLive && satellite && <p>{SATELLITE_ATTRIBUTION} · Elevation: AWS Terrain Tiles · Weather: Open-Meteo · Fires: NASA FIRMS</p>}
      </footer>}
    </div>
  );
}
