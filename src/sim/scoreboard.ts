// The public scoreboard: every scored box of every model, pooled per model.
//
// Rows come from the forecast register (model 'fire-septum-ca' plus the reference models scored on
// the same box) and from submissions (the submitted model plus the reference models on its box).
// Each (model, box) pair counts once: a reference model scored on a box that two records share is
// counted for the first record only. Pooling:
//   CSI, POD, FAR   from summed hits, misses and false alarms (p ≥ 0.5)
//   mean Brier      over every scored block (candidate-weighted)
//   Brier skill     1 − Σ(p − o)² / Σ(r̄ − o)², r̄ = the pooled observed rate of the blocks this
//                   model was scored on (skill against sample climatology; 0 = no better than
//                   knowing the base rate afterwards)
import { boxKey, type Forecast, type ForecastBox, type ForecastModel, type ForecastScore } from './forecast';
import type { HindcastScore } from './hindcast';
import type { Receipt } from './receipt';
import { REGISTER_MODEL } from './forecast';
import { dueAt, type RegisterEntry } from './register';
import { submissionDueAt, type ForecastSubmission } from './submission';

/** A register entry without its (large) inputs. */
export interface BoardRegisterItem {
  hash: string;
  issuedAt: string;
  lat: number;
  lon: number;
  windowH: number;
  rule: string;
  region?: string;
  receipt: Receipt;
  otsB64?: string;
  calendar?: string;
  score?: { scoredAt: string; reproduced: boolean; detections: number; result: HindcastScore; models?: Record<string, ForecastScore> };
}

export interface BoardSubmissionItem {
  sha256: string;
  receivedAt: string;
  forecast: Forecast;
  otsB64?: string;
  calendar?: string;
  score?: { scoredAt: string; boxes: { box: ForecastBox; models: Record<string, ForecastScore> }[] };
}

export interface BoardIndex {
  generatedAt: string;
  register: BoardRegisterItem[];
  submissions: BoardSubmissionItem[];
}

/** Compact index of the register and submissions for the scoreboard page (bundled when hosted statically). */
export function boardIndex(entries: RegisterEntry[], submissions: ForecastSubmission[], generatedAt = new Date().toISOString()): BoardIndex {
  return {
    generatedAt,
    register: [...entries].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)).map((e) => ({
      hash: e.record.receiptSha256, issuedAt: e.issuedAt, lat: e.lat, lon: e.lon, windowH: e.windowH, rule: e.rule,
      ...(e.region ? { region: e.region } : {}),
      receipt: e.record.receipt,
      ...(e.record.anchor ? { otsB64: e.record.anchor.otsB64, calendar: e.record.anchor.calendar } : {}),
      ...(e.score ? { score: { scoredAt: e.score.scoredAt, reproduced: e.score.reproduced, detections: e.score.detections, result: e.score.result, ...(e.score.benchmark ? { models: e.score.benchmark.models } : {}) } } : {}),
    })),
    submissions: [...submissions].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).map((s) => ({
      sha256: s.sha256, receivedAt: s.receivedAt, forecast: s.forecast,
      ...(s.anchor ? { otsB64: s.anchor.otsB64, calendar: s.anchor.calendar } : {}),
      ...(s.score ? { score: { scoredAt: s.score.scoredAt, boxes: s.score.boxes.map((b) => ({ box: b.box, models: b.models })) } } : {}),
    })),
  };
}

export interface BoardRow {
  model: string;
  /** boxKey: box centre and window start hour. */
  key: string;
  /** UTC day the window opened. */
  day: string;
  issuedAt: string;
  score: HindcastScore;
  source: 'register' | 'submission';
  /** Hash of the sealed record the row comes from. */
  record: string;
}

/** Every scored (model, box) pair, each counted once (first record wins). */
export function boardRows(ix: BoardIndex): BoardRow[] {
  const rows: BoardRow[] = [];
  const seen = new Set<string>();
  const add = (r: BoardRow) => {
    const k = `${r.model}|${r.key}`;
    if (seen.has(k)) return;
    seen.add(k);
    rows.push(r);
  };
  for (const e of ix.register) {
    if (!e.score) continue;
    const key = boxKey(e, e.issuedAt), day = e.issuedAt.slice(0, 10);
    const models: Record<string, HindcastScore> = e.score.models ?? { [REGISTER_MODEL]: e.score.result };
    for (const [model, score] of Object.entries(models)) add({ model, key, day, issuedAt: e.issuedAt, score, source: 'register', record: e.hash });
  }
  for (const s of ix.submissions) {
    if (!s.score) continue;
    const day = new Date(s.forecast.issuedAt).toISOString().slice(0, 10);
    for (const b of s.score.boxes) {
      const key = boxKey(b.box, s.forecast.issuedAt);
      for (const [model, score] of Object.entries(b.models)) add({ model, key, day, issuedAt: s.forecast.issuedAt, score, source: 'submission', record: s.sha256 });
    }
  }
  return rows;
}

export interface Standing {
  model: string;
  boxes: number;
  /** Boxes with any new fire within reach. */
  boxesWithFire: number;
  candidates: number;
  observed: number;
  predicted: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  pod: number;
  far: number;
  csi: number;
  /** Candidate-weighted mean Brier score. */
  brier: number;
  /** Against the pooled sample base rate. */
  brierSkill: number;
  /** Pooled CSI of the distance-only forecast of equal size on the same boxes. */
  distanceCsi: number;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Pool rows (one model) into a standing. */
export function pool(model: string, rows: BoardRow[]): Standing {
  let cand = 0, obs = 0, pred = 0, hits = 0, misses = 0, fa = 0, bs = 0, withFire = 0, dHits = 0, dPred = 0;
  for (const { score: s } of rows) {
    cand += s.candidates; obs += s.observed; pred += s.predicted; hits += s.hits; misses += s.misses; fa += s.falseAlarms;
    bs += s.brier * s.candidates;
    if (s.observed > 0) withFire++;
    // The distance-only forecast marks max(1, predicted) blocks; CSI = h / (obs + n − h) gives its hits.
    if (s.candidates > 0) {
      const n = Math.max(1, s.predicted);
      dHits += Math.round((s.distance.csi * (s.observed + n)) / (1 + s.distance.csi));
      dPred += n;
    }
  }
  const rate = ratio(obs, cand);
  const ref = obs * (1 - rate) ** 2 + (cand - obs) * rate ** 2;
  return {
    model, boxes: rows.length, boxesWithFire: withFire, candidates: cand, observed: obs, predicted: pred, hits, misses, falseAlarms: fa,
    pod: ratio(hits, hits + misses), far: ratio(fa, hits + fa), csi: ratio(hits, hits + misses + fa),
    brier: ratio(bs, cand), brierSkill: ref > 0 ? 1 - bs / ref : 0,
    distanceCsi: ratio(dHits, obs + dPred - dHits),
  };
}

/** The leaderboard: one standing per model, best pooled CSI first (ties: higher Brier skill). */
export function leaderboard(rows: BoardRow[]): Standing[] {
  const by = new Map<string, BoardRow[]>();
  for (const r of rows) (by.get(r.model) ?? by.set(r.model, []).get(r.model)!).push(r);
  return [...by.entries()].map(([m, rs]) => pool(m, rs)).sort((a, b) => b.csi - a.csi || b.brierSkill - a.brierSkill || a.model.localeCompare(b.model));
}

export interface SkillPoint { day: string; boxes: number; csi: number; brierSkill: number }

/** Cumulative pooled CSI and Brier skill per model, by the day the windows opened. */
export function skillOverTime(rows: BoardRow[]): Record<string, SkillPoint[]> {
  const out: Record<string, SkillPoint[]> = {};
  const days = [...new Set(rows.map((r) => r.day))].sort();
  for (const model of [...new Set(rows.map((r) => r.model))]) {
    const mine = rows.filter((r) => r.model === model);
    out[model] = days.filter((d) => mine.some((r) => r.day === d)).map((d) => {
      const s = pool(model, mine.filter((r) => r.day <= d));
      return { day: d, boxes: s.boxes, csi: s.csi, brierSkill: s.brierSkill };
    });
  }
  return out;
}

export interface PendingItem {
  model: ForecastModel['id'];
  issuedAt: string;
  dueAt: number;
  boxes: ForecastBox[];
  record: string;
  source: 'register' | 'submission';
}

/** Sealed forecasts without a score yet, soonest due first. */
export function pending(ix: BoardIndex): PendingItem[] {
  const out: PendingItem[] = [];
  for (const e of ix.register) if (!e.score) out.push({ model: REGISTER_MODEL, issuedAt: e.issuedAt, dueAt: dueAt(e), boxes: [{ lat: e.lat, lon: e.lon }], record: e.hash, source: 'register' });
  for (const s of ix.submissions) {
    if (s.score) continue;
    const f = s.forecast;
    out.push({ model: f.model.id, issuedAt: f.issuedAt, dueAt: submissionDueAt(s), boxes: f.boxes ? f.boxes.map(({ lat, lon }) => ({ lat, lon })) : [f.box!], record: s.sha256, source: 'submission' });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}
