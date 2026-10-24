# Hindcast: Fire Septum against NASA FIRMS, 8–19 October 2026

Run on 20 October 2026 with the code in this repository (`src/data/hindcast.ts`, `src/sim/hindcast.ts`). In the app it is under *Live fires → Test on a past day*.

## Question

If Fire Septum had been run at the last satellite pass of day D, using only the data available then, how well would its 24 h forecast of **new** fire have matched what VIIRS detected next?

## Method

- **Events.** The rule was fixed before any score was seen. For each of 6 days (8, 10, 12, 14, 16 and 18 Oct) and each island (Kalimantan, Sumatra), take the 6.4 km box with the most VIIRS detections on day D that also has at least one detection on D+1. That gives 12 events. Some are the same fire on different days: Kalimantan 14/16/18 Oct is one fire, and so are Sumatra 10/12 and 14/16/18 Oct.
- **Inputs at t0**, where t0 is the latest detection in the box on day D (UTC):
  - VIIRS S-NPP, NOAA-20 and NOAA-21 detections up to t0. The last 24 h are placed as burning; anything older is placed as burned.
  - Open-Meteo *historical forecast* weather from t0, plus the 72 h of rain before t0.
  - AWS terrain.
  - The synthetic peat/shrub fuel map. Overpass timed out, so there is no OpenStreetMap land use.
- **Model.** Parameters at the time: 40 runs, τ = 3 h, no suppression. τ = 6 h became the default on 21 Oct; see the rerun section. The forecast is the share of runs in which each cell ignites within 24 h.
- **Observations.** All VIIRS detections in (t0, t0 + 24 h].
- **Scoring.**
  - The grid is compared in 400 m squares, about one VIIRS pixel.
  - Squares already burning or burned at t0 are excluded, because only new fire counts.
  - Squares more than 3 km from the fire at t0 are excluded too, since no spread model can predict a fresh ignition there. No event had any such ignition.
  - A square is forecast if it ignites in at least half the runs.
  - Metrics: POD (share of observed squares caught), FAR (share of forecast squares not observed), CSI = hits / (hits + misses + false alarms), and the Brier skill of the probabilities against the observed base rate.
- **Reference forecast.** A *distance-only* forecast marks the same number of squares, chosen as the ones nearest the fire. If Fire Septum scores higher, wind, slope and fuel added information beyond "fire grows outward".

## Results with the default model (τ = 3 h)

| Island | D | t0 (UTC) | Detections ≤ t0 | Next 24 h | Squares scored | New squares observed | Forecast | Hits | CSI | Distance-only CSI |
|---|---|---|---|---|---|---|---|---|---|---|
| Kalimantan | 08 Oct | 18:53 | 707 | 128 | 107 | 2 | 91 | 2 | 0.02 | 0.02 |
| Kalimantan | 10 Oct | 18:36 | 365 | 314 | 104 | 57 | 84 | 57 | 0.68 | 0.68 |
| Kalimantan | 12 Oct | 17:02 | 601 | 20 | 59 | 8 | 41 | 8 | 0.20 | 0.20 |
| Kalimantan | 14 Oct | 19:00 | 852 | 305 | 58 | 2 | 53 | 2 | 0.04 | 0.04 |
| Kalimantan | 16 Oct | 18:21 | 1,045 | 354 | 54 | 3 | 42 | 3 | 0.07 | 0.07 |
| Kalimantan | 18 Oct | 19:06 | 1,085 | 214 | 54 | 18 | 37 | 16 | 0.41 | 0.25 |
| Sumatra | 08 Oct | 19:13 | 1,313 | 88 | 47 | 0 | 27 | 0 | – | – |
| Sumatra | 10 Oct | 18:36 | 1,460 | 407 | 45 | 0 | 40 | 0 | – | – |
| Sumatra | 12 Oct | 06:57 | 1,321 | 90 | 70 | 2 | 54 | 2 | 0.04 | 0.04 |
| Sumatra | 14 Oct | 19:02 | 556 | 418 | 102 | 20 | 102 | 20 | 0.20 | 0.20 |
| Sumatra | 16 Oct | 19:08 | 1,081 | 81 | 49 | 0 | 41 | 0 | – | – |
| Sumatra | 18 Oct | 19:06 | 509 | 99 | 87 | 2 | 51 | 2 | 0.04 | 0.04 |

Event locations, in the same order:
- Kalimantan: −2.5235, 113.0298 · −3.1011, 112.1923 · −3.3284, 112.1442 · −2.8114, 110.6903 · −2.8132, 110.6886 · −2.8179, 110.6934
- Sumatra: −1.8698, 103.9044 · −3.5741, 105.7519 · −3.5711, 105.7507 · −3.3890, 105.2462 · −3.3833, 105.2407 · −3.3930, 105.2368

**Pooled over all 12 events:**
- 114 new squares were observed. The model forecast 663 and caught 112: POD 0.98, FAR 0.83, **CSI 0.17**. The distance-only forecast scored CSI 0.16.
- Brier skill was −4.0: the probabilities are worse than simply forecasting the observed base rate everywhere.

### What this says

1. **The default model spreads fire far too fast.** It forecast about 6× more new fire than satellites saw.
2. **Most detections on D+1 fell where fire already was.** For example, 128 detections but only 2 new squares on Kalimantan, 8 Oct. These peat fires mostly persisted and crept rather than ran.
3. **At τ = 3 h the model is no better than distance alone.** It marks almost every square within reach, so its direction does not matter.

## Sensitivity to τ (spread time scale), calibrated on Kalimantan and tested on Sumatra

τ is the only free spread parameter (`p_step = 1 − exp(−p·dt/τ)`). Larger τ means slower spread.

| τ (h) | Forecast squares (all) | POD | FAR | CSI, all | Distance CSI, all | **CSI, Kalimantan** | **CSI, Sumatra (held out)** | Distance CSI, Sumatra | Brier skill |
|---|---|---|---|---|---|---|---|---|---|
| 3 (default) | 663 | 0.98 | 0.83 | 0.168 | 0.160 | 0.251 | 0.076 | 0.076 | −4.04 |
| **6** | 390 | 0.79 | 0.77 | **0.217** | 0.175 | **0.315** | **0.114** | 0.093 | −1.63 |
| 12 | 147 | 0.29 | 0.78 | 0.145 | 0.130 | 0.200 | 0.078 | 0.099 | −0.50 |
| 24 | 52 | 0.12 | 0.73 | 0.092 | 0.064 | 0.109 | 0.059 | 0.019 | −0.15 |
| 48 | 12 | 0.04 | 0.67 | 0.033 | 0.008 | 0.022 | 0.065 | 0.000 | −0.10 |
| 96 | 0 | 0 | – | 0 | 0.008 | 0 | 0 | 0 | −0.11 |

- **Choosing τ on Kalimantan alone picks τ = 6 h.** On the Sumatra events, which were not used for the choice, τ = 6 h:
  - raises CSI from 0.076 to 0.114;
  - beats the distance-only forecast of the same size (0.093).

  This is the first evidence that the wind/slope/fuel terms add information once the overall speed is right.
- **The probabilities are still not calibrated.** Brier skill is negative at every τ. Use the forecast as "where new fire is most likely", not as a calibrated percentage.
- **The default is unchanged** (τ = 3 h). Changing it alters every number the app shows. With 12 events, several of them repeats of the same fire, the evidence is suggestive, not conclusive.

## Rerun and new default (21 October 2026)

All 12 events were rebuilt from scratch on 21 Oct 2026, with data fetched again from FIRMS and Open-Meteo, and scored at τ = 3 h and τ = 6 h. The pooled counts are identical to the tables above: 663 forecast and 112 caught at τ = 3 h, 390 and 90 at τ = 6 h. The raw rows are in `docs/hindcast-rerun-2026-10-21.json`.

**τ = 6 h is now the app default.** Per event at τ = 6 h:

| Island | D | Forecast | Hits | CSI | Distance-only CSI |
|---|---|---|---|---|---|
| Kalimantan | 08 Oct | 56 | 2 of 2 | 0.04 | 0.04 |
| Kalimantan | 10 Oct | 49 | 44 of 57 | 0.71 | 0.63 |
| Kalimantan | 12 Oct | 15 | 7 of 8 | 0.44 | 0.35 |
| Kalimantan | 14 Oct | 29 | 0 of 2 | 0.00 | 0.00 |
| Kalimantan | 16 Oct | 18 | 2 of 3 | 0.11 | 0.05 |
| Kalimantan | 18 Oct | 23 | 12 of 18 | 0.41 | 0.17 |
| Sumatra | 08 Oct | 12 | 0 of 0 | – | – |
| Sumatra | 10 Oct | 12 | 0 of 0 | – | – |
| Sumatra | 12 Oct | 32 | 2 of 2 | 0.06 | 0.03 |
| Sumatra | 14 Oct | 75 | 19 of 20 | 0.25 | 0.22 |
| Sumatra | 16 Oct | 32 | 0 of 0 | – | – |
| Sumatra | 18 Oct | 37 | 2 of 2 | 0.05 | 0.03 |

- At τ = 6 h the model beats distance-only on 7 of the 9 events with new fire, ties on 2 and loses on none. Both ties are events with only 2 new squares; on one of them (Kalimantan 14 Oct) both forecasts catch nothing.
- The margins are small. Most events have fewer than 10 new squares, so one or two squares decide them.
- The recorded fire that opens the app is Kalimantan 18 Oct, the most recent Kalimantan event. Its margin over distance-only (0.41 vs 0.17) is the largest in the set, so it flatters the model. The pooled numbers are the fair summary.

The honest next test is prospective, not another hindcast: see the forecast register in the README.

## Caveats

- **Satellites miss fire.** VIIRS passes about twice a day per satellite and misses fire under thick smoke and cloud, as well as low-temperature smouldering peat. Some "false alarms" may be real fire that was not detected.
- **Real fires were fought.** The forecast assumes no suppression; the observations include whatever firefighting happened.
- **The fuel map was synthetic** in the 20–21 Oct runs (Overpass timed out). The first 24 Oct re-run below uses the real peat and land-cover map but no OpenStreetMap features. The later 24 Oct re-run adds rivers, canals and roads from a dated OSM snapshot.
- **The sample is small and partly repeated.** 12 events and 114 new squares; some fires appear on several days.

## Re-run with the real peat and land-cover map (24 October 2026)

On 24 Oct the live scenario builder gained a real peat mask (Global Forest Watch global peatlands, Gumbricht et al. 2017 in the tropics) and real land cover (ESA WorldCover 2021); see the README's *Live data* section. All 12 events were rebuilt from scratch with those layers and scored at τ = 3 h and τ = 6 h (`docs/hindcast-rerun-2026-10-24.json`, made with `src/data/hindcastBatch.ts`). Detections, t0 and observed squares are identical to the earlier runs; only the fuel map changed. Overpass was unavailable again, so no event has OpenStreetMap features.

| Island | D | Peat cells | Next 24 h | New squares | τ=3 forecast | τ=3 hits | τ=3 CSI | Distance | τ=6 forecast | τ=6 hits | τ=6 CSI | Distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Kalimantan | 08 Oct | 88% | 128 | 2 | 86 | 2 | 0.02 | 0.02 | 53 | 2 | 0.04 | 0.04 |
| Kalimantan | 10 Oct | 70% | 314 | 57 | 82 | 56 | 0.67 | 0.70 | 42 | 38 | 0.62 | 0.55 |
| Kalimantan | 12 Oct | 95% | 20 | 8 | 42 | 8 | 0.19 | 0.19 | 14 | 7 | 0.47 | 0.38 |
| Kalimantan | 14 Oct | 56% | 305 | 2 | 31 | 2 | 0.06 | 0.00 | 7 | 0 | 0.00 | 0.00 |
| Kalimantan | 16 Oct | 58% | 354 | 3 | 29 | 3 | 0.10 | 0.10 | 10 | 1 | 0.08 | 0.00 |
| Kalimantan | 18 Oct | 57% | 214 | 18 | 29 | 16 | 0.52 | 0.27 | 14 | 12 | 0.60 | 0.07 |
| Sumatra | 08 Oct | 98% | 88 | 0 | 27 | 0 | – | – | 10 | 0 | – | – |
| Sumatra | 10 Oct | 42% | 407 | 0 | 9 | 0 | – | – | 3 | 0 | – | – |
| Sumatra | 12 Oct | 43% | 90 | 2 | 29 | 2 | 0.07 | 0.03 | 16 | 0 | 0.00 | 0.06 |
| Sumatra | 14 Oct | 98% | 418 | 20 | 102 | 20 | 0.20 | 0.20 | 83 | 20 | 0.24 | 0.21 |
| Sumatra | 16 Oct | 99% | 81 | 0 | 41 | 0 | – | – | 35 | 0 | – | – |
| Sumatra | 18 Oct | 100% | 99 | 2 | 50 | 2 | 0.04 | 0.04 | 39 | 2 | 0.05 | 0.05 |

**Pooled over all 12 events** (synthetic-map values of 21 Oct in brackets):

| τ (h) | Forecast squares | Hits of 114 | POD | FAR | CSI, all (distance) | CSI, Kalimantan (distance) | CSI, Sumatra held out (distance) |
|---|---|---|---|---|---|---|---|
| 3 | 557 [663] | 111 [112] | 0.97 | 0.80 | 0.20 (0.18) [0.17 (0.16)] | 0.29 (0.26) [0.25 (0.23)] | 0.09 (0.09) [0.08 (0.08)] |
| **6** | 326 [390] | 82 [90] | 0.72 | 0.75 | **0.23** (0.18) [0.22 (0.18)] | **0.35** (0.24) [0.32 (0.25)] | **0.12** (0.11) [0.11 (0.09)] |

- **The real map makes the model more selective.** At τ = 6 h it forecasts 326 squares instead of 390 and keeps 82 of the 90 hits, so FAR falls from 0.77 to 0.75 and CSI rises from 0.22 to 0.23. The gain comes from the land cover: water, built-up and wet farmland cells now stop or slow the spread where the synthetic map had peat shrub everywhere.
- **Per event at τ = 6 h** the model beats distance-only on 5 of the 9 events with new fire (Kalimantan 10, 12, 16 and 18 Oct, Sumatra 14 Oct), ties on 3 (Kalimantan 8 and 14 Oct, Sumatra 18 Oct) and loses on 1 (Sumatra 12 Oct, 0 vs 2 squares caught). Before, it was 7 wins, 2 ties, no losses; the Sumatra 12 Oct loss is 2 squares.
- **Held-out Sumatra is now a near tie.** The distance-only reference improved as much as the model (0.09 → 0.11 against 0.11 → 0.12), because fewer forecast squares also shrink the reference. The earlier claim that wind, slope and fuel add information on Sumatra rests on about one square either way.
- **τ = 6 h is still the better default** on every subset, so the choice made on 21 Oct stands.
- The recorded fire that opens the app (Kalimantan 18 Oct) was re-recorded with the real map on 24 Oct; its score card now reads CSI 0.60 vs 0.07 for distance alone. It remains the most flattering event in the set.

## Re-run with rivers, canals and drained peat (24 October 2026, later)

The live builder now takes rivers, canals, ditches and roads from a dated OpenStreetMap snapshot (Geofabrik extracts of 23 Oct 2026, `public/data/osm-barriers/`) instead of the per-box Overpass query that had timed out in every earlier run. Canals, rivers, major roads, water and built-up areas are non-burnable cells. Ditches, drains and streams (fuel-break strength 0.5) and minor roads and tracks (0.3) are partial fuel breaks. Peat-soil cells near a canal, ditch or drain spread faster by 1 + 0.5·exp(−d / 100 m) (rates `brkNarrowWater`, `brkTrack`, `drainK`, `drainLM` in `src/sim/doctrine.ts`). The barrier strengths and k are assumptions. L = 100 m is a fit to Ritzema et al. 2014. None of them were tuned on these events.

All 12 events were rebuilt in Node (`npx tsx scripts/hindcast-batch.ts`, using `scripts/lib/node-env.ts`) at τ = 6 h, three ways. The rows are in `docs/hindcast-rerun-2026-10-24-barriers.json`, with a `variant` key on each. Variant *none* reproduces the earlier 24 Oct re-run exactly: 326 forecast squares, 82 hits. The Node pipeline also rebuilt the browser-recorded 18 Oct event bit for bit.

| Variant (τ = 6 h) | Forecast | Hits of 114 | POD | FAR | CSI, all (distance) | CSI, Kalimantan (distance) | CSI, Sumatra (distance) | Brier skill* |
|---|---|---|---|---|---|---|---|---|
| none (as earlier on 24 Oct) | 326 | 82 | 0.72 | 0.75 | 0.229 (0.176) | 0.353 (0.243) | 0.117 (0.111) | −1.66 |
| + barriers | 321 | 81 | 0.71 | 0.75 | 0.229 (0.179) | 0.351 (0.247) | 0.118 (0.112) | −1.62 |
| + barriers + drained peat | 328 | 82 | 0.72 | 0.75 | 0.228 (0.176) | 0.351 (0.242) | 0.116 (0.111) | −1.62 |

\* Pooled over the 9 events with new fire: 1 − Σ n·BS / Σ n·BS_ref, with n the candidate squares and BS_ref each event's own base-rate reference.

Per event (forecast / hits / CSI; distance-only CSI in brackets), with the snapshot's features in the box:

| Island | D | New squares | none | + barriers | + barriers + drainage | OSM features | Non-burnable / partial-break cells |
|---|---|---|---|---|---|---|---|
| Kalimantan | 08 Oct | 2 | 53 / 2 / 0.04 (0.04) | 52 / 2 / 0.04 (0.04) | 53 / 2 / 0.04 (0.04) | 23 | 0% / 4% |
| Kalimantan | 10 Oct | 57 | 42 / 38 / 0.62 (0.55) | 41 / 37 / 0.61 (0.56) | 42 / 38 / 0.62 (0.55) | 1 | 0% / 1% |
| Kalimantan | 12 Oct | 8 | 14 / 7 / 0.47 (0.38) | 14 / 7 / 0.47 (0.38) | 14 / 7 / 0.47 (0.38) | 0 | – |
| Kalimantan | 14 Oct | 2 | 7 / 0 / 0.00 | 7 / 0 / 0.00 | 8 / 0 / 0.00 | 51 | 0.5% / 7% |
| Kalimantan | 16 Oct | 3 | 10 / 1 / 0.08 (0.00) | 9 / 1 / 0.09 (0.00) | 9 / 1 / 0.09 (0.00) | 50 | 1% / 7% |
| Kalimantan | 18 Oct | 18 | 14 / 12 / 0.60 (0.07) | 14 / 12 / 0.60 (0.07) | 15 / 12 / 0.57 (0.06) | 20 | 0% / 5% |
| Sumatra | 08 Oct | 0 | 10 / 0 / – | 9 / 0 / – | 12 / 0 / – | 129 | 1% / 23% |
| Sumatra | 10 Oct | 0 | 3 / 0 / – | 3 / 0 / – | 3 / 0 / – | 1 | 1% / 0% |
| Sumatra | 12 Oct | 2 | 16 / 0 / 0.00 (0.06) | 16 / 0 / 0.00 (0.06) | 16 / 0 / 0.00 (0.06) | 2 | 1% / 0% |
| Sumatra | 14 Oct | 20 | 83 / 20 / 0.24 (0.21) | 82 / 20 / 0.24 (0.21) | 82 / 20 / 0.24 (0.21) | 5 | 0.5% / 0.5% |
| Sumatra | 16 Oct | 0 | 35 / 0 / – | 35 / 0 / – | 35 / 0 / – | 3 | 0.4% / 0.5% |
| Sumatra | 18 Oct | 2 | 39 / 2 / 0.05 (0.05) | 39 / 2 / 0.05 (0.05) | 39 / 2 / 0.05 (0.05) | 1 | 0% / < 0.1% |

- **Barriers barely change these scores.** Most of the 12 boxes have few mapped barriers: one has none, five have three or fewer features, and the busiest has 129 (Sumatra 8 Oct, no new fire). The changes are one square either way, well inside the noise of 114 observed squares.
- **The drained-peat term adds a few forecast squares and no hits** (+7 squares against barriers alone). These events give no evidence for or against it; it stays on by default because the drawdown is measured, not because it scored better.
- **No default was changed** because of these runs. τ = 6 h, the barrier strengths and k, L are as stated above.
- The recorded fire that opens the app (Kalimantan 18 Oct) was re-recorded with barriers and drainage. Its score card now reads CSI 0.57 against 0.06 for distance alone.
- OpenStreetMap is uneven in rural Kalimantan and Sumatra. Unmapped ditches count as no barrier, so the effect of barriers here is a lower bound. The snapshot is from 23 Oct, after the events; canals and roads rarely change within two weeks.

## Reproduce

Open the app, then *Live fires → Test on a past day*. Enter a location from the table and the day D. The score card shows the same numbers for the default parameters. The 20–21 Oct batches were run in the browser console of the dev server by looping `buildHindcast`, then `runEnsemble`, then `scoreHindcast` over the 12 events, and again with `tauH` set to 6, 12, 24, 48 and 96 h. The 24 Oct batch is the same loop packaged as `src/data/hindcastBatch.ts`; run it from the dev server's console:

```js
const b = await import('/src/data/hindcastBatch.ts');
const r = await b.runHindcastBatch(b.VALIDATION_EVENTS, [3, 6], console.log);
copy(JSON.stringify(r));
```

Since the later 24 Oct run the same batch also runs in Node, with data cached under `.cache/` (FIRMS_MAP_KEY from the environment or `.env`):

```sh
npx tsx scripts/hindcast-batch.ts                        # 3 variants at τ = 6 h → docs/hindcast-rerun-2026-10-24-barriers.json
npx tsx scripts/hindcast-batch.ts --taus 3,6 --variants barriers+drainage --out /tmp/rerun.json
npx tsx scripts/record-event.ts                          # re-record src/data/events/kalimantan-2026-10-18.json
```
