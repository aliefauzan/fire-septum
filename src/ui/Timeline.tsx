import { localClock } from '../sim/recommend';
import type { Action, Scenario, ZoneStats } from '../sim/types';

interface Props {
  scn: Scenario;
  t: number;
  setT: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  actions: Action[];
  baseZones: ZoneStats[] | null;
  planZones: ZoneStats[] | null;
}

export function Timeline({ scn, t, setT, playing, setPlaying, actions, baseZones, planZones }: Props) {
  const H = scn.horizonH;
  const W = 1000, HH = 64;
  const xs = (h: number) => (h / H) * W;
  const ws = scn.weather.slice(0, H + 1);
  const maxWind = Math.max(20, ...ws.map((w) => w.windKmh));
  const windPath = ws.map((w, i) => `${i ? 'L' : 'M'}${xs(w.t).toFixed(1)},${(HH - (w.windKmh / maxWind) * (HH - 14)).toFixed(1)}`).join(' ');
  const rhPath = ws.map((w, i) => `${i ? 'L' : 'M'}${xs(w.t).toFixed(1)},${(HH - (w.rh / 100) * (HH - 6)).toFixed(1)}`).join(' ');
  const clock = localClock(scn, t);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-controls">
        <button className="btn icon round" onClick={() => { if (t >= H) setT(0); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="2" y="1" width="3" height="10" rx="1" /><rect x="7" y="1" width="3" height="10" rx="1" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 1.5v9a.5.5 0 0 0 .77.42l7-4.5a.5.5 0 0 0 0-.84l-7-4.5A.5.5 0 0 0 3 1.5Z" /></svg>}
        </button>
        <div className="tl-now">
          <b>{t === 0 ? 'Now' : `+${t % 1 ? t.toFixed(1) : t} h`}</b>
          {clock && <span className="muted"> {clock}</span>}
        </div>
        <input
          type="range" min={0} max={H} step={0.5} value={t}
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
          aria-label="Forecast hour"
        />
        <span className="muted small">{H} h</span>
      </div>
      <details className="more">
      <summary>Wind and humidity</summary>
      <svg viewBox={`0 0 ${W} ${HH + 24}`} preserveAspectRatio="none" className="tl-chart" aria-hidden>
        {ws.map((w) => w.precipMm > 0 && <rect key={`r${w.t}`} x={xs(w.t)} y={0} width={W / H} height={HH} className="tl-rain" />)}
        {ws.map((w) => {
          const local = Number((w.time ?? '').slice(11, 13));
          const night = w.time ? local < 6 || local >= 18 : false;
          return night ? <rect key={`n${w.t}`} x={xs(w.t)} y={0} width={W / H} height={HH} className="tl-night" /> : null;
        })}
        <path d={rhPath} fill="none" className="tl-rh" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={windPath} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {ws.filter((w) => w.t % 3 === 0).map((w) => (
          <g key={`d${w.t}`} transform={`translate(${xs(w.t)},10) rotate(${(w.windFromDeg + 180) % 360})`}>
            <path d="M0,6 L0,-5 M-3,-1 L0,-5 L3,-1" stroke="currentColor" opacity={0.55} strokeWidth={1.2} fill="none" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {actions.map((a) => (
          <line key={a.id} x1={xs(a.startH)} x2={xs(a.startH)} y1={HH - 14} y2={HH} className="tl-act" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        ))}
        {baseZones?.map((z) => z.etaMedian !== null && !z.initiallyBurning && (
          <text key={`b${z.zoneId}`} x={xs(z.etaMedian)} y={HH + 10} className="tl-eta base">▲{z.zoneId}</text>
        ))}
        {planZones?.map((z) => z.etaMedian !== null && !z.initiallyBurning && (
          <text key={`p${z.zoneId}`} x={xs(z.etaMedian)} y={HH + 22} className="tl-eta plan">▲{z.zoneId}</text>
        ))}
        <line x1={xs(t)} x2={xs(t)} y1={0} y2={HH + 24} className="tl-cursor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="tl-legend muted">
        <span><i className="sw wind" /> Wind, up to {Math.round(maxWind)} km/h</span>
        <span><i className="sw rh" /> Humidity</span>
        <span><i className="sw night" /> Night</span>
        <span><b className="base">▲A</b> Fire reaches zone{planZones ? <> · <b className="plan">▲A</b> with plan</> : ''}</span>
      </div>
      </details>
    </section>
  );
}
