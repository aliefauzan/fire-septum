# Devpost submission text (draft)

Paste section by section into the Devpost form. Every number between `<!-- gen -->` markers is filled from the data files by `npx tsx scripts/gen-docs.ts`; CI fails if one is out of date. Re-run it after the daily register job, just before submitting.

## Track

**Climate Data & Environmental Monitoring.** The track's problem is that environmental data is fragmented and hard to verify. Fire Septum joins fragmented open fire data into one forecast. Then it makes every forecast verifiable: it is sealed and timestamped on Bitcoin before the outcome, reproducible bit for bit in every browser engine, and scored in public against NASA satellites. It is a *climate data verification platform* for wildfire forecasts, one of the builds the track lists.

## Inspiration

In 2015, Indonesia's peat fires emitted more CO₂ per day than the entire US economy (WRI, GFED estimates). Every dry season, fire commanders and governments act on hotspot maps and forecasts. Nobody keeps score of those forecasts: you cannot prove what a model said before the fire spread, and a model can always be tuned to look good on the past.

## What it does

- **Forecast where.** A gradient-boosted model trained on the 2015 and 2019 fire seasons gives the probability of new hotspots tomorrow in every 400 m block. Its inputs are the NASA FIRMS archive, ERA5 fire weather (the Canadian Drought Code), peat, land cover, canals and fire history. It is calibrated with isotonic regression and tested on fires it never saw.
- **Simulate what if.** A 40-run cellular-automaton ensemble simulates how a real fire spreads over 24–48 h, with and without firefighting actions (control lines, helicopter drops, hand crews, peat injection). Canals and roads from a dated OpenStreetMap snapshot stop fire, and canals dry the peat around them. Actions are ranked by area saved, using only the resources the commander says exist.
- **Seal before the outcome.** Every input and output is hashed (SHA-256) and signed (Ed25519), and the hash is timestamped on Bitcoin through OpenTimestamps. Each day's records go into one Merkle root, which can also be attested on Base with the Ethereum Attestation Service. A forecaster, an incident commander and BPBD can co-sign a record. Decisions are sealed too. No token.
- **Score in public, every day.** A GitHub Actions job seals forecasts for the most active fires by a fixed rule. It scores each one after 24 h against what the VIIRS satellites detected, and commits the result. Anyone can submit a sealed forecast in an open format and appear on the same scoreboard.
- **Count the carbon honestly.** Peat burn depth comes from each cell's fire history (Konecny et al. 2016). Every emission number is a Monte Carlo range. The satellite (FRP) estimate is cross-checked against GFED, and burned area is measured from Sentinel-2 and Sentinel-1 afterwards.
- **Watch carbon projects.** It checks fire in and around Indonesian REDD+ peat project boundaries and seals the satellite evidence.
- **Brief the commander.** A one-page PDF brief, with BMKG's own forecast and fire-danger maps shown next to the model's weather.

## How we built it

TypeScript, React and Vite, with three.js for 3D terrain. The spread model is the Alexandridis et al. (2008) cellular automaton, with a Horn slope kernel as in Köse et al. (2008, IEEE 3DTV-CON). It runs in Web Workers with common random numbers, so plans are compared run by run. It uses its own fdlibm-based elementary functions, so the output hash is identical across JavaScript engines. The forecaster is gradient-boosted trees (scikit-learn), trained in Python and exported to JSON. It is evaluated by the same TypeScript feature code in training and in the app. Fire weather follows the cffdrs equations on ERA5. Emissions use the IPCC 2013 Wetlands Supplement factors with per-cell burn depth. Receipts use canonical JSON + SHA-256, Ed25519, RFC 6962 Merkle trees, OpenTimestamps and EAS. <!-- gen:tests -->189 automated tests<!-- /gen:tests --> run in CI.

## Evidence (what we measured, not claimed)

**Validation at scale, split published first.** The split was fixed by a stated rule and timestamped on Bitcoin before any model was trained:

<!-- gen:split -->
| Split | Rule | Events |
|---|---|---:|
| train | 2015 and 2019, Kalimantan and Sumatra | 1,055 |
| validation | 2023 Kalimantan: all tuning, including isotonic calibration and any hyperparameter search | 241 |
| test | 2023 Sumatra: touched once, at the end | 184 |
| oot | out-of-time test: the 12 events of October 2026 and the prospective forecast register | 12 |

1,492 events in all, plus 2,700 training boxes. The split was fixed and timestamped on Bitcoin (`data/validation/events.json.ots`) before any tuning.
<!-- /gen:split -->

**Next-day forecaster** against persistence, distance and climatology on the same rows:

<!-- gen:forecaster -->
| Model | validation (241 boxes) | test (184 boxes) | oot (12 boxes) | oot_allviirs (12 boxes) |
|---|---|---|---|---|
| `gbm` | +0.035 [+0.019, +0.051] · 0.09 · 0.81 | +0.032 [+0.018, +0.044] · 0.08 · 0.79 | +0.067 [−0.186, +0.095] · 0.14 · 0.75 | +0.056 [−0.061, +0.130] · 0.16 · 0.60 |
| `gbm_iso` | +0.042 [+0.031, +0.052] · 0.09 · 0.81 | +0.036 [+0.026, +0.045] · 0.08 · 0.79 | +0.069 [−0.093, +0.098] · 0.14 · 0.75 | +0.062 [+0.005, +0.110] · 0.15 · 0.60 |
| `climatology` | +0.000 [+0.000, +0.000] · 0.02 · 0.50 | +0.000 [+0.000, +0.000] · 0.02 · 0.50 | +0.000 [+0.000, +0.000] · 0.08 · 0.50 | +0.000 [+0.000, +0.000] · 0.14 · 0.50 |
| `distance` | +0.023 [+0.019, +0.028] · 0.06 · 0.77 | +0.022 [+0.016, +0.028] · 0.06 · 0.76 | +0.026 [−0.036, +0.034] · 0.09 · 0.60 | +0.033 [+0.015, +0.038] · 0.14 · 0.58 |
| `persistence` | +0.019 [+0.013, +0.023] · 0.05 · 0.72 | +0.020 [+0.015, +0.026] · 0.05 · 0.72 | +0.034 [−0.010, +0.042] · 0.11 · 0.66 | +0.039 [+0.026, +0.045] · 0.18 · 0.63 |
| `ca` | −6.2 [−7.5, −5.0] · 0.07 · 0.76 | −8.5 [−11.0, −6.8] · 0.06 · 0.76 | −7.9 [−54.8, −4.4] · 0.09 · 0.77 (7 boxes) | −2.8 [−13.2, −1.2] · 0.18 · 0.77 (7 boxes) |

Next 24 h, each cell: Brier skill against train climatology [95% CI, bootstrap over boxes] · CSI at the threshold fixed on validation · AUC. `gbm_iso` is the calibrated model; its validation numbers are in-sample, because the calibration was fitted there. `ca` is the spread simulation; `oot` counts VIIRS S-NPP only (as in training), `oot_allviirs` all three satellites (as the app reads). Source: `docs/validation-scale.json`.
<!-- /gen:forecaster -->

**Spread simulation hindcast, 12 fires, 8–18 Oct 2026.** It is only slightly better than distance alone, and the margin on held-out Sumatra is about one square. We say so.

<!-- gen:hindcast -->
| Fires | Events | New-fire blocks | CSI, model | CSI, distance only | Brier skill |
|---|---:|---:|---:|---:|---:|
| Pooled | 12 | 114 | 0.23 | 0.18 | -1.62 |
| Kalimantan | 6 | 90 | 0.35 | 0.25 | -0.67 |
| Sumatra | 6 | 24 | 0.12 | 0.11 | -4.08 |

Source: `docs/hindcast-rerun-2026-10-24-barriers.json` (τ = 6 h, canal and road barriers on). Brier skill below 0 means the raw ensemble probabilities are not calibrated.
<!-- /gen:hindcast -->

**Pre-registered forecasts, scored by the daily job:**

<!-- gen:register -->
6 forecasts sealed in the register, 6 scored; 0 open submissions.

| Model | Boxes | CSI | POD | FAR | Brier skill |
|---|---:|---:|---:|---:|---:|
| `distance` | 6 | 0.18 | 0.72 | 0.80 | -1.35 |
| `fire-septum-ca` | 6 | 0.13 | 0.68 | 0.86 | -2.98 |
| `climatology` | 6 | 0.00 | 0.00 | 0.00 | -0.04 |
<!-- /gen:register -->

**Reproducibility.** <!-- gen:determinism -->The recorded West Kalimantan fire (40 runs) gives output hash `91087d26772bf2ab…` on 4 engines: V8 (Node); V8 (Chromium 141.0.7390.37); JavaScriptCore (Safari 26.0); SpiderMonkey (js shell). Identical: yes (checked 2026-10-24). Not run on the machine that wrote this file: firefox (CI runs every engine on Linux).<!-- /gen:determinism -->

**Carbon.** <!-- gen:carbon -->Satellite (FRP) CO₂ over GFED4.1s in the five most-burned peat cells: 2015 3.04×, 2019 1.21×, 2023 1.02×. Measured burned area (Sentinel-2 dNBR and Sentinel-1 SAR) for 9 of the October 2026 fires: 81%–100% of it lies inside the FIRMS footprints.<!-- /gen:carbon -->

**Third-party check.** The `.ots` proofs parse in the reference OpenTimestamps client (`ots info`, `ots verify`), with no Fire Septum code involved.

## Who it is for and how it scales

- **BPBD and Manggala Agni commanders:** where fire is likely tomorrow and what acting would change, with uncertainty visible and no invented resources.
- **Provincial governments:** when to request aircraft, on a record that shows what was known at the time.
- **Researchers and agencies:** a public, pre-registered scoreboard where any model can be compared prospectively.
- **Auditors, carbon-project verifiers and buffer pools:** proof of what was forecast, decided and observed, and when. Concession holders can be held strictly liable for fires on their land (UU 32/2009 Pasal 88, as amended by UU 6/2023).

It runs in a browser. It uses free, global open data; FIRMS needs only a free key. The register runs itself on GitHub Actions, and every record is a plain JSON file. Adding a region is a bounding box.

## Challenges and limits (honest)

- The spread simulation's skill over distance alone is small, and its probabilities are not calibrated. On the prospective register it has so far scored below the distance reference.
- Burn depth from fire history is a satellite inference, not a field measurement. Cells that burn every year are probably static heat sources.
- The satellite (FRP) emission number runs 1–3× GFED and disagrees with the forecast number by orders of magnitude on the recorded fire. Both are shown with their method.
- OpenStreetMap canals are patchy. The drainage strength and the partial barrier of ditches are assumptions.
- SiPongi (Kemenhut) data needs written permission, so that adapter is off.
- It has not yet been tested with BPBD or Manggala Agni staff.

## What's next

Run the register through the 2026 dry season and invite other models onto the scoreboard. Add SMAP / SiPALAGA peat moisture to the forecaster. Test the planning view and the PDF brief with one Daops unit.

## Built with

typescript, react, vite, three.js, web-workers, scikit-learn, python, nasa-firms, era5, open-meteo, aws-terrain-tiles, openstreetmap, global-forest-watch, esa-worldcover, sentinel-2, sentinel-1, opentimestamps, bitcoin, ethereum-attestation-service, base, ed25519, github-actions, vercel, vitest
