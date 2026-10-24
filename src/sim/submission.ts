// Stored forecast submissions (server/submissions.ts) and their scores (scripts/register-daily.ts).
import type { RawHotspot } from '../data/firms';
import type { Forecast, ForecastBox, ForecastScore } from './forecast';
import type { Anchor } from './receipt';
import { FIRMS_LATENCY_H } from './register';

export const SUBMISSION_KIND = 'fireseptum.forecast-submission';

/** One box of a scored submission: the mask and detections used, and every model's score on it. */
export interface SubmissionBoxScore {
  box: ForecastBox;
  /** Blocks on fire at t0 (detections in the 48 h before issuedAt), 256 "0"/"1" characters. */
  fireAtT0: string;
  observed: Pick<RawHotspot, 'lat' | 'lon' | 'acquired' | 'frp' | 'satellite' | 'confidence'>[];
  sources: string[];
  /** The submitted model's score and the two reference models', keyed by model id. */
  models: Record<string, ForecastScore>;
}

export interface SubmissionScore {
  scoredAt: string;
  boxes: SubmissionBoxScore[];
}

export interface ForecastSubmission {
  v: 1;
  kind: typeof SUBMISSION_KIND;
  /** When the server received and stored it. */
  receivedAt: string;
  /** SHA-256 of canonical(forecast): the hash that is timestamped and goes into the daily batch. */
  sha256: string;
  forecast: Forecast;
  /** OpenTimestamps proof of sha256 (the "file" is the canonical forecast JSON). */
  anchor?: Anchor;
  score?: SubmissionScore;
}

/** Earliest time the window's detections are all in FIRMS (as the register's dueAt). */
export const submissionDueAt = (s: Pick<ForecastSubmission, 'forecast'>) => Date.parse(s.forecast.issuedAt) + (s.forecast.windowH + FIRMS_LATENCY_H) * 3.6e6;
