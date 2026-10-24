// Forecast submissions from any model, in the open format (schema/forecast-v1.json).
//   GET  /api/submissions             → every stored submission (data/submissions/, plus Vercel Blob when hosted)
//   POST /api/submissions {forecast}  → validate, hash (canonical JSON → SHA-256), timestamp the hash
//                                       with OpenTimestamps and store it, write-once:
//                                       data/submissions/<issue day>/<model id>_<hash16>.json
// The submission is scored after its window by scripts/register-daily.ts with exactly the rules of
// the forecast register (src/sim/forecast.ts scoreForecast), next to the reference models.
// Late submissions are refused: issuedAt must be in the hour before the server receives it.
// When SUBMISSIONS_TOKEN is set, POST needs "Authorization: Bearer <token>".
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  MAX_SUBMISSION_LAG_H, RESERVED_MODEL_IDS, inIndonesia, splitForecast, validateForecast, type Forecast,
} from '../src/sim/forecast';
import type { ForecastSubmission } from '../src/sim/submission';
import { SUBMISSION_KIND } from '../src/sim/submission';
import { anchor as otsAnchor } from './receipt';
import { canonical, readJson } from './register';
import { blobFromEnv, collection, type BlobLike, type Collection } from './store';

const CLOSED = 'Submissions are closed on this deployment (read-only, no Blob store configured). Submit to an instance with BLOB_READ_WRITE_TOKEN set, or run Fire Septum locally.';

export function submissionsCollection(o: { root?: string; readOnly?: boolean; blob?: BlobLike | null } = {}): Collection<ForecastSubmission> {
  return collection<ForecastSubmission>({
    dir: join(o.root ?? process.cwd(), 'data', 'submissions'), rel: 'data/submissions', prefix: 'submissions', recursive: true,
    hashOf: (s) => s.sha256,
    readOnly: o.readOnly ?? !!process.env.VERCEL,
    blob: o.blob === undefined ? blobFromEnv() : o.blob,
    readOnlyError: CLOSED,
  });
}

export const submissionFileName = (f: Forecast, sha256: string) => `${new Date(f.issuedAt).toISOString().slice(0, 10)}/${f.model.id}_${sha256.slice(0, 16)}.json`;

/** Everything a submission must satisfy besides the schema. Returns the problems found. */
export function checkSubmission(f: Forecast, now: number): string[] {
  const err: string[] = [];
  if (RESERVED_MODEL_IDS.includes(f.model.id)) err.push(`model.id "${f.model.id}" is reserved for the scorer's own forecasts`);
  const t = Date.parse(f.issuedAt);
  if (t > now) err.push('issuedAt is in the future');
  else if (now - t > MAX_SUBMISSION_LAG_H * 3.6e6) err.push(`issuedAt is more than ${MAX_SUBMISSION_LAG_H} h before the server received the forecast; late forecasts are not accepted`);
  splitForecast(f).forEach((b, i) => { if (!inIndonesia(b.box)) err.push(`box ${i} (${b.box.lat}, ${b.box.lon}) is outside Indonesia`); });
  return err;
}

export interface SubmissionsDeps {
  getStore: () => Collection<ForecastSubmission>;
  anchor?: (hex: string) => Promise<{ calendar: string; ots: Buffer } | null>;
  now?: () => number;
  token?: () => string | undefined;
}

export function makeSubmissionsHandler(d: SubmissionsDeps) {
  let store: Collection<ForecastSubmission> | null = null;
  const anchor = d.anchor ?? otsAnchor;
  const now = d.now ?? Date.now;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/api/submissions') return next();
    res.setHeader('content-type', 'application/json');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    (async () => {
      store ??= d.getStore();
      if (req.method === 'GET') return send(200, { submissions: await store.list() });
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const token = d.token?.();
      if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'this instance needs Authorization: Bearer <SUBMISSIONS_TOKEN>' });
      if (store.mode === 'read-only') return send(405, { error: CLOSED });
      const body = await readJson(req, 1_000_000);
      const f = (body.forecast ?? body) as Forecast;
      const problems = validateForecast(f);
      if (problems.length) return send(400, { error: 'not a valid forecast (schema/forecast-v1.json)', problems });
      const more = checkSubmission(f, now());
      if (more.length) return send(400, { error: 'forecast refused', problems: more });
      const sha256 = createHash('sha256').update(canonical(f)).digest('hex');
      if (await store.find(sha256)) return send(409, { error: 'already submitted', sha256 });
      // The timestamp is what proves the forecast existed before the satellites looked: no proof, no record.
      const a = await anchor(sha256);
      if (!a) return send(502, { error: 'no OpenTimestamps calendar answered; nothing stored, try again' });
      const rec: ForecastSubmission = {
        v: 1, kind: SUBMISSION_KIND, receivedAt: new Date(now()).toISOString(), sha256, forecast: f,
        anchor: { calendar: a.calendar, submittedAt: new Date(now()).toISOString(), otsB64: a.ots.toString('base64') },
      };
      const r = await store.add(submissionFileName(f, sha256), rec);
      return r.status === 200 ? send(200, { ok: true, sha256, file: r.file, anchor: rec.anchor }) : send(r.status, { error: r.error, sha256 });
    })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
  };
}

export const submissionsHandler = makeSubmissionsHandler({ getStore: () => submissionsCollection(), token: () => process.env.SUBMISSIONS_TOKEN });
