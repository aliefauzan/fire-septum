# Fire Septum: peat-fire forecasts you can hold to account

> The name translates the Indonesian *sekat api*, "fire barrier" (a septum is a dividing wall). Records sealed before 24 Oct 2026 were made under that first name, SekatApi; their format identifiers (`sekatapi.run-receipt`, `sekatapi-receipt-v1`) are kept so they still verify.

**Track: Climate Data & Environmental Monitoring** (IEEE ClimateChain Global Hackathon 2026).

**The challenge:** environmental data is fragmented and hard to verify. During Indonesia's karhutla (forest and land fire) season, the data a fire commander needs is scattered: NASA satellite hotspots, weather forecasts, terrain, rivers and roads. Forecasts and decisions made from it leave no record anyone can check later. Nobody can prove what a model said before the fire spread, so nobody knows which forecasts deserve trust.

**What Fire Septum does:** it joins those open data sources into one fire-spread forecast. Then it makes the forecast accountable:
1. **Forecast.** Two models, each for its own question:
   - *Where will new hotspots appear tomorrow?* A gradient-boosted model trained on the 2015 and 2019 fire seasons (NASA FIRMS archive, ERA5 fire weather, peat, land cover, canals, fire history), calibrated with isotonic regression and tested on fires it never saw.
   - *What if we act?* A cellular-automaton simulation of how a real fire spreads over the next 24–48 h, with the uncertainty visible (40-run ensemble) and firefighting actions on the map.
2. **Seal before the outcome.** Each forecast is hashed, signed and timestamped on Bitcoin through OpenTimestamps *before* the satellites see what happens next. Anyone can re-run the sealed inputs and get bit-identical outputs.
3. **Score in public.** After 24 h, the *Forecast register* scores every sealed forecast against NASA FIRMS detections and keeps it on the board, good or bad. A hindcast can be tuned after the fact; a pre-registered forecast cannot.
4. **Plan.** Candidate firefighting actions (control lines, helicopter drops, hand crews, peat injection) are simulated at several start times and ranked by area saved. Plans are sealed the same way, so what was known and decided is on record.

**Why it matters for the climate:** fires on drained tropical peat release about **800 t CO₂e per hectare** (IPCC Tier 1), and peat fires are one of Indonesia's largest emission sources. Forecasts that steer crews and aircraft to peat only help if they are any good, and today nobody keeps score.

**Who would use it:** BPBD and Manggala Agni (Daops) fire commanders deciding where to act; provincial governments deciding when to request aircraft; researchers comparing fire models; auditors and carbon-project verifiers checking afterwards what was known and when.

It is a **research prototype**. It is not an operational fire-behaviour system and not firefighting guidance.

## Hosted

The app runs at **https://fire-septum.vercel.app** (Vercel, redeployed on every push to `main`). The browser build is static; the server routes in `server/` (FIRMS proxy, OSM, receipt signing and OpenTimestamps anchoring, the register, the brief) are served by one serverless function, `api/index.js`, bundled from `api/_entry.ts` with `npm run build:api` and committed. Re-run that after changing anything in `server/`.

Hosted, the register is written by the daily GitHub Actions job (see [the register](#pre-registered-forecasts-the-forecast-register)). With `BLOB_READ_WRITE_TOKEN` set, hosted writes go to Vercel Blob, write-once, and need `Authorization: Bearer $REGISTER_TOKEN`; scores are never accepted over HTTP when hosted. Without a token the hosted register is read-only. Live hotspots need `FIRMS_MAP_KEY` and signing needs `RECEIPT_ED25519_KEY` (PKCS#8 PEM) in the project's environment variables; `scripts/vercel-env.sh` sets both from the local files with the Vercel CLI.

## Run it

```bash
npm install
cp .env.example .env    # optional: add a free NASA FIRMS key for live hotspots
npm run dev             # http://localhost:5173
npm test                # model, forecaster, emissions, receipts, batches, register and scoreboard (see below)
npm run build           # static site in dist/: the recorded fire and the forecast register work without any server
```

Checks CI runs on every push (`.github/workflows/ci.yml`): type check, <!-- gen:tests -->189 automated tests<!-- /gen:tests -->, build, the API bundle is up to date, the cross-engine determinism check, and the generated numbers in this README:

```bash
node scripts/determinism.mjs        # same output hash in Node, Chromium, Firefox and WebKit
npx tsx scripts/gen-docs.ts --check  # every number between <!-- gen --> markers matches the data files
```

Requires Node 20 or newer. There is no other backend. The Vite dev/preview server also runs a few small middlewares:
- `/api/firms` keeps the FIRMS key on the server (`server/firmsProxy.ts`).
- `/api/osm` calls Overpass with an identifying User-Agent and caches results in `.cache/osm`.
- `/api/receipt/*` signs run receipts and submits them to OpenTimestamps (`server/receipt.ts`). It only ever receives a 64-hex-digit hash.
- `/api/register` stores pre-registered forecasts as JSON files in `data/register/` (`server/register.ts`). Entries are never overwritten, and a score is written once.
- `/api/submissions`, `/api/scoreboard`, `/api/decisions`, `/api/evidence`, `/api/batches`: open forecast submissions, the scoreboard index, sealed decisions, carbon-project evidence and daily Merkle batches.
- `/api/bmkg`, `/api/bmkg-fdrs`: BMKG's village forecast and fire-danger maps (`server/bmkg.ts`). `/api/sipongi/*` is off unless `SIPONGI_PERMISSION=granted` (see [Commander tools](#commander-tools-pdf-brief-bmkg-and-sipongi)).

**Static hosting.** `npm run build` gives a plain static site. Without the middlewares, the recorded fire, the synthetic scenarios and the forecast register (read-only, from the files in `data/register/`) still work. Live data, sealing and scoring need `npm run dev` or `npm run preview`.

## How to use it

1. **Pick a scenario.**
   - *Recorded fire* (default): a real West Kalimantan fire frozen at the last satellite pass of 18 Oct 2026, with what the satellites saw in the next 24 h. It ships with the code, so it needs no keys. It is the most recent Kalimantan event of the [hindcast set](docs/hindcast.md). It is also the event where the model beat the distance-only reference most, so read the pooled scores too.
   - *Whiteboard*: A and C are burning and B is at risk. This is the sketch the idea started from (synthetic).
   - *Wind shift*
   - *Ridge*
   - *Live data*: real weather, terrain and hotspots around any lat/lon.
2. **Read the baseline (map A).** Each zone label shows its status and the share of simulated runs in which it has ignited by the selected hour. Drag the timeline or press play.
3. **Read the recommendations (right panel).** Each one states Where, What, When, Why, Impact and Resources. It also has a small chart of hectares saved by start time, which shows the cost of acting late. Hover a card to preview it on map B.
4. **Act.** Use *Add to plan* or *Apply strategy*, or draw your own actions on map B: drag to draw a control line, click to place water or crews. Change any action's start hour with its slider. Map B, the zone table and the arrival markers on the timeline update right away.
5. **Switch to 3D terrain** (toggle above the maps). The same map is draped on a three.js mesh built from the scenario's own elevation grid: real AWS terrain in live mode, with the satellite image. Vertical exaggeration is shown in the corner, since Kalimantan peat is nearly flat. Burning cells glow. Both panes share one camera, and you can click on the terrain to place actions.
6. **AI situation brief (optional).** Set `LLM_API_KEY`, plus `LLM_BASE_URL` and `LLM_MODEL` for any OpenAI-compatible endpoint, in `.env`. The model receives only the simulated numbers and rewrites them as a short brief in Bahasa Indonesia or English for commanders. It makes no predictions of its own. The call goes through `/api/brief` on the dev server, so the key never reaches the browser.
7. **Enter your resources (Resources panel).** Type how many helicopters, hand crews (regu) and dozers are actually available; leave a field blank if you don't know. Live mode starts with everything unknown and lists the real bases mapped near the fire. See [Resources, doctrine and where the numbers come from](#resources-doctrine-and-where-the-numbers-come-from).
8. **Change the conditions.** The wind direction and speed sliders re-run everything. *Advance clock +6 h* turns one simulated run into the new present and re-plans. The recommender always plans **on top of your current plan**, so it answers "what else is needed?"
9. **Read the carbon.** The outcome card shows peat emissions if nothing is done and, with a plan, the emissions avoided, compared run by run. See [Emissions](#emissions-peat-carbon).
10. **Seal the decision (Record tab).** *Seal and sign* creates a receipt. *Timestamp on Bitcoin* anchors it. *Check by re-running* proves the numbers reproduce. *Download* gives a file anyone can open with *Open record…*. See [Trust](#trust-signed-reproducible-run-records).
11. **Seal forecasts before the outcome (Forecast register…).** *Seal top 3 Kalimantan fires* (or Sumatra) picks the three most active FIRMS clusters by a fixed rule, forecasts the next 24 h, and seals, signs and timestamps each one. *Score due* scores them once the 24 h window is in FIRMS. See [Pre-registered forecasts](#pre-registered-forecasts-the-forecast-register).
12. **Test the model on a past day (Live fires → Test on a past day).** Pick a location and a day. The app forecasts from that day's last satellite pass, using only data available then, and scores the forecast against the detections of the next 24 h. See [Validation](#validation-hindcasts-against-nasa-firms).

## Simulation model

| Piece | Choice | Where |
|---|---|---|
| Grid | 64 × 64 cells of 100 m (6.4 × 6.4 km), 0.5 h steps, 48 h horizon | `src/sim/scenarios.ts` |
| Spread probability | Alexandridis et al. (2008) cellular automaton: `p = p_h(1+p_veg)(1+p_den)·p_w·p_s`, with `p_w = exp(c1·V)·exp(c2·V·(cosθ−1))` and `p_s = exp(a·θ_s)`, using the paper's constants | `src/sim/model.ts` |
| Step rescaling | `p` is treated as a hazard: `p_step = 1 − exp(−p·dt/τ)`, τ = 6 h, chosen by hindcast against NASA FIRMS (it was 3 h, which spread ~6× too much new fire). This keeps wind and slope asymmetry when `p > 1` | `model.ts` |
| Fuel dryness | Heuristic multiplier from relative humidity, temperature, current rain and 72 h antecedent rain. This produces the diurnal cycle: fast afternoons, slow humid nights | `dryness()` |
| Burning time | Per fuel: grass 1 h, shrub 4 h, **peat 12 h**. Peat keeps smouldering and re-igniting its neighbours | `src/sim/fuels.ts` |
| Spotting | When wind is above 15 km/h, embers can ignite cells 2–4 cells downwind. They can jump control lines | `model.ts` |
| Terrain | Slope term from elevation. Horn 3×3 slope/aspect as in Köse et al. (2008), IEEE 3DTV-CON | `landscape.ts` |
| Uncertainty | 40-member ensemble. Each member perturbs wind direction (σ 15°), wind speed (σ 20%) and humidity (σ 5%), and has its own stochastic spread | `ensemble.ts` |
| Fair comparison | **Common random numbers.** Every random draw is a hash of (seed, step, cell, slot), so baseline and plan share all draws except where the intervention physically changes something. Differences are paired per run | `rng.ts` |

### Interventions

All rates below are editable in the app under *Resources → Rates and limits*; each shows its source (see the next section).

- **Control line.** Built by a dozer, or by hand crews when no dozer is available. Line speed comes from per-fuel production rates in chains per hour: NWCG dozer rates and the San Dimas hand-crew rate. A finished cell blocks 85–99% of spread attempts; it leaks more in strong wind, and embers can jump it. A line cannot be cut through cells that are already burning.
- **Helicopter water.** Drops per helicopter-hour = 60 / (round-trip flight to the dip site + dip/drop time). The dip-site distance comes from the nearest river, canal or lake in OpenStreetMap when available. Each drop wets bucket litres ÷ litres-per-hectare. Drops only knock down flame shorter than 2.4 m (IRPG aircraft band). On peat they mostly stop surface flame (editable factor, default ×0.3), because smouldering peat needs ~4–6 L of water per kg. Wetness evaporates faster in hot, dry air.
- **Hand crews.** Each crew works burning edge cells at its per-fuel production rate. It only engages where the estimated flame length is below 1.2 m (IRPG / Andrews & Rothermel). Flame length uses Byram, `L = 0.0775·I^0.46`, with `I = H·w·R` and `R` taken from the model's own head spread rate.

### Recommender

The recommender is search plus simulation, not a black box:

1. Run the ensemble for the current plan.
2. Find threatened zones: not burning, and at least 15% chance of igniting.
3. For each threatened zone, find where and from which neighbour the fire enters, and the predicted head position over time.
4. Generate candidate actions:
   - a control line on each boundary that faces the fire
   - a helicopter knockdown at the predicted head
   - crew direct attack at the predicted head
5. Simulate every candidate at start times +0, +3, +6, +10 and +15 h, using the same seeds.
6. Rank by value-weighted hectares saved. Cost only breaks near-ties.
7. Build a greedy strategy **only from resources known to be available** in the entered inventory, then report any zones still at 30% risk or more.
8. Leave out **speculative** actions: those whose effect rests only on placeholder rates. Today that is cloud seeding, since BMKG reports no rain amounts or timing. They are still simulated and listed last with a *speculative* tag, but they never enter the combined strategy (`effectEvidence` in `src/sim/doctrine.ts`).

Every sentence of each explanation is filled from these simulated numbers, the inventory, mapped logistics and the cited doctrine. No LLM writes predictions or strategies.

## Resources, doctrine and where the numbers come from

**What is available.** The app does not guess what an incident has.
- **Live mode** starts with the inventory unknown. Options that need helicopters, crews or dozers are still simulated, but they are tagged *availability unknown* and left out of the combined strategy until the commander enters counts.
- **Zero means none.** A count of 0 removes that option family, and the app says why ("No helicopters available…").
- **Synthetic scenarios** use an exercise inventory (2 helicopters, 4 crews, 1 dozer), and the panel labels it as not real.

**What is nearby.** `/api/osm-resources` queries OpenStreetMap for:
- within 80 km: fire stations, Manggala Agni / Daops and BPBD offices, heliports, helipads, aerodromes and airstrips;
- within 15 km: rivers, canals, lakes and roads.

When the public Overpass servers are overloaded, the server falls back to `data/osm-facilities.json`. This is a dated OSM snapshot of 1,118 bases across Kalimantan and Sumatra, refreshed with `node scripts/snapshot-facilities.mjs`. A mapped base is not proof of staff or equipment, and the UI says so.

**Where the strategy comes from.** Candidates are generated by geometry (the boundary facing the fire, the predicted head) and judged by simulation. Published rules shape and check them, and each recommendation lists its sources. The rules are kept in `src/sim/doctrine.ts`:

| Rule | Source |
|---|---|
| Tactic by flame length: < 1.2 m hand crews; 1.2–2.4 m dozers / aircraft; > 2.4 m head control probably ineffective; > 3.4 m ineffective | Andrews & Rothermel 1982 (GTR INT-131); NWCG IRPG PMS 461 (2025), p. 50 |
| Flame length from intensity `L = 0.0775·I^0.46` | Byram 1959 (seen via secondary sources) |
| Direct attack whenever possible; indirect line must be completed and held before the fire arrives (checked against the 10th-percentile arrival) | IRPG, Firefighting Orders 4 and 6 |
| Anchor every line (checked: the line ends must touch non-burnable ground or the map edge) | IRPG, Watch-Out Situation 8 |
| LCES before crews engage | IRPG |
| Smouldering peat needs ~4–6 L water/kg; injection beats spraying | Santoso et al. 2021 (IJWF 30:378); Mulyasih et al. 2022 |
| Regu equipment (pumps, peat injectors); Daops Manggala Agni executes; aerial support in emergency status or at a Governor's request | Permen LHK P.32/2016, Pasal 12, 57, 88–89 |
| Allocate whole resource units within what is available | Donovan & Rideout 2003; Hu & Ntaimo 2009 |

**Rates.** Every number is tagged:
- **verified**: read in the primary document;
- **secondary**: published, but seen quoted elsewhere;
- **assumption**: no published value found.

Assumptions include helicopter speed with a bucket, dip/drop time, bucket size, litres per hectare, crew rates outside grass, dozer rates on peat and fuel loads. Replace them with your unit's numbers. The helicopter cycle formula is a derived model; no published productivity study was found.

**AI brief.** The brief receives the inventory, mapped facilities and doctrine list. It is told to mention only those resources, flag unknown counts, and cite only the given doctrine.

### Honesty rules built into the UI

- A zone is never called "safe". The best label is *Not reached in any run*, and the UI states that this is not a guarantee either.
- *Lower risk* and *delayed* are always relative to the no-action forecast, and come with the share of runs or a 10–90% range.
- A provenance strip shows what is synthetic and what is real: SYNTHETIC, or LIVE + SYNTHETIC.

## Live data: the "simulate from real-time data" idea

| Layer | Source | Status |
|---|---|---|
| Weather (hourly wind, RH, temperature, rain, 72 h rain history) | [Open-Meteo](https://open-meteo.com) | Real, no key |
| Active fires | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) VIIRS S-NPP, NOAA-20 and NOAA-21 NRT, last 48 h | Real, needs a free `FIRMS_MAP_KEY` |
| Elevation | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium) | Real |
| Peat soil | [Global Forest Watch global peatlands](https://data-api.globalforestwatch.org/dataset/gfw_peatlands) (tropics: Gumbricht et al. 2017, CIFOR, 232 m), keyless PNG tiles | Real |
| Land cover | [ESA WorldCover 2021](https://esa-worldcover.org/) 10 m, through the Microsoft Planetary Computer tile API, keyless | Real |
| Rivers, canals, roads, settlements, land use | OpenStreetMap via Overpass | Real where mapped. Overpass is often at capacity, so results are cached |
| Fuel type where the layers above fail | Synthetic per zone | **Synthetic**, and the UI says so |
| Basemap | Esri World Imagery | Real imagery, display only |

Live scenarios use a 3 × 3 zone grid (A–I), because a real fire cluster usually spans the centre and the outer zones are what can still be protected. Each zone is named after its most common fuel.

**How the fuel map is made** (`src/data/live.ts`, `src/data/landcover.ts`): every cell takes its WorldCover class and its peat-mask bit. On peat soil, tree cover is *peat swamp forest* and every other burnable cover is *degraded peat shrub* (cropland included: on Kalimantan peat it is mostly dryland plots and fallow that burn), so the emission count follows the soil. Off peat, tree cover is *plantation* (oil palm and acacia read as trees in WorldCover), cropland and herbaceous wetland are *wet farmland*, the rest is *grass*. OpenStreetMap water, roads, settlements and land use go on top, bent to the peat mask the same way. Sea-level DEM cells are water.

*Find active fires* scans all of Kalimantan or Sumatra in FIRMS, groups detections into roughly 6 km clusters, and loads the area around the cluster you pick. Detections from the last 24 h are placed as burning, each as a disc the size of a 375 m VIIRS pixel. Older detections are placed as burned scar.

## Assumptions and limitations

- **The spread simulation is barely calibrated against Indonesian fire records.** Only τ was fitted, on 6 Kalimantan events (see Validation). The fuel parameters are heuristics. The Alexandridis constants were fitted to a Mediterranean island. The statistical forecaster is the calibrated one; use it for *where*, and the simulation for *what if*.
- **Peat is simplified.** Real peat fires burn underground for weeks and come back to the surface. Here peat is a long-burning cell, and the model has no depth or water-table term.
- **The peat map says where peat is, not how deep it burns.** The Global Forest Watch layer is a soil-type map at 232 m. Burn depth comes from each cell's fire history (Konecny et al. 2016 classes, IPCC default for ground not seen burning since 2001), which is an inference from satellites, not a field measurement (see [docs/burn-depth.md](docs/burn-depth.md)). Register entries and the recorded event sealed before the peat layer existed keep their synthetic fuel maps, because the seal covers the inputs as they were; the UI labels those tonnes illustrative.
- **WorldCover cannot tell a plantation from a forest**, and OpenStreetMap canals are patchy even in the snapshot, so the fuel types are real at the class level and heuristic below it. The canal drainage effect (k = 0.5) and the partial barrier of ditches and tracks are assumptions.
- **FIRMS geolocation is coarse.** VIIRS pixels are about 375 m and satellites pass a few times a day. Ignition positions are not jittered between runs yet; the research notes recommend doing that.
- **Suppression effects use published rates where they exist and labelled placeholders where they don't.** The recommender's ranking is meaningful *relative to these rates*. The flame-length estimate uses the model's uncalibrated spread rate, so treat it as a class rather than a measurement.
- **The simulation is validated only roughly.** On 12 hindcast fires it is only slightly better than a distance-only forecast, and on held-out Sumatra the margin rests on 24 observed squares from about 3 distinct fires. Its probabilities are not calibrated, and on the prospective register it has so far scored below the distance reference. See [Validation](#validation-hindcasts-against-nasa-firms). The [forecast register](#pre-registered-forecasts-the-forecast-register) exists to settle this prospectively.
- **Not in the model:** smoke, spotting physics, crown fire, night-time inversions. Travel time from the nearest base is reported in the text but does not delay action starts. Actions in a plan run in parallel; the app warns when a plan uses more than the inventory, but it does not schedule units in sequence.

## Emissions (peat carbon)

Hectares saved are turned into tonnes of CO₂-equivalent with the IPCC Tier 1 method for fires on organic soil (`src/sim/carbon.ts`), with the peat consumed per hectare taken from each cell's fire history:

`t CO₂e = Σ burned peat cells × ha × M_B(cell) × (464 g C/kg × 44/12 + 21 g CH₄/kg × 27) / 1000`, where `M_B` is 353 t dry matter/ha (≈ 801 t CO₂e/ha) on ground with no fire seen since 2001, and 115, 69 or 23 t/ha after one, two or three and more earlier fire years (Konecny et al. 2016).

| Factor | Value | Source | Status |
|---|---|---|---|
| Peat burnt per ha, tropical wildfire on drained peat (M_B·C_f) | 353 t d.m./ha (95% CI 170–536) | IPCC 2013 Wetlands Supplement, ch. 2, Table 2.6 | verified |
| CO₂-C emission factor, tropical organic soil | 464 g/kg | same, Table 2.7 | verified |
| CH₄ emission factor, tropical organic soil | 21 g/kg | same, Table 2.7 | verified |
| GWP-100 of non-fossil CH₄ | 27.0 | IPCC AR6 WGI, Table 7.15 | secondary |

How the numbers are reported:
- **Only newly burned cells on peat soil count.** Vegetation above mineral soil, CO, N₂O and particulates are left out. That leaves those sources out; it does not make the peat number itself a lower bound, because burn depth can be over- or under-estimated.
- **The count is per fire event.** The 353 t/ha is the whole burn, not only the 48 h shown. This matches the event-based Tier 1 method, but it assumes each burned peat cell burns to a typical depth.
- **Every emission number is labelled as a model estimate.** It is "if the forecast is right", not a measurement and not a carbon credit. When the peat map is synthetic, the UI says the number is illustrative only. A simulated difference between two plans is not an avoided emission anyone could claim.
- **Every emission number is a range.** A deterministic Monte Carlo of 2,000 draws samples the fire-spread run, the burn depth of each class and the emission factors; the card shows the median and the 5–95% range, and the run record stores it as `results.tco2eRange`. Method and spreads: [docs/burn-depth.md](docs/burn-depth.md).
- **Burn depth from fire history.** `public/data/fire-history/` holds the years 2001–2025 in which FIRMS saw fire on each ~550 m cell. Only years before the scenario's year count. Cells that burn almost every year are probably static heat sources and are a known caveat.
- **Avoided emissions are paired.** Each run with the plan is compared with the same run without it (common random numbers).
- **The factors are editable** under *Resources → Rates and limits*, like every other rate.

In live mode the peat soil comes from the Global Forest Watch peatland map and the vegetation from ESA WorldCover, so the "illustrative" label is gone there; the synthetic exercises keep it.

### Already released, by satellite (FRP method)

Next to the forecast, the outcome card shows what the satellites have already seen burn in the last 48 h (`src/sim/frp.ts`). This is an estimate from observations, independent of the spread model and of the burn-depth default:

`FRE (MJ) = Σ over passes of FRP (MW) × hold (s)`, each VIIRS pass (one satellite, 10-minute bin) held until the next pass and for at most 12 h; `dry matter = FRE × β`, with the GFAS conversion factors by cover (Kaiser et al. 2012, Table 2: peat 5.87, tropical forest 0.96, savanna 0.78, agriculture 0.29 kg/MJ); `CO₂e = dry matter × EF`, peat with the Wetlands Supplement factors above and other covers with IPCC 2006 Vol. 4, Table 2.5 (tropical forest CO₂ 1580, CH₄ 6.8; savanna 1613, 2.3; agricultural residues 1515, 2.7 g/kg). A detection centred on a road or canal cell is counted as the fuel around it, since a VIIRS pixel is 375 m across.

Caveats: smouldering peat radiates little to the sky, so GFAS fits a large peat factor to burned-area inventories and the per-fire error is wide. Passes without detections (cloud, haze) are invisible, but the holding rule can also over-count, so the number is **not** a floor. <!-- gen:carbon -->Satellite (FRP) CO₂ over GFED4.1s in the five most-burned peat cells: 2015 3.04×, 2019 1.21×, 2023 1.02×. Measured burned area (Sentinel-2 dNBR and Sentinel-1 SAR) for 9 of the October 2026 fires: 81%–100% of it lies inside the FIRMS footprints.<!-- /gen:carbon --> Details: [docs/emissions-crosscheck.md](docs/emissions-crosscheck.md) and [docs/burned-area.md](docs/burned-area.md). It is stored in the run record as `results.observed` with its method string and range.

On the recorded fire the two numbers disagree by about two orders of magnitude (forecast new burn about 7,100 t CO₂e; satellite FRP over the whole cluster about 710,000 t). They measure different things: the forecast counts only cells newly burned in 48 h, the FRP number every pass over the whole cluster. Neither is a measurement of the fire's emissions.

## Trust: signed, reproducible run records

**Why this is the right technology.** The ClimateChain tracks ask for transparent, verifiable climate data. For a fire decision, the questions that matter later are:
- What did the forecast say?
- What did the commander decide?
- When was that?
- Has anything been changed since?

Concession holders in Indonesia can be held strictly liable (*tanggung jawab mutlak*) for fires on their land under UU 32/2009 Pasal 88, as amended by UU 6/2023 (Cipta Kerja), so these questions end up in audits and in court. Fire Septum answers them with layers that each do one job:

1. **Reproducible.** The simulation is deterministic: every random draw is a hash of (seed, step, cell, slot). A receipt stores the SHA-256 of:
   - every input: scenario, weather, the fire at t0, the plan, rates and seeds;
   - every output: ignition time, burn-out time and suppression for every cell in every run of both ensembles.

   The record file also carries the inputs themselves. *Check by re-running* or *Open record…* recomputes every hash and re-runs all runs. Any change to the plan, a rate or the weather breaks the match.
2. **Signed.** The server signs `fireseptum-receipt-v2:<receipt hash>:<time>` with Ed25519 (records from before 24 Oct 2026 used the prefix `sekatapi-receipt-v1`, and still verify). The key comes from `RECEIPT_ED25519_KEY`, or is generated once in `.cache/`. The browser verifies the signature with WebCrypto. The signature says which Fire Septum instance issued the record and when. It does not vouch for the numbers; the re-run does that.
3. **Timestamped on Bitcoin.** *Timestamp on Bitcoin* sends only the 64-character receipt hash to the public [OpenTimestamps](https://opentimestamps.org) calendars. The calendars commit it to a Bitcoin block within a few hours. *Download proof* saves the exact receipt bytes and a standard `.ots` file, which anyone can check without Fire Septum:

   ```bash
   pip install opentimestamps-client
   ots upgrade fireseptum-<hash>.receipt.json.ots   # once the block is confirmed
   ots verify fireseptum-<hash>.receipt.json.ots
   ```

4. **Batched and attested.** Every record sealed in a UTC day (run records, register entries, decisions, evidence) is a leaf of one RFC 6962 Merkle tree (`src/sim/merkle.ts`, `src/sim/batch.ts`). `npm run seal-day` writes `data/batches/<day>.json` with the root, every leaf and its inclusion proof, and timestamps the root with OpenTimestamps. `npm run attest` also posts the root to the [Ethereum Attestation Service](https://attest.org) on Base (schema `bytes32 merkleRoot, string day, uint32 records, string uri`), a public, indexed record next to the Bitcoin proof. It runs dry without a key and never touches mainnet without `--network base`.
5. **Co-signed by people.** The server's signature says which instance issued a record. In the Record tab, a forecaster, an incident commander and a BPBD officer can each make an Ed25519 role key in their own browser and co-sign a record (`fireseptum-cosign-v1`), saying that they saw and accepted it at that time (`src/sim/cosign.ts`).
6. **Decisions sealed too.** A decision record (`src/sim/decision.ts`) seals what people did with a forecast: the plan chosen (by its run-record hash), the alternatives shown, the resources entered and a note. It is signed, timestamped and co-signable like a run record.

**Versioned formats.** Every record names its kind and version. Records from before 24 Oct 2026 (`sekatapi.run-receipt`, signature prefix `sekatapi-receipt-v1`, engine `Math`) still verify and re-run (`src/sim/compat.test.ts`); new records are `fireseptum.run-receipt` v2 with `math: 'det1'`.

**What blockchain is used for, and what not.** Bitcoin is used only as a public, append-only clock: one hash per record, no wallet, no fee, no token. EAS on Base adds one attestation per day, never fire data, and no token. Fire data itself does not go on chain, and a smart contract could not make the simulation more correct. Re-running does that, at no cost.

**Same bits in every browser.** ECMAScript lets `Math.exp`, `Math.atan` and friends differ in the last bit between engines, and one flipped bit can flip a random threshold. Since 24 Oct 2026 the simulation uses its own elementary functions (`src/sim/detmath.ts`, fdlibm algorithms built only from IEEE-exact operations), recorded in the run inputs as `math: 'det1'`. `node scripts/determinism.mjs` re-runs the recorded fire in Node, Chromium (V8), WebKit (JavaScriptCore) and Firefox (SpiderMonkey) and compares the output hashes; CI runs it on every push (`docs/determinism.json`). Older records name no maths and re-run with the engine's own `Math`, as they were made.

## Pre-registered forecasts: the forecast register

A hindcast is easy to fool yourself with: the model can be tuned until the past looks good. The forecast register removes that freedom.

1. **Pick places by a fixed rule.** *Seal top 3 Kalimantan fires* takes the three most active FIRMS clusters of the last 24 h, ranked by detections + FRP/50. Nobody chooses the easy fires.
2. **Forecast and seal.** For each place it builds the live scenario (FIRMS, Open-Meteo forecast, AWS terrain, OSM), runs the 40-run no-action forecast for 24 h, and seals it as a run receipt. The server signs the receipt, and its hash goes to OpenTimestamps right away. If the timestamp fails, nothing is stored.
3. **Store.** The entry is written to `data/register/<UTC hour>_<hash>.json` with everything needed to re-run it. Entries are never overwritten (`server/register.ts`).
4. **Score after 24 h.** *Score due* waits until 24 h + 6 h (FIRMS latency) have passed. It re-runs the sealed inputs, which must reproduce the sealed output hash, and fetches the FIRMS detections acquired in (sealed, sealed + 24 h]. It scores new fire only, exactly like a hindcast. The score is written once; anyone can recompute it from FIRMS.
5. **Check without Fire Septum.** `node scripts/export-proofs.mjs` writes each receipt and its `.ots` proof to `proofs/`, for `ots upgrade` and `ots verify`.

**Why the timestamp matters.** The proof shows that the forecast existed before the Bitcoin block that confirms it, usually within a few hours of sealing. VIIRS satellites pass over Indonesia about twice a day per satellite, mostly around 01:30 and 13:30 local time. A forecast sealed soon after a pass is in a block before the next pass observes anything. A strict auditor can start the window at the block time instead.

**Runs every day by itself.** `.github/workflows/register.yml` runs `scripts/register-daily.ts` at 10:00 UTC, after the afternoon VIIRS passes are in FIRMS. It scores every forecast whose window has closed, seals the top 3 clusters per island, seals yesterday's Merkle batch, attests it on Base when a key is set, and commits the new files to `main`. Every step is idempotent; `--dry-run` signs and writes nothing. It needs the repository secrets `FIRMS_MAP_KEY` and `RECEIPT_ED25519_KEY` (and optionally `EAS_PRIVATE_KEY`, `BLOB_READ_WRITE_TOKEN`).

**Open benchmark.** Anyone can submit a sealed forecast for the same boxes in the open format [`fireseptum.forecast.v1`](docs/forecast-schema.md) (256 block probabilities per 6.4 km box; JSON Schema in `schema/forecast-v1.json`) with `npx tsx scripts/submit-forecast.ts` or `POST /api/submissions`. It is hashed, timestamped on arrival, and scored by the same code as the register, next to two reference models: distance (`p = exp(−d / 1 km)`) and climatology. The public scoreboard is at [`#/scoreboard`](https://fire-septum.vercel.app/#/scoreboard): pooled CSI, POD, FAR and Brier skill per model, skill over time, and what is still pending.

**Status:**

<!-- gen:register -->
6 forecasts sealed in the register, 6 scored; 0 open submissions.

| Model | Boxes | CSI | POD | FAR | Brier skill |
|---|---:|---:|---:|---:|---:|
| `distance` | 6 | 0.18 | 0.72 | 0.80 | -1.35 |
| `fire-septum-ca` | 6 | 0.13 | 0.68 | 0.86 | -2.98 |
| `climatology` | 6 | 0.00 | 0.00 | 0.00 | -0.04 |
<!-- /gen:register -->

The simulation (`fire-septum-ca`) has so far scored below the distance reference on the register. That is the point of keeping score: it is on the board either way.

## Validation: hindcasts against NASA FIRMS

*Live fires → Test on a past day* re-creates a past moment, the last satellite pass of day D, using only data available then:
- detections up to that pass;
- Open-Meteo's archived forecast weather;
- terrain.

It forecasts 24 h ahead and scores the forecast against the VIIRS detections that came next. The map shows them as white rings. Only **new** fire is scored, in 400 m squares (about one satellite pixel). The score is compared with a distance-only forecast of the same size, which shows whether wind, slope and fuel add anything (`src/sim/hindcast.ts`).

**Results on 12 fires (Kalimantan and Sumatra, 8–18 Oct 2026; full tables and the earlier runs in [docs/hindcast.md](docs/hindcast.md)), current model with canal and road barriers:**

<!-- gen:hindcast -->
| Fires | Events | New-fire blocks | CSI, model | CSI, distance only | Brier skill |
|---|---:|---:|---:|---:|---:|
| Pooled | 12 | 114 | 0.23 | 0.18 | -1.62 |
| Kalimantan | 6 | 90 | 0.35 | 0.25 | -0.67 |
| Sumatra | 6 | 24 | 0.12 | 0.11 | -4.08 |

Source: `docs/hindcast-rerun-2026-10-24-barriers.json` (τ = 6 h, canal and road barriers on). Brier skill below 0 means the raw ensemble probabilities are not calibrated.
<!-- /gen:hindcast -->

What we learned:
- **The default model runs about 6× too hot.** Most detections on D+1 fell where fire already was: these peat fires persisted and crept.
- **Slowing spread to τ = 6 h helps.** That value was chosen on Kalimantan only. On held-out Sumatra events it improves the score (0.08 to 0.11) and edges past distance alone (0.09). That margin is about 1 square in 24, so treat it as a hint, not proof.
- **The probabilities are not calibrated.** Brier skill is negative at every setting.
- **The default is now τ = 6 h** (since 21 Oct 2026). Re-running all 12 events from scratch on 21 Oct gave exactly the same pooled counts as on 20 Oct (`docs/hindcast-rerun-2026-10-21.json`), so the hindcast itself is reproducible.
- **Canals and roads barely change it.** With the OpenStreetMap barrier snapshot and peat drainage on (24 Oct, `docs/hindcast-rerun-2026-10-24-barriers.json`), pooled CSI stays at 0.23 against 0.18 for distance.
- **The real fuel map helps a little and does not change the conclusion.** With peat soil and land cover from GFW and WorldCover (24 Oct, `docs/hindcast-rerun-2026-10-24.json`) the model forecasts fewer squares (326 instead of 390 at τ = 6 h) and keeps most of its hits, so pooled CSI moves from 0.22 to 0.23 and Kalimantan from 0.32 to 0.35. On held-out Sumatra the distance-only reference improves as much as the model (0.12 vs 0.11), so the Sumatra margin is now about 1 square. The ranking of τ is unchanged.

## Next-day forecaster and validation at scale

Twelve fires cannot tell a good model from a lucky one. The statistical forecaster (`src/sim/gbm.ts`, trained by `ml/gbm/`) is tested on hundreds.

**The split was published before tuning.** `data/validation/events.json` fixes every event from the FIRMS archive by a stated rule ([docs/forecast-split.md](docs/forecast-split.md)), and its hash was timestamped on Bitcoin before any model was trained:

<!-- gen:split -->
| Split | Rule | Events |
|---|---|---:|
| train | 2015 and 2019, Kalimantan and Sumatra | 1,055 |
| validation | 2023 Kalimantan: all tuning, including isotonic calibration and any hyperparameter search | 241 |
| test | 2023 Sumatra: touched once, at the end | 184 |
| oot | out-of-time test: the 12 events of October 2026 and the prospective forecast register | 12 |

1,492 events in all, plus 2,700 training boxes. The split was fixed and timestamped on Bitcoin (`data/validation/events.json.ots`) before any tuning.
<!-- /gen:split -->

**The model.** Per 400 m block it gives the probability that VIIRS sees new fire on each of the next three days. It uses 44 features computed by the same code in training and in the app (`src/sim/features.ts`): distance to active and older fire, hotspot counts, FRP and fire duration, peat and land cover, canal density and distance to drainage (OSM snapshot), earlier fire years, terrain, the Canadian FWI system codes from ERA5 (FFMC, DMC, Drought Code, ISI, BUI, FWI; `src/sim/fwi.ts`), days since rain, humidity, wind speed and temperature. Gradient-boosted trees (scikit-learn, `ml/gbm/`) are exported to `public/data/forecaster/gbm-v1.json` and evaluated in TypeScript (`src/sim/gbm.ts`, equal to scikit-learn to 1e-12); isotonic calibration was fitted on the validation split only. The test split was opened once.

**Results**, against persistence, distance and climatology baselines and the spread simulation on the same blocks:

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

What this says:
- **It beats distance and persistence on a season it never saw**, and keeps that at 48 and 72 h. Its calibrated probabilities track the observed frequencies on test.
- **The absolute skill is small.** New fire hits about 2% of blocks a day, so the best CSI is under 0.1, and at p ≥ 0.5 it marks almost nothing.
- **Distance to active fire dominates**, then degraded peat shrub and fire duration. The drought codes and wind gain weight with lead time.
- **On the October 2026 fires it under-forecasts about 2×.** That season's new-fire rate was about three times 2015–2023, and the model learned from one satellite (S-NPP) while the app reads three. At three days it has no skill there.
- **The spread simulation is not a probability forecast.** Its Brier skill is strongly negative because its ensemble probabilities are not calibrated; use it to compare actions, not to say where fire will be.
- **Not yet in the model:** wind direction (the ERA5 cache has none), peat moisture (SMAP / SiPALAGA), burned area as labels.

Reliability diagrams, CSI by lead (1–3 days), feature importance and a post-hoc (not pre-registered) re-score of the register: [docs/forecaster.md](docs/forecaster.md).

## Carbon projects: reversal monitoring

A REDD+ or VCS peat project loses credited carbon when it burns. *Record → Carbon projects: fire watch* checks VIIRS detections against the boundaries of three Indonesian peat projects (simplified from the Verra registry, with attribution; source KMLs are not redistributed): fire inside, within 1 km and within 5 km, in the last 24 h and 7 days, with the satellite (FRP) emission estimate and its range (`src/sim/reversal.ts`). *Seal evidence* writes a reversal evidence record with the raw FIRMS rows, signed and timestamped like a run record (`src/sim/evidence.ts`). It describes what satellites saw. It does not verify a project or say anything about its credits.

## Commander tools: PDF brief, BMKG and SiPongi

- **PDF brief.** *Brief → Download PDF brief* builds a one-page A4 brief in the browser (map, risk, recommended actions, the record hash), in Bahasa Indonesia or English, for sharing by hand. Nothing is sent anywhere.
- **BMKG.** The Sources view shows BMKG's own village forecast for the nearest kecamatan next to the Open-Meteo hours the model runs on, and BMKG's SPARTAN fire-danger (FWI) maps, so a commander can see where they disagree. The model's weather is unchanged.
- **SiPongi** (Kemenhut). An adapter for hotspots and peat water-table stations exists, but SiPongi's terms forbid access without written permission from the Ministry of Forestry, so it answers 403 unless an operator who holds that permission sets `SIPONGI_PERMISSION=granted`.

## Project layout

```
src/sim/        pure TypeScript, tested: model, ensemble, recommender, doctrine (sources + rates), detmath (det1),
                carbon (Monte Carlo), frp, fwi, features + gbm (forecaster), receipt, merkle, batch, cosign,
                decision, evidence, reversal, register, forecast (open format + scoring), scoreboard, hindcast
src/data/       Open-Meteo, FIRMS, terrain, peat, WorldCover, OSM barriers, fire history, ERA5 FWI archive,
                live and hindcast builders, register, events/ (the recorded Kalimantan fire)
src/ui/         map, 3D terrain, timeline, panels, Record/Trust, register, scoreboard, carbon projects, PDF brief
server/         FIRMS proxy, Overpass, receipts + OpenTimestamps, register, submissions, scoreboard,
                decisions, evidence, batches, BMKG/SiPongi, LLM brief; write-once store (files or Vercel Blob)
public/data/    OSM barrier tiles, fire history, forecaster model, carbon-project boundaries, BMKG areas
data/           register/, submissions/, batches/ (daily Merkle roots), validation/ (split, burned area,
                GFED cross-check), fwi/ (ERA5 codes), osm-facilities.json
ml/             Python: OSM snapshot, FIRMS archive + split + FWI + fire history, GBM training, Sentinel burned area
scripts/        register-daily, seal-day, attest (EAS), new-testnet-wallet, submit-forecast, determinism,
                gen-docs, hindcast-batch, record-event, export-proofs
schema/         forecast-v1.json (open forecast format)
docs/           methods: hindcast, forecast split, forecaster, burn depth, burned area, emissions cross-check, schema
```

## References

- Alexandridis A., Vakalis D., Siettos C. I., Bafas G. V. (2008). *A cellular automata model for forest fire spread prediction: The case of the wildfire that swept through Spetses Island in 1990.* Applied Mathematics and Computation 204(1):191–201.
- Köse K., Grammalidis N., Yılmaz E., Çetin E. (2008). *3D forest fire propagation simulation.* 3DTV-CON 2008, pp. 369–372. doi:10.1109/3DTV.2008.4547885.
- Andrews P. L., Rothermel R. C. (1982). *Charts for interpreting wildland fire behavior characteristics.* USDA Forest Service GTR INT-131.
- NWCG (2025). *Incident Response Pocket Guide*, PMS 461.
- Byram G. M. (1959). Combustion of forest fuels. In Davis K. P. (ed.), *Forest Fire: Control and Use*. McGraw-Hill.
- Santoso et al. (2021). Int. J. Wildland Fire 30(5):378–390. doi:10.1071/WF20117.
- Mulyasih et al. (2022). Alexandria Engineering Journal 61(12):12525–12537.
- Peraturan Menteri LHK No. P.32/MENLHK/SETJEN/KUM.1/3/2016 tentang Pengendalian Kebakaran Hutan dan Lahan.
- Donovan G. H., Rideout D. B. (2003). An integer programming model to optimize resource allocation for wildfire containment. Forest Science 49(2):331–335.
- Hu, Ntaimo L. (2009). Integrated simulation and optimization for wildfire containment. ACM TOMACS 19(4). doi:10.1145/1596519.1596524.
- IPCC (2013). *2013 Supplement to the 2006 IPCC Guidelines for National Greenhouse Gas Inventories: Wetlands*, ch. 2, Eq. 2.8 and Tables 2.6–2.7.
- Forster P. et al. (2021). The Earth's energy budget, climate feedbacks and climate sensitivity. In *Climate Change 2021: The Physical Science Basis* (IPCC AR6 WGI), ch. 7, Table 7.15.
- Research notes on the inspiration posts and related projects: [docs/research.md](docs/research.md).
