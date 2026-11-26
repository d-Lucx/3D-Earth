export type DeepTimeEraId =
  | 'accretion'
  | 'hadean'
  | 'archean'
  | 'snowball'
  | 'pangaea'
  | 'cretaceous';

export type StoryBeaconAction =
  | 'theia-impact'
  | 'bombardment-strike'
  | 'stromatolite-plume'
  | 'volcanic-rift-melt'
  | 'himalayan-uplift'
  | 'chicxulub-impact';

export interface StoryBeacon {
  id: string;
  eraId: DeepTimeEraId;
  name: string;
  region: string;
  lat: number;
  lon: number;
  ageLabel: string;
  metricLabel: string;
  metricValue: string;
  summary: string;
  accentColor: string;
  action: StoryBeaconAction;
}

export interface SpatialFieldCheck {
  prompt: string;
  hint: string;
  targetLat: number;
  targetLon: number;
  toleranceDeg: number;
  targetName: string;
  explanation: string;
}

export interface DeepTimeShaderTarget {
  /** 0 = solid crust, 1 = incandescent molten magma ocean */
  magmaFactor: number;
  /** 0 = modern polar caps, 1 = equatorial Cryogenian ice sheet */
  iceCoverage: number;
  /** 0 = modern ocean albedo, 1 = shifted ancient ocean chemistry */
  oceanTintStrength: number;
  /** RGB tint for ancient ocean chemistry (e.g. iron-rich Archean green-teal) */
  oceanTintRgb: [number, number, number];
  /** 0 = Rayleigh blue, 1 = dense Hadean/Archean amber-orange greenhouse haze */
  atmosphereHue: number;
  /** Cloud opacity multiplier for era */
  cloudScale: number;
  /** 0 = modern continents, 1 = early craton / magma crust masking */
  ancientSurfaceMix: number;
  /** 0 = clear, 1 = K-Pg global impact soot/ash cloud */
  ashFactor: number;
  /** Banded iron rusting & cyan oxygen bloom intensity */
  oxidationFactor: number;
  /** Allow night-side modern city lights */
  allowCityLights: boolean;
}

export interface DeepTimeSandboxDefaults {
  axialTiltDeg: number;
  co2Multiplier: number; // 0.2x .. 10x
  lunarDistanceRe: number; // Earth radii (normal modern = 60, visual scaled 0.4..1.5)
  driftProgress: number; // 0 = Pangaea, 1 = Modern
  riftMeltProgress: number; // 0 = frozen Snowball, 1 = volcanic thaw
}

export interface DeepTimeChapter {
  id: DeepTimeEraId;
  index: number;
  title: string;
  shortTitle: string;
  timeframe: string;
  cosmicClockTime: string;
  /** Normalized 0..1 position along the 24-Hour Cosmic Clock */
  cosmicClockNorm: number;
  accentColor: string;
  summary: string;
  educationalFocus: string;
  keyStats: { label: string; value: string }[];
  actionButtonLabel: string;
  defaultAction: StoryBeaconAction;
  cameraFocus: { lat: number; lon: number; distance: number };
  shader: DeepTimeShaderTarget;
  sandboxDefaults: DeepTimeSandboxDefaults;
  beacons: StoryBeacon[];
  fieldCheck: SpatialFieldCheck;
}

export interface CosmicClockMilestone {
  time: string;
  label: string;
  norm: number;
  eraId: DeepTimeEraId;
}

export const COSMIC_CLOCK_MILESTONES: CosmicClockMilestone[] = [
  { time: '00:00', label: 'Earth Forms', norm: 0.0, eraId: 'accretion' },
  { time: '01:30', label: 'Oceans Condense', norm: 0.062, eraId: 'hadean' },
  { time: '04:00', label: 'First Life', norm: 0.167, eraId: 'archean' },
  { time: '12:54', label: 'Great Oxidation', norm: 0.538, eraId: 'archean' },
  { time: '20:11', label: 'Snowball Earth', norm: 0.841, eraId: 'snowball' },
  { time: '22:13', label: 'Pangaea', norm: 0.926, eraId: 'pangaea' },
  { time: '23:39', label: 'K–Pg Impact', norm: 0.985, eraId: 'cretaceous' },
  { time: '23:59:56', label: 'Humans', norm: 1.0, eraId: 'cretaceous' },
];

export const EARTH_INTERIOR_LAYERS = [
  {
    name: 'Solid Inner Core',
    depthRange: '5,150 – 6,371 km',
    temp: '~5,500 °C',
    color: '#fef08a',
    detail: 'Crystalline iron-nickel alloy compressed solid at 360 GPa.',
  },
  {
    name: 'Liquid Outer Core',
    depthRange: '2,890 – 5,150 km',
    temp: '4,000 – 5,000 °C',
    color: '#f97316',
    detail: 'Convecting molten Fe–Ni dynamo generating Earth’s dipole magnetic field.',
  },
  {
    name: 'Silicate Mantle',
    depthRange: '35 – 2,890 km',
    temp: '1,000 – 3,700 °C',
    color: '#b91c1c',
    detail: 'Viscoplastic magnesium-iron silicate rock driving plate tectonics.',
  },
  {
    name: 'Lithospheric Crust',
    depthRange: '0 – 35 km',
    temp: '-50 – 900 °C',
    color: '#38bdf8',
    detail: 'Brittle basaltic oceanic plates and buoyant granitic continental cratons.',
  },
] as const;

export const DEEP_TIME_CHAPTERS: DeepTimeChapter[] = [
  {
    id: 'accretion',
    index: 1,
    title: 'Accretion & Theia Impact',
    shortTitle: 'Accretion',
    timeframe: '4.54 – 4.50 Ga',
    cosmicClockTime: '00:00 – 00:13',
    cosmicClockNorm: 0.008,
    accentColor: '#fb923c',
    summary:
      'Proto-Earth coalesced from colliding planetesimals into a global magma ocean. Roughly 45 million years in, an oblique collision with Mars-sized Theia vaporized outer silicate layers into a glowing debris ring that accreted into the Moon.',
    educationalFocus:
      'Protoplanetary accretion, iron-core differentiation, and the Giant-Impact hypothesis.',
    keyStats: [
      { label: 'Surface Temp', value: '~2,200 °C' },
      { label: 'Day Length', value: '5.5 hrs' },
      { label: 'Moon Orbit', value: '~24,000 km' },
    ],
    actionButtonLabel: 'Replay Theia Impact',
    defaultAction: 'theia-impact',
    cameraFocus: { lat: 12, lon: 22, distance: 3.15 },
    shader: {
      magmaFactor: 1.0,
      iceCoverage: 0.0,
      oceanTintStrength: 0.0,
      oceanTintRgb: [0.06, 0.25, 0.45],
      atmosphereHue: 1.0,
      cloudScale: 0.12,
      ancientSurfaceMix: 1.0,
      ashFactor: 0.15,
      oxidationFactor: 0.0,
      allowCityLights: false,
    },
    sandboxDefaults: {
      axialTiltDeg: 23.4,
      co2Multiplier: 8.5,
      lunarDistanceRe: 0.48,
      driftProgress: 0.0,
      riftMeltProgress: 0.0,
    },
    beacons: [
      {
        id: 'beacon-theia-impact',
        eraId: 'accretion',
        name: 'Theia Oblique Impact Basin',
        region: 'Equatorial Proto-Mantle',
        lat: 14.0,
        lon: 28.0,
        ageLabel: '4.50 Ga',
        metricLabel: 'Impact Velocity',
        metricValue: '10.8 km/s',
        summary:
          'Glancing 45° collision ejects iron-depleted mantle silicate into Roche-limit orbit, forming the proto-lunar disk.',
        accentColor: '#fb923c',
        action: 'theia-impact',
      },
      {
        id: 'beacon-core-diff',
        eraId: 'accretion',
        name: 'Iron Catastrophe Diapir',
        region: 'Global Magma Ocean',
        lat: -18.0,
        lon: -42.0,
        ageLabel: '4.52 Ga',
        metricLabel: 'Core Sinking Heat',
        metricValue: '+1,800 K',
        summary:
          'Dense liquid iron-nickel droplets sink through molten silicate toward Earth’s center, igniting the early geodynamo.',
        accentColor: '#f59e0b',
        action: 'theia-impact',
      },
    ],
    fieldCheck: {
      prompt: 'Click the equatorial impact zone where Theia struck proto-Earth obliquely.',
      hint: 'Look near the bright equatorial magma basin around 14° N, 28° E.',
      targetLat: 14.0,
      targetLon: 28.0,
      toleranceDeg: 26,
      targetName: 'Theia Impact Basin',
      explanation:
        'An oblique equatorial-latitude strike imparted Earth’s rapid initial spin and lofted enough mantle material past the Roche limit to form our unusually large Moon.',
    },
  },
  {
    id: 'hadean',
    index: 2,
    title: 'Hadean Cooling & Bombardment',
    shortTitle: 'Hadean',
    timeframe: '4.40 – 3.80 Ga',
    cosmicClockTime: '00:44 – 03:54',
    cosmicClockNorm: 0.09,
    accentColor: '#f59e0b',
    summary:
      'As the magma crust quenched into dark basalt, volcanic outgassing built a crushing amber CO₂ and steam atmosphere that condensed into Earth’s first oceans—even as Late Heavy Bombardment asteroids hammered the young crust.',
    educationalFocus:
      'Jack Hills zircon evidence for early liquid water, volcanic outgassing, and planetary bombardment.',
    keyStats: [
      { label: 'Atm Pressure', value: '~60 bar' },
      { label: 'Oldest Zircon', value: '4.404 Ga' },
      { label: 'Ocean Temp', value: '~70 °C' },
    ],
    actionButtonLabel: 'Trigger Asteroid Barrage',
    defaultAction: 'bombardment-strike',
    cameraFocus: { lat: -14, lon: 112, distance: 2.85 },
    shader: {
      magmaFactor: 0.42,
      iceCoverage: 0.0,
      oceanTintStrength: 0.72,
      oceanTintRgb: [0.16, 0.27, 0.24],
      atmosphereHue: 0.85,
      cloudScale: 0.88,
      ancientSurfaceMix: 0.78,
      ashFactor: 0.25,
      oxidationFactor: 0.0,
      allowCityLights: false,
    },
    sandboxDefaults: {
      axialTiltDeg: 23.4,
      co2Multiplier: 7.0,
      lunarDistanceRe: 0.62,
      driftProgress: 0.0,
      riftMeltProgress: 0.0,
    },
    beacons: [
      {
        id: 'beacon-jack-hills',
        eraId: 'hadean',
        name: 'Jack Hills Zircon Crust',
        region: 'Western Australia',
        lat: -26.2,
        lon: 116.9,
        ageLabel: '4.404 Ga',
        metricLabel: 'Oxygen-18 Signature',
        metricValue: 'Liquid Water',
        summary:
          'Detrital zircon crystals preserve isotopic proof that cool continental crust and liquid oceans existed just 140 Myr after Earth formed.',
        accentColor: '#f59e0b',
        action: 'bombardment-strike',
      },
      {
        id: 'beacon-acasta',
        eraId: 'hadean',
        name: 'Acasta Gneiss Complex',
        region: 'Northwest Territories, Canada',
        lat: 65.1,
        lon: -115.5,
        ageLabel: '4.03 Ga',
        metricLabel: 'Rock Age',
        metricValue: '4.031 Ga',
        summary:
          'The oldest intact felsic bedrock on Earth, forged as primordial basaltic crust melted and differentiated above early subduction zones.',
        accentColor: '#fbbf24',
        action: 'bombardment-strike',
      },
    ],
    fieldCheck: {
      prompt: 'Click Western Australia where 4.4-billion-year-old Jack Hills zircons proved early liquid oceans.',
      hint: 'Target the western margin of Australia (~26° S, 117° E).',
      targetLat: -26.2,
      targetLon: 116.9,
      toleranceDeg: 24,
      targetName: 'Jack Hills, Western Australia',
      explanation:
        'Heavy oxygen isotopes trapped inside microscopic Jack Hills zircons show that their parent magmas interacted with liquid surface water as early as 4.404 Ga.',
    },
  },
  {
    id: 'archean',
    index: 3,
    title: 'Archean Cratons & Great Oxidation',
    shortTitle: 'Archean GOE',
    timeframe: '3.50 – 2.10 Ga',
    cosmicClockTime: '05:30 – 12:54',
    cosmicClockNorm: 0.36,
    accentColor: '#2dd4bf',
    summary:
      'Buoyant granite cratons merged out of iron-rich emerald seas. Along shallow margins, cyanobacteria stromatolites invented oxygenic photosynthesis—rusting dissolved iron into Banded Iron Formations before transforming Earth’s sky and oceans blue.',
    educationalFocus:
      'Early craton assembly, cyanobacteria photosynthesis, Banded Iron Formations, and the Great Oxidation Event.',
    keyStats: [
      { label: 'Atmospheric O₂', value: '0.001 → 2%' },
      { label: 'Ocean Iron', value: 'Fe²⁺ Rich' },
      { label: 'Stromatolites', value: '3.48 Ga' },
    ],
    actionButtonLabel: 'Pulse Oxygen Plumes',
    defaultAction: 'stromatolite-plume',
    cameraFocus: { lat: -18, lon: 75, distance: 2.75 },
    shader: {
      magmaFactor: 0.04,
      iceCoverage: 0.0,
      oceanTintStrength: 0.92,
      oceanTintRgb: [0.07, 0.34, 0.27],
      atmosphereHue: 0.42,
      cloudScale: 0.65,
      ancientSurfaceMix: 0.46,
      ashFactor: 0.0,
      oxidationFactor: 0.85,
      allowCityLights: false,
    },
    sandboxDefaults: {
      axialTiltDeg: 23.4,
      co2Multiplier: 3.5,
      lunarDistanceRe: 0.78,
      driftProgress: 0.0,
      riftMeltProgress: 0.0,
    },
    beacons: [
      {
        id: 'beacon-pilbara',
        eraId: 'archean',
        name: 'Pilbara Stromatolite Reefs',
        region: 'Northwestern Australia',
        lat: -21.2,
        lon: 119.5,
        ageLabel: '3.48 Ga',
        metricLabel: 'O₂ Productivity',
        metricValue: 'Cyanobacteria',
        summary:
          'Ancient shallow-shelf microbial mats trapped sediment into layered domes while releasing oxygen bubbles into anoxic seas.',
        accentColor: '#2dd4bf',
        action: 'stromatolite-plume',
      },
      {
        id: 'beacon-kaapvaal',
        eraId: 'archean',
        name: 'Barberton Greenstone & BIF',
        region: 'Kaapvaal Craton, South Africa',
        lat: -25.8,
        lon: 31.1,
        ageLabel: '3.20 Ga',
        metricLabel: 'Iron Deposit',
        metricValue: 'Fe₂O₃ Bands',
        summary:
          'Oxygen oxidized dissolved ferrous iron in the oceans, precipitating crimson hematite Banded Iron Formations across ancient shelves.',
        accentColor: '#f87171',
        action: 'stromatolite-plume',
      },
    ],
    fieldCheck: {
      prompt: 'Click the Kaapvaal Craton in Southern Africa where Banded Iron Formations recorded ocean oxygenation.',
      hint: 'Look along the southern tip of Africa (~26° S, 31° E).',
      targetLat: -25.8,
      targetLon: 31.1,
      toleranceDeg: 24,
      targetName: 'Barberton Greenstone Belt, South Africa',
      explanation:
        'Banded Iron Formations in South Africa and Western Australia mark the centuries-long chemical reaction as biogenic O₂ scrubbed dissolved iron from Archean seas.',
    },
  },
  {
    id: 'snowball',
    index: 4,
    title: 'Snowball Earth (Cryogenian)',
    shortTitle: 'Snowball',
    timeframe: '720 – 635 Ma',
    cosmicClockTime: '20:11 – 20:38',
    cosmicClockNorm: 0.841,
    accentColor: '#7dd3fc',
    summary:
      'Runaway ice-albedo feedback drove continental glaciers all the way to the tropical oceans, reflecting sunlight back to space. Only millions of years of volcanic CO₂ outgassing through fractured rifts broke the freeze and sparked multicellular evolution.',
    educationalFocus:
      'Ice-albedo runaway feedback loops, Cryogenian glaciation, and volcanic greenhouse recovery.',
    keyStats: [
      { label: 'Mean Temp', value: '-42 °C' },
      { label: 'Planetary Albedo', value: '0.68' },
      { label: 'CO₂ Recovery', value: '~120,000 ppm' },
    ],
    actionButtonLabel: 'Erupt Volcanic Rifts',
    defaultAction: 'volcanic-rift-melt',
    cameraFocus: { lat: 6, lon: 20, distance: 2.75 },
    shader: {
      magmaFactor: 0.0,
      iceCoverage: 0.96,
      oceanTintStrength: 0.1,
      oceanTintRgb: [0.12, 0.34, 0.56],
      atmosphereHue: 0.0,
      cloudScale: 0.38,
      ancientSurfaceMix: 0.15,
      ashFactor: 0.0,
      oxidationFactor: 0.0,
      allowCityLights: false,
    },
    sandboxDefaults: {
      axialTiltDeg: 23.4,
      co2Multiplier: 0.25,
      lunarDistanceRe: 0.92,
      driftProgress: 0.0,
      riftMeltProgress: 0.0,
    },
    beacons: [
      {
        id: 'beacon-franklin-lip',
        eraId: 'snowball',
        name: 'Equatorial Rift Volcanoes',
        region: 'East African & Rodinia Rift',
        lat: 4.5,
        lon: 36.2,
        ageLabel: '635 Ma',
        metricLabel: 'CO₂ Outgassing',
        metricValue: '350× Modern',
        summary:
          'Active volcanic arcs punctured kilometer-thick sea ice, injecting CO₂ unbuffered by silicate weathering until super-greenhouse melt occurred.',
        accentColor: '#fb7185',
        action: 'volcanic-rift-melt',
      },
      {
        id: 'beacon-namibia-cap',
        eraId: 'snowball',
        name: 'Namibia Cap Carbonates',
        region: 'Otavi Platform, Namibia',
        lat: -19.5,
        lon: 15.8,
        ageLabel: '635 Ma',
        metricLabel: 'Glacial Tillite',
        metricValue: 'Tropical Sea Level',
        summary:
          'Tropical marine glacial dropstones directly overlain by warm-water cap carbonates document the abrupt end of the Marinoan glaciation.',
        accentColor: '#7dd3fc',
        action: 'volcanic-rift-melt',
      },
    ],
    fieldCheck: {
      prompt: 'Click the equatorial East African volcanic rift beacon to fracture the ice sheet with CO₂ outgassing.',
      hint: 'Target the glowing red rift beacon near East Africa (~4° N, 36° E).',
      targetLat: 4.5,
      targetLon: 36.2,
      toleranceDeg: 24,
      targetName: 'Equatorial Volcanic Rift Zone',
      explanation:
        'With oceans sealed beneath ice, volcanic CO₂ could no longer dissolve into rainwater or weather rocks—accumulating until greenhouse warming melted the ice rapidly.',
    },
  },
  {
    id: 'pangaea',
    index: 5,
    title: 'Pangaea & Continental Drift',
    shortTitle: 'Pangaea',
    timeframe: '335 – 175 Ma',
    cosmicClockTime: '22:13 – 23:04',
    cosmicClockNorm: 0.926,
    accentColor: '#34d399',
    summary:
      'All major landmasses assembled into the supercontinent Pangaea surrounded by the Panthalassa ocean. Mantle plumes later rifted the Central Atlantic open, launching the Indian plate northward to collide with Eurasia and raise the Himalayas.',
    educationalFocus:
      'Mantle convection, seafloor spreading along the Mid-Atlantic Ridge, and continental collision orogeny.',
    keyStats: [
      { label: 'Supercontinent', value: 'Pangaea' },
      { label: 'Spread Rate', value: '2.5 – 16 cm/yr' },
      { label: 'Tethys Ocean', value: 'Closing' },
    ],
    actionButtonLabel: 'Animate Drift Sequence',
    defaultAction: 'himalayan-uplift',
    cameraFocus: { lat: 14, lon: 18, distance: 2.88 },
    shader: {
      magmaFactor: 0.0,
      iceCoverage: 0.0,
      oceanTintStrength: 0.25,
      oceanTintRgb: [0.06, 0.26, 0.48],
      atmosphereHue: 0.08,
      cloudScale: 0.5,
      ancientSurfaceMix: 0.35,
      ashFactor: 0.0,
      oxidationFactor: 0.0,
      allowCityLights: false,
    },
    sandboxDefaults: {
      axialTiltDeg: 23.4,
      co2Multiplier: 2.6,
      lunarDistanceRe: 0.96,
      driftProgress: 0.08,
      riftMeltProgress: 0.0,
    },
    beacons: [
      {
        id: 'beacon-tethys',
        eraId: 'pangaea',
        name: 'Tethys Seaway & Himalayan Suture',
        region: 'India–Eurasia Collision Zone',
        lat: 29.5,
        lon: 84.0,
        ageLabel: '50 Ma',
        metricLabel: 'India Speed',
        metricValue: '16 cm/yr',
        summary:
          'After detaching from Gondwana, the Indian plate raced across the Tethys Ocean and buckled into Eurasia, uplifting the Tibetan Plateau.',
        accentColor: '#34d399',
        action: 'himalayan-uplift',
      },
      {
        id: 'beacon-camp-rift',
        eraId: 'pangaea',
        name: 'Central Atlantic Magmatic Rift',
        region: 'Proto-Atlantic Suture',
        lat: 24.0,
        lon: -38.0,
        ageLabel: '201 Ma',
        metricLabel: 'Seafloor Spread',
        metricValue: 'Mid-Atlantic',
        summary:
          'Deep mantle upwelling fractured North America away from Africa, opening the Atlantic Ocean basin along a volcanic spreading ridge.',
        accentColor: '#38bdf8',
        action: 'himalayan-uplift',
      },
    ],
    fieldCheck: {
      prompt: 'Click the convergent plate boundary responsible for the Himalayan mountain uplift.',
      hint: 'Target the collision arc north of India (~30° N, 84° E).',
      targetLat: 29.5,
      targetLon: 84.0,
      toleranceDeg: 24,
      targetName: 'India–Eurasia Himalayan Suture',
      explanation:
        'Buoyant continental crust cannot easily subduct, so the northward collision of the Indian plate into Eurasia thickened the crust into Earth’s highest mountain belt.',
    },
  },
  {
    id: 'cretaceous',
    index: 6,
    title: 'Cretaceous Impact & Anthropocene',
    shortTitle: 'K–Pg → Now',
    timeframe: '66 Ma – Present',
    cosmicClockTime: '23:39 – 23:59:56',
    cosmicClockNorm: 0.988,
    accentColor: '#f43f5e',
    summary:
      'A 10-kilometer carbonaceous asteroid struck the shallow Yucatán carbonate shelf at 20 km/s, triggering a global ejecta plume and impact winter that ended the Mesozoic—opening ecological niches for mammals and ultimately human civilization.',
    educationalFocus:
      'K–Pg boundary iridium anomaly, mass extinction dynamics, Cenozoic cooling, and the Anthropocene.',
    keyStats: [
      { label: 'Impactor Size', value: '~10–12 km' },
      { label: 'Crater Width', value: '180 km' },
      { label: 'Energy Yield', value: '100 Tt TNT' },
    ],
    actionButtonLabel: 'Replay Chicxulub Impact',
    defaultAction: 'chicxulub-impact',
    cameraFocus: { lat: 21.4, lon: -89.5, distance: 2.48 },
    shader: {
      magmaFactor: 0.0,
      iceCoverage: 0.0,
      oceanTintStrength: 0.0,
      oceanTintRgb: [0.05, 0.24, 0.46],
      atmosphereHue: 0.0,
      cloudScale: 0.72,
      ancientSurfaceMix: 0.0,
      ashFactor: 0.0,
      oxidationFactor: 0.0,
      allowCityLights: true,
    },
    sandboxDefaults: {
      axialTiltDeg: 23.4,
      co2Multiplier: 1.0,
      lunarDistanceRe: 1.0,
      driftProgress: 1.0,
      riftMeltProgress: 0.0,
    },
    beacons: [
      {
        id: 'beacon-chicxulub',
        eraId: 'cretaceous',
        name: 'Chicxulub Impact Crater',
        region: 'Yucatán Peninsula, Mexico',
        lat: 21.4,
        lon: -89.5,
        ageLabel: '66.04 Ma',
        metricLabel: 'Impact Energy',
        metricValue: '4.2 × 10²³ J',
        summary:
          'Vaporized sulfate evaporites and rock lofted stratospheric aerosols worldwide, shutting down photosynthesis for years and depositing a global iridium layer.',
        accentColor: '#f43f5e',
        action: 'chicxulub-impact',
      },
      {
        id: 'beacon-deccan',
        eraId: 'cretaceous',
        name: 'Deccan Traps Flood Basalts',
        region: 'Western India',
        lat: 19.2,
        lon: 74.5,
        ageLabel: '66.2 Ma',
        metricLabel: 'Lava Volume',
        metricValue: '1.3M km³',
        summary:
          'Massive mantle-plume volcanism flooded western India with kilometer-thick basalt flows, stressing late Cretaceous ecosystems before the K–Pg impact.',
        accentColor: '#fb923c',
        action: 'chicxulub-impact',
      },
    ],
    fieldCheck: {
      prompt: 'Click the Yucatán Peninsula impact crater that triggered the K–Pg mass extinction.',
      hint: 'Target the southern rim of the Gulf of Mexico (~21° N, 90° W).',
      targetLat: 21.4,
      targetLon: -89.5,
      toleranceDeg: 22,
      targetName: 'Chicxulub Crater, Yucatán',
      explanation:
        'Chicxulub’s buried 180-km peak-ring crater on the Yucatán coast matches the exact 66.04 Ma age of the global iridium-rich K–Pg clay boundary.',
    },
  },
];

export function getDeepTimeChapter(id: DeepTimeEraId): DeepTimeChapter {
  return DEEP_TIME_CHAPTERS.find((c) => c.id === id) ?? DEEP_TIME_CHAPTERS[0];
}
