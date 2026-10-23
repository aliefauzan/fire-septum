// Replay a past day: forecast from the last satellite pass of day D using only what was
// known then, and keep the next 24 h of detections to score the forecast against.
import { fetchHotspots, type RawHotspot } from './firms';
import { bboxAround, buildLiveScenario, type LiveBuild } from './live';

export const HINDCAST_WINDOW_H = 24;

/** Split FIRMS detections around t0 = the latest detection on `date` (UTC). */
export function splitAtLastPass(hs: RawHotspot[], date: string, windowH = HINDCAST_WINDOW_H) {
  const onDay = hs.filter((h) => h.acquired.startsWith(date)).map((h) => h.acquired).sort();
  const t0 = onDay.at(-1);
  if (!t0) return null;
  const t = Date.parse(t0), until = t + windowH * 3.6e6;
  return {
    t0,
    known: hs.filter((h) => Date.parse(h.acquired) <= t),
    observed: hs.filter((h) => { const a = Date.parse(h.acquired); return a > t && a <= until; }),
  };
}

export async function buildHindcast(lat: number, lon: number, date: string): Promise<LiveBuild> {
  const g = bboxAround(lat, lon);
  // Two days before D (burned scars and the 24 h of active fire) through D + 1 (the observations).
  const from = new Date(Date.parse(date) - 2 * 864e5).toISOString().slice(0, 10);
  const r = await fetchHotspots([g.west, g.south, g.east, g.north], 4, from);
  const s = splitAtLastPass(r.hotspots, date);
  if (!s) throw new Error(`No fire detected in this 6.4 km box on ${date}. Pick a day and place with active fire.`);
  const b = await buildLiveScenario({ lat, lon, horizonH: HINDCAST_WINDOW_H, past: { ...s, windowH: HINDCAST_WINDOW_H } });
  if (b.scenario.hindcast && b.scenario.hindcast.observed.length === 0) {
    b.warnings.push(`Satellites saw no fire here in the ${HINDCAST_WINDOW_H} h after the start, so there is nothing to score against.`);
  }
  return b;
}
