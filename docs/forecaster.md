# The statistical forecaster: where new fire will be seen in the next three days

Fire Septum has two models with two jobs:

- **The cellular automaton** (`src/sim/model.ts`, Alexandridis et al. 2008) answers *what happens if we act*: it spreads fire cell by cell and lets firebreaks, water and crews change the outcome.
- **The gradient-boosted forecaster** (this document; `src/sim/features.ts`, `src/sim/gbm.ts`, `ml/gbm/`) answers *where will new fire be seen*: the probability that VIIRS detects new fire in each 400 m block of the 6.4 km box in each of the next three 24 h windows.

The cellular automaton was built for wind-driven surface fire fronts. Indonesian peat fires smoulder and creep, and are driven by drought and drainage rather than by wind. On the six pre-registered register forecasts it scored CSI 0.13 and Brier skill −2.98, worse than a fixed distance reference (CSI 0.18, Brier skill −1.35), and on the 12 hindcasts its probabilities were uncalibrated. A data-driven forecaster, trained on three fire seasons and checked on a season and an island it never saw, is the better tool for the second question.

Every number below is in [`validation-scale.json`](validation-scale.json) (written by `ml/gbm/evaluate.py`); the tables are printed from that file by `ml/gbm/report.py`.

## In one paragraph

On 2023 Sumatra, a season and an island the model never saw in training or tuning and that was scored exactly once, the calibrated forecaster has a Brier skill of **+0.036 (95% CI +0.026 to +0.045)** for the next 24 h, against +0.022 for distance alone, +0.020 for persistence and **−8.5** for the cellular automaton on the same blocks. It ranks blocks better (AUC 0.79 against 0.76) and keeps its skill at 48 and 72 h, where distance and persistence fade. Its probabilities are reliable on the test season. The skill is small in absolute terms: new fire is rare (about 2 % of the candidate blocks per day with VIIRS S-NPP), and the best CSI any model reaches is under 0.1. On the 12 October 2026 events (out-of-time) it is ahead at lead 1 but the intervals cross zero, and at lead 3 it has no skill; it under-forecasts there, because 2026 had about three times the new-fire rate of the training seasons.

## Question and target

For a 6.4 km box (16 × 16 blocks of 400 m) at time t0, what is the probability that VIIRS detects **new** fire in each block during lead 1 (t0, t0 + 24 h], lead 2 (t0 + 24, t0 + 48 h] and lead 3 (t0 + 48, t0 + 72 h]?

The target is the one the register, the hindcasts and the open benchmark score (`src/sim/hindcast.ts` `scoreBlocks`, now with its label rule factored out as `observedBlocks`):

- Blocks already burning or burned at t0 are excluded, because only new fire counts.
- Only blocks within 3 km of fire at t0 count (the *candidate* blocks).
- A block is a positive for a lead if a detection of that window falls in it.

Every lead uses the same candidate blocks and the same fire-at-t0 mask.

## Split (published and timestamped before any fitting)

The split is the one in [forecast-split.md](forecast-split.md): `data/validation/events.json` (SHA-256 `ca8c962d…1924c`, OpenTimestamps proof `events.json.ots`) and `train-boxes.json`. The model file records the hash of both.

| Split | Boxes | Use here |
|---|---|---|
| train | 2015 + 2019, both islands, 2,700 boxes from `train-boxes.json` (up to 8 per island per day) | fitting the trees and the three baselines |
| validation | 2023 Kalimantan, 241 events | number of trees, the hyperparameter grid, isotonic calibration, the CSI thresholds |
| test | 2023 Sumatra, 184 events | evaluated **once**, at the end (`evaluate.py --final`, logged in `testEvaluations` of the JSON: one entry, 2026-10-24T13:26Z) |
| out-of-time | the 12 events of 8–18 Oct 2026 | reported after the test |

A box and all its blocks stay in one split. The split separates whole seasons, and for the test a whole island, so the same fires never appear in training and evaluation.

## Data and extraction

`scripts/ml/extract.ts` builds every box exactly as a hindcast, with the Node data environment:

- **Scenario at t0.** `buildLiveScenario` (`src/data/live.ts`) reads peat (GFW), land cover (WorldCover), terrain, the OSM barrier snapshot (water, settlement, partial breaks, distance to drainage `drainM`) and the FIRMS fire history (earlier years only).
- **FIRMS.** Detections from 00:00 UTC two days before day D up to t0 are known: those up to 24 h old are burning, older ones burned. t0 is the published one.
  - 2015–2023 come from the yearly VIIRS S-NPP archive (`scripts/lib/firms-archive.ts`, type 0 only, the same columns as the area API).
  - The 2026 events come from the FIRMS area API (cached). Split `oot` keeps S-NPP only, the label source of training. `oot_allviirs` keeps S-NPP + NOAA-20 + NOAA-21, as the app reads them.
- **Weather.** The extraction reads none: features do not use the CA weather, and `LiveOptions.weather` (new) takes caller-supplied weather. Overpass is switched off in batch runs.
- **Labels.** Detections of each window are run through `observedBlocks`.
- **FWI join.** `scripts/ml/assemble.ts` joins the FWI values (`data/fwi/era5-<year>.json.gz`, `src/data/fwiArchive.ts`): nearest 0.5° point (median 21.6 km, max 39 km away), the latest 05 UTC value at or before t0 (`fwiDateAt`). It writes `.cache/ml/rows_<split>.csv` and `manifest.json`.

Check: for the 12 October 2026 events with all three satellites, the lead-1 candidate and new-fire block counts equal those of the published hindcast re-run (`docs/hindcast-rerun-2026-10-24.json`) box by box.

| Split | Boxes extracted / expected | Failed | Boxes with no candidate block | Candidate blocks (rows) | New-fire blocks lead 1 / 2 / 3 | Boxes with FWI |
|---|---|---|---|---|---|---|
| train | 2700 / 2700 | 0 | 20 | 464,100 | 12164 / 14724 / 14816 | 2680 |
| validation | 241 / 241 | 0 | 0 | 48,775 | 951 / 904 / 823 | 241 |
| test | 184 / 184 | 0 | 0 | 36,044 | 778 / 774 / 860 | 184 |
| oot | 12 / 12 | 0 | 0 | 1,061 | 81 / 122 / 87 | 12 |
| oot_allviirs | 12 / 12 | 0 | 0 | 837 | 114 / 163 / 160 | 12 |

No box failed. The 20 train boxes without a candidate block have no fire-at-t0 cell on burnable fuel. Every box had the real peat map except one train box (synthetic). Every box used the OSM snapshot barriers except one validation box (none; its canal features are NaN). Every box had the fire-history layer. The positive rate is about 2 % per lead in 2015–2023 and 8–12 % in October 2026 (S-NPP); with three satellites it is 14–20 %.

## Features (`src/sim/features.ts`)

One implementation serves training and the app: `computeBoxFeatures` runs on every historical box in the extraction and inside `gbmForecast` on a live or sealed scenario.

- **Missing values are NaN in both places.** Examples are no older fire in the box, no canal layer, no FWI value or no wind direction. The trees route NaN down their learned missing-value branch, so no imputation can differ between training and inference.
- **Deterministic.** The code uses only IEEE-exact operations plus DET1 `sin`/`cos`.

| # | Feature | Definition |
|---|---|---|
| 1 | `d_active_km` | Distance (km) from the block centre to the nearest detection of the last 24 h (active fire). NaN when there is none in the box. |
| 2 | `d_older_km` | Distance (km) to the nearest detection 24–48 h old. NaN when there is none. |
| 3 | `d_fire_km` | Distance (km) from the block centre to the nearest block on fire at t0 (the scorer's fire mask, which also holds older scars). NaN when no block is on fire. |
| 4 | `n_active_1km` | Detections of the last 24 h within 1 km. |
| 5 | `n_active_3km` | Detections of the last 24 h within 3 km. |
| 6 | `n_older_3km` | Detections 24–48 h old within 3 km. |
| 7 | `frp_active_3km` | Sum of fire radiative power (MW) of the detections of the last 24 h within 3 km. |
| 8 | `n_active_box` | Detections of the last 24 h in the whole box. |
| 9 | `n_older_box` | Detections 24–48 h old in the whole box. |
| 10 | `frp_active_box` | Sum of FRP (MW) of the detections of the last 24 h in the box. |
| 11 | `growth_ratio` | n_active_box / (n_older_box + 1): is the fire in the box growing or dying down. |
| 12 | `fire_duration_h` | Hours between the oldest and the newest detection (≤ 48 h old) within 3 km: how long this fire has been seen. NaN when none is within 3 km. |
| 13 | `spread_align` | Cosine between the bearing from the nearest active detection to the block and the shift of the fire's centroid from the 24–48 h detections to the last 24 h ones (the direction the fire has been moving). NaN when either set is empty or the shift is under half a cell. |
| 14 | `wind_align` | Cosine between the bearing from the nearest active detection to the block and the direction the wind blows TO at t0. NaN when the wind direction is not given (always, in the historical training data: the ERA5 archive has no wind direction). |
| 15 | `peat_frac` | Share of the block's cells on peat soil (fuel peat swamp forest or degraded peat shrub, GFW peat map). |
| 16 | `peat_frac_nbr` | Share of peat-soil cells in the 5 × 5 blocks (2 km) around the block. |
| 17 | `f_grass` | Share of cells with fuel grass / fern (WorldCover grass, shrub or bare off peat). |
| 18 | `f_shrub` | Share of cells with fuel degraded peat shrub. |
| 19 | `f_peatforest` | Share of cells with fuel peat swamp forest. |
| 20 | `f_plantation` | Share of cells with fuel plantation (tree cover off peat). |
| 21 | `f_agri` | Share of cells with fuel wet farmland (cropland, wetland, mangrove off peat). |
| 22 | `f_water` | Share of water cells (WorldCover water, OSM rivers and canals, sea level). |
| 23 | `f_built` | Share of settlement / major-road cells. |
| 24 | `nonburn_nbr` | Share of non-burnable cells (water + settlement) in the 5 × 5 blocks around the block. |
| 25 | `brk_frac` | Share of cells carrying a partial fuel break (OSM ditches, drains, streams, minor roads, tracks). |
| 26 | `drain_min_m` | Minimum over the block's cells of the distance (m) to the nearest canal, ditch or drain (OSM snapshot). NaN without the canal layer. |
| 27 | `drain_mean_m` | Mean of the same distance over the block. NaN without the canal layer. |
| 28 | `canal_density` | Share of cells in the 5 × 5 blocks around the block that lie within 50 m of a canal, ditch or drain. NaN without the canal layer. |
| 29 | `fire_years_mean` | Mean over the block's cells of the number of earlier calendar years with a FIRMS detection (years before t0's year only). NaN without the fire-history layer. |
| 30 | `fire_years_max` | Maximum of the same count over the block. NaN without the fire-history layer. |
| 31 | `elev_mean` | Mean elevation (m) of the block (AWS Terrain Tiles). |
| 32 | `elev_rel` | Block mean elevation minus the median block elevation of the box (m): peat domes and river valleys. |
| 33 | `slope_pct` | Slope (%) from the block-mean elevations of the neighbouring blocks (central differences, one-sided at the edge). |
| 34 | `ffmc` | Fine Fuel Moisture Code at t0 (FWI System, ERA5, nearest 0.5° point, the latest 05 UTC value at or before t0). |
| 35 | `dmc` | Duff Moisture Code at t0. |
| 36 | `dc` | Drought Code at t0: deep, slow drying. The key peat drought signal. |
| 37 | `isi` | Initial Spread Index at t0. |
| 38 | `bui` | Buildup Index at t0. |
| 39 | `fwi` | Fire Weather Index at t0. |
| 40 | `days_since_rain` | Days since the last day with ≥ 2 mm of rain (ERA5). |
| 41 | `rain24` | Rain (mm) in the 24 h ending at the FWI hour. |
| 42 | `rh` | Relative humidity (%) at the FWI hour. |
| 43 | `wind_kmh` | 10 m wind speed (km/h) at the FWI hour. |
| 44 | `temp_c` | 2 m air temperature (°C) at the FWI hour. |
| 45 | `doy` | UTC day of year of t0 (1–366). |

`wind_align` is computed but never observed in training, because the ERA5 archive the FWI pipeline cached has no wind direction. The model therefore has 44 features and ignores wind direction. As a data-driven stand-in, `spread_align` measures how the fire's centroid moved over the previous two days.

## Model

- **Trees.** scikit-learn 1.9.1 `HistGradientBoostingClassifier` (log loss, learning rate 0.1), one model per lead (`ml/gbm/train.py`).
- **Tuning on validation only.** For each of 12 grid points (max leaf nodes 15/31/63 × min samples per leaf 100/400 × L2 0/1), up to 400 trees are fitted on train. The number of trees is the one with the lowest validation log loss of the staged predictions. The grid point with the lowest validation log loss wins, and its fitted model is cut to that many trees (no refit).
  - Lead 1: 31 leaves, min leaf 400, L2 1, 101 trees.
  - Lead 2: 63 / 100 / 1, 82 trees.
  - Lead 3: 63 / 100 / 1, 51 trees.
- **Calibration.** Isotonic regression (clipped) maps the raw validation probabilities to the observed validation frequencies, with 62 / 56 / 54 knots.
- **Shipped model.** `public/data/forecaster/gbm-v1.json` (0.85 MB) holds, per lead, the trees as columnar node arrays (feature, threshold with `null` = +∞, missing-goes-left, left, right, leaf value), the baseline log-odds and the isotonic knots. It also holds the feature list in column order, the tuning log, and training metadata including the SHA-256 of `events.json` and `train-boxes.json` and of the FWI files.
- **Inference (`src/sim/gbm.ts`).** Pure TypeScript: comparisons, + and ÷, and `DET1.exp` for the logistic. `src/sim/gbm.test.ts` reproduces scikit-learn's raw score, probability and isotonic value on 260 fixture rows (200 validation rows + 60 with 30 % of features knocked out to NaN) to 1e-12 for all three leads.

## Baselines

All baselines are fitted on train only.

- **Climatology:** the train base rate per lead (0.026 / 0.032 / 0.032).
- **Distance-only:** logistic regression in `d_fire_km`, the distance to the nearest block on fire at t0. Lead 1: logit = −1.92 − 1.98·d.
- **Persistence:** two train rates: blocks with a detection of the last 24 h within 1 km (0.058 at lead 1) and all others (0.009). This is "fire that was active on day D spreads to its neighbours".
- **Cellular automaton (leads 1–2):** `scripts/ml/ca.ts`, DEFAULT_PARAMS (τ = 6 h, 40 runs, det1), no actions.
  - Weather is hourly ERA5 from the FWI pipeline's cache (`.cache/era5/<year>/`, nearest 0.5° point), starting at t0's hour, with the 72 h of rain before it as antecedent rain.
  - **The cache has no wind direction**, and this work may not call Open-Meteo. The 40 runs are therefore split over 8 wind directions (5 seeds each) at the ERA5 speed: a direction-averaged CA.
  - Lead 1 is the share of runs that newly ignite a cell of the block within 24 h (as the register). Lead 2 is the share of runs with a cell, ignited after t0, burning at some time in (24, 48 h].
  - It ran on all 241 validation and 184 test boxes, and on 7 of the 12 out-of-time boxes. Three have no 2026 weather file. For two (18 Oct) the cached archive ends at 18 Oct 23:00 UTC, short of 48 h.
  - The rebuilt scenarios gave the same candidate blocks and labels as the extraction in every box.

## Metrics

All metrics are computed on candidate blocks only.

- **Brier score** and **Brier skill against climatology**: 1 − BS / BS(train base rate) on the same rows. The register's BSS is against each box's own observed rate, so it is not the same number.
- **AUC.**
- **Reliability:** 10 equal-width bins with counts in the JSON, plus forecast deciles, because almost all forecasts are below 0.2.
- **CSI, POD and FAR** at the CSI-optimal threshold chosen on validation for each model and lead, and at 0.5.
- **95% intervals:** bootstrap over boxes (1,000 draws; AUC 300). For BSS there is also a bootstrap over island-weeks, because boxes of the same fire on neighbouring days are not independent.

Everything is in `docs/validation-scale.json`. Reliability plots are `docs/img/forecaster-reliability-<split>.png`; the CA's points run off their axes.

## Results

### Brier skill and AUC

**Validation: 2023 Kalimantan** (241 boxes, 48,775 candidate blocks; base rate lead 1/2/3: 0.019 / 0.019 / 0.017)

| Model | BSS lead 1 [95% CI] | BSS lead 2 | BSS lead 3 | AUC 1 / 2 / 3 |
|---|---|---|---|---|
| GBM (raw) | +0.035 [+0.019, +0.051] | +0.033 [+0.018, +0.048] | +0.026 [+0.012, +0.041] | 0.810 / 0.771 / 0.769 |
| GBM + isotonic | +0.042 [+0.031, +0.052] | +0.038 [+0.026, +0.051] | +0.034 [+0.025, +0.045] | 0.813 / 0.775 / 0.774 |
| Climatology (train rate) | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | 0.500 / 0.500 / 0.500 |
| Distance-only (logistic) | +0.023 [+0.019, +0.028] | +0.012 [+0.005, +0.019] | +0.010 [+0.003, +0.016] | 0.773 / 0.714 / 0.703 |
| Persistence | +0.019 [+0.013, +0.023] | +0.009 [+0.001, +0.015] | +0.008 [+0.001, +0.014] | 0.725 / 0.672 / 0.662 |
| Cellular automaton (241/241 boxes) | -6.185 [-7.546, -4.992] | -9.347 [-12.023, -7.374] | – | 0.765 / 0.690 / – |

**Test: 2023 Sumatra** (184 boxes, 36,044 candidate blocks; base rate lead 1/2/3: 0.022 / 0.021 / 0.024)

| Model | BSS lead 1 [95% CI] | BSS lead 2 | BSS lead 3 | AUC 1 / 2 / 3 |
|---|---|---|---|---|
| GBM (raw) | +0.032 [+0.018, +0.044] | +0.034 [+0.019, +0.049] | +0.030 [+0.015, +0.047] | 0.795 / 0.793 / 0.749 |
| GBM + isotonic | +0.036 [+0.026, +0.045] | +0.035 [+0.024, +0.046] | +0.026 [+0.016, +0.038] | 0.794 / 0.789 / 0.745 |
| Climatology (train rate) | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | 0.500 / 0.500 / 0.500 |
| Distance-only (logistic) | +0.022 [+0.016, +0.028] | +0.021 [+0.013, +0.027] | +0.013 [+0.008, +0.018] | 0.756 / 0.755 / 0.702 |
| Persistence | +0.020 [+0.015, +0.026] | +0.019 [+0.012, +0.025] | +0.011 [+0.006, +0.016] | 0.722 / 0.709 / 0.657 |
| Cellular automaton (184/184 boxes) | -8.517 [-10.970, -6.763] | -13.379 [-17.110, -10.595] | – | 0.756 / 0.703 / – |

**Out-of-time: Oct 2026 (VIIRS S-NPP)** (12 boxes, 1,061 candidate blocks; base rate lead 1/2/3: 0.076 / 0.115 / 0.082)

| Model | BSS lead 1 [95% CI] | BSS lead 2 | BSS lead 3 | AUC 1 / 2 / 3 |
|---|---|---|---|---|
| GBM (raw) | +0.067 [-0.186, +0.095] | +0.017 [-0.051, +0.064] | -0.004 [-0.040, +0.017] | 0.748 / 0.669 / 0.583 |
| GBM + isotonic | +0.069 [-0.093, +0.098] | +0.023 [-0.021, +0.059] | -0.003 [-0.032, +0.017] | 0.747 / 0.668 / 0.588 |
| Climatology (train rate) | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | 0.500 / 0.500 / 0.500 |
| Distance-only (logistic) | +0.026 [-0.036, +0.034] | +0.021 [+0.006, +0.038] | +0.014 [-0.013, +0.031] | 0.602 / 0.532 / 0.533 |
| Persistence | +0.034 [-0.010, +0.042] | +0.026 [+0.006, +0.046] | +0.016 [-0.008, +0.035] | 0.655 / 0.595 / 0.569 |
| Cellular automaton (7/12 boxes) | -7.905 [-54.816, -4.355] | -2.177 [-7.795, -0.165] | – | 0.767 / 0.599 / – |

**Out-of-time: Oct 2026 (all three VIIRS, as the app)** (12 boxes, 837 candidate blocks; base rate lead 1/2/3: 0.136 / 0.195 / 0.191)

| Model | BSS lead 1 [95% CI] | BSS lead 2 | BSS lead 3 | AUC 1 / 2 / 3 |
|---|---|---|---|---|
| GBM (raw) | +0.056 [-0.061, +0.130] | +0.050 [-0.273, +0.243] | +0.055 [+0.032, +0.088] | 0.604 / 0.623 / 0.659 |
| GBM + isotonic | +0.062 [+0.005, +0.110] | +0.056 [-0.255, +0.213] | +0.033 [+0.018, +0.051] | 0.603 / 0.622 / 0.652 |
| Climatology (train rate) | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | 0.500 / 0.500 / 0.500 |
| Distance-only (logistic) | +0.033 [+0.015, +0.038] | +0.034 [+0.027, +0.041] | +0.026 [+0.015, +0.041] | 0.577 / 0.561 / 0.532 |
| Persistence | +0.039 [+0.026, +0.045] | +0.036 [+0.028, +0.046] | +0.025 [+0.009, +0.040] | 0.629 / 0.605 / 0.555 |
| Cellular automaton (7/12 boxes) | -2.819 [-13.183, -1.188] | -0.780 [-4.744, +0.328] | – | 0.772 / 0.647 / – |

Island-week intervals for the calibrated GBM's BSS are close to the box intervals:

| Lead | Validation | Test |
|---|---|---|
| 1 | +0.029 to +0.053 | +0.028 to +0.048 |
| 2 | +0.024 to +0.051 | +0.022 to +0.048 |
| 3 | +0.021 to +0.054 | +0.018 to +0.037 |

For distance, the test intervals are +0.014 to +0.030 (lead 1), +0.007 to +0.031 (lead 2) and +0.004 to +0.019 (lead 3).

### CSI by lead

**Test: 2023 Sumatra**: CSI at the validation-chosen threshold (threshold in brackets), and at 0.5

| Model | Lead 1 | Lead 2 | Lead 3 | CSI at 0.5 (1 / 2 / 3) | POD / FAR lead 1 |
|---|---|---|---|---|---|
| GBM (raw) | 0.077 [0.06, 0.09] (p ≥ 0.10) | 0.084 [0.06, 0.11] (p ≥ 0.07) | 0.074 [0.06, 0.10] (p ≥ 0.05) | 0.000 / 0.000 / 0.000 | 0.19 / 0.88 |
| GBM + isotonic | 0.077 [0.06, 0.09] (p ≥ 0.08) | 0.069 [0.05, 0.09] (p ≥ 0.07) | 0.071 [0.05, 0.09] (p ≥ 0.05) | 0.000 / 0.000 / 0.000 | 0.20 / 0.89 |
| Climatology (train rate) | 0.022 [0.02, 0.03] (p ≥ 0.01) | 0.021 [0.02, 0.03] (p ≥ 0.01) | 0.024 [0.02, 0.03] (p ≥ 0.01) | 0.000 / 0.000 / 0.000 | 1.00 / 0.98 |
| Distance-only (logistic) | 0.061 [0.05, 0.07] (p ≥ 0.05) | 0.057 [0.05, 0.07] (p ≥ 0.06) | 0.048 [0.04, 0.06] (p ≥ 0.06) | 0.000 / 0.000 / 0.000 | 0.56 / 0.94 |
| Persistence | 0.052 [0.04, 0.06] (p ≥ 0.01) | 0.049 [0.04, 0.06] (p ≥ 0.02) | 0.047 [0.04, 0.06] (p ≥ 0.02) | 0.000 / 0.000 / 0.000 | 0.74 / 0.95 |
| Cellular automaton | 0.061 [0.05, 0.07] (p ≥ 0.81) | 0.039 [0.03, 0.05] (p ≥ 0.51) | – | 0.051 / 0.038 / – | 0.51 / 0.93 |

**Validation: 2023 Kalimantan**: CSI at the validation-chosen threshold (threshold in brackets), and at 0.5

| Model | Lead 1 | Lead 2 | Lead 3 | CSI at 0.5 (1 / 2 / 3) | POD / FAR lead 1 |
|---|---|---|---|---|---|
| GBM (raw) | 0.088 [0.07, 0.11] (p ≥ 0.10) | 0.072 [0.05, 0.09] (p ≥ 0.07) | 0.054 [0.04, 0.07] (p ≥ 0.05) | 0.000 / 0.000 / 0.000 | 0.23 / 0.88 |
| GBM + isotonic | 0.089 [0.07, 0.11] (p ≥ 0.08) | 0.073 [0.05, 0.10] (p ≥ 0.07) | 0.056 [0.04, 0.07] (p ≥ 0.05) | 0.000 / 0.001 / 0.001 | 0.25 / 0.88 |
| Climatology (train rate) | 0.019 [0.02, 0.02] (p ≥ 0.01) | 0.019 [0.01, 0.02] (p ≥ 0.01) | 0.017 [0.01, 0.02] (p ≥ 0.01) | 0.000 / 0.000 / 0.000 | 1.00 / 0.98 |
| Distance-only (logistic) | 0.057 [0.05, 0.07] (p ≥ 0.05) | 0.045 [0.04, 0.05] (p ≥ 0.06) | 0.038 [0.03, 0.05] (p ≥ 0.06) | 0.000 / 0.000 / 0.000 | 0.56 / 0.94 |
| Persistence | 0.047 [0.04, 0.05] (p ≥ 0.01) | 0.038 [0.03, 0.05] (p ≥ 0.02) | 0.034 [0.03, 0.04] (p ≥ 0.02) | 0.000 / 0.000 / 0.000 | 0.74 / 0.95 |
| Cellular automaton | 0.070 [0.06, 0.08] (p ≥ 0.81) | 0.035 [0.03, 0.04] (p ≥ 0.51) | – | 0.059 / 0.035 / – | 0.40 / 0.92 |

**Out-of-time: Oct 2026 (VIIRS S-NPP)**: CSI at the validation-chosen threshold (threshold in brackets), and at 0.5

| Model | Lead 1 | Lead 2 | Lead 3 | CSI at 0.5 (1 / 2 / 3) | POD / FAR lead 1 |
|---|---|---|---|---|---|
| GBM (raw) | 0.142 [0.02, 0.20] (p ≥ 0.10) | 0.118 [0.07, 0.17] (p ≥ 0.07) | 0.072 [0.03, 0.12] (p ≥ 0.05) | 0.000 / 0.000 / 0.000 | 0.38 / 0.82 |
| GBM + isotonic | 0.144 [0.02, 0.21] (p ≥ 0.08) | 0.102 [0.04, 0.16] (p ≥ 0.07) | 0.085 [0.04, 0.14] (p ≥ 0.05) | 0.000 / 0.016 / 0.021 | 0.40 / 0.82 |
| Climatology (train rate) | 0.076 [0.01, 0.16] (p ≥ 0.01) | 0.115 [0.06, 0.16] (p ≥ 0.01) | 0.082 [0.04, 0.13] (p ≥ 0.01) | 0.000 / 0.000 / 0.000 | 1.00 / 0.92 |
| Distance-only (logistic) | 0.093 [0.03, 0.17] (p ≥ 0.05) | 0.107 [0.07, 0.14] (p ≥ 0.06) | 0.088 [0.04, 0.14] (p ≥ 0.06) | 0.000 / 0.000 / 0.000 | 0.57 / 0.90 |
| Persistence | 0.114 [0.03, 0.21] (p ≥ 0.01) | 0.142 [0.08, 0.21] (p ≥ 0.02) | 0.096 [0.05, 0.16] (p ≥ 0.02) | 0.000 / 0.000 / 0.000 | 0.84 / 0.88 |
| Cellular automaton | 0.091 [0.00, 0.15] (p ≥ 0.81) | 0.094 [0.00, 0.15] (p ≥ 0.51) | – | 0.068 / 0.104 / – | 0.73 / 0.91 |

**Out-of-time: Oct 2026 (all three VIIRS, as the app)**: CSI at the validation-chosen threshold (threshold in brackets), and at 0.5

| Model | Lead 1 | Lead 2 | Lead 3 | CSI at 0.5 (1 / 2 / 3) | POD / FAR lead 1 |
|---|---|---|---|---|---|
| GBM (raw) | 0.156 [0.08, 0.23] (p ≥ 0.10) | 0.199 [0.05, 0.38] (p ≥ 0.07) | 0.232 [0.17, 0.31] (p ≥ 0.05) | 0.000 / 0.054 / 0.000 | 0.36 / 0.78 |
| GBM + isotonic | 0.155 [0.07, 0.22] (p ≥ 0.08) | 0.174 [0.02, 0.38] (p ≥ 0.07) | 0.237 [0.18, 0.32] (p ≥ 0.05) | 0.000 / 0.073 / 0.000 | 0.36 / 0.79 |
| Climatology (train rate) | 0.136 [0.04, 0.26] (p ≥ 0.01) | 0.195 [0.09, 0.31] (p ≥ 0.01) | 0.191 [0.12, 0.26] (p ≥ 0.01) | 0.000 / 0.000 / 0.000 | 1.00 / 0.86 |
| Distance-only (logistic) | 0.140 [0.05, 0.23] (p ≥ 0.05) | 0.176 [0.11, 0.23] (p ≥ 0.06) | 0.174 [0.12, 0.23] (p ≥ 0.06) | 0.000 / 0.000 / 0.000 | 0.54 / 0.84 |
| Persistence | 0.179 [0.06, 0.32] (p ≥ 0.01) | 0.232 [0.12, 0.34] (p ≥ 0.02) | 0.200 [0.14, 0.27] (p ≥ 0.02) | 0.000 / 0.000 / 0.000 | 0.83 / 0.81 |
| Cellular automaton | 0.176 [0.00, 0.29] (p ≥ 0.81) | 0.192 [0.02, 0.26] (p ≥ 0.51) | – | 0.154 / 0.204 / – | 0.66 / 0.81 |

At p ≥ 0.5 the GBM marks almost nothing: a calibrated forecast of a 2 % event rarely reaches 0.5, so CSI at 0.5 is the wrong yardstick for it. The validation-chosen thresholds (0.05–0.10) are its operating points. The CA's are 0.81 and 0.51, near its usual 0.5.

### Out-of-time, by island

**Out-of-time: Oct 2026 (VIIRS S-NPP) by island** (BSS, lead 1 / 2 / 3)

| Model | Kalimantan | Sumatra |
|---|---|---|
| GBM (raw) | +0.05 / -0.02 / +0.00 | +0.10 / +0.08 / -0.03 |
| GBM + isotonic | +0.05 / -0.00 / -0.01 | +0.10 / +0.07 / +0.01 |
| Climatology (train rate) | +0.00 / +0.00 / +0.00 | +0.00 / +0.00 / +0.00 |
| Distance-only (logistic) | +0.03 / +0.02 / +0.02 | +0.02 / +0.03 / +0.01 |
| Persistence | +0.03 / +0.02 / +0.01 | +0.04 / +0.04 / +0.02 |
| Cellular automaton | -8.32 / +0.02 / – | -7.78 / -5.93 / – |

**Out-of-time: Oct 2026 (all three VIIRS, as the app) by island** (BSS, lead 1 / 2 / 3)

| Model | Kalimantan | Sumatra |
|---|---|---|
| GBM (raw) | +0.05 / +0.07 / +0.05 | +0.09 / +0.01 / +0.08 |
| GBM + isotonic | +0.06 / +0.07 / +0.03 | +0.08 / +0.02 / +0.05 |
| Climatology (train rate) | +0.00 / +0.00 / +0.00 | +0.00 / +0.00 / +0.00 |
| Distance-only (logistic) | +0.04 / +0.03 / +0.02 | +0.02 / +0.04 / +0.04 |
| Persistence | +0.04 / +0.03 / +0.02 | +0.03 / +0.05 / +0.03 |
| Cellular automaton | -0.89 / +0.30 / – | -3.96 / -2.27 / – |

### The same boxes as the CA, out-of-time (lead 1)

**Out-of-time: Oct 2026 (VIIRS S-NPP), lead 1, only the 7 boxes the CA ran on** (588 blocks)

| Model | BSS [95% CI] | AUC | CSI (validation threshold) | CSI at 0.5 |
|---|---|---|---|---|
| GBM (raw) | -0.001 [-1.026, +0.091] | 0.797 | 0.101 | 0.000 |
| GBM + isotonic | +0.040 [-0.679, +0.105] | 0.794 | 0.099 | 0.000 |
| Climatology (train rate) | +0.000 [+0.000, +0.000] | 0.500 | 0.037 | 0.000 |
| Distance-only (logistic) | +0.006 [-0.339, +0.025] | 0.603 | 0.047 | 0.000 |
| Persistence | +0.020 [-0.273, +0.040] | 0.664 | 0.056 | 0.000 |
| Cellular automaton | -7.905 [-96.646, -4.371] | 0.767 | 0.091 | 0.068 |

### Reliability

**Reliability of GBM + isotonic, Test: 2023 Sumatra**: forecast deciles (mean forecast / observed frequency); equal-width bins (10, with counts) are in validation-scale.json

| Decile | Lead 1 | Lead 2 | Lead 3 |
|---|---|---|---|
| 1 | 0.002 / 0.002 | 0.001 / 0.001 | 0.001 / 0.004 |
| 2 | 0.003 / 0.005 | 0.003 / 0.004 | 0.003 / 0.005 |
| 3 | 0.004 / 0.006 | 0.008 / 0.004 | 0.004 / 0.009 |
| 4 | 0.005 / 0.007 | 0.011 / 0.008 | 0.009 / 0.009 |
| 5 | 0.005 / 0.007 | 0.011 / 0.010 | 0.011 / 0.016 |
| 6 | 0.010 / 0.013 | 0.011 / 0.013 | 0.015 / 0.016 |
| 7 | 0.016 / 0.015 | 0.015 / 0.015 | 0.018 / 0.024 |
| 8 | 0.024 / 0.024 | 0.025 / 0.027 | 0.026 / 0.027 |
| 9 | 0.040 / 0.047 | 0.041 / 0.044 | 0.042 / 0.045 |
| 10 | 0.087 / 0.091 | 0.075 / 0.088 | 0.064 / 0.083 |

On the test season the calibrated forecasts track the observed frequencies, with a slight under-forecast in the top decile at leads 2–3. On the 2026 events the observed frequency is about twice the forecast across the deciles (`validation-scale.json`, `oot`), because October 2026 had a much higher new-fire rate than 2015–2023.

### What drives it (validation, permutation importance, increase in log loss × 10⁴)

| Rank | Lead 1 | Lead 2 | Lead 3 |
|---|---|---|---|
| 1 | d_active_km (88.5) | d_active_km (50.3) | d_active_km (38.4) |
| 2 | d_fire_km (24.0) | f_shrub (19.9) | f_shrub (17.6) |
| 3 | f_shrub (12.6) | fire_duration_h (13.4) | dc (7.8) |
| 4 | fire_duration_h (8.6) | wind_kmh (11.6) | elev_mean (7.2) |
| 5 | d_older_km (7.9) | n_active_1km (6.7) | frp_active_3km (6.8) |
| 6 | wind_kmh (5.6) | d_fire_km (5.3) | n_active_1km (6.4) |
| 7 | isi (4.2) | frp_active_3km (5.3) | peat_frac_nbr (5.8) |
| 8 | dc (3.8) | rh (5.2) | fwi (4.0) |
| 9 | temp_c (3.1) | d_older_km (5.0) | dmc (3.8) |
| 10 | elev_mean (3.1) | nonburn_nbr (4.5) | growth_ratio (3.7) |
| 11 | n_active_1km (2.9) | bui (4.1) | rain24 (3.7) |
| 12 | rh (2.5) | elev_mean (3.9) | spread_align (3.3) |

Distance to the active fire dominates every lead. Degraded peat shrub (`f_shrub`), the fire's duration and recent FRP follow. The weather and drought codes matter more as the lead grows: wind speed at lead 2, and the Drought Code third at lead 3. `wind_kmh` here is the daily 05 UTC ERA5 value from the FWI file, not a direction.

### The register, post hoc (NOT pre-registered)

`scripts/ml/register-posthoc.ts` runs the GBM afterwards on the inputs sealed in the six register records of 20 Oct 2026 (the sealed scenario and its detections), with the issue day's FWI (DC 735–873). It scores them with each record's own fire mask and window detections. This is context only: the GBM did not exist when those forecasts were sealed.

**Register, POST HOC** (6 sealed boxes of 20 Oct 2026, lead 1)

| Model | CSI at 0.5 | Hits / misses / false alarms | BSS (own base rate, pooled as the register) |
|---|---|---|---|
| Cellular automaton (sealed) | 0.129 | 61 / 29 / 383 | -3.20 |
| Distance reference | 0.182 | 65 / 25 / 267 | -1.47 |
| Climatology reference | 0.000 | 0 / 90 / 0 | -0.09 |
| GBM raw (post hoc) | 0.000 | 0 / 90 / 0 | -0.08 |
| GBM + isotonic (post hoc) | 0.000 | 0 / 90 / 0 | -0.05 |
| GBM + isotonic at its validation threshold p ≥ 0.08 (post hoc) | 0.128 | 35 / 55 / 184 | – |

The calibrated GBM has the best Brier score of the four (own-base-rate BSS −0.05 against −3.20 for the CA and −1.47 for distance). At its validation threshold its CSI (0.128) equals the CA's (0.129) and is below distance (0.182). The sealed inputs carry all three VIIRS satellites, on which the model was not trained.

## What this says

1. **A modest, real gain over distance and persistence on unseen data.**
   - On held-out 2023 Sumatra, the calibrated GBM's Brier skill is about 1.6× distance-only at lead 1 and 2× at lead 3, and its intervals exclude both baselines' point values.
   - The CA's probabilities are far worse than climatology (BSS −8.5 and −13.4).
   - The CA ranks blocks about as well as distance (AUC 0.76) but marks far too many blocks with high probability. The direction-averaged runs spread fire every way, which makes this worse than with known wind.
2. **The absolute skill is small.** About 2 % of candidate blocks get new S-NPP fire per day. The best CSI is 0.08–0.09 at lead 1, against 0.06 for distance. A forecaster cannot say which few blocks will light; it can rank them and give calibrated odds.
3. **Leads 2 and 3 hold up on 2023, not on 2026.** On 2026 the GBM's lead-3 skill is zero (−0.003, CI −0.032 to +0.017). With 12 boxes from 4 island-weeks, the out-of-time intervals are wide.
4. **The CA stays the tool for "what if we act", not for "where will it burn".**

## Caveats

- **Satellite misses.** FIRMS misses smouldering peat and fire under cloud and smoke. A block with no detection may still be burning, so labels undercount fire.
- **Fires were fought.** Suppression is in the outcomes, not in the model.
- **Labels are detections, not burned area.** A 375 m pixel can light up a 400 m block from a fire next to it.
- **One satellite in training, three in the app.** The model learned from VIIRS S-NPP alone (the only satellite with yearly archives from 2015). The app reads S-NPP, NOAA-20 and NOAA-21, which roughly triples the detections, and the count features shift with it. `oot_allviirs` and the register post hoc show the effect. A model retrained on NOAA-20/21 data (2018 onwards, from the area API) is the fix.
- **2026 comes from near-real-time data.** The out-of-time inputs are near-real-time S-NPP, not standard processing, and 2026 had about three times the training seasons' new-fire rate. Calibration does not transfer.
- **Canals and land cover are snapshots.** The canal and road snapshot is OSM of 2026 and land cover is WorldCover 2021, both applied to 2015–2023. Canals dug after a fire count as present before it.
- **Coarse weather.** FWI comes from 0.5° ERA5 points up to 39 km away, at one time of day. Wind direction is unavailable historically (see `wind_align`), and the CA baseline ran direction-averaged for the same reason.
- **Correlated boxes.** Boxes of consecutive days often cover the same fire. The island-week bootstrap is the more honest interval, and it is similar for 2023.
- **Tuning on validation.** The validation numbers of GBM + isotonic are in-sample for the calibration, threshold and grid. The test and out-of-time numbers are not.

## Reproduce

```
npx tsx scripts/ml/extract.ts            # ~8 min with cached tiles; resumable; .cache/ml/boxes.jsonl
npx tsx scripts/ml/assemble.ts           # FWI join -> .cache/ml/rows_<split>.csv, manifest.json
npx tsx scripts/ml/ca.ts --shard 0/4     # (x4 in parallel) CA baseline -> .cache/ml/ca-*.jsonl
cd ml/gbm && uv run python train.py      # ~25 min; gbm-v1.json, src/sim/gbm.fixture.json
uv run python evaluate.py                # validation only
npx tsx scripts/ml/register-posthoc.ts   # post hoc register scores
uv run python evaluate.py --final        # + test and out-of-time; logged, once per model
uv run python report.py                  # the tables of this file
```

## Files

- `src/sim/features.ts`: features (+ `features.test.ts`).
- `src/sim/gbm.ts`: inference, `gbmForecast`, `gbmForecastAll`, `gbmBoxForecast` (forecast-v1, model id `fire-septum-gbm`), plus `gbm.test.ts` and `gbm.fixture.json`.
- `public/data/forecaster/gbm-v1.json`: the model.
- `scripts/lib/firms-archive.ts`, `scripts/ml/{common,extract,assemble,ca,register-posthoc}.ts`.
- `ml/gbm/{common,train,evaluate,report}.py`: uv project, Python 3.12.
- `docs/validation-scale.json`, `docs/img/forecaster-reliability-*.png`.
