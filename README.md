# SekatApi: peat-fire forecasts you can hold to account

> *Sekat api* means "fire barrier" in Indonesian.

**Track: Climate Data & Environmental Monitoring** (IEEE ClimateChain Global Hackathon 2026).

**The challenge:** environmental data is fragmented and hard to verify. During Indonesia's karhutla (forest and land fire) season, the data a fire commander needs is scattered: NASA satellite hotspots, weather forecasts, terrain, rivers and roads. Forecasts and decisions made from it leave no record anyone can check later. Nobody can prove what a model said before the fire spread, so nobody knows which forecasts deserve trust.

**What SekatApi does:** it joins those open data sources into one fire-spread forecast. Then it makes the forecast accountable:
1. **Forecast.** How a real fire is likely to spread over the next 24–48 h, with the uncertainty visible (40-run ensemble).
2. **Seal before the outcome.** Each forecast is hashed, signed and timestamped on Bitcoin through OpenTimestamps *before* the satellites see what happens next. Anyone can re-run the sealed inputs and get bit-identical outputs.
3. **Score in public.** After 24 h, the *Forecast register* scores every sealed forecast against NASA FIRMS detections and keeps it on the board, good or bad. A hindcast can be tuned after the fact; a pre-registered forecast cannot.
4. **Plan.** Candidate firefighting actions (control lines, helicopter drops, hand crews, peat injection) are simulated at several start times and ranked by area saved. Plans are sealed the same way, so what was known and decided is on record.

**Why it matters for the climate:** fires on drained tropical peat release about **800 t CO₂e per hectare** (IPCC Tier 1), and peat fires are one of Indonesia's largest emission sources. Forecasts that steer crews and aircraft to peat only help if they are any good, and today nobody keeps score.

**Who would use it:** BPBD and Manggala Agni (Daops) fire commanders deciding where to act; provincial governments deciding when to request aircraft; researchers comparing fire models; auditors and carbon-project verifiers checking afterwards what was known and when.

It is a **research prototype**. It is not an operational fire-behaviour system and not firefighting guidance.

## Run it

```bash
npm install
cp .env.example .env    # optional: add a free NASA FIRMS key for live hotspots
npm run dev             # http://localhost:5173
npm test                # 47 tests: model, interventions, recommender, emissions, receipts, hindcast and register scoring
npm run build           # static site in dist/: the recorded fire and the forecast register work without any server
```

Requires Node 20 or newer. There is no other backend. The Vite dev/preview server also runs a few small middlewares:
- `/api/firms` keeps the FIRMS key on the server (`server/firmsProxy.ts`).
- `/api/osm` calls Overpass with an identifying User-Agent and caches results in `.cache/osm`.
- `/api/receipt/*` signs run receipts and submits them to OpenTimestamps (`server/receipt.ts`). It only ever receives a 64-hex-digit hash.
- `/api/register` stores pre-registered forecasts as JSON files in `data/register/` (`server/register.ts`). Entries are never overwritten, and a score is written once.

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
| Rivers, canals, roads, settlements, land use | OpenStreetMap via Overpass | Real where mapped. Overpass is often at capacity, so results are cached |
| Fuel type where OSM has nothing | Synthetic per zone | **Synthetic** |
| Basemap | Esri World Imagery | Real imagery, display only |

Live scenarios use a 3 × 3 zone grid (A–I), because a real fire cluster usually spans the centre and the outer zones are what can still be protected.

*Find active fires* scans all of Kalimantan or Sumatra in FIRMS, groups detections into roughly 6 km clusters, and loads the area around the cluster you pick. Detections from the last 24 h are placed as burning, each as a disc the size of a 375 m VIIRS pixel. Older detections are placed as burned scar.

## Assumptions and limitations

- **Barely calibrated against Indonesian fire records.** Only τ was fitted, on 6 Kalimantan events (see Validation). The fuel parameters are heuristics. The Alexandridis constants were fitted to a Mediterranean island.
- **Peat is simplified.** Real peat fires burn underground for weeks and come back to the surface. Here peat is a long-burning cell, and the model has no depth or water-table term.
- **The fuel and peat map is synthetic** outside OSM-mapped features, including in every hindcast and register event so far. This is the biggest limit on the emission numbers. Candidate sources checked but not yet integrated: the Ministry of Agriculture 1:50,000 peat map (2019, redistributed by Trase under CC BY 4.0) and the IIASA harmonized peatland dataset v0.1 (Zenodo, doi:10.5281/zenodo.6998052). Neither is served as browser-ready tiles, so it needs a preprocessing step.
- **FIRMS geolocation is coarse.** VIIRS pixels are about 375 m and satellites pass a few times a day. Ignition positions are not jittered between runs yet; the research notes recommend doing that.
- **Suppression effects use published rates where they exist and labelled placeholders where they don't.** The recommender's ranking is meaningful *relative to these rates*. The flame-length estimate uses the model's uncalibrated spread rate, so treat it as a class rather than a measurement.
- **Validated only roughly.** On 12 hindcast fires the model is only slightly better than a distance-only forecast (CSI 0.22 vs 0.17), and on held-out Sumatra the margin rests on 24 observed squares from about 3 distinct fires. The probabilities are not calibrated. See [Validation](#validation-hindcasts-against-nasa-firms). The [forecast register](#pre-registered-forecasts-the-forecast-register) exists to settle this prospectively.
- **Not in the model:** smoke, spotting physics, crown fire, night-time inversions. Travel time from the nearest base is reported in the text but does not delay action starts. Actions in a plan run in parallel; the app warns when a plan uses more than the inventory, but it does not schedule units in sequence.

## Emissions (peat carbon)

Hectares saved are turned into tonnes of CO₂-equivalent with the IPCC Tier 1 method for fires on organic soil (`src/sim/carbon.ts`):

`t CO₂e = burned peat ha × 353 t dry matter/ha × (464 g C/kg × 44/12 + 21 g CH₄/kg × 27) / 1000 ≈ 801 t CO₂e/ha`

| Factor | Value | Source | Status |
|---|---|---|---|
| Peat burnt per ha, tropical wildfire on drained peat (M_B·C_f) | 353 t d.m./ha (95% CI 170–536) | IPCC 2013 Wetlands Supplement, ch. 2, Table 2.6 | verified |
| CO₂-C emission factor, tropical organic soil | 464 g/kg | same, Table 2.7 | verified |
| CH₄ emission factor, tropical organic soil | 21 g/kg | same, Table 2.7 | verified |
| GWP-100 of non-fossil CH₄ | 27.0 | IPCC AR6 WGI, Table 7.15 | secondary |

How the numbers are reported:
- **Only newly burned cells on peat soil count.** Vegetation above mineral soil, CO, N₂O and particulates are left out, so the totals are a floor.
- **The count is per fire event.** The 353 t/ha is the whole burn, not only the 48 h shown. This matches the event-based Tier 1 method, but it assumes each burned peat cell burns to a typical depth.
- **Every emission number is labelled as a model estimate.** It is "if the forecast is right", not a measurement and not a carbon credit. When the peat map is synthetic, the UI says the number is illustrative only. A simulated difference between two plans is not an avoided emission anyone could claim.
- **Two kinds of uncertainty are shown separately.** The 10–90% range comes from the 40 fire-spread runs. The IPCC 95% interval of peat burnt (×0.48 to ×1.52) mostly reflects burn depth.
- **Avoided emissions are paired.** Each run with the plan is compared with the same run without it (common random numbers).
- **The factors are editable** under *Resources → Rates and limits*, like every other rate.

In live mode the peat map is still synthetic outside OpenStreetMap features. The emissions are therefore only as good as the fuel map. The GFW / KLHK peat map is the next step.

## Trust: signed, reproducible run records

**Why this is the right technology.** The ClimateChain tracks ask for transparent, verifiable climate data. For a fire decision, the questions that matter later are:
- What did the forecast say?
- What did the commander decide?
- When was that?
- Has anything been changed since?

Concession holders in Indonesia carry strict liability for fires on their land (UU 32/2009, Pasal 88), so these questions end up in audits and in court. SekatApi answers them with three layers. Each layer does one job:

1. **Reproducible.** The simulation is deterministic: every random draw is a hash of (seed, step, cell, slot). A receipt stores the SHA-256 of:
   - every input: scenario, weather, the fire at t0, the plan, rates and seeds;
   - every output: ignition time, burn-out time and suppression for every cell in every run of both ensembles.

   The record file also carries the inputs themselves. *Check by re-running* or *Open record…* recomputes every hash and re-runs all runs. Any change to the plan, a rate or the weather breaks the match.
2. **Signed.** The server signs `sekatapi-receipt-v1:<receipt hash>:<time>` with Ed25519. The key comes from `RECEIPT_ED25519_KEY`, or is generated once in `.cache/`. The browser verifies the signature with WebCrypto. The signature says which SekatApi instance issued the record and when. It does not vouch for the numbers; the re-run does that.
3. **Timestamped on Bitcoin.** *Timestamp on Bitcoin* sends only the 64-character receipt hash to the public [OpenTimestamps](https://opentimestamps.org) calendars. The calendars commit it to a Bitcoin block within a few hours. *Download proof* saves the exact receipt bytes and a standard `.ots` file, which anyone can check without SekatApi:

   ```bash
   pip install opentimestamps-client
   ots upgrade sekatapi-<hash>.receipt.json.ots   # once the block is confirmed
   ots verify sekatapi-<hash>.receipt.json.ots
   ```

**What blockchain is used for, and what not.** Bitcoin is used only as a public, append-only clock: one hash per decision, no wallet, no fee, no token. Fire data itself does not go on chain, and a smart contract could not make the simulation more correct. Re-running does that, at no cost.

**Known limit.** Floating-point maths such as `Math.exp` can differ in the last bit between JavaScript engines. Identical hashes were confirmed for Node and Chromium (both V8). A record made in Chromium might not reproduce bit-for-bit in Safari or Firefox; the receipt notes which engine produced it.

## Pre-registered forecasts: the forecast register

A hindcast is easy to fool yourself with: the model can be tuned until the past looks good. The forecast register removes that freedom.

1. **Pick places by a fixed rule.** *Seal top 3 Kalimantan fires* takes the three most active FIRMS clusters of the last 24 h, ranked by detections + FRP/50. Nobody chooses the easy fires.
2. **Forecast and seal.** For each place it builds the live scenario (FIRMS, Open-Meteo forecast, AWS terrain, OSM), runs the 40-run no-action forecast for 24 h, and seals it as a run receipt. The server signs the receipt, and its hash goes to OpenTimestamps right away. If the timestamp fails, nothing is stored.
3. **Store.** The entry is written to `data/register/<UTC hour>_<hash>.json` with everything needed to re-run it. Entries are never overwritten (`server/register.ts`).
4. **Score after 24 h.** *Score due* waits until 24 h + 6 h (FIRMS latency) have passed. It re-runs the sealed inputs, which must reproduce the sealed output hash, and fetches the FIRMS detections acquired in (sealed, sealed + 24 h]. It scores new fire only, exactly like a hindcast. The score is written once; anyone can recompute it from FIRMS.
5. **Check without SekatApi.** `node scripts/export-proofs.mjs` writes each receipt and its `.ots` proof to `proofs/`, for `ots upgrade` and `ots verify`.

**Why the timestamp matters.** The proof shows that the forecast existed before the Bitcoin block that confirms it, usually within a few hours of sealing. VIIRS satellites pass over Indonesia about twice a day per satellite, mostly around 01:30 and 13:30 local time. A forecast sealed soon after a pass is in a block before the next pass observes anything. A strict auditor can start the window at the block time instead.

**Status (21 Oct 2026, 00:40 WITA):** 6 forecasts sealed and timestamped, 3 in Kalimantan and 3 in Sumatra. Their windows close on 21 Oct about 16:40 UTC; scoring is due after 22:40 UTC. The `.ots` proofs parse in the reference `ots` client and were pending Bitcoin confirmation when written.

## Validation: hindcasts against NASA FIRMS

*Live fires → Test on a past day* re-creates a past moment, the last satellite pass of day D, using only data available then:
- detections up to that pass;
- Open-Meteo's archived forecast weather;
- terrain.

It forecasts 24 h ahead and scores the forecast against the VIIRS detections that came next. The map shows them as white rings. Only **new** fire is scored, in 400 m squares (about one satellite pixel). The score is compared with a distance-only forecast of the same size, which shows whether wind, slope and fuel add anything (`src/sim/hindcast.ts`).

**Results on 12 fires (Kalimantan and Sumatra, 8–19 Oct 2026; full tables in [docs/hindcast.md](docs/hindcast.md)):**

| | Default model (τ = 3 h) | Spread slowed to τ = 6 h |
|---|---|---|
| New 400 m squares observed / forecast / caught | 114 / 663 / 112 | 114 / 390 / 90 |
| CSI, all events (distance-only reference) | 0.17 (0.16) | 0.22 (0.18) |
| CSI, Sumatra only, held out when choosing τ (reference) | 0.08 (0.08) | 0.11 (0.09) |

What we learned:
- **The default model runs about 6× too hot.** Most detections on D+1 fell where fire already was: these peat fires persisted and crept.
- **Slowing spread to τ = 6 h helps.** That value was chosen on Kalimantan only. On held-out Sumatra events it improves the score (0.08 to 0.11) and edges past distance alone (0.09). That margin is about 1 square in 24, so treat it as a hint, not proof.
- **The probabilities are not calibrated.** Brier skill is negative at every setting.
- **The default is now τ = 6 h** (since 21 Oct 2026). Re-running all 12 events from scratch on 21 Oct gave exactly the same pooled counts as on 20 Oct (`docs/hindcast-rerun-2026-10-21.json`), so the hindcast itself is reproducible.

## Project layout

```
src/sim/      model, ensemble, recommender, doctrine (sources + rates), resources, scenarios, worker,
              carbon (IPCC peat emissions), receipt (hashes, records), hindcast (scoring) (pure TS, tested)
src/sim/      register (pre-registered forecasts: observation window, pooling)
src/data/     Open-Meteo (forecast + archive), FIRMS, terrain, OSM fuel + logistics, satellite, live and hindcast builders,
              register (issue + score), presets + events/ (the recorded Kalimantan fire)
data/register/ sealed, timestamped forecasts and their scores (one JSON file each)
proofs/       receipts + .ots files exported by scripts/export-proofs.mjs
data/         dated OpenStreetMap snapshot of bases (fallback when Overpass is busy)
scripts/      snapshot-facilities.mjs (refresh the snapshot), export-proofs.mjs (register → proofs/)
src/ui/       canvas renderer, map, timeline, panels
server/       Vite middleware: FIRMS key proxy, Overpass UA + cache, LLM brief proxy, receipt signing + OpenTimestamps, forecast register store
docs/         research notes, original idea page from the previous session
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
