# Fire Septum forecaster: validation events and the published split

Generated 2026-10-24T11:03:24Z by `ml/forecast/events.py`, before any forecaster was trained or tuned.

## Published before tuning

The event rule and the train / validation / test split below were written down and the event list
(`data/validation/events.json`) was timestamped on the Bitcoin blockchain with OpenTimestamps
*before* any model was fitted, any hyperparameter searched or any calibration chosen. Nothing in
this file or in `events.json` may change after a score has been seen; a new rule needs a new file,
a new timestamp and a note saying why.

- SHA-256 of `data/validation/events.json`: `ca8c962dc77eeeb5be37c20263a9f347354d959ef5ecb496b0ab6b69c3c1924c`
- OpenTimestamps proof: `data/validation/events.json.ots` (stamped 2026-10-24T11:04Z on the a/b.pool.opentimestamps.org, a.pool.eternitywall.com and ots.btc.catallaxy.com calendars; pending Bitcoin confirmation. train-boxes.json is stamped the same way in train-boxes.json.ots)
- Verify: `uvx --from opentimestamps-client ots verify data/validation/events.json.ots` (once the
  calendar has committed the digest to a Bitcoin block, typically a few hours; `ots upgrade` first).

## Split

| Split | Data | Use |
|---|---|---|
| **train** | 2015 and 2019, Kalimantan and Sumatra | fitting the forecaster |
| **validation** | 2023 Kalimantan | all tuning: isotonic calibration, any hyperparameter search, feature choices |
| **test** | 2023 Sumatra | touched once, at the end, and reported whatever it says |
| **out-of-time test** | the 12 events of 8 to 18 October 2026 and the prospective forecast register | reported after the test split |

2015 (strong El Nino) and 2019 (strong positive Indian Ocean Dipole) were severe fire seasons; 2023
(El Nino with a positive IOD) was large but smaller. Holding out a whole year, and a whole island
for the test, keeps neighbouring days and the same fires out of training and tuning.

## Event rule (exact text, also in `events.json`)

> For every UTC day D from 1 August to 31 October of 2015, 2019 and 2023, separately for Kalimantan [108.5, -4.5, 119.5, 4.5] and Sumatra [95, -6, 106.5, 6] (west, south, east, north), using NASA FIRMS VIIRS S-NPP standard-processing detections from the yearly Indonesia country files with type == 0 (presumed vegetation fire): (1) group the detections of day D on a 0.06 degree grid (clusterHotspots in src/data/firms.ts); (2) for each group, centre = mean latitude and mean longitude of its detections, box = bboxAround(centre) from src/data/live.ts (6.4 km x 6.4 km); (3) detD = VIIRS S-NPP detections inside the box on day D, detD1 = VIIRS S-NPP detections inside the box on UTC day D+1; (4) drop boxes with detD < 5 or detD1 < 1; (5) rank the rest by detD (ties: higher detD1, then lower latitude, then lower longitude) and take them greedily, skipping any box that overlaps one already taken, until 3 boxes (events) or 8 boxes (training-sample list, train years only) are taken. t0 = the latest detection inside the box on day D (UTC). The 12 events of 8 to 18 October 2026 (docs/hindcast.md, VALIDATION_EVENTS in src/data/hindcastBatch.ts) are added unchanged as an out-of-time set.

It generalises the 12-event rule of `docs/hindcast.md` (busiest box per island per day, with fire on
D+1) from one box to up to three non-overlapping boxes, and adds the minimum of 5 detections on D.
Scoring keeps the hindcast conventions of `src/sim/hindcast.ts`: 400 m blocks, new fire only (blocks
burning or burned at t0 are excluded), and a 3 km reach from the fire at t0.

Inputs are restricted to what was knowable at t0. The detections that define an event on day D and
D+1 are VIIRS S-NPP only (standard processing, from the yearly archive), so the label source is
consistent across 2015 to 2023. NOAA-20 flies from 2018 but has no yearly country file at the
corresponding `viirs-noaa20` path (HTTP 404 on 24 Oct 2026), and is not needed: S-NPP covers all years.

## Counts

| Split | Island | Year | Events | Days with an event |
|---|---|---|---|---|
| train | Kalimantan | 2015 | 276 | 92 |
| train | Sumatra | 2015 | 253 | 87 |
| train | Kalimantan | 2019 | 258 | 87 |
| train | Sumatra | 2019 | 268 | 91 |
| validation | Kalimantan | 2023 | 241 | 86 |
| test | Sumatra | 2023 | 184 | 69 |
| oot | Kalimantan | 2026 | 6 | 6 |
| oot | Sumatra | 2026 | 6 | 6 |

Totals: train 1055, validation 241, test 184, oot 12; all 1492.

## Training-sample boxes (train only)

`data/validation/train-boxes.json` applies the same rule with up to **8** boxes per day per island,
for 2015 and 2019 only, to give the forecaster more training samples. Every box in it has
`split: "train"`. It must never be used for validation or test, and it contains no 2023 or 2026 box.

| Island | Year | Boxes |
|---|---|---|
| Kalimantan | 2015 | 735 |
| Sumatra | 2015 | 658 |
| Kalimantan | 2019 | 621 |
| Sumatra | 2019 | 686 |

Total training boxes: 2700.

## Source files

| File | SHA-256 | Rows | Dropped (type != 0) |
|---|---|---|---|
| `viirs-snpp_2015_Indonesia.csv` | `88ffeba70b181aed...` | 875,824 | 16,413 |
| `viirs-snpp_2019_Indonesia.csv` | `1dd309b8ae9dd744...` | 437,281 | 12,748 |
| `viirs-snpp_2023_Indonesia.csv` | `2dba3b772b5a3a2c...` | 253,388 | 17,265 |

Downloaded keyless from `https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/<YEAR>/` into
`.cache/firms-archive/` by `ml/forecast/firms_archive.py`. FIRMS `type`: 0 presumed vegetation fire,
1 active volcano, 2 other static land source, 3 offshore; only type 0 is used.

## Caveats

- Satellites miss fire under smoke and cloud and miss cool smouldering peat; a box with no D+1
  detection is not proof the fire stopped. The D+1 requirement makes every event scoreable.
- Boxes on consecutive days often cover the same fire. Scores must be pooled over events and
  reported with that dependence in mind (for example a block bootstrap by fire or by week).
- The Kalimantan bbox reaches 119.5 E and so includes a strip of western Sulawesi; the country file
  holds Indonesian detections only, so Malaysian Borneo is not in it.
