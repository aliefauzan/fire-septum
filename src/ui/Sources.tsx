import { useEffect, useState } from 'react';
import { compass } from '../sim/recommend';
import type { Scenario } from '../sim/types';
import { fdrsUrl, fetchBmkg, islandFor, sipongiEnabled, sipongiTmat, type BmkgForecast, type FdrsRegion, type TmatStation } from '../data/bmkg';
import { Segmented } from './Controls';

const centre = (scn: Scenario) => {
  const g = scn.landscape.geo;
  return g ? { lat: (g.north + g.south) / 2, lon: (g.east + g.west) / 2 } : null;
};
const f0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v)));
const f1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1));

/**
 * BMKG's own village forecast next to the Open-Meteo hours the model runs on, so a commander
 * can see where the two disagree. A comparison only: the model's weather is unchanged.
 */
function WeatherCompare({ scn }: { scn: Scenario }) {
  const c = centre(scn);
  const [fc, setFc] = useState<BmkgForecast | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setFc(null); setErr(null);
    if (!c) return;
    const ctl = new AbortController();
    fetchBmkg(c.lat, c.lon, ctl.signal).then(setFc).catch((e) => { if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : String(e)); });
    return () => ctl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.lat, c?.lon]);
  if (!c) return <p className="muted small">BMKG forecasts need a real location; this example scenario has none.</p>;
  if (err) return <p className="muted small">BMKG forecast unavailable: {err}</p>;
  if (!fc) return <p className="muted small"><span className="spinner" aria-hidden /> Asking BMKG…</p>;
  // Open-Meteo hours carry local time labels ("2026-10-24T18:00"); BMKG gives local "2026-10-24 18:00:00".
  const om = new Map(scn.weather.filter((w) => w.time).map((w) => [w.time!.slice(0, 13), w]));
  const rows = fc.hours.filter((h) => !h.local || h.local.slice(0, 13).replace(' ', 'T') >= (scn.weather[0]?.time ?? '').slice(0, 13)).slice(0, 9);
  const l = fc.lokasi;
  return (
    <>
      <p className="small"><b>BMKG forecast for {l.desa}, {l.kecamatan}</b> <span className="muted">({l.kotkab}{fc.distanceKm !== null ? `, ${fc.distanceKm} km from the fire centre` : ''})</span></p>
      <div className="wx-compare">
        <table className="table">
          <thead>
            <tr><th>Local time</th><th>Wind km/h</th><th>From</th><th>RH %</th><th>°C</th><th>Rain mm</th><th>BMKG sky</th></tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const key = h.local ? h.local.slice(0, 13).replace(' ', 'T') : '';
              const o = om.get(key);
              const pair = (b: string, m: string) => <>{b} <span className="muted">/ {m}</span></>;
              return (
                <tr key={h.utc}>
                  <td>{h.local ? h.local.slice(5, 16) : h.utc.slice(5, 16).replace('T', ' ') + ' UTC'}</td>
                  <td>{pair(f0(h.windKmh), f0(o?.windKmh))}</td>
                  <td>{pair(h.windFromDeg === null ? '—' : compass(h.windFromDeg), o ? compass(o.windFromDeg) : '—')}</td>
                  <td>{pair(f0(h.rh), f0(o?.rh))}</td>
                  <td>{pair(f0(h.tempC), f0(o?.tempC))}</td>
                  <td>{pair(f1(h.precipMm), f1(o?.precipMm))}</td>
                  <td className="muted">{h.weather ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small footnote">BMKG first, <span>Open-Meteo</span> (what the simulation uses) after the slash; BMKG gives 3-hourly steps. Shown for comparison only: the forecast still runs on Open-Meteo. Forecast data: BMKG.</p>
    </>
  );
}

const DAYS = ['obs', 0, 1, 2, 3, 4, 5, 6, 7] as const;
const REGION_LABEL: Record<FdrsRegion, string> = {
  '36_indonesia': 'Indonesia', '37_sumatera': 'Sumatra', '38_kalimantan': 'Kalimantan', '20_kalbar': 'West Kalimantan', '21_kalsel': 'South Kalimantan',
  '22_kalteng': 'Central Kalimantan', '04_riau': 'Riau', '06_jambi': 'Jambi', '08_sumsel': 'South Sumatra',
};

/** BMKG's daily fire danger maps (Canadian FWI system): Drought Code for deep peat, FFMC for surface fuel. */
function FireDanger({ scn }: { scn: Scenario }) {
  const c = centre(scn);
  const [region, setRegion] = useState<FdrsRegion>(() => (c ? islandFor(c.lat, c.lon) : '38_kalimantan'));
  const [day, setDay] = useState(1); // index into DAYS: 1 = today
  useEffect(() => { if (c) setRegion(islandFor(c.lat, c.lon)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.lat, c?.lon]);
  const d = DAYS[day];
  const label = d === 'obs' ? 'yesterday (observed)' : d === 0 ? 'today' : `today +${d} d`;
  return (
    <>
      <div className="section-head">
        <Segmented label="Island" value={region} onChange={setRegion} options={(['37_sumatera', '38_kalimantan', '36_indonesia'] as FdrsRegion[]).map((r) => ({ value: r, label: REGION_LABEL[r] }))} />
      </div>
      <label className="field stacked">
        <span>Day: <b>{label}</b></span>
        <input type="range" min={0} max={DAYS.length - 1} step={1} value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Fire danger day" />
      </label>
      <div className="fdrs-row">
        <figure>
          <img className="fdrs-img" src={fdrsUrl(region, 'dc', d)} alt={`BMKG Drought Code map, ${REGION_LABEL[region]}, ${label}`} loading="lazy" />
          <figcaption className="muted small">Drought Code: how dry the deep organic layer is (peat smoulders when high)</figcaption>
        </figure>
        <figure>
          <img className="fdrs-img" src={fdrsUrl(region, 'ffmc', d)} alt={`BMKG Fine Fuel Moisture Code map, ${REGION_LABEL[region]}, ${label}`} loading="lazy" />
          <figcaption className="muted small">FFMC: how easily surface litter and grass ignite</figcaption>
        </figure>
      </div>
      <p className="muted small footnote">Maps: BMKG SPARTAN fire danger rating system (dataweb.bmkg.go.id), redrawn daily. Not used by the simulation.</p>
    </>
  );
}

/** BMKG sources beside the model: a forecast comparison and the national fire danger maps. */
export function SourcesCard({ scn }: { scn: Scenario }) {
  return (
    <details className="card disclosure">
      <summary>BMKG forecast and fire danger</summary>
      <section className="section">
        <header className="section-head"><h2>Weather: BMKG beside Open-Meteo</h2></header>
        <WeatherCompare scn={scn} />
      </section>
      <section className="section">
        <header className="section-head"><h2>BMKG fire danger</h2></header>
        <FireDanger scn={scn} />
      </section>
    </details>
  );
}

/** SiPongi peat water-table stations on the map, only when the operator enabled SiPongi. */
export function useTmatStations(scn: Scenario): TmatStation[] {
  const [st, setSt] = useState<TmatStation[]>([]);
  const g = scn.landscape.geo;
  useEffect(() => {
    setSt([]);
    if (!g) return;
    let live = true;
    sipongiEnabled().then((on) => (on ? sipongiTmat() : []))
      .then((xs) => { if (live) setSt(xs.filter((s) => s.lat <= g.north && s.lat >= g.south && s.lon >= g.west && s.lon <= g.east)); })
      .catch(() => { /* optional layer */ });
    return () => { live = false; };
  }, [g]);
  return st;
}
