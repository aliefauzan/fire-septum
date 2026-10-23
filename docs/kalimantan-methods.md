# What crews do against karhutla in Kalimantan, and what SekatApi simulates

Researched 20 Oct 2026. [P] = official or primary source, [S] = media or second-hand. "Not found" means we searched and found no published number, so the simulator uses an editable placeholder (marked "assumption" in Resources → Rates and limits).

## Dry ice (CO2 pellets)
- No use against fires in Kalimantan found yet. The trial was over **South Sumatra (Palembang), from 15 Oct 2026**: a Cessna Caravan flew 2 sorties of 800 kg (~3 mm pellets at about −75 °C, dropped at ~4,500 ft). [S] [InfoPublik](https://infopublik.id/kategori/bencana/993315/bnpb-semai-1600-kilogram-dry-ice-untuk-atasi-asap-karhutla-sumsel)
- **What it is for:** breaking the haze inversion so smoke can disperse and aircraft can fly again. It does **not** make rain and needs no clouds. Same day: visibility rose from 300–650 m to 2,800 m, and PM2.5 fell from 660 to 208. How long this lasted was not reported. [S]
- BMKG says its effectiveness is not yet established. Pellets reportedly hit a house roof, so BNPB now requires finer grains. Central Kalimantan is named as the next target; it is unconfirmed whether operations have started there. [S]
- **Simulated as:** "Dry ice" (whole area). It only matters when the "Thick haze, grounded" condition is on, because haze grounds helicopters. Each sortie opens the sky for a few hours (`dryIceClearH`, assumption).

## Cloud seeding with NaCl (OMC / TMC)
- Kalbar 2026: 27 sorties, 24,600 kg NaCl. Kalteng 2026: 10 sorties, 8,000 kg (~800 kg per sortie), seeded at 6,000–10,000 ft. Rain is reported only as "light to moderate". [P] [BMKG](https://www.bmkg.go.id/berita/utama/optimalkan-potensi-hujan-untuk-redakan-karhutla-bmkg-omc-di-kalbar-buahkan-hasil)
- It only works when rain clouds can grow. [P] [BMKG 2025](https://www.bmkg.go.id/berita/utama/bmkg-perlu-kewaspadaan-ekstra-omc-tak-efektif-saat-awan-tak-terbentuk-patroli-dan-penjagaan-harus-ditingkatkan) Riau 2021: +33–64% rain over natural in one phase, ~2% in another. [S]
- **Not found:** the delay from seeding to rain, and the rain amount in mm.
- **Simulated as:** "Cloud seeding" (whole area). In a share of runs set by BMKG cloud potential (high / medium / low = 60% / 35% / 0%, assumption), rain falls over the map for `seedRainH` hours, `seedLagH` hours after seeding. Rain lowers fuel dryness and raises humidity.

## Helicopter water bombing
- Sep 2026: 24 helicopters across 6 provinces, 13 of them in Kalimantan (Sikorsky, Super Puma, Mi-17/Mi-8, Bell 412, Kamov). About 4,000 L per drop. [S]
- Limits: smoke grounded Kalteng helicopters for over a week in Oct 2026 [S], and drops are weak against smouldering peat. [S]
- **Simulated as:** existing water drops, grounded while there is haze. `peatKnockdown` already limits their effect on peat.

## Peat injection (suntik gambut) and foam
- Smouldering peat needs ~5.7 ± 2.1 L of water per kg. Injection uses ~3.8–4.2 L/kg in about half the time of spraying. [P] Santoso 2021; Mulyasih 2022.
- Field lance flow ~1,669 L/h, 13–15 h per pit. [P] [CSIRO supplement](https://www.publish.csiro.au/WF/acc/WF21135/WF21135_AC.pdf) A regu carries 5 peat injectors. [P] P.32/2016
- 1% wetting agent cut suppression time by 39% in the lab. [P] Santoso 2021. Kalteng police inject cassava starch. [S]
- **Simulated as:** "Inject" (map tool). Crews pour `lanceLph` per lance into the nearest burning peat cell until it has received `injectLPerHa`, then move on. "With foam" multiplies the flow by 1.6. One crew does about 1 ha per day, in line with reported field progress of 1–3 ha/day. Inside a 48 h run it mostly mops up, so it saves little burned area.

## Bored wells (sumur bor), canal blocks, rewetting
- Wells are 16–25 m deep and wet ~200–400 m around them. In Kalsel only 350 of 629 wells worked. [S] The legal water-table target is no deeper than 0.4 m (PP 57/2016). [P]
- Canal blocks act over a few hundred metres and over months; many are broken. [S]
- **Simulated as:** "Soak" (map tool). Pumps (`pumpLpm`, assumption) fed by bored wells soak unburned peat ahead of the fire. Soaked peat dries 4× slower. Canal blocking itself acts too slowly for a 48 h forecast, so it is not modelled.

## Not simulated (yet)
- Detection delay from satellite revisit time. MODIS passes about 4 times a day; Himawari gives sub-hourly data. [P]
- Patrols, watch towers, and the "Jalur Hijau" firebreak widths (widths not found).
- Backburning: no evidence that it is used in Indonesia.
