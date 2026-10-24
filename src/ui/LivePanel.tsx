import { useState } from 'react';
import { FirmsKeyMissing, KALIMANTAN_BBOX, SUMATRA_BBOX, clusterHotspots, fetchHotspots, type Cluster } from '../data/firms';

const PLACES = [
  { name: 'Palangka Raya', lat: -2.25, lon: 114.0 },
  { name: 'Tanjung Puting', lat: -2.75, lon: 111.95 },
  { name: 'Ogan Komering Ilir', lat: -3.3, lon: 105.5 },
];

/** Latest day whose next 24 h are already in the FIRMS archive. */
const lastFullDay = () => new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);

export function LivePanel({ onLoad, onHindcast, loading }: { onLoad: (lat: number, lon: number) => void; onHindcast: (lat: number, lon: number, date: string) => void; loading: boolean }) {
  const [date, setDate] = useState(lastFullDay);
  const [lat, setLat] = useState('-2.25');
  const [lon, setLon] = useState('114');
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async (bbox: [number, number, number, number], region: string) => {
    setBusy(true); setMsg(null); setClusters(null);
    try {
      // FIRMS counts "1 day" as the current UTC date, which is nearly empty early in the UTC morning;
      // ask for two days and keep a rolling 24 h window.
      const r = await fetchHotspots(bbox, 2);
      const since = Date.now() - 24 * 3600 * 1000;
      const recent = r.hotspots.filter((h) => Date.parse(h.acquired) >= since);
      const c = clusterHotspots(recent).slice(0, 8);
      setClusters(c);
      setMsg(c.length ? `${recent.length} fire detections in ${region} in the last 24 h. Pick one:` : `No fires detected in ${region} in the last 24 h.`);
    } catch (e) {
      setMsg(e instanceof FirmsKeyMissing
        ? 'Fire search needs a NASA FIRMS key (FIRMS_MAP_KEY in .env). You can still enter a location below.'
        : `Couldn\u2019t search for fires: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="live">
      <section className="section">
        <header className="section-head"><h2>Active fires</h2>{busy && <span className="status"><span className="spinner" aria-hidden />Searching</span>}</header>
        <p className="muted small">NASA satellite detections from the last 24 hours.</p>
        <div className="btn-row">
          <button className="btn" disabled={busy || loading} onClick={() => find(KALIMANTAN_BBOX, 'Kalimantan')}>Search Kalimantan</button>
          <button className="btn" disabled={busy || loading} onClick={() => find(SUMATRA_BBOX, 'Sumatra')}>Search Sumatra</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
        {clusters && clusters.length > 0 && (
          <ul className="list">
            {clusters.map((c) => (
              <li key={`${c.lat},${c.lon}`} className="row-item">
                <button className="row-head" disabled={loading} onClick={() => { setLat(c.lat.toFixed(4)); setLon(c.lon.toFixed(4)); onLoad(c.lat, c.lon); }}>
                  <span className="row-text">
                    <span className="row-title">{c.lat.toFixed(3)}, {c.lon.toFixed(3)}</span>
                    <span className="row-sub">{c.count} detections · last seen {c.latest.slice(11, 16)} UTC</span>
                  </span>
                  <span className="chev right" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section">
        <header className="section-head"><h2>Location</h2></header>
        <div className="btn-row">
          {PLACES.map((p) => (
            <button key={p.name} className={`chip ${lat === String(p.lat) && lon === String(p.lon) ? 'on' : ''}`} onClick={() => { setLat(String(p.lat)); setLon(String(p.lon)); }}>{p.name}</button>
          ))}
        </div>
        <div className="coord-row">
          <label className="inv"><span>Latitude</span><input className="num" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" /></label>
          <label className="inv"><span>Longitude</span><input className="num" value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" /></label>
        </div>
        <button className="btn primary wide" disabled={loading || !isFinite(Number(lat)) || !isFinite(Number(lon))} onClick={() => onLoad(Number(lat), Number(lon))}>
          {loading ? 'Loading…' : 'Load this location'}
        </button>
      </section>
      <section className="section">
        <header className="section-head"><h2>Test on a past day</h2></header>
        <p className="muted small">Forecast this location from the last satellite pass of a past day, then compare with what satellites saw in the next 24 hours.</p>
        <div className="coord-row">
          <label className="inv"><span>Day (UTC)</span><input className="num" type="date" value={date} max={lastFullDay()} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <button className="btn wide" disabled={loading || !date || !isFinite(Number(lat)) || !isFinite(Number(lon))} onClick={() => onHindcast(Number(lat), Number(lon), date)}>
          {loading ? 'Loading…' : 'Replay this day'}
        </button>
      </section>
    </div>
  );
}
