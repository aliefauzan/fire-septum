# Open forecast format and benchmark (v1)

Fire Septum keeps a public, pre-registered benchmark for peat-fire forecasts in Indonesia. Any model can take part. A forecast is sealed before the satellites look, and scored afterwards against NASA FIRMS. The rules are the same ones used for Fire Septum's own forecast register and hindcasts. The leaderboard is at `#/scoreboard` in the app (<https://fire-septum.vercel.app/#/scoreboard>).

- JSON Schema: [`schema/forecast-v1.json`](../schema/forecast-v1.json)
- Validator, scorer and reference models: [`src/sim/forecast.ts`](../src/sim/forecast.ts) (`validateForecast`, `scoreForecast`)
- Server: `POST /api/submissions`, `GET /api/submissions` ([`server/submissions.ts`](../server/submissions.ts))
- Command-line client: [`scripts/submit-forecast.ts`](../scripts/submit-forecast.ts)

## What a forecast is

A forecast gives the probability that VIIRS sees **new** active fire in each 400 m block of a 6.4 km box during the 24 h after it was issued.

```json
{
  "schema": "fireseptum.forecast.v1",
  "model": { "id": "my-model", "name": "My fire model", "version": "1.2.0", "url": "https://example.org/my-model" },
  "issuedAt": "2026-10-25T10:05:00Z",
  "windowH": 24,
  "grid": "blocks400m",
  "box": { "lat": -2.9641, "lon": 112.1507 },
  "probabilities": [0.02, 0.03, "… 256 numbers in [0, 1] …"],
  "metadata": { "inputs": ["FIRMS", "ERA5"], "trainedOn": "2015-2025" }
}
```

| Field | Meaning |
|---|---|
| `schema` | Always `"fireseptum.forecast.v1"`. |
| `model.id` | Stable id, `^[a-z0-9][a-z0-9._-]{1,62}$`. The scorer reserves `fire-septum-ca`, `distance` and `climatology`. |
| `model.name`, `model.version` | Required. Give a new version whenever the model changes. `model.url` is optional. |
| `issuedAt` | ISO 8601 with time zone. The scored window is **(issuedAt, issuedAt + 24 h]**: no detection at or before `issuedAt` is ever scored. |
| `windowH` | Always `24`. |
| `grid` | Always `"blocks400m"`. |
| `box` | Centre of the box: 64 × 64 cells of 100 m. Cell (0, 0) is the north-west corner. The half-widths are 3200 m / 111 320 m per degree of latitude, and 3200 m / (111 320 m · cos lat) per degree of longitude. This is the same box as `bboxAround` in `src/data/live.ts`. |
| `probabilities` | 256 numbers in [0, 1], one per 400 m block (4 × 4 cells). The blocks run row by row from the north-west: `index = row · 16 + column`. |
| `boxes` | Instead of `box` + `probabilities`: up to 50 entries `{lat, lon, probabilities}`, sealed together and scored box by box. |
| `metadata` | Optional free-form object. It is sealed with the forecast but not scored. |

A detection at latitude φ and longitude λ falls in cell `x = (λ − west) / (east − west) · 64 − 0.5` and `y = (north − φ) / (north − south) · 64 − 0.5`, rounded to the nearest integer. Its block is `(⌊y/4⌋, ⌊x/4⌋)`.

## Sealing

1. **Canonical JSON.** Object keys are sorted at every level and `undefined` is dropped (`canonical` in `src/sim/receipt.ts`). Numbers are written exactly as JavaScript's `JSON.stringify` writes them.
2. **SHA-256** of those bytes.
3. **OpenTimestamps.** The server submits the hash to the public calendars right away. If no calendar answers, nothing is stored. The Bitcoin block that confirms it, usually within a few hours, proves that the forecast existed then.
4. **Daily Merkle batch.** The hash also goes into that UTC day's batch (`data/batches/<day>.json`, see the README). The batch root is timestamped and can be attested with EAS on Base.

The record is stored write-once as `data/submissions/<issue day>/<model id>_<first 16 hex digits of the hash>.json`. On the hosted site it goes to Vercel Blob, and the register job (`scripts/register-daily.ts`) copies it into the repository.

**Late forecasts are refused.** `issuedAt` must not be in the future, and it must be at most 1 h before the server receives the forecast. Otherwise anyone could "forecast" what FIRMS already shows. Every box must be in Indonesia (lat −11.5 to 6.5, lon 94.5 to 141.5).

## Scoring

The scoring runs after the window, once the window plus 6 h of FIRMS latency has passed. `scripts/register-daily.ts` does it whenever it runs (by hand for now; on a daily schedule once the hosted instance has its secrets). It uses exactly the register's rules (`scoreBlocks` in `src/sim/hindcast.ts`):

- **Observed.** A block is observed when a VIIRS detection (S-NPP, NOAA-20 or NOAA-21, near real time) acquired in the window falls in it.
- **New fire only.** Blocks on fire at t0 are left out, because any forecast "predicts" fire that is already there.
  - For a submitted box, a block is on fire at t0 when it has a cell within 1.9 cells (one 375 m VIIRS pixel) of a detection acquired in the 48 h before `issuedAt`.
  - For Fire Septum's own register entries, the sealed initial state is used. It applies the same disc to the fuel cells.
- **Within reach.** Only blocks within 3 km of fire at t0 are scored, and these are the candidates. New detections farther away are fresh ignitions, often land clearing. They are counted (`newFires`) but not scored.
- **Yes/no metrics at p ≥ 0.5:** POD = hits / (hits + misses), FAR = false alarms / (hits + false alarms), CSI = hits / (hits + misses + false alarms).
- **Brier score** over the candidate blocks. The per-box **Brier skill** is measured against that box's own observed base rate.
- **Distance-only reference.** On the same box, a forecast of equal size that marks the blocks nearest to the fire. It shows whether a model adds anything beyond "fire grows outward".

```ts
import { scoreForecast } from './src/sim/forecast';
const score = scoreForecast(forecast /* one box */, firmsDetections /* {lat, lon, acquired}[] */, fireAtT0 /* 256 × 0/1 */);
```

`scoreForecast(f, detections, mask)` gives exactly the numbers of `scoreHindcast` for Fire Septum's own ensemble. `src/sim/forecast.test.ts` checks this on the sealed register entries.

### Reference models, scored on every box

| id | Probability | Why |
|---|---|---|
| `distance` | p = exp(−d / 1 km). d is the distance from the block centre to the nearest block on fire at t0 (0 where there is none). | Fixed a priori, never fitted on outcomes. The 8 neighbouring blocks get p ≥ 0.5, so its yes/no forecast is "the fire grows by one VIIRS pixel". |
| `climatology` | p = 114 / 836 ≈ 0.136 in every block. | The share of candidate blocks with new fire in the 12 hindcast events of 8–18 Oct 2026 (`docs/hindcast-rerun-2026-10-24.json`). It is fixed and never refitted. It never says yes, so its CSI is 0; it is a Brier baseline. |

Fire Septum's own register forecast takes part as `fire-septum-ca`. Its block probabilities are the share of the 40 sealed runs that ignite the block within 24 h.

### The leaderboard

Each (model, box) pair counts once. Per model:

- **Pooled CSI** comes from summed hits, misses and false alarms.
- **Mean Brier** is taken over every scored block.
- **Brier skill** = 1 − Σ(p − o)² / Σ(r̄ − o)², where r̄ is the pooled observed rate of the blocks that model was scored on.

The page also shows the cumulative pooled CSI and Brier skill by day. Pooling is in `src/sim/scoreboard.ts`.

## Submitting

```bash
# validate locally
npx tsx scripts/submit-forecast.ts my-forecast.json --check
# submit (the hosted site accepts submissions when its Blob store is configured)
npx tsx scripts/submit-forecast.ts my-forecast.json --url https://fire-septum.vercel.app
```

Or POST it yourself:

```bash
curl -X POST https://fire-septum.vercel.app/api/submissions \
  -H 'content-type: application/json' -d "{\"forecast\": $(cat my-forecast.json)}"
```

The answer carries the hash, the stored file name and the `.ots` proof. The CLI saves `<file>.canonical.json` and `<file>.canonical.json.ots`; once Bitcoin has confirmed the timestamp, check it with `ots upgrade` and `ots verify`. If the instance sets `SUBMISSIONS_TOKEN`, send `Authorization: Bearer <token>`.

**Which boxes?** Any box in Indonesia. To compare with Fire Septum's own forecast on the same fires, forecast the register's boxes. Each time the register job runs (best after the afternoon pass), it seals the top 3 FIRMS clusters per island (Kalimantan, Sumatra), ranked by detections + FRP/50 over the last 24 h. `clusterHotspots` in `src/data/firms.ts` picks them, and anyone can compute the same boxes from FIRMS.

## Caveats

- **The sample is small.** A few busy fires dominate the pooled numbers.
- **VIIRS misses fire.** Cloud, haze and low-intensity smouldering peat hide it, so some "false alarms" did burn.
- **Fires were fought.** Every forecast is scored against what happened with suppression, so a fire that crews stopped counts against a forecast that assumed no action.
- **The window is fixed to `issuedAt`.** A strict auditor can instead start it at the Bitcoin block time of the timestamp.
