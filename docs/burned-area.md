# Measured burned area after the 12 validation fires

Run on 24 October 2026 with `ml/rs/burned_area.py` (Sentinel-2 and Sentinel-1) and `ml/rs/forecast_events.ts` (the app's own forecast for the recorded event). Per-event results: `data/validation/burned-area/<event-id>.json` and `<event-id>.png`; all events: `data/validation/burned-area/summary.json`. Tables below are printed by `ml/rs/make_tables.py` from those files.

## Question

The hindcasts in [hindcast.md](hindcast.md) score Fire Septum against VIIRS hotspots: points about 375 m across, seen twice a day per satellite and only while the fire is hot enough. What actually burned? This note maps the burned ground after each of the 12 validation fires from satellite images. It compares that with the FIRMS detections, and, for the recorded fire, with the model's forecast.

## Method

**Grid.** The app's grid: 64 × 64 cells of 100 m over the `bboxAround` box (6.4 km) around each event's location, with cell (0, 0) at the north-west corner.

**Sentinel-2 (optical), where it can see the ground.** Sentinel-2 L2A from the Microsoft Planetary Computer (keyless; assets signed with the `planetary_computer` package).
- NBR = (B08 − B12) / (B08 + B12), on surface reflectance with the processing-baseline offset applied, at 20 m.
- A pixel is used only if the scene classification (SCL) is dark area, vegetation, bare or water (2, 4, 5, 6) and blue reflectance (B02) is below 0.10. Class 2 is kept because fresh burn scars are often labelled "dark area". The blue test removes smoke that SCL calls vegetation or bare soil.
- Pre-fire: per-pixel median NBR over all clear looks from D − 32 to D − 2 days.
- Post-fire: per-pixel median NBR over all clear looks from D + 1 to 24 October.
- A 20 m pixel is burned if dNBR = NBR_pre − NBR_post > 0.27 **and** post-fire NBR < 0.10.
  - 0.27 is the lower bound of "moderate-low severity" in Key & Benson (2006). It is conservative; 0.10–0.27 is "low severity".
  - The post-NBR ceiling is our own guard against haze and seasonal change: dense tropical vegetation has NBR around 0.4–0.7. It is not taken from a paper.
- A 100 m cell is clear when at least 13 of its 25 pixels have both a pre and a post look. It is burned when at least half of those pixels are burned.

**Sentinel-1 (radar), where clouds and smoke block the optical view.** Sentinel-1 RTC (radiometrically terrain-corrected γ⁰, VH and VV), also from the Planetary Computer.
- Backscatter is averaged in linear power to 100 m (about 100 looks, so speckle is about 0.5 dB).
- For each relative orbit with both a pre (D − 32 to D − 2) and a post (D + 1 to 24 Oct) acquisition: ΔVH = 10 log₁₀(mean post / mean pre). If several orbits qualify, their ΔVH values are averaged.
- A cell is burned if ΔVH ≤ −3 dB. Cells whose pre-fire VH is below −24 dB are treated as open water and not scored.
- Burned tropical vegetation shows a drop in cross-polarised backscatter (VH). Lohberger et al. (2018) mapped Indonesia's 2015 fire area this way with Sentinel-1. Belenguer-Plomer et al. (2019) found VH the most sensitive channel for burned area. Neither paper gives one transferable dB threshold, so −3 dB was chosen in advance as a conservative value, and −2 and −4 dB are reported below.

**Combining.** Sentinel-2 decides where its cell is clear, otherwise Sentinel-1, otherwise the cell is unobserved. Each event file stores, as bit masks on the 64 × 64 grid: burned, observed, decided by S2, decided by S1, and the FIRMS footprint.

**FIRMS.** All VIIRS S-NPP, NOAA-20 and NOAA-21 near-real-time detections in the box from D − 2 to 24 October, from the FIRMS area API (key from `.env`, never printed). Each detection is drawn as a 375 m disc (radius 187.5 m) on the grid, the same footprint the app uses.

**Forecast (recorded event only).** `ml/rs/forecast_events.ts` decodes `src/data/events/kalimantan-2026-10-18.json` and runs `runEnsemble` with `DEFAULT_PARAMS` (40 runs, τ = 6 h, no suppression).
- 24 h: the scenario exactly as stored. It reproduces the app's score card against FIRMS: CSI 0.60 vs 0.067 for distance alone.
- 48 h: the stored scenario has only 25 hours of weather, so hours 25–48 were fetched again from the same Open-Meteo historical-forecast archive and appended. Hours 0–24 are unchanged; the script checks that its first 24 h give exactly the 24 h result.
- Output: per-cell and per-400 m-block probabilities of new fire (`data/validation/burned-area/forecast-kalimantan-2026-10-18.json`).

Scoring against measured burn uses the same block logic as `src/sim/hindcast.ts`:
- 400 m blocks; blocks on fire at t0 are left out, as are blocks more than 3 km from the fire;
- a block is forecast if it gets new fire in at least half the runs;
- a block is observed burned if at least 2 of its 16 cells are newly burned; a block is scored only if at least half of its cells were observed.

The other 11 events have no stored scenario, so they are compared with FIRMS only.

## Results

### Per event

| Event | S2 clear | S1 | Observed | Burned ha (S2 / S1) | FIRMS det. | FIRMS footprint ha (observed) | Overlap ha | Burned inside footprint | Footprint burned |
|---|---|---|---|---|---|---|---|---|---|
| kalimantan-2026-10-08 | 0% | 100% | 100% | 234 (0 / 234) | 1402 | 2,759 (2,759) | 233 | 100% | 8% |
| kalimantan-2026-10-10 | 16% | 100% | 100% | 1,180 (540 / 640) | 1108 | 3,839 (3,839) | 1,094 | 93% | 28% |
| kalimantan-2026-10-12 | 43% | 98% | 98% | 1,385 (1,374 / 11) | 879 | 3,415 (3,411) | 1,177 | 85% | 34% |
| kalimantan-2026-10-14 | 1% | 0% | 1% | 0 (0 / 0) | 3212 | 3,619 (27) | 0 | – | 0% |
| kalimantan-2026-10-16 | 1% | 0% | 1% | 0 (0 / 0) | 2839 | 3,585 (25) | 0 | – | 0% |
| kalimantan-2026-10-18 | 0% | 0% | 0% | 0 (0 / 0) | 2244 | 3,463 (0) | 0 | – | – |
| sumatra-2026-10-08 | 0% | 100% | 100% | 1,488 (0 / 1,488) | 1681 | 2,981 (2,981) | 1,433 | 96% | 48% |
| sumatra-2026-10-10 | 83% | 100% | 100% | 2,227 (1,912 / 315) | 3410 | 3,002 (3,002) | 2,140 | 96% | 71% |
| sumatra-2026-10-12 | 81% | 100% | 100% | 2,237 (1,902 / 335) | 2582 | 2,667 (2,667) | 2,026 | 91% | 76% |
| sumatra-2026-10-14 | 0% | 100% | 100% | 517 (0 / 517) | 1945 | 3,057 (3,057) | 449 | 87% | 15% |
| sumatra-2026-10-16 | 0% | 100% | 100% | 759 (0 / 759) | 1623 | 2,994 (2,994) | 618 | 81% | 21% |
| sumatra-2026-10-18 | 0% | 100% | 100% | 819 (0 / 819) | 1120 | 2,462 (2,462) | 736 | 90% | 30% |

"Burned inside footprint" is the share of measured burned hectares that lie within a FIRMS disc. "Footprint burned" is the share of the observed FIRMS footprint that was measured as burned. Sumatra 10 and 12 Oct are the same fire with nearly the same windows, so their maps are nearly identical; the same holds for Kalimantan 14, 16 and 18 Oct and for Sumatra 14, 16 and 18 Oct.

### Which looks were used

| Event | S2 pre dates (clear share) | S2 post dates (clear share) | S1 orbit: pre → post | S1 burned cells at −2 / −3 / −4 dB | S2 burned cells dNBR>0.10 / 0.27 / 0.44 (post NBR<0.10) |
|---|---|---|---|---|---|
| kalimantan-2026-10-08 | 09-11 (13%), 09-14 (8%) | none ≥5% | 3: 09-15,09-27 → 10-09,10-21 | 797 / 234 / 48 | 0 / 0 / 0 |
| kalimantan-2026-10-10 | 09-14 (32%), 09-19 (73%), 10-04 (19%) | 10-21 (17%) | 3: 09-15,09-27 → 10-21; 76: 09-08,09-20,10-02 → 10-14 | 1749 / 750 / 149 | 561 / 540 / 288 |
| kalimantan-2026-10-12 | 09-11 (35%), 09-14 (85%), 09-19 (34%), 09-24 (69%), 09-29 (50%), 10-04 (76%), 10-09 (8%) | 10-14 (24%), 10-21 (31%) | 3: 09-15,09-27,10-09 → 10-21; 76: 09-20,10-02 → 10-14 | 901 / 24 / 0 | 1481 / 1374 / 1146 |
| kalimantan-2026-10-14 | 09-12 (21%), 10-02 (37%) | none ≥5% | no post pass yet | – | 0 / 0 / 0 |
| kalimantan-2026-10-16 | 10-02 (38%) | none ≥5% | no post pass yet | – | 0 / 0 / 0 |
| kalimantan-2026-10-18 | 10-02 (35%) | none ≥5% | no post pass yet | – | 0 / 0 / 0 |
| sumatra-2026-10-08 | 09-06 (21%), 09-08 (99%), 09-21 (22%), 09-23 (27%) | none ≥5% | 18: 09-16 → 10-10,10-22; 171: 09-15,09-27 → 10-09,10-21 | 1830 / 1488 / 967 | 0 / 0 / 0 |
| sumatra-2026-10-10 | 09-08 (29%), 09-10 (30%), 09-18 (16%), 09-23 (51%), 09-30 (92%), 10-03 (8%), 10-08 (10%) | 10-20 (77%), 10-23 (22%) | 98: 09-10,09-22,10-04 → 10-16; 120: 09-11,09-23,10-05 → 10-17 | 1986 / 1367 / 725 | 1962 / 1912 / 1751 |
| sumatra-2026-10-12 | 09-10 (29%), 09-18 (16%), 09-23 (54%), 09-30 (92%), 10-03 (8%), 10-08 (12%) | 10-20 (76%), 10-23 (22%) | 98: 09-10,09-22,10-04 → 10-16; 120: 09-11,09-23,10-05 → 10-17 | 2037 / 1388 / 763 | 1958 / 1902 / 1753 |
| sumatra-2026-10-14 | none ≥5% | 10-23 (24%) | 98: 09-22,10-04 → 10-16; 120: 09-23,10-05 → 10-17; 171: 09-15,09-27,10-09 → 10-21 | 1210 / 517 / 130 | 0 / 0 / 0 |
| sumatra-2026-10-16 | none ≥5% | 10-23 (23%) | 120: 09-23,10-05 → 10-17; 171: 09-15,09-27,10-09 → 10-21 | 1613 / 759 / 197 | 0 / 0 / 0 |
| sumatra-2026-10-18 | none ≥5% | 10-23 (25%) | 171: 09-27,10-09 → 10-21 | 1428 / 819 / 281 | 0 / 0 / 0 |

Only Sentinel-1D appears in the Planetary Computer catalogue for these boxes, so each orbit repeats every 12 days.

### Sentinel-1 against Sentinel-2 where both see the ground

| Event | Cells seen by both | S2 burned there | S1 recall / precision vs S2 at −2 dB | −3 dB | −4 dB |
|---|---|---|---|---|---|
| kalimantan-2026-10-10 | 660 | 540 | 0.42 / 0.98 | 0.20 / 1.00 | 0.04 / 1.00 |
| kalimantan-2026-10-12 | 1746 | 1374 | 0.33 / 1.00 | 0.01 / 1.00 | 0.00 / 0.00 |
| sumatra-2026-10-10 | 3396 | 1912 | 0.80 / 0.98 | 0.55 / 1.00 | 0.27 / 1.00 |
| sumatra-2026-10-12 | 3335 | 1902 | 0.81 / 0.98 | 0.55 / 1.00 | 0.29 / 1.00 |

Taking Sentinel-2 as the reference, a Sentinel-1 "burned" cell is almost always right (precision 0.98–1.00), but at −3 dB Sentinel-1 finds only 1–55% of the burned cells, and at −2 dB 33–81%. On Kalimantan's degraded peat shrub the radar change is small. **The Sentinel-1-only numbers (Kalimantan 8 Oct, all three late Sumatra events) are therefore lower bounds**, probably by a factor of 2 or more. The −2 dB column in the table above is the better central estimate; the −3 dB default was fixed before this comparison and is kept so the threshold is not tuned on the result.

### The recorded fire (Kalimantan, 18 Oct) against the forecast

**It could not be scored.** No usable image of the box exists yet:
- Sentinel-2's only post-fire look (22 Oct) was covered by smoke and cloud: no 100 m cell passed the cloud and haze test.
- Sentinel-1's last pass over the box was 14 Oct, before the fire window. The next pass on the same orbit is 26 Oct; the RTC product then has to be processed and catalogued, typically within a few days.
- The same applies to Kalimantan 14 and 16 Oct, the same fire.

All 54 candidate 400 m blocks are unobserved, so POD, FAR, CSI and the burned-area-weighted forecast probability are undefined (`null` in the event file). The forecast itself is stored and ready:
- At 24 h it marks 14 new blocks against FIRMS and catches 12 of the 18 observed (CSI 0.60).
- Its expected new burn is 203 ha at 24 h and 346 ha at 48 h.
- FIRMS discs already cover 2,628 of the box's 4,096 cells at t0, so even with a clear image only a small area could be scored as new burn.

To score it once Sentinel-1 has passed again (after about 27 Oct):

```bash
uv run --project ml/rs python ml/rs/burned_area.py --only kalimantan-2026-10-18
```

## What this says

1. **Where satellites could see, FIRMS hotspots mark real burn.** In the 9 events with an observation, 81–100% of the measured burned area lies inside a FIRMS footprint. The hotspots are not sending the model to places that did not burn.
2. **But a FIRMS disc is not a burned hectare.** Only 8–76% of the footprint was measured as burned (lower in radar-only events, where Sentinel-1 misses much of the burn). Where Sentinel-2 sees most of the box, the footprint is 1.2–1.3× the measured burned area (Sumatra 10 and 12 Oct: 3,002 vs 2,227 ha and 2,667 vs 2,237 ha), and 2.5× on Kalimantan 12 Oct, which was only 43% clear to Sentinel-2. This matters for the app, which turns old detections into burned scar with exactly these discs.
3. **Sentinel-2 could see the ground after the fire in only 4 of 12 events**, and fully in 2 (Sumatra 10 and 12 Oct, about 80% clear). October haze over Kalimantan and South Sumatra hid the rest.
4. **Sentinel-1 fills gaps but under-counts burn.** It is reliable where it says "burned", conservative overall, and has no post-fire pass yet for the most recent Kalimantan fire.
5. **The forecast-vs-burned-area test the model most needs could not be done this week.** That is a data-availability result, not a model result.

## Caveats

- **Haze and cloud.** Clear-pixel shares are listed per date above. Smoke that is thin enough to pass the blue test can still lower NBR, which looks like burn. The post-NBR < 0.10 rule limits this, but some false positives may remain at the edge of smoke plumes.
- **Timing.** The pre-fire image is a median over 30 days, and the post-fire image a median over all clear looks up to 24 Oct. The measured burn is therefore everything that burned between roughly mid-September and the post-fire look, not just the 24 or 48 hours after t0. Early events (8 Oct) have post windows of up to 16 days, so their maps include later spread.
- **Peat smoulders below the surface.** Underground peat fire can spread under intact or only scorched vegetation. Neither optical nor radar sensors see that until the surface collapses or the vegetation dies, so both under-count peat burn. Conversely, a scorched canopy over unburned peat counts as burned.
- **Threshold sensitivity.** Lowering the S2 dNBR threshold from 0.27 to 0.10 adds 3–8% burned cells; raising it to 0.44 removes 8–47% (Sumatra 10 Oct: 1,962 / 1,912 / 1,751; Kalimantan 10 Oct: 561 / 540 / 288). Moving the S1 threshold from −3 to −2 dB multiplies S1 burned cells by 1.2–3.4. Both tables are above.
- **Radar confounders.** A VH drop can also come from flooding or harvest, and rain raises backscatter. Early October is the start of the wet season, so some S1 burn may be water, and some burn may be masked by wet soil.
- **Same fire, several events.** Kalimantan 14/16/18 Oct and Sumatra 10/12 and 14/16/18 Oct overlap, so the 12 rows are not 12 independent fires.
- **Scene classification mislabels fresh scars.** Sen2Cor sometimes calls very dark burn scars "cloud shadow" (class 3), which is excluded, so S2 can miss the darkest scars.

## Reproduce

```bash
npx tsx ml/rs/forecast_events.ts                                  # forecast for the recorded event
uv run --project ml/rs python ml/rs/burned_area.py                # all 12 events (~1 h first time; cached in .cache/rs/)
uv run --project ml/rs python ml/rs/make_tables.py                # prints the tables above
```

`npx tsx` needs network access to Open-Meteo for the 48 h weather. Without it, the script holds the last recorded hour for hours 25–48 and says so in the output.

## References

- Key C. H., Benson N. C. (2006). Landscape Assessment: Ground measure of severity, the Composite Burn Index; and remote sensing of severity, the Normalized Burn Ratio. In *FIREMON: Fire Effects Monitoring and Inventory System*, USDA Forest Service RMRS-GTR-164-CD, LA 1–51.
- Lohberger S., Stängel M., Atwood E. C., Siegert F. (2018). Spatial evaluation of Indonesia's 2015 fire-affected area and estimated carbon emissions using Sentinel-1. *Global Change Biology* 24(2):644–654.
- Belenguer-Plomer M. A., Tanase M. A., Fernandez-Carrillo A., Chuvieco E. (2019). Burned area detection and mapping using Sentinel-1 backscatter coefficient and thermal anomalies. *Remote Sensing of Environment* 233:111345.
- Main-Knorn M. et al. (2017). Sen2Cor for Sentinel-2. *Proc. SPIE* 10427 (scene classification).
- Schroeder W. et al. (2014). The New VIIRS 375 m active fire detection data product. *Remote Sensing of Environment* 143:85–96.
