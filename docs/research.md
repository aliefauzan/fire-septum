# Research notes (20 Oct 2026)

Sources the user pointed to, and what SekatApi takes from each. Social posts were read through agent-reach burner accounts, read-only. Quote-posts could not be fetched because X search returned 404.

## Claude post (x.com/claudeai/status/2111177834127601902)

A thread of six community projects. The first is "a wildfire analysis prototype that maps the fire's spread over time and tracks hot spots, made with Opus 5.5" (FireTrace, by @DilumSanjaya).

Useful replies:
- VIIRS pixels are 375 m and satellites pass only a few times a day, so a "spread over time" view fills big gaps. Show that uncertainty.
- How are predictions checked against what actually happened?
- Add wind; place suppression where the hotspots are; is it live FIRMS data or a replay?
- Two users ask directly whether it works for Kalimantan and Indonesia.
- @kkoseug links IEEE 4547885 as "work that we did years ago". This may be the paper's first author; not confirmed.
- Critics: operational systems already do this, and fire is hard to model.

## Dilum Sanjaya post (x.com/DilumSanjaya/status/2108241054298415258)

A wildfire analysis concept built with three.js. The author says the terrain is procedural and all data, including the forecast, is mock. The idea is a map that is mostly observed data, with the most recent stretch forecast.

Repliers ask for wind, relative humidity, fuel types and burning index, a thermal overlay, detection latency, and prescribed-burn planning.

## FireTrace rebuild by @lxbarth (firemap-two.vercel.app), read from its public source

| Part | How it works |
|---|---|
| Stack | Plain ES modules, no backend, Mapbox GL 3D terrain, a WebGL2 canvas draped on the DEM |
| Model | Minimum-travel-time (Dijkstra) spread over the real DEM. 16-neighbour stencil, elliptical wind term `exp(1.45·cos Δ)`, exponential slope term, fBm noise fuel field |
| Calibration | Arrival order is mapped onto clock time with a hand-fitted rate-of-spread curve, so burned acres match the incident record. This is a forensic replay, not a forecast |
| Rendering | One arrival-time texture drives the burn scar, the front glow (cells with `t ≈ arrival`), isochrone streaks and domain-warp noise that hides the grid |

What we took: arrival-time thinking (every run stores the ignition hour of each cell), one shared time value driving all views, and a satellite basemap.

What we do differently: we forecast with uncertainty (an ensemble), we model interventions, and we never fit to a known outcome.

## Other projects found in the replies

- **Ember Scope** (github.com/JesseQin123/ember-scope, MIT): React + three.js. Deterministic replay, suppression drops that rewind with the timeline, and an explicit "synthetic demo, not a decision tool" disclaimer. We use the same honesty labels.
- **Wildfire_Analysis_Project** (github.com/AnasA18H/Wildfire_Analysis_Project): pre/post burn-severity polygons. Useful for later hindcast validation.

## IEEE paper

K. Köse, N. Grammalidis, E. Yılmaz, and E. Çetin, "3D forest fire propagation simulation," in *Proc. 3DTV Conf.: The True Vision – Capture, Transmission and Display of 3D Video*, Istanbul, Turkey, May 2008, pp. 369–372, doi: 10.1109/3DTV.2008.4547885.

Method: fireLib, which derives from BEHAVE and the Rothermel model, run on a grid. Each cell has a fuel model, moisture, slope and aspect. Wind, moisture and fuel can change over time. Rain on previous days wets fuel. Slope and aspect come from SRTM with a 3×3 Horn kernel. Output is an ignition-time map exported as KMZ.

What SekatApi uses from it:
- the Horn kernel (`slopeAspect` in `src/sim/landscape.ts`)
- weather that changes hour by hour
- antecedent rain as a dryness term (`Scenario.antecedentRainMm`, computed from 72 h of Open-Meteo history)
- an ignition-time grid as the core output
- real elevation (AWS Terrain Tiles)

## Spread probability model

A. Alexandridis, D. Vakalis, C. I. Siettos, and G. V. Bafas, "A cellular automata model for forest fire spread prediction: The case of the wildfire that swept through Spetses Island in 1990," *Applied Mathematics and Computation*, vol. 204, no. 1, pp. 191–201, 2008.

Used for `p_burn = p_h(1+p_veg)(1+p_den)·p_w·p_s` and its calibrated constants. See `src/sim/model.ts`.
