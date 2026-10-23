// Where the numbers and rules come from.
//
// Every production rate, threshold and logistics constant the simulator uses lives
// here with its source and how well that source was checked:
//   verified   – read in the primary document
//   secondary  – the value is published, but we only saw it quoted in another source
//   assumption – no published value found; our placeholder, meant to be overridden
// The UI shows the status next to each number and lets the user edit it.

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
  peatBurntTdmHa: { label: 'Peat burnt per hectare of fire', unit: 't dry matter/ha', source: 'ipccWetlands', status: 'verified', note: 'Table 2.6, tropical wildfire on drained peat: 353 (95% CI 170–536). The range mostly reflects burn depth. Counted once per burned peat cell, for the whole fire event, not only the 48 h shown.' },
  peatCo2cGkg: { label: 'Peat fire CO2-C emission factor', unit: 'g C/kg', source: 'ipccWetlands', status: 'verified', note: 'Table 2.7, tropical organic soil. Multiplied by 44/12 to give CO2 (1,701 g/kg).' },
  peatCh4Gkg: { label: 'Peat fire CH4 emission factor', unit: 'g/kg', source: 'ipccWetlands', status: 'verified', note: 'Table 2.7, tropical organic soil. Based on one study (Christian et al. 2003).' },
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
export const flameLengthM = (intensityKWm: number) => 0.0775 * Math.pow(Math.max(0, intensityKWm), 0.46);

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
