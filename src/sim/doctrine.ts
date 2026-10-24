// Where the numbers and rules come from.
//
// Every production rate, threshold and logistics constant the simulator uses lives
// here with its source and how well that source was checked:
//   verified   – read in the primary document
//   secondary  – the value is published, but we only saw it quoted in another source
//   assumption – no published value found; our placeholder, meant to be overridden
// The UI shows the status next to each number and lets the user edit it.

import type { MathLib } from './detmath';
import type { FuelId } from './types';

export type SourceStatus = 'verified' | 'secondary' | 'assumption';

export interface Source {
  short: string;
  full: string;
  url?: string;
}

export const SOURCES = {
  irpg: {
    short: 'NWCG IRPG (PMS 461, 2025)',
    full: 'National Wildfire Coordinating Group, Incident Response Pocket Guide, PMS 461, January 2025 (NFES 001077).',
    url: 'https://www.nwcg.gov/publications/pms461',
  },
  andrewsRothermel: {
    short: 'Andrews & Rothermel 1982',
    full: 'P. L. Andrews and R. C. Rothermel, "Charts for interpreting wildland fire behavior characteristics," USDA Forest Service Gen. Tech. Rep. INT-131, 1982.',
    url: 'https://research.fs.usda.gov/treesearch/22647',
  },
  byram: {
    short: 'Byram 1959',
    full: 'G. M. Byram, "Combustion of forest fuels," in K. P. Davis (ed.), Forest Fire: Control and Use, McGraw-Hill, 1959. Flame length L = 0.0775·I^0.46 (L in m, I in kW/m).',
  },
  nwcgDozer: {
    short: 'NWCG dozer production rates',
    full: 'NWCG dozer line production rates, Type 3 dozer, single pass, slope class 1, by fuel model (FM1–2: 55–90 ch/h, FM4: 20–35, FM6/7/9: 35–55, FM11–12: 15–25).',
  },
  sanDimas: {
    short: 'USFS San Dimas Tech Tip 1151-1805P (2011)',
    full: 'USDA Forest Service San Dimas Technology & Development Center, Tech Tip 1151-1805P, 2011: Type I crew direct handline in short grass ≈ 1,122 ft/h (792–1,386), ≈ 17 ch/h.',
  },
  santoso: {
    short: 'Santoso et al. 2021',
    full: 'Santoso et al., Int. J. Wildland Fire 30(5):378–390, 2021. Spray needed 5.7 ± 2.1 L of water per kg of peat.',
    url: 'https://doi.org/10.1071/WF20117',
  },
  mulyasih: {
    short: 'Mulyasih et al. 2022',
    full: 'Mulyasih et al., Alexandria Engineering Journal 61(12):12525–12537, 2022. Water injection into peat needed 3.8–4.2 L/kg and beat surface spraying.',
    url: 'https://doaj.org/article/05ea98ef15d54a5d8a1760905dfa7c6d',
  },
  p32: {
    short: 'Permen LHK P.32/2016',
    full: 'Peraturan Menteri LHK No. P.32/MENLHK/SETJEN/KUM.1/3/2016 tentang Pengendalian Kebakaran Hutan dan Lahan (Berita Negara RI 2016 No. 583).',
    url: 'https://peraturan.go.id/files/bn583-2016.pdf',
  },
  donovan: {
    short: 'Donovan & Rideout 2003',
    full: 'G. H. Donovan and D. B. Rideout, "An integer programming model to optimize resource allocation for wildfire containment," Forest Science 49(2):331–335, 2003.',
    url: 'https://research.fs.usda.gov/treesearch/23594',
  },
  hu: {
    short: 'Hu & Ntaimo 2009',
    full: 'Hu and L. Ntaimo, "Integrated simulation and optimization for wildfire containment," ACM Trans. Modeling and Computer Simulation 19(4), 2009.',
    url: 'https://doi.org/10.1145/1596519.1596524',
  },
  alexandridis: {
    short: 'Alexandridis et al. 2008',
    full: 'A. Alexandridis, D. Vakalis, C. I. Siettos and G. V. Bafas, "A cellular automata model for forest fire spread prediction: The case of the wildfire that swept through Spetses Island in 1990," Applied Mathematics and Computation 204(1):191–201, 2008.',
  },
  bmkgOmc: {
    short: 'BMKG OMC Kalimantan 2026',
    full: 'BMKG, "Optimalkan potensi hujan untuk redakan karhutla, BMKG OMC di Kalbar buahkan hasil", 2026: Kalbar 27 sorties / 24,600 kg NaCl; Kalteng 10 sorties / 8,000 kg (~800 kg per sortie). Rain reported only as light to moderate; no mm given. Seeding needs growing clouds.',
    url: 'https://www.bmkg.go.id/berita/utama/optimalkan-potensi-hujan-untuk-redakan-karhutla-bmkg-omc-di-kalbar-buahkan-hasil',
  },
  bmkgClouds: {
    short: 'BMKG 2025 (OMC needs clouds)',
    full: 'BMKG, "Perlu kewaspadaan ekstra, OMC tak efektif saat awan tak terbentuk", 2025: seeding only works when rain clouds can form; patrols must continue.',
    url: 'https://www.bmkg.go.id/berita/utama/bmkg-perlu-kewaspadaan-ekstra-omc-tak-efektif-saat-awan-tak-terbentuk-patroli-dan-penjagaan-harus-ditingkatkan',
  },
  bnpbDryIce: {
    short: 'BNPB dry ice, Sumsel Oct 2026',
    full: 'InfoPublik, "BNPB semai 1.600 kilogram dry ice untuk atasi asap karhutla Sumsel", 15 Oct 2026: Cessna Caravan, 2 sorties × 800 kg of ~3 mm CO2 pellets at ~4,500 ft to break the haze inversion (no rain). Visibility rose from 300–650 m to 2,800 m the same day; how long it lasted was not reported.',
    url: 'https://infopublik.id/kategori/bencana/993315/bnpb-semai-1600-kilogram-dry-ice-untuk-atasi-asap-karhutla-sumsel',
  },
  csiroLance: {
    short: 'Santoso et al. 2022 (supplement)',
    full: 'Supplementary material to Int. J. Wildland Fire WF21135: field lance injection ~1,669 L/h with 13–15 h per pit, versus surface spraying at 3,024–4,878 L/h.',
    url: 'https://www.publish.csiro.au/WF/acc/WF21135/WF21135_AC.pdf',
  },
  ppGambut: {
    short: 'PP 57/2016 (peat water table)',
    full: 'Peraturan Pemerintah No. 57/2016 on peat ecosystems: the water table must be kept no deeper than 0.4 m below the peat surface. Bored wells (sumur bor) 16–25 m deep, wetting ~200–400 m around each (reported, Mongabay 2016).',
    url: 'https://mongabay.co.id/2016/08/11/antisipasi-kebakaran-lahan-gambut-ratusan-sumur-bor-disiapkan-di-lokasi-rawan-di-kalteng/',
  },
  ipccWetlands: {
    short: 'IPCC 2013 Wetlands Supplement, ch. 2',
    full: 'IPCC, 2013 Supplement to the 2006 IPCC Guidelines for National Greenhouse Gas Inventories: Wetlands, ch. 2 (Drained Inland Organic Soils), Eq. 2.8 and Tables 2.6–2.7, pp. 2.39–2.41. Tropical wildfire on drained peat: 353 t dry matter/ha burnt (95% CI 170–536; Ballhorn et al. 2009, Page et al. 2002, Usup et al. 2004), combustion factor 1.0; emission factors 464 g CO2-C, 210 g CO and 21 g CH4 per kg dry matter (Christian et al. 2003).',
    url: 'https://www.ipcc-nggip.iges.or.jp/public/wetlands/pdf/Wetlands_separate_files/WS_Chp2_Drained_Inland_Organic_Soils.pdf',
  },
  ar6Gwp: {
    short: 'IPCC AR6 WGI, Table 7.15',
    full: 'Forster et al. 2021, IPCC AR6 WGI ch. 7, Table 7.15: GWP-100 of non-fossil methane = 27.0 (fossil 29.8).',
    url: 'https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-7/',
  },
  gfwPeat: {
    short: 'GFW global peatlands (Gumbricht et al. 2017)',
    full: 'Global Forest Watch, "Global peatland extent" (gfw_peatlands v20230315), served as keyless map tiles. In the tropics: T. Gumbricht et al., "An expert system model for mapping tropical wetlands and peatlands reveals South America as the largest contributor," Global Change Biology 23(9):3581–3599, 2017 (CIFOR Tropical and Subtropical Wetlands Distribution v2, 232 m). A soil-type map, not a peat-depth or water-table map.',
    url: 'https://data-api.globalforestwatch.org/dataset/gfw_peatlands',
  },
  worldcover: {
    short: 'ESA WorldCover 2021',
    full: 'D. Zanaga et al., ESA WorldCover 10 m 2021 v200, 2022 (doi:10.5281/zenodo.7254221), CC BY 4.0. Read through the Microsoft Planetary Computer tile API. Oil palm and acacia plantations are classed as tree cover.',
    url: 'https://esa-worldcover.org/',
  },
  gfas: {
    short: 'Kaiser et al. 2012 (GFAS)',
    full: 'J. W. Kaiser et al., "Biomass burning emissions estimated with a global fire assimilation system based on observed fire radiative power," Biogeosciences 9:527–554, 2012. Table 2, conversion factors from fire radiative energy to dry matter, kg/MJ: peat 5.87, tropical forest 0.96, savanna 0.78, agriculture 0.29 (Wooster et al. 2005 universal factor: 0.368). The paper notes that for peat the bulk of combustion is underground, out of the satellite\u2019s view.',
    url: 'https://doi.org/10.5194/bg-9-527-2012',
  },
  ipccFire2006: {
    short: 'IPCC 2006 Vol. 4, Table 2.5',
    full: 'IPCC 2006 Guidelines for National Greenhouse Gas Inventories, Vol. 4 (AFOLU), ch. 2, Eq. 2.27 and Table 2.5 (after Andreae and Merlet 2001), g per kg dry matter burnt: tropical forest CO2 1580 ± 90, CH4 6.8 ± 2.0; savanna and grassland CO2 1613 ± 95, CH4 2.3 ± 0.9; agricultural residues CO2 1515 ± 177, CH4 2.7.',
    url: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/4_Volume4/V4_02_Ch2_Generic.pdf',
  },
  konecny: {
    short: 'Konecny et al. 2016',
    full: 'K. Konecny et al., "Variable carbon losses from recurrent fires in drained tropical peatlands," Global Change Biology 22(4):1469–1480, 2016. Recurrent fires on drained peat in the ex-Mega Rice Project, Central Kalimantan. Table 3: relative burn depth 0.17, 0.10, 0.06 and 0.02 m and dry peat consumed 206, 115, 69 and 23 t/ha for the first, second, third and fourth-or-later fire on the same ground (58% to 7% of the IPCC Tier 1 default); bulk density 0.121 ± 0.018 g/cm³ (first fire) and 0.115 ± 0.020 (later), carbon content 55.3 ± 4.2%, combustion efficiency 1.0. Deeper burns and more repeat fires closer to drainage canals. One drained site.',
    url: 'https://doi.org/10.1111/gcb.13186',
  },
  ritzema: {
    short: 'Ritzema et al. 2014',
    full: 'H. P. Ritzema, S. Limin, K. Kusin, J. Jauhiainen and H. Wösten, "Canal blocking strategies for hydrological restoration of degraded tropical peatlands in Central Kalimantan, Indonesia," Catena 114:11–20, 2014 (doi:10.1016/j.catena.2013.10.009). Table 4, Kalampangan Canal (15–20 m wide, 3–4 m deep), Block C of the ex-Mega Rice Project, mean of four transects Sep 2004 – Apr 2007: dry-season (Jul–Oct) water table 0.88, 0.54, 0.35 and 0.33 m below the surface at 10, 100, 400 and 1000 m from the canal (rainy season 0.50, 0.13, 0.05, 0.06 m). The text: the water table close to the canal is 0.40–0.50 m deeper than 1000 m away.',
    url: 'https://edepot.wur.nl/282926',
  },
  evans2019: {
    short: 'Evans et al. 2019',
    full: 'C. D. Evans et al., "Rates and spatial variability of peat subsidence in Acacia plantation and forest landscapes in Sumatra, Indonesia," Geoderma 338:410–421, 2019 (doi:10.1016/j.geoderma.2018.12.028). In forest next to drained plantations, mean water-table depth and subsidence fall log-linearly with distance from the forest/plantation boundary (usually a canal), Eq. 5 and Fig. 3: "a clear effect of plantation canals on water table drawdown and subsidence within native forest areas within 300 m of the plantation boundary, whilst evidence of effects beyond that distance is equivocal".',
    url: 'https://nora.nerc.ac.uk/id/eprint/522239/',
  },
  osm: {
    short: 'OpenStreetMap',
    full: 'OpenStreetMap contributors (ODbL), queried through the Overpass API. Mapped features only; a missing helipad or fire station may simply be unmapped.',
    url: 'https://www.openstreetmap.org/copyright',
  },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;

/** Fuels that can burn and need per-fuel production rates. */
export const BURNABLE: FuelId[] = ['grass', 'shrub', 'peat', 'plantation', 'agri'];
export type PerFuel = Record<'grass' | 'shrub' | 'peat' | 'plantation' | 'agri', number>;

export interface Rates {
  /** Dozer control-line production, chains (20.1 m) per hour, by fuel. */
  dozerChPerH: PerFuel;
  /** One hand crew's line / direct-attack production, chains per hour, by fuel. */
  crewChPerH: PerFuel;
  /** Fine fuel consumed in the flaming front, kg/m², by fuel (for Byram intensity). */
  fuelLoadKgM2: PerFuel;
  /** Low heat of combustion, kJ/kg. */
  heatKJkg: number;
  /** Flame-length limits for tactics (m). */
  crewMaxFlameM: number;
  equipMaxFlameM: number;
  headMaxFlameM: number;
  /** Helicopter bucket work. */
  heliCruiseKmh: number;
  heliTurnMin: number;
  bucketL: number;
  /** One-way distance from the fire to the bucket dip site (km). */
  dipKm: number;
  /** Litres per hectare that knock down a surface fire. */
  coverageLPerHa: number;
  /** Share of the surface knockdown effect that also stops a smouldering-peat cell. */
  peatKnockdown: number;
  crewSize: number;
  groundKmh: number;
  /** Peat injection (suntik gambut). */
  lancesPerCrew: number;
  lanceLph: number;
  injectLPerHa: number;
  /** Speed-up from ~1% wetting agent / foam in the water. */
  foamMul: number;
  /** Pumping from bored wells to soak peat ahead of the fire. */
  pumpLpm: number;
  soakLPerHa: number;
  /** Cloud seeding (OMC): delay to rain, rain duration and intensity where it works. */
  seedLagH: number;
  seedRainH: number;
  seedRainMmH: number;
  /** Share of runs in which seeding adds rain, by BMKG cloud potential. */
  seedChanceHigh: number;
  seedChanceMedium: number;
  /** Dry ice: delay and how long one sortie keeps the haze open for helicopters. */
  dryIceLagH: number;
  dryIceClearH: number;
  /** Peat burnt per hectare of tropical peat wildfire (IPCC Tier 1, M_B × C_f), t dry matter/ha. */
  peatBurntTdmHa: number;
  /** Emission factors for tropical organic-soil fire, g per kg dry matter. */
  peatCo2cGkg: number;
  peatCh4Gkg: number;
  /** 100-year global warming potential of non-fossil methane. */
  ch4Gwp100: number;
  /**
   * Fuel-break strength (FireState.brk, 0..1) of a mapped narrow waterway (ditch, drain, stream)
   * and of a minor road or track. Applied when a scenario is built from the OSM snapshot.
   * Optional: rates stored in records made before 24 Oct 2026 do not have them.
   */
  brkNarrowWater?: number;
  brkTrack?: number;
  /**
   * Drained peat: spread hazard on peat-soil cells is multiplied by 1 + drainK·exp(−d / drainLM),
   * d = metres to the nearest canal, ditch or drain (Landscape.drainM). Only scenarios that carry
   * drainM use it. Optional for the same reason as above.
   */
  drainK?: number;
  drainLM?: number;
  /**
   * Peat burnt per hectare on ground that FIRMS saw burn in 1, 2, or 3+ earlier years (Konecny et
   * al. 2016, second, third and fourth-or-later fire), t dry matter/ha. Cells with no earlier fire
   * year use peatBurntTdmHa. Used only when the landscape carries fireYears. Optional: rates in
   * records made before 24 Oct 2026 do not have them.
   */
  peatBurnt2ndTdmHa?: number;
  peatBurnt3rdTdmHa?: number;
  peatBurnt4thTdmHa?: number;
  /** Monte Carlo spread of the Konecny classes: relative SD of burn depth and of bulk density. */
  peatDepthRelSd?: number;
  peatBdRelSd?: number;
  /** Monte Carlo spread of the peat emission factors: relative SD of CO2-C and of CH4. */
  peatCo2cRelSd?: number;
  peatCh4RelSd?: number;
  /** Monte Carlo spread of the satellite number: SD of ln(β × holding rule), GFAS conversion. */
  gfasBetaLnSd?: number;
}

export interface RateInfo {
  label: string;
  unit: string;
  source: SourceId | null;
  status: SourceStatus | PerFuelStatus;
  note: string;
}
type PerFuelStatus = Partial<Record<keyof PerFuel, SourceStatus>>;

export const DEFAULT_RATES: Rates = {
  dozerChPerH: { grass: 55, shrub: 20, peat: 15, plantation: 35, agri: 55 },
  crewChPerH: { grass: 17, shrub: 6, peat: 3, plantation: 8, agri: 17 },
  fuelLoadKgM2: { grass: 0.4, shrub: 2.0, peat: 1.0, plantation: 1.2, agri: 0.3 },
  heatKJkg: 18000,
  crewMaxFlameM: 1.2,
  equipMaxFlameM: 2.4,
  headMaxFlameM: 3.4,
  heliCruiseKmh: 150,
  heliTurnMin: 3,
  bucketL: 4000,
  dipKm: 5,
  coverageLPerHa: 8000,
  peatKnockdown: 0.3,
  crewSize: 15,
  groundKmh: 30,
  lancesPerCrew: 5,
  lanceLph: 1669,
  injectLPerHa: 200000,
  foamMul: 1.6,
  pumpLpm: 300,
  soakLPerHa: 60000,
  seedLagH: 2,
  seedRainH: 3,
  seedRainMmH: 2,
  seedChanceHigh: 0.6,
  seedChanceMedium: 0.35,
  dryIceLagH: 1,
  dryIceClearH: 6,
  peatBurntTdmHa: 353,
  peatCo2cGkg: 464,
  peatCh4Gkg: 21,
  ch4Gwp100: 27,
  brkNarrowWater: 0.5,
  brkTrack: 0.3,
  drainK: 0.5,
  drainLM: 100,
  peatBurnt2ndTdmHa: 115,
  peatBurnt3rdTdmHa: 69,
  peatBurnt4thTdmHa: 23,
  peatDepthRelSd: 0.4,
  peatBdRelSd: 0.17,
  peatCo2cRelSd: 0.11,
  peatCh4RelSd: 0.44,
  gfasBetaLnSd: 0.6,
};

export const RATE_INFO: Record<keyof Rates, RateInfo> = {
  dozerChPerH: {
    label: 'Dozer line production', unit: 'ch/h', source: 'nwcgDozer',
    status: { grass: 'secondary', shrub: 'secondary', plantation: 'secondary', peat: 'assumption', agri: 'assumption' },
    note: 'Low end of the NWCG range: grass = FM1–2, peat shrub = FM4 brush, plantation = FM6/7/9 litter. Peat swamp uses the FM11–12 slash rate as a placeholder: no published dozer rate on soft peat was found. Rates fall steeply with slope.',
  },
  crewChPerH: {
    label: 'Hand crew line production (per crew)', unit: 'ch/h', source: 'sanDimas',
    status: { grass: 'secondary', agri: 'assumption', shrub: 'assumption', plantation: 'assumption', peat: 'assumption' },
    note: 'Only the short-grass rate is published (Type I crew). Brush, plantation and peat values are placeholders. Peat is set low because smouldering peat needs ~4–6 L of water per kg (Santoso 2021; Mulyasih 2022), so crews must soak, not just scrape.',
  },
  fuelLoadKgM2: {
    label: 'Fuel consumed in flaming front', unit: 'kg/m²', source: null, status: 'assumption',
    note: 'Placeholders loosely based on standard fuel-model loadings. Used only for the flame-length estimate. Peat counts the surface layer (litter, ferns), not the peat itself.',
  },
  heatKJkg: { label: 'Heat of combustion', unit: 'kJ/kg', source: 'byram', status: 'secondary', note: 'Standard value used with Byram’s intensity I = H·w·R.' },
  crewMaxFlameM: { label: 'Hand crews at the head up to', unit: 'm flame', source: 'irpg', status: 'verified', note: 'IRPG p. 50 / Andrews & Rothermel 1982: < 4 ft (1.2 m), hand tools at the head or flanks; handline should hold.' },
  equipMaxFlameM: { label: 'Equipment / aircraft effective up to', unit: 'm flame', source: 'irpg', status: 'verified', note: 'IRPG p. 50: 4–8 ft (1.2–2.4 m), too hot for hand tools at the head; dozers, engines and retardant aircraft can be effective.' },
  headMaxFlameM: { label: 'Head control ineffective above', unit: 'm flame', source: 'irpg', status: 'verified', note: 'IRPG p. 50: 8–11 ft (2.4–3.4 m) head control probably ineffective; > 11 ft (3.4 m) ineffective (crowning, major runs).' },
  heliCruiseKmh: { label: 'Helicopter speed with bucket', unit: 'km/h', source: null, status: 'assumption', note: 'Set from your aircraft. A slung bucket limits airspeed.' },
  heliTurnMin: { label: 'Dip + drop + approach time', unit: 'min/cycle', source: null, status: 'assumption', note: 'No published productivity study found (NWCG PMS 510 gives no cycle times). Calibrate locally.' },
  bucketL: { label: 'Bucket capacity', unit: 'L', source: null, status: 'assumption', note: 'Set from your aircraft and bucket.' },
  dipKm: { label: 'Distance fire → dip site', unit: 'km', source: 'osm', status: 'assumption', note: 'Filled from the nearest mapped river / canal / lake in OpenStreetMap when available; otherwise a placeholder.' },
  coverageLPerHa: { label: 'Water to knock down 1 ha of surface fire', unit: 'L/ha', source: null, status: 'assumption', note: 'About 0.8 L/m². Placeholder; heavier fuels need more.' },
  peatKnockdown: { label: 'Effect of water drops on smouldering peat', unit: '× surface', source: 'santoso', status: 'assumption', note: 'Surface drops deliver ~1 L/m² while smouldering peat needs ~4–6 L per kg of peat (Santoso 2021; Mulyasih 2022), so drops mostly stop surface flame, not the peat underneath.' },
  crewSize: { label: 'People per crew (regu)', unit: 'people', source: null, status: 'assumption', note: 'Set to your unit’s regu size.' },
  groundKmh: { label: 'Ground travel speed to the fire', unit: 'km/h', source: null, status: 'assumption', note: 'Used only to estimate travel time from the nearest base.' },
  lancesPerCrew: { label: 'Peat injectors per crew', unit: 'lances', source: 'p32', status: 'verified', note: 'P.32/2016 regu kit includes 5 peat injectors ("suntikan gambut").' },
  lanceLph: { label: 'Flow per peat injector', unit: 'L/h', source: 'csiroLance', status: 'secondary', note: 'Field lance injection measured at ~1,669 L/h, 13–15 h per pit.' },
  injectLPerHa: { label: 'Water to put out 1 ha of smouldering peat', unit: 'L/ha', source: 'santoso', status: 'assumption', note: 'Lab: 5.7 ± 2.1 L per kg of peat (Santoso 2021); experts extrapolate 200,000–1,000,000 L/ha. Uses the low end. With 1 crew this gives ~1 ha per day, in line with reported field progress (1–3 ha/day).' },
  foamMul: { label: 'Speed-up with wetting agent / foam', unit: '×', source: 'santoso', status: 'secondary', note: 'Lab: 1% wetting agent cut suppression time by 39% (×1.6). Field effect not measured.' },
  pumpLpm: { label: 'Pump flow from a bored well', unit: 'L/min', source: null, status: 'assumption', note: 'Mark-3 class pump gives ~300 L/min at 100 psi (maker spec). Bored-well yield was not found; a weak well limits this.' },
  soakLPerHa: { label: 'Water to soak 1 ha of peat ahead of the fire', unit: 'L/ha', source: null, status: 'assumption', note: 'No published value found. Placeholder for wetting the top layer enough to slow ignition.' },
  seedLagH: { label: 'Seeding: hours until rain', unit: 'h', source: 'bmkgOmc', status: 'assumption', note: 'Time from NaCl seeding to rain was not found in BMKG reports. Placeholder.' },
  seedRainH: { label: 'Seeding: hours of rain', unit: 'h', source: 'bmkgOmc', status: 'assumption', note: 'Not reported. Placeholder.' },
  seedRainMmH: { label: 'Seeding: rain rate', unit: 'mm/h', source: 'bmkgOmc', status: 'assumption', note: 'BMKG reports only "light to moderate" rain; BMKG classes light rain as about 1–5 mm/h.' },
  seedChanceHigh: { label: 'Seeding works (high cloud potential)', unit: 'share of runs', source: 'bmkgClouds', status: 'assumption', note: 'Riau 2021 evaluation reported +33–64% rain over natural in one phase and ~2% in another. Placeholder probability.' },
  seedChanceMedium: { label: 'Seeding works (medium cloud potential)', unit: 'share of runs', source: 'bmkgClouds', status: 'assumption', note: 'Placeholder. With low cloud potential the model gives seeding no effect (BMKG: OMC fails when clouds do not form).' },
  dryIceLagH: { label: 'Dry ice: hours until haze opens', unit: 'h', source: 'bnpbDryIce', status: 'secondary', note: 'Visibility improved the same day in Sumsel (Oct 2026).' },
  dryIceClearH: { label: 'Dry ice: hours haze stays open per sortie', unit: 'h', source: 'bnpbDryIce', status: 'assumption', note: 'How long the effect lasted was not reported. BMKG said its effectiveness is not yet established.' },
  peatBurntTdmHa: { label: 'Peat burnt per hectare: no fire seen since 2001', unit: 't dry matter/ha', source: 'ipccWetlands', status: 'verified', note: 'Table 2.6, tropical wildfire on drained peat: 353 (95% CI 170–536), from 1997–2006 El Niño burns of 0.3–0.5 m, mostly on ground burning for the first time since drainage. Used for burned peat cells where FIRMS saw no fire in any earlier year since 2001 (MODIS-era history can miss older fires, and a first burn goes deeper), and for every peat cell in records made without fire history. The 95% CI enters the Monte Carlo range as a normal distribution (SD 93 t/ha). Counted once per burned peat cell, for the whole fire event, not only the hours shown.' },
  peatBurnt2ndTdmHa: { label: 'Peat burnt per hectare: 1 earlier fire year', unit: 't dry matter/ha', source: 'konecny', status: 'verified', note: 'Konecny et al. 2016, Table 3, second fire on the same ground: 0.10 m relative burn depth × bulk density 0.115 g/cm³ × combustion efficiency 1.0 = 115 t/ha. Used for burned peat cells where FIRMS saw fire in exactly one earlier calendar year. One drained site (ex-Mega Rice Project, Central Kalimantan). A FIRMS detection is not a burned-area map: an old detection may not have burned the whole cell, which makes this class too shallow there.' },
  peatBurnt3rdTdmHa: { label: 'Peat burnt per hectare: 2 earlier fire years', unit: 't dry matter/ha', source: 'konecny', status: 'verified', note: 'Konecny et al. 2016, Table 3, third fire: 0.06 m × 0.115 g/cm³ = 69 t/ha. Same caveats as the 1-year class.' },
  peatBurnt4thTdmHa: { label: 'Peat burnt per hectare: 3+ earlier fire years', unit: 't dry matter/ha', source: 'konecny', status: 'verified', note: 'Konecny et al. 2016, Table 3, fourth and later fires: 0.02 m × 0.115 g/cm³ = 23 t/ha. Same caveats as the 1-year class.' },
  peatDepthRelSd: { label: 'Burn depth spread, repeat-fire classes', unit: 'relative SD', source: 'konecny', status: 'assumption', note: 'Konecny et al. 2016 measured one drained site; how well its class depths transfer to another site is not published. 0.4 is our placeholder (log-normal, mean kept), shared by the three repeat-fire classes in each Monte Carlo draw.' },
  peatBdRelSd: { label: 'Peat bulk density spread', unit: 'relative SD', source: 'konecny', status: 'verified', note: 'Konecny et al. 2016: 0.115 ± 0.020 g/cm³ after the first fire (0.121 ± 0.018 before), so about 17%. Normal, shared by the repeat-fire classes in each Monte Carlo draw. Combustion efficiency is 1.0 in the paper and is not varied.' },
  peatCo2cRelSd: { label: 'CO2-C emission factor spread', unit: 'relative SD', source: 'ipccWetlands', status: 'assumption', note: 'Table 2.7 gives no uncertainty for the tropical factors, which come from one study (Christian et al. 2003). We borrow the boreal/temperate 95% half-width (362 ± 41 g/kg, 11%) and use it as one standard deviation, wider than its source. Normal, truncated at 0.' },
  peatCh4RelSd: { label: 'CH4 emission factor spread', unit: 'relative SD', source: 'ipccWetlands', status: 'assumption', note: 'As for CO2-C: the boreal/temperate CH4 factor is 9 ± 4 g/kg (44%), used here as one standard deviation for the single-study tropical 21 g/kg. Normal, truncated at 0, independent of CO2-C.' },
  gfasBetaLnSd: { label: 'Satellite number spread (β and holding rule)', unit: 'SD of ln', source: 'gfas', status: 'assumption', note: 'Kaiser et al. 2012 give the GFAS conversion factors without an uncertainty (fitted by regression to GFED3.1; for tropical Asia they call peat combustion estimates intrinsically very uncertain). Our cross-check of this method against GFED4.1s on 15 busy 0.25° cells (docs/emissions-crosscheck.md) found per-cell ratios of 0.6–4.0 with an SD of ln(ratio) of 0.6, so 0.6 it is: about ×/÷ 2.7 at 90%. Log-normal centred on the point value.' },
  peatCo2cGkg: { label: 'Peat fire CO2-C emission factor', unit: 'g C/kg', source: 'ipccWetlands', status: 'verified', note: 'Table 2.7, tropical organic soil. Multiplied by 44/12 to give CO2 (1,701 g/kg).' },
  peatCh4Gkg: { label: 'Peat fire CH4 emission factor', unit: 'g/kg', source: 'ipccWetlands', status: 'verified', note: 'Table 2.7, tropical organic soil. Based on one study (Christian et al. 2003).' },
  brkNarrowWater: {
    label: 'Ditch / drain / stream as a fuel break', unit: 'strength 0–1', source: 'osm', status: 'assumption',
    note: 'Narrow mapped waterways (OSM ditch, drain, stream; typically 1–5 m) slow spread into their cell by about this share, instead of becoming non-burnable water cells as canals and rivers do: a 100 m cell is mostly land, and a dry ditch or one the smouldering peat passes under does not stop a peat fire. No published crossing probability was found. Applied when the scenario is built.',
  },
  brkTrack: {
    label: 'Minor road / track as a fuel break', unit: 'strength 0–1', source: 'osm', status: 'assumption',
    note: 'Minor roads and tracks (OSM unclassified, residential, service, track) are bare strips a few metres wide: partial fuel breaks. Major roads stay non-burnable. No published value; placeholder. The snapshot keeps minor roads only on peat. Applied when the scenario is built.',
  },
  drainK: {
    label: 'Drained peat: extra spread hazard next to a canal', unit: '× (1 + k)', source: 'konecny', status: 'assumption',
    note: 'Canals lower the peat water table (Ritzema 2014: 0.55 m deeper at 10 m than at 1 km in the dry season) and burns are deeper and repeat more often near canals (Konecny 2016). How much faster fire spreads on drier peat has no published value: k = 0.5 means up to 1.5× the hazard on peat soil beside a canal, ditch or drain. Not tuned on the hindcast events.',
  },
  drainLM: {
    label: 'Drained peat: distance scale of the canal effect', unit: 'm', source: 'ritzema', status: 'verified',
    note: 'Our exponential fit to Ritzema et al. 2014 Table 4 (dry season): the extra water-table drop beyond its 1 km value is 0.55, 0.21 and 0.02 m at 10, 100 and 400 m, an e-folding distance of about 100 m. One 15–20 m canal in Central Kalimantan; small ditches drain less. Evans et al. 2019 found a clear drawdown within about 300 m of plantation canals in Sumatra, so 100 m is the short end.',
  },
  ch4Gwp100: { label: 'Methane warming potential (100 yr)', unit: '× CO2', source: 'ar6Gwp', status: 'secondary', note: 'Non-fossil methane, AR6 Table 7.15. Value seen quoted (GHG Management Institute; Muñoz 2024, ERL 19:121002), not read in the table itself.' },
};

/** The rates that set how much an action changes the fire. Used to tell measured effects from guesses. */
const EFFECT_RATES: Partial<Record<string, (keyof Rates)[]>> = {
  seeding: ['seedLagH', 'seedRainH', 'seedRainMmH', 'seedChanceHigh', 'seedChanceMedium'],
};

/**
 * 'speculative' when every rate behind an action's effect is an assumption (no published
 * value). Such actions are still simulated and shown, but they are kept out of the combined
 * strategy: ranking a placeholder above a measured tactic would be a guess dressed as a result.
 */
export function effectEvidence(kind: string): 'measured' | 'speculative' {
  const keys = EFFECT_RATES[kind];
  if (!keys) return 'measured';
  return keys.every((k) => RATE_INFO[k].status === 'assumption') ? 'speculative' : 'measured';
}

export const CHAIN_M = 20.1168;

/** Production in cells per hour for a rate in chains per hour. */
export const chainsToCells = (chPerH: number, cellM: number) => (chPerH * CHAIN_M) / cellM;

/** Helicopter bucket drops per hour: 60 / (round-trip flight + dip/drop time). Derived model, not a published rule. */
export function dropsPerHeliHour(r: Pick<Rates, 'dipKm' | 'heliCruiseKmh' | 'heliTurnMin'>): number {
  const flightMin = ((2 * Math.max(0, r.dipKm)) / Math.max(10, r.heliCruiseKmh)) * 60;
  return 60 / (flightMin + Math.max(0.5, r.heliTurnMin));
}

/** Byram flame length (m) from fireline intensity (kW/m). */
export const flameLengthM = (intensityKWm: number, m: Pick<MathLib, 'pow'> = Math) => 0.0775 * m.pow(Math.max(0, intensityKWm), 0.46);

/** IRPG / Andrews & Rothermel interpretation of a flame length. */
export function flameBand(L: number, r: Pick<Rates, 'crewMaxFlameM' | 'equipMaxFlameM' | 'headMaxFlameM'>): { band: 0 | 1 | 2 | 3; text: string } {
  if (L < r.crewMaxFlameM) return { band: 0, text: 'hand crews can work the head or flanks' };
  if (L < r.equipMaxFlameM) return { band: 1, text: 'too hot for hand tools at the head; dozers and aircraft can be effective' };
  if (L < r.headMaxFlameM) return { band: 2, text: 'head control probably ineffective; work the flanks' };
  return { band: 3, text: 'head control ineffective' };
}

export const perFuel = (m: PerFuel, f: FuelId): number => (f in m ? m[f as keyof PerFuel] : 0);

/** Doctrine the recommender applies, each with its source. Shown in the UI and sent to the LLM brief. */
export const DOCTRINE: { id: string; rule: string; source: SourceId; status: SourceStatus }[] = [
  { id: 'flame', rule: 'Choose the tactic by flame length: < 1.2 m hand crews at the head; 1.2–2.4 m dozers, engines and aircraft; > 2.4 m head control probably ineffective, > 3.4 m ineffective.', source: 'andrewsRothermel', status: 'verified' },
  { id: 'direct', rule: 'Use direct attack whenever possible (Firefighting Order 4). An indirect control line must be completed and held before the fire arrives, so place it far enough out given the predicted spread.', source: 'irpg', status: 'verified' },
  { id: 'anchor', rule: 'Anchor every line; building line without a safe anchor point is Watch-Out Situation 8.', source: 'irpg', status: 'verified' },
  { id: 'lces', rule: 'Before crews engage: Lookouts, Communications, Escape routes, Safety zones (LCES), known to all firefighters. Escape time must be shorter than the time the fire needs to arrive.', source: 'irpg', status: 'verified' },
  { id: 'peat-water', rule: 'Smouldering peat needs about 4–6 L of water per kg of peat; injecting water into the peat works better than spraying the surface.', source: 'santoso', status: 'verified' },
  { id: 'regu', rule: 'Each Manggala Agni regu carries pumps (1 main, 3 portable, 2 floating), 5 nozzles and 5 peat injectors ("suntikan gambut"). Daops Manggala Agni executes operations.', source: 'p32', status: 'verified' },
  { id: 'aerial', rule: 'Aerial suppression and TNI/POLRI support are deployed in emergency status or at a Governor’s request. Command escalates to the Bupati (2+ kecamatan), Governor (2+ kabupaten) and Minister (2+ provinces).', source: 'p32', status: 'verified' },
  { id: 'omc', rule: 'Cloud seeding (OMC) only works when rain clouds can grow; it does not replace patrols and ground work.', source: 'bmkgClouds', status: 'secondary' },
  { id: 'dryice', rule: 'Dry ice breaks the haze inversion so aircraft can fly again; it makes no rain. Its effect is still being evaluated.', source: 'bnpbDryIce', status: 'secondary' },
  { id: 'rewet', rule: 'Keep the peat water table no deeper than 0.4 m; bored wells and canal blocks wet a few hundred metres around them.', source: 'ppGambut', status: 'secondary' },
  { id: 'allocation', rule: 'Allocate whole resource units to minimise suppression cost plus loss, within what is actually available. The recommender approximates this by simulating each option and ranking by saved value.', source: 'donovan', status: 'verified' },
];
