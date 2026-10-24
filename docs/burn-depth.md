# Burn depth: per-cell fire history and a Monte Carlo range

Until 24 October 2026 the emission numbers multiplied every hectare of burned peat by one IPCC
Tier 1 value, 353 t dry matter per hectare. Since then each burned peat cell takes a burn depth
from its own fire history, and every emission number is reported as a range from a Monte Carlo
over fire spread, burn depth and emission factors (`src/sim/carbon.ts`). This page sets out the
rule, the sources, the uncertainty model and the limits.

## The rule

At scenario build (`src/data/live.ts`, `src/data/fireHistorySample.ts`) the fire-history raster
(`public/data/fire-history/`, built by `ml/forecast/fire_history.py` from the NASA FIRMS yearly
Indonesia files: MODIS 2001–2025 within 500 m of a detection, VIIRS S-NPP 2012–2025 within 187 m,
vegetation fires only, 0.005° cells) is sampled at the centre of each 100 m cell of the 64 × 64
grid. The landscape stores, per cell, the number of distinct calendar years **before the
scenario's year** with a detection (`Landscape.fireYears`). The scenario's own year is never
counted, so a fire cannot count itself. That also leaves out an earlier fire in the same season.

Each newly burned peat cell then takes the peat consumed per hectare of its class:

| Earlier fire years on the cell | Peat consumed (t dry matter/ha) | Source |
|---|---|---|
| 0 (no fire seen since 2001) | **353** (95% CI 170–536) | IPCC 2013 Wetlands Supplement, ch. 2, Table 2.6 |
| 1 | **115** | Konecny et al. 2016, Table 3, second fire |
| 2 | **69** | same, third fire |
| 3 or more | **23** | same, fourth and later fires |

### Why 353 and not 206 for "no fire seen"

Konecny et al. 2016 measured a first fire at 206 t/ha (0.17 m × 0.121 g/cm³). It is tempting to
use that for cells with no recorded fire, but two things point the other way:

- **The record starts in 2001.** The ex-Mega Rice Project and much of the Kalimantan and Sumatra
  peat burned in 1997, before MODIS. A cell with no detection since 2001 may be first-burn
  ground or may have burned in 1997 or earlier. FIRMS also misses fires under cloud and smoke.
- **A true first burn goes deeper.** The IPCC value is the mean of first-time El Niño fires on
  drained peat (Page et al. 2002, Usup et al. 2004, Ballhorn et al. 2009), 0.3–0.5 m deep. A
  cell that has not burned in 25 years still has its loose, dry surface peat, which is what a
  first fire removes.

The IPCC 95% interval (170–536) contains Konecny's 206, so using 353 with its full interval in
the Monte Carlo covers both readings: the range is wide where the history says least. Anyone who
prefers Konecny's first-fire value can set *Peat burnt per hectare: no fire seen since 2001* to
206 under *Resources → Rates and limits*.

### Why the Konecny classes for repeat fires

Konecny et al. 2016 (Global Change Biology 22(4):1469–1480, doi:10.1111/gcb.13186), Table 3,
for drained peat in the ex-Mega Rice Project, Central Kalimantan: relative burn depth 0.17, 0.10,
0.06 and 0.02 m and dry peat consumed 206, 115, 69 and 23 t/ha for the first, second, third and
fourth-or-later fire; bulk density 0.121 ± 0.018 g/cm³ for the first fire and 0.115 ± 0.020
after; carbon content 55.3 ± 4.2%; combustion efficiency 1.0. Each repeat fire burns shallower
because the first ones removed the loose, dry surface peat. It is the only published per-fire
sequence for tropical peat, and it comes from the same landscape type as most of the fires the
app loads. Its main weakness is that it is **one site**.

### Records without fire history

Every record made before 24 October 2026 (the shipped West Kalimantan event, the register
entries, sealed receipts) has no `fireYears`. For those, all burned peat goes into the first
class and the arithmetic is the old one, line for line: hectares × 353 × (464 × 44/12 + 21 × 27)
/ 1000. `src/sim/carbon.test.ts` checks this bit for bit and re-runs a sealed register forecast
to its sealed t CO₂e. The outcome card says that the scenario carries no fire history and that
353 t/ha is too high where the peat has burned before.

## The Monte Carlo

`emissionRange` in `src/sim/carbon.ts` draws N = 2,000 samples. Draw *i* uses:

1. **Fire spread**: spread run *i* mod 40, so every run is used equally often.
2. **Burn depth**, one draw per class per sample (systematic: a class value that is wrong is
   wrong for every cell in it; independent per-cell noise would average away over thousands of
   cells and understate the range):
   - no-history class ~ Normal(353, 93), the SD from the IPCC 95% CI (half-width 183 / 1.96),
     clamped at 0;
   - the three Konecny classes × one shared log-normal depth factor (mean 1, relative SD 0.4)
     × one shared bulk-density factor ~ Normal(1, 0.17). The bulk-density SD is the paper's
     (0.020 / 0.115). The depth SD is **our assumption**: the paper is one site, and how well
     its class depths transfer to another site is not published. Combustion efficiency stays at
     the paper's 1.0. Carbon content does not enter, because the emission factors are per kg
     of dry matter.
3. **Emission factors**: CO₂-C ~ Normal(464, 11%), CH₄ ~ Normal(21, 44%), independent, clamped
   at 0. Table 2.7 gives no uncertainty for the tropical factors (one study, Christian et al.
   2003). We take the boreal/temperate 95% half-widths (CO₂-C 362 ± 41, 11%; CH₄ 9 ± 4, 44%)
   and use them as one standard deviation, i.e. twice as wide as their source. **Assumption.**
   GWP-100 (27.0) is not varied.

With the plan, the same run and the same factor draws are used on both sides, so the avoided
emission is paired draw by draw. The card reports the median and the 5–95% range (10–90% in
the details), for doing nothing, with the plan and avoided.

**What drives the range.** Each source is varied alone with the others at their central value
(spread: the 40 runs with central factors; depth and emission factors: the mean burned hectares
per class), and the three variances are shown as shares. Interactions are ignored, so the shares
are a guide, not an exact decomposition.

**Determinism.** Every random number is a pure function of (fixed seed, draw, slot): a
mulberry32 stream seeded by `hash4(seed, draw)`, Box–Muller with the fdlibm `log`, `cos` and
`exp` from `src/sim/detmath.ts`. The same inputs give the same quantiles on every call and in
every engine. (Two `hash4` values that differ only in their last argument came out correlated,
which is why the stream is used.) A full Monte Carlo takes a few milliseconds in Node on the
64 × 64 grid.

The rates (class values and spreads) are in `src/sim/doctrine.ts` with their sources and status
(verified / assumption) and are editable like every other rate.

## Example numbers (24 Oct 2026)

| Scenario | Fire history | Burned peat by class, no action (ha: 0 / 1 / 2 / 3+) | t CO₂e, no action: median (5–95%) | Main driver |
|---|---|---|---|---|
| Shipped West Kalimantan event (24 h), as recorded | none (recorded 18 Oct) | 156 / – / – / – (all IPCC) | 120,000 (63,000–220,000) | spread 44%, depth 44%, EF 12% |
| Same event with fire history attached in memory (not re-recorded) | 2001–2025 | 0 / 0 / 0 / 156 | 7,100 (3,100–17,000) | depth 71% |
| Live box, ex-Mega Rice Project Block C, -2.901, 114.402 (48 h) | 2001–2025 | 0 / 7 / 133 / 735 | 52,000 (20,000–130,000) | depth 55%, spread 40% |

On ground that FIRMS has seen burn three or more times, the emissions fall by about 15× against
the flat default. The satellite number for the same West Kalimantan box is about 710,000 t CO₂e
in the 48 h before (260,000–1,900,000), so the two estimates now disagree by far more than a
factor of two. The forecast counts only the cells newly burned in its 24 h, while the satellite
number covers 48 h of all burning, including fire already smouldering. Even so, a gap this large
suggests that either the 3+ class is too shallow for this ground (see the first limit below), or
the FRP number is high (the GFED cross-check found it 1.0–3.0× high). Both deserve a closer look.

## Limits

- **A FIRMS detection is not a burned-area map.** A MODIS detection marks every 0.005° cell
  within 500 m, and a smouldering front can be detected without the whole cell burning through.
  An old detection may therefore put a cell in a shallower class than it deserves. This biases
  the emissions **low**, most of all where MODIS saw fire in many years. MODIS burned area
  (MCD64A1, 500 m) would be the cleaner input, at a coarser grid.
- **2001 is the start of the record.** Fires of 1997 and earlier are invisible, so "no fire
  seen" mixes first-burn ground with ground that burned before 2001. The wide IPCC interval is
  the hedge.
- **One drained site.** All three repeat-fire classes come from Konecny's site in the ex-Mega
  Rice Project. The relative SD of 0.4 on depth is our placeholder for how well that transfers.
- **No canal or water-table term on depth.** Konecny also found deeper burns near canals, and
  depth tracks the water table. `Landscape.drainM` already gives the distance to drainage; a
  depth modifier from it is the natural next step, but no published curve was found to set it.
- **Tropical emission factors from one study**, with an assumed spread. CO, N₂O and particulates
  are still left out, so the totals stay a floor for the gases counted.
- **The fire-history raster is ~13 MB** (Kalimantan 7 MB, Sumatra 6 MB). Only the island under
  the box is fetched, once per session.

## The satellite number

The "already released, by satellite" figure (`src/sim/frp.ts`) does not use a burn depth: it
integrates fire radiative power and converts it with the GFAS factor for peat (5.87 kg dry
matter per MJ, Kaiser et al. 2012, Table 2). Kaiser et al. give the conversion factors without
any uncertainty: they were fitted by regression to GFED3.1, global budgets agree within 12%,
regional ones much less, and for tropical Asia the paper calls peat combustion estimates
intrinsically very uncertain because the bulk burns underground. The Monte Carlo therefore uses
**our own** spread: one log-normal multiplier on every β per draw with SD of ln = 0.6, which is
the SD of ln(FRP method / GFED4.1s) over the 15 busy 0.25° cells of the cross-check
(`docs/emissions-crosscheck.md`; ratios 0.62–3.95, geometric mean 1.57). It is centred on the
point value, about ×/÷ 2.7 at 90%, and it covers the holding rule as well as β. Peat emission
factors vary as in the forecast; other covers use the IPCC 2006 Table 2.5 SDs.

The cross-check result itself (pooled ratio to GFED4.1s 1.0, 1.2 and 3.0 in 2023, 2019 and 2015;
about 1.5 to GFED5.1 for all of Indonesia) is shown on the card as context. It is not applied as
a correction. Smouldering peat radiates little to the sky, so on peat the method misses fire it
cannot see, but holding each pass for up to 12 h pushes the total up; at cell level it has run
above GFED more often than below.

## The synthetic exercises stay illustrative

The whiteboard, wind-shift and ridge scenarios have no location, so there is no peat map, land
cover or fire history to load; their peat is drawn by hand and their tonnes keep the
"illustrative" label. Register entries sealed before this change carry their own inputs and
must keep them: the seal covers the inputs as they were.
