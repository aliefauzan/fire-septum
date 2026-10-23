import { useEffect, useState } from 'react';
import { KALIMANTAN_BBOX, SUMATRA_BBOX, clusterHotspots, fetchHotspots } from '../data/firms';
import { issueForecast, listRegister, scoreEntry, type Runner } from '../data/register';
import { canonical, decode, fromB64, type RunInputs } from '../sim/receipt';
import { dueAt, summarize, type RegisterEntry } from '../sim/register';

const PER_REGION = 3;

function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const when = (iso: string | number) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * The forecast register: forecasts sealed and timestamped on Bitcoin before the outcome
 * exists, then scored against what NASA satellites saw. The scoreboard keeps every
 * forecast, good or bad.
 */
export function RegisterPanel({ run, onOpen }: { run: Runner; onOpen: (r: RunInputs) => void }) {
  const [entries, setEntries] = useState<RegisterEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () => listRegister().then(setEntries).catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  useEffect(() => { reload(); }, []);

  const issueRegion = async (bbox: [number, number, number, number], region: string) => {
    setMsg(null);
    try {
      setBusy(`Finding active fires in ${region}`);
      const { hotspots } = await fetchHotspots(bbox, 1);
      const top = clusterHotspots(hotspots).slice(0, PER_REGION);
      if (!top.length) { setMsg(`No fires detected in ${region} in the last 24 h.`); return; }
      const rule = `Top ${PER_REGION} FIRMS clusters in ${region} (last 24 h, ranked by detections + FRP/50), picked automatically at issue time.`;
      let n = 0;
      for (const c of top) {
        setBusy(`Sealing forecast ${++n} of ${top.length} (${c.lat.toFixed(2)}, ${c.lon.toFixed(2)})`);
        try { await issueForecast(c.lat, c.lon, rule, run); }
        catch (e) { setMsg(`Skipped ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}: ${e instanceof Error ? e.message : e}`); }
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); reload(); }
  };

  const scoreDue = async () => {
    if (!entries) return;
    const due = entries.filter((e) => !e.score && Date.now() >= dueAt(e));
    let n = 0;
    for (const e of due) {
      setBusy(`Scoring ${++n} of ${due.length}`);
      try { await scoreEntry(e, run); }
      catch (err) { setMsg(`Could not score ${e.lat.toFixed(2)}, ${e.lon.toFixed(2)}: ${err instanceof Error ? err.message : err}`); }
    }
    setBusy(null);
    reload();
  };

  const s = entries ? summarize(entries) : null;
  const due = entries?.filter((e) => !e.score && Date.now() >= dueAt(e)).length ?? 0;
  return (
    <div className="register">
      <section className="section">
        <p className="muted small">
          Each forecast is sealed, signed and timestamped on Bitcoin before the satellites see what happens next.
          After 24 h it is scored against NASA FIRMS. Every forecast stays on the board, good or bad: a hindcast can be tuned after the fact, this cannot.
        </p>
        {s && (
          <dl className="kv">
            <dt>Forecasts</dt><dd>{s.issued} sealed · {s.scored} scored</dd>
            <dt>Score so far</dt><dd>{s.scored ? <>CSI {s.csi.toFixed(2)} · distance-only {s.distanceCsi.toFixed(2)} · {s.hits} of {s.observed} new fire spots caught</> : 'Waiting for the first 24 h windows to close'}</dd>
          </dl>
        )}
        <div className="btn-row">
          <button className="btn" disabled={!!busy} onClick={() => issueRegion(KALIMANTAN_BBOX, 'Kalimantan')}>Seal top {PER_REGION} Kalimantan fires</button>
          <button className="btn" disabled={!!busy} onClick={() => issueRegion(SUMATRA_BBOX, 'Sumatra')}>Seal top {PER_REGION} Sumatra fires</button>
          <button className="btn" disabled={!!busy || due === 0} onClick={scoreDue}>Score {due || ''} due</button>
        </div>
        {busy && <p className="status"><span className="spinner" aria-hidden />{busy}</p>}
        {msg && <p className="note small" role="status">{msg}</p>}
      </section>

      <section className="section" aria-label="Forecasts">
        {entries && entries.length === 0 && <p className="muted small">No forecasts sealed yet.</p>}
        <ol className="list">
          {[...(entries ?? [])].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map((e) => {
            const r = e.score?.result;
            const name = `sekatapi-${e.record.receiptSha256.slice(0, 12)}`;
            return (
              <li key={e.record.receiptSha256} className="row-item">
                <div className="row-head static">
                  <span className="row-text">
                    <span className="row-title">{e.lat.toFixed(3)}, {e.lon.toFixed(3)}</span>
                    <span className="row-sub">
                      Sealed {when(e.issuedAt)} · {e.record.anchor ? 'timestamped on Bitcoin' : 'not timestamped'}
                      {!e.score && <> · scores after {when(dueAt(e))}</>}
                      {e.score && !e.score.reproduced && <span className="tag">re-run differs</span>}
                    </span>
                  </span>
                  <span className={`saved ${r && r.observed ? '' : 'nil'}`}>
                    {!r ? 'pending' : r.observed === 0 ? 'no new fire' : `CSI ${r.csi.toFixed(2)} / ${r.distance.csi.toFixed(2)}`}
                  </span>
                </div>
                <div className="btn-row tight">
                  <button className="btn small plain" onClick={() => onOpen(decode<RunInputs>(e.record.inputs))}>Open in map</button>
                  <button className="btn small plain" onClick={() => save(`${name}.json`, JSON.stringify(e.record), 'application/json')}>Record</button>
                  {e.record.anchor && (
                    <button className="btn small plain" onClick={() => { save(`${name}.receipt.json`, canonical(e.record.receipt), 'application/json'); save(`${name}.receipt.json.ots`, fromB64(e.record.anchor!.otsB64), 'application/octet-stream'); }}>Proof</button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
