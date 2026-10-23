import { useState, type ReactNode } from 'react';
import { SOURCES, type Rates } from '../sim/doctrine';
import { actionDurationH, heliCount } from '../sim/model';
import { resourcesOf, type Recommendation, type RecommendOutput } from '../sim/recommend';
import type { Inventory } from '../sim/resources';
import type { Action, EnsembleResult, Scenario, SimParams } from '../sim/types';
import { Segmented } from './Controls';
import type { Tool } from './MapView';
import { STATUS_LABEL, fmtHa, fmtHour, fmtPct, isProtected, zoneStatus } from './status';

export const KIND_LABEL: Record<Action['kind'], string> = {
  firebreak: 'Control line', water: 'Water drop', crew: 'Hand crews', inject: 'Peat injection', wet: 'Soak peat', seeding: 'Cloud seeding', dryice: 'Dry ice',
};

export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'inspect', label: 'Inspect', hint: 'Hover the map to see details.' },
  { id: 'firebreak', label: 'Control line', hint: 'Drag across the map to draw a control line.' },
  { id: 'water', label: 'Water drop', hint: 'Click the map to drop water by helicopter.' },
  { id: 'crew', label: 'Hand crews', hint: 'Click the map to send hand crews.' },
  { id: 'inject', label: 'Peat injection', hint: 'Click burning peat to send crews with peat injectors.' },
  { id: 'wet', label: 'Soak peat', hint: 'Click unburned peat to soak it from bored wells.' },
  { id: 'ignite', label: 'Add fire', hint: 'Click the map to start a new fire.' },
];

function TimingSpark({ r }: { r: Recommendation }) {
  const max = Math.max(1, ...r.timing.map((t) => t.savedHa));
  const W = 150, H = 30;
  const last = r.timing[r.timing.length - 1]?.startH || 1;
  const x = (h: number) => (h / Math.max(last, 1)) * (W - 12) + 6;
  return (
    <svg width={W} height={H + 12} className="spark" aria-label="Hectares saved by start time">
      {r.timing.map((t) => {
        const h = Math.max(1, (Math.max(0, t.savedHa) / max) * H);
        return (
          <g key={t.startH}>
            <rect x={x(t.startH) - 6} y={H - h} width={12} height={h} rx={3} className={t.startH === r.bestStartH ? 'best' : ''} />
            <text x={x(t.startH)} y={H + 10} textAnchor="middle">+{t.startH}h</text>
          </g>
        );
      })}
    </svg>
  );
}

export function RecPanel({
  rec, loading, progress, onApply, onApplyStrategy, planSize, onHover, applied,
}: {
  rec: RecommendOutput | null;
  loading: boolean;
  progress: [number, number] | null;
  onApply: (r: Recommendation) => void;
  onApplyStrategy: () => void;
  planSize: number;
  onHover: (r: Recommendation | null) => void;
  applied: Set<string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // The whole plan: the confirmed strategy, or a draft that still needs resources confirmed.
  const strat = rec?.strategy?.ids.length ? rec.strategy : rec?.draft?.ids.length ? rec.draft : null;
  const unconfirmed: string[] = !rec?.strategy?.ids.length && rec?.draft ? rec.draft.unconfirmed : [];
  const stratDone = !!strat && strat.ids.every((id) => applied.has(id));
  // Options that save under 1 ha are noise for a commander; count them instead of listing them.
  const shown = rec?.recommendations.filter((r) => r.saved.mean >= 1 || applied.has(r.id)) ?? [];
  const hidden = (rec?.recommendations.length ?? 0) - shown.length;
  return (
    <section className="section" aria-label="Suggestions">
      <header className="section-head">
        <h2>Suggestions</h2>
        {loading && <span className="status"><span className="spinner" aria-hidden />{progress ? `${Math.round((progress[0] / Math.max(1, progress[1])) * 100)}%` : 'Simulating'}</span>}
      </header>
      {!rec && !loading && <p className="muted small">No suggestions yet.</p>}
      {rec && (
        <>
          {strat && (
            <div className="callout">
              <div>
                <div className="callout-title">{planSize ? 'Add more to your plan' : 'Whole plan'}</div>
                <div className="muted small">{strat.ids.length} action{strat.ids.length > 1 ? 's' : ''} together · about {fmtHa(strat.saved)} ha saved</div>
                {unconfirmed.length > 0 && <div className="muted small">Confirm {unconfirmed.join(', ')} are available</div>}
              </div>
              <button className="btn primary" disabled={stratDone} onClick={onApplyStrategy}>{stratDone ? 'Added' : planSize ? `Add ${strat.ids.length}` : 'Add whole plan'}</button>
            </div>
          )}
          {rec.notes.length > 0 && (
            <details className="more">
              <summary>Why these suggestions</summary>
              {rec.notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
            </details>
          )}
          {shown.length === 0 && <p className="muted small">Nothing else helps right now.</p>}
          <ol className="list">
            {shown.map((r, i) => {
              const isOpen = open === r.id;
              const done = applied.has(r.id);
              return (
                <li key={r.id} className={`row-item ${isOpen ? 'open' : ''}`} onMouseEnter={() => onHover(r)} onMouseLeave={() => onHover(null)}>
                  <button className="row-head" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                    <span className="rank">{i + 1}</span>
                    <span className="row-text">
                      <span className="row-title">{r.title}</span>
                      <span className="row-sub">
                        {KIND_LABEL[r.kind]} · start {fmtHour(r.bestStartH)}
                        {r.availability === 'unknown' && <span className="tag">resources unknown</span>}
                        {r.evidence === 'speculative' && <span className="tag" title="Every rate behind this effect is a placeholder. Not used in the combined strategy.">speculative</span>}
                        {done && <span className="tag">added</span>}
                      </span>
                    </span>
                    <span className={`saved ${r.saved.mean > 1 ? '' : 'nil'}`}>−{fmtHa(Math.max(0, r.saved.mean))} ha</span>
                    <span className="chev" aria-hidden />
                  </button>
                  {isOpen && (
                    <div className="row-body">
                      <dl>
                        <dt>Where</dt><dd>{r.where}</dd>
                        <dt>What</dt><dd>{r.what}</dd>
                        <dt>When</dt><dd>{r.when}</dd>
                        <dt>Why</dt><dd>{r.why}</dd>
                        <dt>Needs</dt><dd>{r.resources}</dd>
                      </dl>
                      <div className="row-foot">
                        <div>
                          <div className="muted small">Saved by start time</div>
                          <TimingSpark r={r} />
                        </div>
                        <button className="btn primary" disabled={done} onClick={() => onApply(r)}>{done ? 'Added' : 'Add to plan'}</button>
                      </div>
                      <p className="cites">
                        Based on{' '}
                        {r.citations.map((c, i) => {
                          const s = SOURCES[c];
                          return (
                            <span key={c}>
                              {i > 0 && ', '}
                              {'url' in s && s.url ? <a href={s.url} target="_blank" rel="noreferrer" title={s.full}>{s.short}</a> : <span title={s.full}>{s.short}</span>}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {hidden > 0 && <p className="muted small footnote">{hidden} other option{hidden > 1 ? 's' : ''} simulated, each saving less than 1 ha.</p>}
        </>
      )}
    </section>
  );
}

export function PlanPanel({
  scn, actions, onChange, onRemove, onClear, params, inventory, subtitle,
}: {
  subtitle?: ReactNode;
  scn: Scenario;
  params: SimParams;
  inventory: Inventory;
  actions: Action[];
  onChange: (a: Action) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (actions.length === 0) return null;
  const R: Rates = params.rates;
  const used = resourcesOf(actions, params);
  const over = (['helicopters', 'crews', 'dozers'] as const).filter((k) => inventory[k] !== null && used[k] > inventory[k]!);
  return (
    <section className="section" aria-label="Your plan">
      <header className="section-head">
        <h2>Your plan</h2>
        <button className="btn plain small" onClick={onClear}>Clear all</button>
      </header>
      {subtitle && <p className="muted small plan-sub">{subtitle}</p>}
      {over.length > 0 && (
        <p className="note">Needs more than you have: {over.map((k) => `${used[k]} ${k} (have ${inventory[k]})`).join(', ')}.</p>
      )}
      <ul className="list">
        {actions.map((a) => (
          <li key={a.id} className={`row-item action ${openId === a.id ? 'open' : ''}`}>
            <div className="act-row">
              <button className="act-head" onClick={() => setOpenId(openId === a.id ? null : a.id)} aria-expanded={openId === a.id}>
                <span className="row-title">{KIND_LABEL[a.kind]}</span>
                <span className="row-sub">{(a.label ?? (a.source === 'user' ? 'Drawn on map' : '')).replace(/^#\d+ /, '')} · {a.startH < 0 ? `started ${-a.startH} h ago` : `start +${a.startH} h`}</span>
              </button>
              <button className="btn icon plain" onClick={() => onRemove(a.id)} aria-label="Remove action" title="Remove">✕</button>
            </div>
            {openId === a.id && <>
            <p className="muted small">Takes {actionDurationH(a, R).toFixed(1)} h once started.</p>
            {a.startH < 0 ? (
              <div className="field"><span>Started {-a.startH} h ago</span></div>
            ) : (
              <label className="field">
                <span>Start</span>
                <input type="range" min={0} max={scn.horizonH - 2} step={1} value={a.startH} onChange={(e) => onChange({ ...a, startH: Number(e.target.value) })} />
                <b>+{a.startH} h</b>
              </label>
            )}
            {a.kind === 'water' && (
              <label className="field">
                <span>Drops</span>
                <input type="range" min={4} max={60} step={2} value={a.drops} onChange={(e) => onChange({ ...a, drops: Number(e.target.value) })} />
                <b>{a.drops}</b>
              </label>
            )}
            {a.kind === 'water' && (
              <label className="field">
                <span>Helicopters</span>
                <input type="range" min={1} max={6} step={1} value={heliCount(a, R)} onChange={(e) => onChange({ ...a, helicopters: Number(e.target.value) })} />
                <b>{heliCount(a, R)}</b>
              </label>
            )}
            {(a.kind === 'seeding' || a.kind === 'dryice') && (
              <label className="field">
                <span>Sorties</span>
                <input type="range" min={1} max={6} step={1} value={a.sorties} onChange={(e) => onChange({ ...a, sorties: Number(e.target.value) })} />
                <b>{a.sorties}</b>
              </label>
            )}
            {a.kind === 'inject' && (
              <div className="field">
                <span>Water</span>
                <Segmented label="Additive" value={a.additive} onChange={(v) => onChange({ ...a, additive: v })} options={[{ value: 'water', label: 'Plain' }, { value: 'foam', label: 'With foam' }]} />
                <span />
              </div>
            )}
            {(a.kind === 'crew' || a.kind === 'inject' || a.kind === 'wet') && (
              <label className="field">
                <span>Crews</span>
                <input type="range" min={1} max={8} step={1} value={a.crews} onChange={(e) => onChange({ ...a, crews: Number(e.target.value) })} />
                <b>{a.crews}</b>
              </label>
            )}
            </>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ZoneTable({ scn, base, plan, hasPlan }: { scn: Scenario; base: EnsembleResult | null; plan: EnsembleResult | null; hasPlan: boolean }) {
  if (!base || !plan) return null;
  // Zones already on fire have nothing to forecast; list only the ones that could still be saved.
  const open = scn.landscape.zones.map((z, i) => ({ z, i })).filter(({ i }) => !base.zoneStats[i].initiallyBurning);
  if (open.length === 0) return null;
  const cell = (z: EnsembleResult['zoneStats'][number]) => (z.initiallyBurning ? 'Burning' : `${STATUS_LABEL[zoneStatus(z)]} · ${fmtPct(z.pIgnite)}`);
  return (
    <section className="card" aria-label="Zones">
      <header className="section-head"><h2>Zones not yet burning</h2></header>
      <table className="table">
        <thead>
          <tr>
            <th>Zone</th>
            <th>{hasPlan ? 'No action' : 'Chance of fire'}</th>
            {hasPlan && <th>With plan</th>}
            <th>Fire arrives</th>
          </tr>
        </thead>
        <tbody>
          {open.map(({ z, i }) => {
            const b = base.zoneStats[i], p = plan.zoneStats[i];
            const prot = hasPlan && isProtected(b, p);
            return (
              <tr key={z.id}>
                <td><b>{z.id}</b> <span className="muted">{z.asset ?? z.name.replace(/^Zone \w+\s*·?\s*/, '')}</span></td>
                <td>{cell(b)}</td>
                {hasPlan && <td className={prot ? 'strong' : ''}>{cell(p)}</td>}
                <td title={b.initiallyBurning ? undefined : `10–90% of runs: ${fmtHour(b.etaP10)} to ${fmtHour(b.etaP90)}`}>
                  {b.initiallyBurning ? '—' : hasPlan && fmtHour(p.etaMedian) !== fmtHour(b.etaMedian) ? `${fmtHour(b.etaMedian)} → ${fmtHour(p.etaMedian)}` : fmtHour(b.etaMedian)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small footnote">Share of {base.runs.length} simulated runs in which the zone catches fire within {scn.horizonH} h. No forecast is a guarantee.</p>
    </section>
  );
}
