// The public scoreboard (#/scoreboard): every sealed forecast of every model, scored on the same
// terms against NASA FIRMS, next to two reference models. Works on the static deploy (the index is
// bundled at build time) and live through /api/scoreboard when a server is there.
import { useEffect, useMemo, useState } from 'react';
import { FORECASTER_MODEL, REFERENCE_MODEL_INFO, REGISTER_MODEL, boxKey } from '../sim/forecast';
import { canonical, fromB64 } from '../sim/receipt';
import { boardRows, leaderboard, pending, skillOverTime, type BoardIndex, type BoardRow, type SkillPoint, type Standing } from '../sim/scoreboard';
import './scoreboard.css';

const REPO = 'https://github.com/aliefauzan/fire-septum';

async function loadIndex(): Promise<{ ix: BoardIndex; source: string }> {
  try {
    const r = await fetch('/api/scoreboard');
    if (r.ok && r.headers.get('content-type')?.includes('json')) return { ix: await r.json(), source: 'live' };
  } catch { /* static deploy */ }
  return { ix: (await import('virtual:scoreboard-index')).default, source: 'bundled' };
}

function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const when = (t: string | number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const f2 = (x: number) => x.toFixed(2);
const modelName = (id: string) => REFERENCE_MODEL_INFO[id]?.name ?? id;
const SHORT: Record<string, string> = { [REGISTER_MODEL]: 'Fire Septum CA', [FORECASTER_MODEL]: 'Fire Septum forecaster', distance: 'Distance', climatology: 'Climatology' };
const shortName = (id: string) => SHORT[id] ?? id;
const isRef = (id: string) => id === 'distance' || id === 'climatology';

/** Line style per model: the register's model in ink, references in grey dashes, others in a small palette. */
const OTHER = ['#b4532a', '#2f6f9f', '#6b4fa0', '#3c7d4a'];
function styleOf(id: string, others: string[]) {
  if (id === REGISTER_MODEL) return { stroke: 'var(--ink)', dash: '' };
  if (id === 'distance') return { stroke: 'var(--muted)', dash: '6 4' };
  if (id === 'climatology') return { stroke: 'var(--faint)', dash: '2 3' };
  return { stroke: OTHER[others.indexOf(id) % OTHER.length], dash: '' };
}

function SkillChart({ title, series, value, others, zero }: { title: string; series: Record<string, SkillPoint[]>; value: (p: SkillPoint) => number; others: string[]; zero?: boolean }) {
  const days = [...new Set(Object.values(series).flat().map((p) => p.day))].sort();
  const vals = Object.values(series).flat().map(value);
  if (!days.length) return null;
  let lo = Math.min(0, ...vals), hi = Math.max(zero ? 0.05 : 0.3, ...vals);
  if (hi - lo < 0.1) hi = lo + 0.1;
  const pad = (hi - lo) * 0.08; lo -= zero ? pad : 0; hi += pad;
  const W = 520, H = 180, L = 40, R = 12, T = 12, B = 26;
  const x = (d: string) => (days.length === 1 ? L + (W - L - R) / 2 : L + ((W - L - R) * days.indexOf(d)) / (days.length - 1));
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v * 100) / 100);
  return (
    <figure className="sb-chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{v.toFixed(2)}</text></g>)}
        {lo < 0 && hi > 0 && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="zero" />}
        {days.map((d) => <text key={d} x={x(d)} y={H - 8} textAnchor="middle">{d.slice(5)}</text>)}
        {Object.entries(series).map(([m, pts]) => {
          const s = styleOf(m, others);
          return (
            <g key={m}>
              <polyline fill="none" stroke={s.stroke} strokeWidth={m === REGISTER_MODEL ? 2 : 1.5} strokeDasharray={s.dash} points={pts.map((p) => `${x(p.day)},${y(value(p))}`).join(' ')} />
              {pts.map((p) => <circle key={p.day} cx={x(p.day)} cy={y(value(p))} r={3} fill={s.stroke}><title>{`${shortName(m)}, to ${p.day}: ${value(p).toFixed(3)} over ${p.boxes} box(es)`}</title></circle>)}
            </g>
          );
        })}
      </svg>
      <ul className="sb-legend">
        {Object.keys(series).map((m) => { const s = styleOf(m, others); return <li key={m}><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={s.stroke} strokeWidth="2" strokeDasharray={s.dash} /></svg>{shortName(m)}</li>; })}
      </ul>
    </figure>
  );
}

function Leaderboard({ board }: { board: Standing[] }) {
  return (
    <div className="sb-table-wrap">
      <table className="sb-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col" className="sb-num" title="Boxes scored (with any new fire)">Boxes</th>
            <th scope="col" className="sb-num" title="Critical success index of p ≥ 0.5, from summed hits, misses and false alarms">Pooled CSI</th>
            <th scope="col" className="sb-num" title="A distance-only forecast marking the same number of blocks, nearest to the fire first">Same-size distance</th>
            <th scope="col" className="sb-num" title="New-fire blocks caught / observed">Caught</th>
            <th scope="col" className="sb-num" title="Mean Brier score over every scored block (lower is better)">Mean Brier</th>
            <th scope="col" className="sb-num" title="1 − Brier / Brier of the pooled observed base rate (0 = no better than knowing the rate afterwards)">Brier skill</th>
          </tr>
        </thead>
        <tbody>
          {board.map((s) => (
            <tr key={s.model} className={isRef(s.model) ? 'ref' : ''}>
              <th scope="row">{modelName(s.model)}{isRef(s.model) && <span className="sb-tag">reference</span>}<span className="sb-id">{s.model}</span></th>
              <td className="sb-num">{s.boxes} <span className="muted">({s.boxesWithFire})</span></td>
              <td className="sb-num sb-strong">{f2(s.csi)}</td>
              <td className="sb-num">{s.predicted > 0 ? f2(s.distanceCsi) : '—'}</td>
              <td className="sb-num">{s.hits} / {s.observed} <span className="muted">· {s.falseAlarms} false</span></td>
              <td className="sb-num">{s.brier.toFixed(3)}</td>
              <td className="sb-num">{f2(s.brierSkill)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Scoreboard() {
  const [data, setData] = useState<{ ix: BoardIndex; source: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadIndex().then(setData, (e) => setErr(e instanceof Error ? e.message : String(e))); }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const rows = boardRows(data.ix);
    const board = leaderboard(rows);
    const others = board.map((s) => s.model).filter((m) => m !== REGISTER_MODEL && !isRef(m));
    return { rows, board, others, time: skillOverTime(rows), due: pending(data.ix) };
  }, [data]);

  const byRecord = useMemo(() => {
    const m = new Map<string, BoardRow[]>();
    for (const r of view?.rows ?? []) (m.get(r.key) ?? m.set(r.key, []).get(r.key)!).push(r);
    return m;
  }, [view]);

  const regProof = (hash: string) => {
    const e = data?.ix.register.find((x) => x.hash === hash);
    if (!e) return;
    const name = `fireseptum-${hash.slice(0, 12)}`;
    save(`${name}.receipt.json`, canonical(e.receipt), 'application/json');
    if (e.otsB64) save(`${name}.receipt.json.ots`, fromB64(e.otsB64), 'application/octet-stream');
  };
  const subProof = (sha: string) => {
    const s = data?.ix.submissions.find((x) => x.sha256 === sha);
    if (!s) return;
    const name = `fireseptum-forecast-${sha.slice(0, 12)}.json`;
    save(name, canonical(s.forecast), 'application/json');
    if (s.otsB64) save(`${name}.ots`, fromB64(s.otsB64), 'application/octet-stream');
  };

  return (
    <div className="scoreboard-page">
      <header className="sb-bar">
        <a className="sb-back" href="#/">← Fire Septum</a>
        <span className="sb-title">Forecast scoreboard</span>
        <a className="sb-back" href={`${REPO}/blob/main/docs/forecast-schema.md`} target="_blank" rel="noreferrer">Submit a model</a>
      </header>
      <main className="sb-main">
        <section className="sb-intro">
          <h1>Who forecasts peat fire best?</h1>
          <p>
            Every forecast here was sealed and timestamped on Bitcoin before the satellites looked, then scored against the NASA FIRMS VIIRS detections of the next 24 hours:
            new fire only, in 400 m blocks, within 3 km of the fire at the start. Any model can take part through the open forecast format; two reference models are scored on every box so there is always something to beat.
          </p>
          <p className="muted small">
            Read the numbers with care. The sample is small, so one busy fire moves the pooled score. VIIRS misses fire under cloud and haze and much smouldering peat, so some "false alarms" burned unseen.
            Crews fought these fires, while every forecast here assumes no action, so a fire that was stopped counts against the forecast. Fresh ignitions farther than 3 km from any known fire are counted but not scored: no spread model can foresee them.
          </p>
        </section>

        {err && <p className="note">{err}</p>}
        {!view && !err && <p className="status"><span className="spinner" aria-hidden />Loading the register</p>}

        {view && (
          <>
            <section aria-labelledby="sb-lead">
              <h2 id="sb-lead">Leaderboard</h2>
              {view.board.length ? <Leaderboard board={view.board} /> : <p className="muted small">No forecast has been scored yet.</p>}
              <p className="muted small sb-foot">
                {data!.source === 'bundled' ? `Published with the code; index built ${when(data!.ix.generatedAt)}.` : 'Live from the register.'}{' '}
                Reference models: <em>distance</em>, p = exp(−d / 1 km) from the nearest fire at the start; <em>climatology</em>, p = 0.136 everywhere (the new-fire rate of the 12 hindcast events, 8–18 Oct 2026). Both are fixed, never fitted on outcomes.
              </p>
            </section>

            {view.rows.length > 0 && (
              <section aria-labelledby="sb-time">
                <h2 id="sb-time">Skill over time</h2>
                <p className="muted small">Pooled over every box scored up to each day (by the day the 24 h window opened).</p>
                <div className="sb-charts">
                  <SkillChart title="Cumulative pooled CSI (higher is better)" series={view.time} value={(p) => p.csi} others={view.others} />
                  <SkillChart title="Cumulative Brier skill (0 = base rate; higher is better)" series={view.time} value={(p) => p.brierSkill} others={view.others} zero />
                </div>
              </section>
            )}

            <section aria-labelledby="sb-boxes">
              <h2 id="sb-boxes">Scored boxes</h2>
              <ol className="sb-list">
                {data!.ix.register.filter((e) => e.score).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map((e) => {
                  const rows = byRecord.get(boxKey(e, e.issuedAt)) ?? [];
                  const ca = rows.find((r) => r.model === REGISTER_MODEL)?.score ?? e.score!.result;
                  return (
                    <li key={e.hash}>
                      <div className="sb-li-head">
                        <span className="sb-place">{e.lat.toFixed(3)}, {e.lon.toFixed(3)}{e.region && <span className="muted"> · {e.region}</span>}</span>
                        <span className="muted small">sealed {when(e.issuedAt)}{e.score!.reproduced ? ' · re-run reproduces the seal' : ' · re-run differs'}</span>
                      </div>
                      <div className="sb-li-body small">
                        <span>{ca.observed === 0 ? 'No new fire within 3 km' : `${ca.observed} new 400 m blocks seen`}</span>
                        {rows.map((r) => <span key={r.model} className={r.model === REGISTER_MODEL ? 'sb-strong' : 'muted'}>{shortName(r.model)}: CSI {f2(r.score.csi)}, Brier {r.score.brier.toFixed(3)}</span>)}
                        <button className="btn small plain" onClick={() => regProof(e.hash)}>Proof</button>
                      </div>
                    </li>
                  );
                })}
                {data!.ix.submissions.filter((s) => s.score).map((s) => (
                  <li key={s.sha256}>
                    <div className="sb-li-head">
                      <span className="sb-place">{s.forecast.model.name} <span className="muted">{s.forecast.model.version}</span></span>
                      <span className="muted small">issued {when(s.forecast.issuedAt)} · {s.score!.boxes.length} box(es)</span>
                    </div>
                    <div className="sb-li-body small">
                      {s.score!.boxes.map((b) => <span key={`${b.box.lat},${b.box.lon}`}>{b.box.lat.toFixed(3)}, {b.box.lon.toFixed(3)}: {Object.entries(b.models).map(([m, v]) => `${m} CSI ${f2(v.csi)}`).join(' · ')}</span>)}
                      <button className="btn small plain" onClick={() => subProof(s.sha256)}>Proof</button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="sb-due">
              <h2 id="sb-due">Sealed, not yet scored</h2>
              {view.due.length === 0 ? <p className="muted small">Nothing waiting. New forecasts are sealed each time the register job runs.</p> : (
                <ol className="sb-list">
                  {view.due.map((p) => (
                    <li key={p.record}>
                      <div className="sb-li-head">
                        <span className="sb-place">{modelName(p.model)}</span>
                        <span className="muted small">sealed {when(p.issuedAt)} · {Date.now() >= p.dueAt ? 'due now, scored on the next register run' : `scores after ${when(p.dueAt)}`}</span>
                      </div>
                      <div className="sb-li-body small">
                        <span>{p.boxes.map((b) => `${b.lat.toFixed(3)}, ${b.lon.toFixed(3)}`).join(' · ')}</span>
                        <button className="btn small plain" onClick={() => (p.source === 'register' ? regProof(p.record) : subProof(p.record))}>Proof</button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <p className="muted small sb-foot">
                A proof is the sealed bytes and their OpenTimestamps file: <code>ots verify</code> shows the Bitcoin block that dates them. Every record is also in its day's Merkle batch (<a href={`${REPO}/tree/main/data/batches`} target="_blank" rel="noreferrer">data/batches</a>), and the full records with their inputs are in <a href={`${REPO}/tree/main/data/register`} target="_blank" rel="noreferrer">data/register</a>.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default Scoreboard;
