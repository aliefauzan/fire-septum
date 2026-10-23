# Hindcast: SekatApi against NASA FIRMS, 8–19 October 2026

Run on 20 October 2026 with the code in this repository (`src/data/hindcast.ts`, `src/sim/hindcast.ts`). In the app it is under *Live fires → Test on a past day*.

## Question

If SekatApi had been run at the last satellite pass of day D, using only the data available then, how well would its 24 h forecast of **new** fire have matched what VIIRS detected next?

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
- **Reference forecast.** A *distance-only* forecast marks the same number of squares, chosen as the ones nearest the fire. If SekatApi scores higher, wind, slope and fuel added information beyond "fire grows outward".

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
- **The fuel map is synthetic** in every event (Overpass timed out). A real peat and land-cover map (GFW, KLHK, ESA WorldCover) is the most likely next improvement.
- **The sample is small and partly repeated.** 12 events and 114 new squares; some fires appear on several days.

## Reproduce

Open the app, then *Live fires → Test on a past day*. Enter a location from the table and the day D. The score card shows the same numbers for the default parameters. The batch above was run in the browser console of the dev server by looping `buildHindcast`, then `runEnsemble`, then `scoreHindcast` over the 12 events, and again with `tauH` set to 6, 12, 24, 48 and 96 h.
