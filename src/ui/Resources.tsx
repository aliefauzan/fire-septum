import { useEffect, useState } from 'react';
import { BURNABLE, DEFAULT_RATES, DOCTRINE, RATE_INFO, SOURCES, dropsPerHeliHour, type PerFuel, type Rates, type SourceStatus } from '../sim/doctrine';
import { FUEL_LIST } from '../sim/fuels';
import { FACILITY_LABEL, type Inventory, type Logistics } from '../sim/resources';

export type LogiStatus = { state: 'idle' | 'loading' | 'ok' | 'error'; error?: string };

const STATUS_TEXT: Record<SourceStatus, string> = { verified: 'verified', secondary: 'secondary', assumption: 'assumption' };

/** Number input that commits on blur / Enter, so typing does not re-run the simulation per keystroke. */
function Num({ value, onCommit, allowEmpty, min = 0, step, label, placeholder }: {
  value: number | null; onCommit: (v: number | null) => void; allowEmpty?: boolean; min?: number; step?: number; label: string; placeholder?: string;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const t = draft.trim();
    if (t === '' && allowEmpty) { if (value !== null) onCommit(null); return; }
    const v = Number(t);
    if (!Number.isFinite(v) || v < min) { setDraft(value === null ? '' : String(value)); return; }
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className="num" type="number" inputMode="decimal" min={min} step={step ?? 'any'} aria-label={label} placeholder={placeholder}
      value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Badge({ status }: { status: SourceStatus }) {
  return <span className={`src-badge ${status}`}>{STATUS_TEXT[status]}</span>;
}

function SourceLink({ id }: { id: keyof typeof SOURCES | null }) {
  if (!id) return <span className="muted">no published source</span>;
  const s = SOURCES[id];
  return 'url' in s && s.url ? <a href={s.url} target="_blank" rel="noreferrer" title={s.full}>{s.short}</a> : <span title={s.full}>{s.short}</span>;
}

const osmUrl = (id: string) => `https://www.openstreetmap.org/${id}`;

export function ResourcesPanel(p: {
  inventory: Inventory; setInventory: (i: Inventory) => void;
  rates: Rates; setRates: (r: Rates) => void;
  logistics: Logistics | null; logiStatus: LogiStatus; onRetry: () => void;
  isLive: boolean; dipFromOsm: boolean;
}) {
  const inv = p.inventory;
  const setCount = (k: 'helicopters' | 'crews' | 'dozers' | 'aircraft', v: number | null) =>
    p.setInventory({ ...inv, [k]: v === null ? null : Math.round(v), source: 'user' });
  const scalarKeys = (Object.keys(RATE_INFO) as (keyof Rates)[]).filter((k) => typeof DEFAULT_RATES[k] === 'number');
  const fuelKeys = (Object.keys(RATE_INFO) as (keyof Rates)[]).filter((k) => typeof DEFAULT_RATES[k] === 'object');
  const fuelLabel = (id: string) => FUEL_LIST.find((f) => f.id === id)?.label ?? id;
  const top = p.logistics?.facilities.slice(0, 8) ?? [];

  return (
    <div className="resources">
      <section className="section" aria-label="Available now">
        <header className="section-head"><h2>Available now</h2></header>
        <div className="inv-row">
          {(['helicopters', 'crews', 'dozers', 'aircraft'] as const).map((k) => (
            <label key={k} className="inv">
              <span>{k === 'crews' ? 'Hand crews' : k === 'helicopters' ? 'Helicopters' : k === 'dozers' ? 'Dozers' : 'Seeding planes'}</span>
              <Num value={inv[k]} allowEmpty label={k} placeholder="?" onCommit={(v) => setCount(k, v)} />
            </label>
          ))}
        </div>
        <p className="muted small">
          {inv.source === 'synthetic' && 'Practice numbers for this example. Change them to test other situations.'}
          {inv.source === 'user' && 'Leave a field blank if you don\u2019t know. Suggestions that need it are flagged.'}
          {inv.source === 'unknown' && 'Enter what you actually have. Until then, suggestions that need it are flagged.'}
        </p>
      </section>

      {p.isLive && (
        <section className="section" aria-label="Nearby">
          <header className="section-head"><h2>Nearby</h2>{p.logiStatus.state === 'loading' && <span className="status"><span className="spinner" aria-hidden />Searching</span>}</header>
          {p.logiStatus.state === 'error' && (
            <p className="note">Couldn\u2019t load nearby bases. <button className="btn plain small" onClick={p.onRetry}>Try again</button></p>
          )}
          {p.logistics && (
            <>
              <ul className="facilities">
                {top.map((f) => (
                  <li key={f.id}>
                    <a href={osmUrl(f.id)} target="_blank" rel="noreferrer">{f.name}</a>
                    <span className="muted small">{FACILITY_LABEL[f.kind]}</span>
                    <span className="muted small num-cell">{f.km.toFixed(0)} km</span>
                  </li>
                ))}
                {top.length === 0 && <li className="muted small">No bases, helipads or airfields mapped within 80 km.</li>}
              </ul>
              <p className="muted small">
                Water for helicopters: {p.logistics.dip ? `${p.logistics.dip.name}, ${p.logistics.dip.km.toFixed(1)} km` : p.logistics.waterChecked ? 'none mapped within 15 km' : 'unknown'}.
                {' '}From OpenStreetMap; confirm with Manggala Agni / BPBD.
              </p>
            </>
          )}
        </section>
      )}

      <details className="doctrine">
        <summary>How suggestions are made</summary>
        <p className="small muted">
          Each option is simulated at several start times and ranked by the area it saves. These published rules shape them:
        </p>
        <ol className="small">
          {DOCTRINE.map((d) => (
            <li key={d.id}>{d.rule} <span className="muted">— <SourceLink id={d.source} /></span></li>
          ))}
        </ol>
      </details>

      <details className="rates">
        <summary>Rates and limits</summary>
        <p className="small muted">
          Replace any <b>assumption</b> with your own numbers. One helicopter now makes about {dropsPerHeliHour(p.rates).toFixed(1)} drops per hour.
        </p>
        <table className="rate-table">
          <tbody>
            {scalarKeys.map((k) => {
              const info = RATE_INFO[k];
              return (
                <tr key={k}>
                  <th scope="row" title={info.note}>{info.label}</th>
                  <td><Num value={p.rates[k] as number} label={info.label} onCommit={(v) => p.setRates({ ...p.rates, [k]: v ?? (DEFAULT_RATES[k] as number) })} /></td>
                  <td className="muted small">{info.unit}</td>
                  <td>
                    <Badge status={k === 'dipKm' && p.dipFromOsm ? 'secondary' : (info.status as SourceStatus)} />{' '}
                    <span className="small">{k === 'dipKm' ? (p.dipFromOsm ? 'OpenStreetMap' : <span className="muted">placeholder</span>) : <SourceLink id={info.source} />}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {fuelKeys.map((k) => {
          const info = RATE_INFO[k];
          const m = p.rates[k] as PerFuel;
          const st = info.status as Partial<Record<keyof PerFuel, SourceStatus>> | SourceStatus;
          return (
            <div key={k} className="fuel-rates">
              <div className="small"><b>{info.label}</b> <span className="muted">({info.unit}) — <SourceLink id={info.source} /></span></div>
              <table className="rate-table">
                <tbody>
                  {BURNABLE.map((f) => (
                    <tr key={f}>
                      <th scope="row">{fuelLabel(f)}</th>
                      <td><Num value={m[f as keyof PerFuel]} label={`${info.label} ${f}`} onCommit={(v) => p.setRates({ ...p.rates, [k]: { ...m, [f]: v ?? (DEFAULT_RATES[k] as PerFuel)[f as keyof PerFuel] } })} /></td>
                      <td><Badge status={typeof st === 'string' ? st : st[f as keyof PerFuel] ?? 'assumption'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">{info.note}</p>
            </div>
          );
        })}
        <button className="btn small" onClick={() => p.setRates({ ...DEFAULT_RATES, dipKm: p.rates.dipKm })}>Reset to defaults</button>
      </details>
    </div>
  );
}
