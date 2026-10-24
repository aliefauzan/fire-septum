# Burn depth: why 353 t/ha is still a default, and what would replace it

The emission numbers multiply hectares of burned peat by the IPCC Tier 1 value for a tropical
wildfire on drained peat: **353 t dry matter per hectare**, 95% CI 170–536 (2013 Wetlands
Supplement, Table 2.6). With bulk density of about 0.1 g/cm³ that is a burn about 35 cm deep
(17–54 cm across the interval). The peat map and the land cover are now real
(`src/data/peat.ts`, `src/data/landcover.ts`), so *where* peat burns is measured. *How deep* it
burns is not, and that is now the largest single uncertainty in the tonnes.

## What the default is made of

The 353 t/ha is the mean of three Kalimantan studies cited by the IPCC: Page et al. 2002 (the
1997 El Niño fires, burn depths around 0.5 m), Usup et al. 2004 and Ballhorn et al. 2009 (2006 El
Niño fires measured by LiDAR, mean about 0.33 m). All three are drought-year fires, and Page and
Ballhorn measured areas that were burning for the first time since drainage.

## Why it is usually too high for today's fires

Konecny et al. 2016 (Global Change Biology 22:1469–1480) flew LiDAR before and after fire over
drained peat in Central Kalimantan and measured the burned depth for every fire in the record:

| Fire on the same ground | Peat consumed | Share of the IPCC default |
|---|---|---|
| First | ≈ 206 t/ha | 58% |
| Second | ≈ 115 t/ha | 33% |
| Third | ≈ 69 t/ha | 20% |
| Fourth and later | ≈ 23 t/ha | 7% |

The first fire removes the loose, dry surface peat; what remains is denser, wetter and burns
shallower. Depth also rises closer to drainage canals, where the water table is lowest. The
fires the app loads from FIRMS sit mostly in the ex-Mega Rice Project area around Palangka
Raya, which has burned in 1997, 2002, 2006, 2009, 2015 and 2019. On that ground the default is
likely 2–5× too high, and the IPCC lower bound (170 t/ha) is closer to a first fire than to a
typical one. Until the depth is modelled, read the tonnes as "if this peat burned like a
first-time drought fire".

## What would make it real, per cell

1. **Fire history per cell (feasible now).** Count prior fires on each 100 m cell from the
   FIRMS archive (VIIRS from 2012, MODIS from 2000) or MODIS burned area (MCD64A1, 500 m), map
   the count to the Konecny class, and use that class's t/ha instead of 353 for that cell. The
   archive is already behind `/api/firms`, but a 20-year pull is thousands of 10-day requests,
   so it needs an offline step: one FIRMS country download per year, rasterised to a
   burn-count PNG for Kalimantan and Sumatra (about 1,200 × 1,000 pixels at 1 km), shipped with
   the app like the peat tiles. Per-cell `peatBurntTdmHa` then replaces the single rate in
   `src/sim/carbon.ts`. Expected effect on the live fires: the tonnes fall by half or more, and
   the 10–90% range narrows because the class, not the whole IPCC interval, sets the depth.
2. **Distance to canals (feasible now).** Konecny gives burn depth as a function of distance
   to drainage canals. The OpenStreetMap layer already brings canals into the fuel map, so a
   distance transform from `water` line cells is a few lines of code. Canal mapping in OSM is
   patchy, so this would be a modifier on the history class, not a replacement.
3. **Water table (the real driver, not reachable yet).** Peat does not burn when the water
   table is within about 40 cm of the surface (the PP 57/2016 rule), and burn depth tracks how
   far below that it has fallen. BRGM's SIPALAGA network logs water tables at monitoring
   stations across the peat hydrological units, but there is no public API. The 72 h rain
   from Open-Meteo, already in the scenario, is a weak proxy and is not calibrated to depth.
4. **Peat thickness (helps only on thin peat).** The Ministry of Agriculture 1:50,000 peat map
   (2019, redistributed by Trase under CC BY 4.0) and the Wetlands International atlases carry
   depth classes (0.5–1, 1–2, 2–4, 4–8, > 8 m). Most burns consume 10–50 cm, so thickness caps
   the burn only on the thinnest class. Worth adding to mark shallow peat, not as a depth model.
5. **Direct measurement (not operational).** Pre- and post-fire LiDAR or ICESat-2 profiles
   give the burned depth itself. That is how Konecny's numbers were made; it is not something
   an app can do in real time.

## The satellite number is independent of all this

The "already released, by satellite" figure (`src/sim/frp.ts`) does not use a burn depth at
all: it integrates fire radiative power and converts it with the GFAS factor for peat
(5.87 kg dry matter per MJ, Kaiser et al. 2012). Its own weakness runs the other way: most of a
peat fire smoulders underground and radiates little to the sky, so GFAS compensates with a
large factor fitted to GFED's burned-area inventory. The two numbers are therefore two
different estimates of the same thing, and when they disagree by more than a factor of two
that is itself information about the depth assumption.

## The synthetic exercises stay illustrative

The whiteboard, wind-shift and ridge scenarios have no location, so there is no peat map or
land cover to load; their peat is drawn by hand and their tonnes keep the "illustrative" label.
The recorded West Kalimantan event was frozen before the peat layer existed, so its stored fuel
map is still synthetic and it is labelled the same way; re-recording it with
`buildLiveScenario` would make it real. Register entries sealed before this change carry their
own synthetic fuel maps too, and must keep them: the seal covers the inputs as they were.
