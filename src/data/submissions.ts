// Score a stored forecast submission once its window is in FIRMS (scripts/register-daily.ts).
import {
  FIRE_LOOKBACK_H, boxBounds, detectionsInWindow, fireMaskFromDetections, maskToString, scoreForecast, scoreReferences, splitForecast,
} from '../sim/forecast';
import type { ForecastSubmission, SubmissionScore } from '../sim/submission';
import type { FirmsFetch } from './register';

/**
 * Per box: fetch FIRMS from 48 h before issuedAt to the end of the window, make the fire-at-t0
 * mask from the detections before issuedAt, and score the submitted model and the two reference
 * models on the detections of the window. Writes nothing.
 */
export async function computeSubmissionScore(s: ForecastSubmission, firms: FirmsFetch): Promise<SubmissionScore> {
  const boxes = [];
  for (const f of splitForecast(s.forecast)) {
    const t0 = Date.parse(f.issuedAt);
    const fromMs = Date.parse(new Date(t0 - FIRE_LOOKBACK_H * 3.6e6).toISOString().slice(0, 10));
    const days = Math.min(5, Math.ceil((t0 + f.windowH * 3.6e6 - fromMs) / 864e5) + 1);
    const g = boxBounds(f.box.lat, f.box.lon);
    const { hotspots, sources } = await firms([g.west, g.south, g.east, g.north], days, new Date(fromMs).toISOString().slice(0, 10));
    const mask = fireMaskFromDetections(f.box, f.issuedAt, hotspots);
    boxes.push({
      box: f.box,
      fireAtT0: maskToString(mask),
      observed: detectionsInWindow(f, hotspots).map(({ lat, lon, acquired, frp, satellite, confidence }) => ({ lat, lon, acquired, frp, satellite, confidence })),
      sources,
      models: { [f.model.id]: scoreForecast(f, hotspots, mask), ...scoreReferences(f.box, f.issuedAt, f.windowH, hotspots, mask) },
    });
  }
  return { scoredAt: new Date().toISOString(), boxes };
}
