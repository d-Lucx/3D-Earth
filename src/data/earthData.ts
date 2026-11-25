import * as THREE from 'three';
import type { EarthquakeEvent } from '../services/seismicTelemetry';

export type StationCategory = 'climate' | 'seismic' | 'oceanic' | 'atmospheric';
export type DataLayerMode = 'natural' | 'precipitation' | 'thermal' | 'co2' | 'tectonic';
export type CameraPresetId = 'global' | 'americas' | 'emea' | 'apac' | 'polar';

export interface MonitoringStation {
  id: string;
  name: string;
  region: string;
  category: StationCategory;
  lat: number;
  lon: number;
  elevationM: number;
  status: 'Nominal' | 'Elevated' | 'Advisory';
  primaryMetricLabel: string;
  primaryMetricValue: string;
  primaryMetricUnit: string;
  temperatureC: number;
  co2Ppm: number;
  pressureHpa: number;
  windMs: number;
  trend24h: number[];
  trendUnit: string;
  summary: string;
}

export interface OrbitalSatellite {
  id: string;
  name: string;
  agency: string;
  orbitType: 'LEO' | 'SSO' | 'GEO';
  altitudeKm: number;
  visualRadius: number;
  inclinationDeg: number;
  raanDeg: number;
  initialPhaseRad: number;
  angularSpeedRad: number;
  velocityKms: number;
  periodMin: number;
  accentColor: string;
  mission: string;
  instrument: string;
}

export interface DataArc {
  id: string;
  fromId: string;
  toId: string;
  kind: 'telemetry' | 'atmospheric' | 'oceanic';
}

export interface GlobalLocation {
  id: string;
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  elevationM?: number;
  population?: number;
  kindLabel: 'City' | 'Landmark' | 'Coordinates';
  summary?: string;
}

export type SelectedTarget =
  | { kind: 'station'; id: string }
  | { kind: 'satellite'; id: string }
  | { kind: 'location'; id: string; location: GlobalLocation }
  | { kind: 'earthquake'; id: string; event: EarthquakeEvent };

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  lat: number;
  lon: number;
  distance: number;
}

export interface DataModeSpec {
  id: DataLayerMode;
  label: string;
  shortLabel: string;
  description: string;
  unit: string;
  minLabel: string;
  midLabel: string;
  maxLabel: string;
  gradientCss: string;
}

export const EARTH_RADIUS = 1.0;

/**
 * Converts geographic latitude [-90, 90] and longitude [-180, 180]
 * into Three.js SphereGeometry local 3D coordinates.
 * Matches equirectangular UV layout:
 *   u = (lon + 180) / 360 -> phi = u * 2*PI
 *   v = (lat + 90) / 180  -> theta = (90 - lat) * DEG2RAD
 */
export function latLonToVector3(
  lat: number,
  lon: number,
  radius = EARTH_RADIUS,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) / 180) * Math.PI;
  const sinTheta = Math.sin(theta);

  out.set(
    -radius * Math.cos(phi) * sinTheta,
    radius * Math.cos(theta),
    radius * Math.sin(phi) * sinTheta,
  );
  return out;
}

/**
 * Inverse of latLonToVector3: converts a 3D point in Earth's local space
 * back to geographic latitude and longitude in degrees.
 */
export function vector3ToLatLon(vec: THREE.Vector3): { lat: number; lon: number } {
  const len = vec.length();
  if (len < 1e-6) return { lat: 0, lon: 0 };
  const nx = vec.x / len;
  const ny = THREE.MathUtils.clamp(vec.y / len, -1, 1);
  const nz = vec.z / len;

  const lat = Math.asin(ny) * (180 / Math.PI);
  let phi = Math.atan2(nz, -nx);
  if (phi < 0) phi += Math.PI * 2;
  const lon = (phi / (Math.PI * 2)) * 360 - 180;
  return { lat, lon };
}

export function formatCoord(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr} · ${lonStr}`;
}

export const CATEGORY_COLORS: Record<StationCategory, string> = {
  climate: '#38bdf8',
  seismic: '#f59e0b',
  oceanic: '#2dd4bf',
  atmospheric: '#a78bfa',
};

export const CATEGORY_LABELS: Record<StationCategory, string> = {
  climate: 'Climate',
  seismic: 'Seismic',
  oceanic: 'Oceanic',
  atmospheric: 'Atmospheric',
};

export const DATA_MODES: DataModeSpec[] = [
  {
    id: 'natural',
    label: 'Natural Earth',
    shortLabel: 'Natural',
    description: 'True-color bathymetry, terrestrial biomes, dynamic clouds, and night city lights.',
    unit: 'Albedo',
    minLabel: 'Deep Ocean',
    midLabel: 'Temperate Land',
    maxLabel: 'Polar Ice',
    gradientCss: 'linear-gradient(90deg, #0b2242 0%, #166078 28%, #2e6b3e 55%, #b89c6a 78%, #eef4f8 100%)',
  },
  {
    id: 'precipitation',
    label: 'Precip & Clouds',
    shortLabel: 'Precip',
    description: 'Real-time global cloud cover fraction and active precipitation radar intensity.',
    unit: 'mm/h',
    minLabel: 'Clear · 0 mm/h',
    midLabel: 'Rain · 4 mm/h',
    maxLabel: 'Storm · 16+ mm/h',
    gradientCss: 'linear-gradient(90deg, #0b1628 0%, #2b4c74 24%, #06b6d4 46%, #22c55e 64%, #f59e0b 82%, #ef4444 100%)',
  },
  {
    id: 'thermal',
    label: 'Surface Thermal',
    shortLabel: 'Thermal',
    description: 'Global sea and land surface temperature distribution with regional anomaly corridors.',
    unit: '°C',
    minLabel: '-24 °C',
    midLabel: '+14 °C',
    maxLabel: '+42 °C',
    gradientCss: 'linear-gradient(90deg, #1d4ed8 0%, #06b6d4 28%, #22c55e 52%, #f59e0b 76%, #ef4444 100%)',
  },
  {
    id: 'co2',
    label: 'Atmospheric CO₂',
    shortLabel: 'CO₂ Flux',
    description: 'Mid-tropospheric carbon dioxide concentration bands and northern hemisphere plumes.',
    unit: 'ppm',
    minLabel: '412 ppm',
    midLabel: '424 ppm',
    maxLabel: '438 ppm',
    gradientCss: 'linear-gradient(90deg, #0f172a 0%, #0e7490 30%, #14b8a6 55%, #eab308 80%, #f97316 100%)',
  },
  {
    id: 'tectonic',
    label: 'Tectonic Stress',
    shortLabel: 'Tectonic',
    description: 'Major lithospheric plate boundaries, subduction trenches, and Ring of Fire strain zones.',
    unit: 'MPa',
    minLabel: '0.2 MPa',
    midLabel: '4.5 MPa',
    maxLabel: '12.0 MPa',
    gradientCss: 'linear-gradient(90deg, #0f172a 0%, #1e3a5f 32%, #d97706 68%, #ef4444 100%)',
  },
];

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'global', label: 'Global', lat: 18, lon: 12, distance: 3.05 },
  { id: 'americas', label: 'Americas', lat: 16, lon: -82, distance: 2.65 },
  { id: 'emea', label: 'EMEA', lat: 24, lon: 18, distance: 2.65 },
  { id: 'apac', label: 'Asia-Pacific', lat: 14, lon: 118, distance: 2.65 },
  { id: 'polar', label: 'Arctic', lat: 78, lon: 15, distance: 2.75 },
];

export const STATIONS: MonitoringStation[] = [
  {
    id: 'mauna-loa',
    name: 'Mauna Loa Observatory',
    region: 'Hawaii, Pacific',
    category: 'atmospheric',
    lat: 19.54,
    lon: -155.58,
    elevationM: 3397,
    status: 'Nominal',
    primaryMetricLabel: 'Baseline CO₂',
    primaryMetricValue: '426.8',
    primaryMetricUnit: 'ppm',
    temperatureC: 11.4,
    co2Ppm: 426.8,
    pressureHpa: 681.2,
    windMs: 6.4,
    trend24h: [426.1, 426.3, 426.5, 426.4, 426.7, 426.9, 426.8, 426.6, 426.5, 426.7, 426.9, 426.8],
    trendUnit: 'ppm',
    summary: 'High-altitude baseline trace gas and solar radiation benchmark above the Pacific inversion layer.',
  },
  {
    id: 'svalbard',
    name: 'Ny-Ålesund Arctic Vault',
    region: 'Svalbard, Norway',
    category: 'climate',
    lat: 78.92,
    lon: 11.93,
    elevationM: 474,
    status: 'Elevated',
    primaryMetricLabel: 'Permafrost Anomaly',
    primaryMetricValue: '+2.34',
    primaryMetricUnit: '°C',
    temperatureC: -4.8,
    co2Ppm: 429.4,
    pressureHpa: 1004.6,
    windMs: 11.2,
    trend24h: [-6.1, -5.9, -5.7, -5.4, -5.2, -5.0, -4.9, -4.7, -4.6, -4.8, -4.9, -4.8],
    trendUnit: '°C',
    summary: 'High-Arctic cryosphere observatory tracking sea-ice albedo, methane flux, and glacier mass balance.',
  },
  {
    id: 'tokyo-seismic',
    name: 'Kanto Broadband Array',
    region: 'Honshu, Japan',
    category: 'seismic',
    lat: 35.68,
    lon: 139.69,
    elevationM: 42,
    status: 'Elevated',
    primaryMetricLabel: 'Micro-Tremor Index',
    primaryMetricValue: '3.42',
    primaryMetricUnit: 'ML',
    temperatureC: 17.8,
    co2Ppm: 432.1,
    pressureHpa: 1015.4,
    windMs: 5.1,
    trend24h: [1.8, 2.0, 1.9, 2.4, 3.1, 2.9, 3.5, 3.3, 3.1, 3.6, 3.4, 3.42],
    trendUnit: 'ML',
    summary: 'Dense borehole seismometer network monitoring Pacific and Philippine Sea subduction strain.',
  },
  {
    id: 'amazon-flux',
    name: 'ATTO Basin Flux Tower',
    region: 'Amazonas, Brazil',
    category: 'climate',
    lat: -2.14,
    lon: -59.0,
    elevationM: 120,
    status: 'Nominal',
    primaryMetricLabel: 'Canopy Carbon Flux',
    primaryMetricValue: '-14.6',
    primaryMetricUnit: 'µmol/m²s',
    temperatureC: 28.9,
    co2Ppm: 418.2,
    pressureHpa: 1009.8,
    windMs: 2.8,
    trend24h: [-8.2, -10.5, -13.1, -15.4, -16.8, -16.2, -15.0, -14.1, -13.8, -14.3, -14.9, -14.6],
    trendUnit: 'µmol/m²s',
    summary: '325-meter tropical rainforest tall tower measuring biosphere-atmosphere carbon and aerosol exchange.',
  },
  {
    id: 'atacama-alma',
    name: 'Chajnantor Plateau Array',
    region: 'Atacama, Chile',
    category: 'atmospheric',
    lat: -23.02,
    lon: -67.75,
    elevationM: 5058,
    status: 'Nominal',
    primaryMetricLabel: 'Water Vapor (PWV)',
    primaryMetricValue: '0.68',
    primaryMetricUnit: 'mm',
    temperatureC: 2.1,
    co2Ppm: 423.1,
    pressureHpa: 554.0,
    windMs: 9.6,
    trend24h: [0.81, 0.78, 0.74, 0.71, 0.69, 0.65, 0.64, 0.66, 0.69, 0.7, 0.68, 0.68],
    trendUnit: 'mm',
    summary: 'Ultra-dry Andean high-altitude station tracking stratospheric opacity and millimeter-wave sky transparency.',
  },
  {
    id: 'reykjavik-rift',
    name: 'Reykjanes Ridge Probe',
    region: 'Southwest Iceland',
    category: 'seismic',
    lat: 64.14,
    lon: -21.94,
    elevationM: 65,
    status: 'Advisory',
    primaryMetricLabel: 'Crustal Uplift',
    primaryMetricValue: '+18.4',
    primaryMetricUnit: 'mm/mo',
    temperatureC: 5.2,
    co2Ppm: 425.7,
    pressureHpa: 994.2,
    windMs: 14.3,
    trend24h: [14.2, 14.8, 15.1, 15.7, 16.0, 16.4, 16.9, 17.3, 17.8, 18.0, 18.2, 18.4],
    trendUnit: 'mm/mo',
    summary: 'Mid-Atlantic divergent plate boundary GPS and tiltmeter telemetry tracking volcanic rift inflation.',
  },
  {
    id: 'gbr-marine',
    name: 'Coral Sea Mooring',
    region: 'Queensland, Australia',
    category: 'oceanic',
    lat: -18.28,
    lon: 147.69,
    elevationM: 0,
    status: 'Elevated',
    primaryMetricLabel: 'Sea Surface Temp',
    primaryMetricValue: '29.4',
    primaryMetricUnit: '°C',
    temperatureC: 29.4,
    co2Ppm: 422.5,
    pressureHpa: 1012.1,
    windMs: 7.5,
    trend24h: [28.7, 28.8, 28.9, 29.1, 29.2, 29.5, 29.6, 29.5, 29.4, 29.3, 29.4, 29.4],
    trendUnit: '°C',
    summary: 'Autonomous ocean buoy logging thermal stress, dissolved oxygen, and carbonate pH across the outer reef.',
  },
  {
    id: 'nairobi-rift',
    name: 'East African Rift Node',
    region: 'Nairobi, Kenya',
    category: 'seismic',
    lat: -1.29,
    lon: 36.82,
    elevationM: 1795,
    status: 'Nominal',
    primaryMetricLabel: 'Plate Divergence',
    primaryMetricValue: '6.8',
    primaryMetricUnit: 'mm/yr',
    temperatureC: 22.6,
    co2Ppm: 421.9,
    pressureHpa: 826.4,
    windMs: 4.1,
    trend24h: [6.7, 6.7, 6.8, 6.8, 6.8, 6.9, 6.8, 6.8, 6.7, 6.8, 6.8, 6.8],
    trendUnit: 'mm/yr',
    summary: 'Continental geodetic station recording Somalian-Nubian lithospheric extension and regional rainfall.',
  },
  {
    id: 'zurich-cryo',
    name: 'Jungfraujoch High Lab',
    region: 'Bernese Alps, Switzerland',
    category: 'atmospheric',
    lat: 46.55,
    lon: 7.98,
    elevationM: 3571,
    status: 'Nominal',
    primaryMetricLabel: 'Aerosol Optical Depth',
    primaryMetricValue: '0.092',
    primaryMetricUnit: 'AOD',
    temperatureC: -7.3,
    co2Ppm: 428.1,
    pressureHpa: 659.5,
    windMs: 10.8,
    trend24h: [0.088, 0.09, 0.094, 0.098, 0.102, 0.099, 0.095, 0.093, 0.091, 0.09, 0.092, 0.092],
    trendUnit: 'AOD',
    summary: 'European free-troposphere observatory sampling Saharan dust intrusions and alpine glacier retreat.',
  },
  {
    id: 'cape-agulhas',
    name: 'Agulhas Current Buoy',
    region: 'Western Cape, South Africa',
    category: 'oceanic',
    lat: -34.83,
    lon: 20.01,
    elevationM: 0,
    status: 'Nominal',
    primaryMetricLabel: 'Current Velocity',
    primaryMetricValue: '1.84',
    primaryMetricUnit: 'm/s',
    temperatureC: 19.6,
    co2Ppm: 419.8,
    pressureHpa: 1018.2,
    windMs: 12.1,
    trend24h: [1.65, 1.7, 1.72, 1.78, 1.81, 1.86, 1.89, 1.87, 1.85, 1.83, 1.84, 1.84],
    trendUnit: 'm/s',
    summary: 'Boundary current profiler capturing warm Indian-to-Atlantic heat transport eddies south of Africa.',
  },
  {
    id: 'singapore-strait',
    name: 'Equatorial Maritime Hub',
    region: 'Singapore Strait',
    category: 'oceanic',
    lat: 1.29,
    lon: 103.85,
    elevationM: 12,
    status: 'Nominal',
    primaryMetricLabel: 'Sea Level Anomaly',
    primaryMetricValue: '+4.1',
    primaryMetricUnit: 'cm',
    temperatureC: 30.2,
    co2Ppm: 431.6,
    pressureHpa: 1008.7,
    windMs: 3.9,
    trend24h: [3.6, 3.8, 4.0, 4.3, 4.5, 4.4, 4.2, 4.0, 3.9, 4.0, 4.1, 4.1],
    trendUnit: 'cm',
    summary: 'Equatorial tide-gauge and monsoon air-sea exchange node bridging the South China Sea and Indian Ocean.',
  },
  {
    id: 'nyc-coastal',
    name: 'Hudson Shelf Tide Array',
    region: 'New York, USA',
    category: 'oceanic',
    lat: 40.71,
    lon: -74.01,
    elevationM: 8,
    status: 'Nominal',
    primaryMetricLabel: 'Shelf Water Temp',
    primaryMetricValue: '15.2',
    primaryMetricUnit: '°C',
    temperatureC: 14.8,
    co2Ppm: 433.4,
    pressureHpa: 1016.9,
    windMs: 6.8,
    trend24h: [14.9, 15.0, 15.1, 15.3, 15.4, 15.5, 15.4, 15.3, 15.2, 15.1, 15.2, 15.2],
    trendUnit: '°C',
    summary: 'Northwest Atlantic continental shelf mooring measuring Gulf Stream warm-core rings and storm surge.',
  },
  {
    id: 'san-francisco-fault',
    name: 'Hayward-San Andreas Array',
    region: 'California, USA',
    category: 'seismic',
    lat: 37.77,
    lon: -122.42,
    elevationM: 54,
    status: 'Nominal',
    primaryMetricLabel: 'Strain Accumulation',
    primaryMetricValue: '2.18',
    primaryMetricUnit: 'µε/yr',
    temperatureC: 16.4,
    co2Ppm: 429.2,
    pressureHpa: 1017.5,
    windMs: 8.2,
    trend24h: [2.12, 2.13, 2.15, 2.14, 2.16, 2.18, 2.19, 2.17, 2.18, 2.18, 2.17, 2.18],
    trendUnit: 'µε/yr',
    summary: 'Transform plate boundary strainmeter network logging Pacific-North American shear displacement.',
  },
  {
    id: 'cairo-lidar',
    name: 'Sahara Dust Lidar',
    region: 'Cairo, Egypt',
    category: 'atmospheric',
    lat: 30.04,
    lon: 31.24,
    elevationM: 74,
    status: 'Elevated',
    primaryMetricLabel: 'Mineral Dust Load',
    primaryMetricValue: '164',
    primaryMetricUnit: 'µg/m³',
    temperatureC: 31.6,
    co2Ppm: 430.8,
    pressureHpa: 1011.2,
    windMs: 7.4,
    trend24h: [112, 124, 138, 149, 158, 171, 176, 172, 169, 165, 162, 164],
    trendUnit: 'µg/m³',
    summary: 'Vertical polarization lidar profiling trans-Mediterranean and trans-Atlantic Saharan mineral plumes.',
  },
  {
    id: 'mumbai-monsoon',
    name: 'Arabian Sea Monsoon Radar',
    region: 'Maharashtra, India',
    category: 'climate',
    lat: 19.08,
    lon: 72.88,
    elevationM: 14,
    status: 'Nominal',
    primaryMetricLabel: 'Moisture Flux',
    primaryMetricValue: '312',
    primaryMetricUnit: 'kg/ms',
    temperatureC: 31.1,
    co2Ppm: 434.0,
    pressureHpa: 1007.4,
    windMs: 8.9,
    trend24h: [278, 286, 294, 301, 310, 319, 322, 318, 315, 311, 310, 312],
    trendUnit: 'kg/ms',
    summary: 'Doppler coastal weather array quantifying southwest monsoon moisture convergence and cyclone intensity.',
  },
  {
    id: 'anchorage-borehole',
    name: 'Boreal Permafrost Station',
    region: 'Alaska, USA',
    category: 'climate',
    lat: 61.22,
    lon: -149.9,
    elevationM: 38,
    status: 'Elevated',
    primaryMetricLabel: 'Active Layer Depth',
    primaryMetricValue: '1.42',
    primaryMetricUnit: 'm',
    temperatureC: -1.6,
    co2Ppm: 429.9,
    pressureHpa: 1002.1,
    windMs: 6.2,
    trend24h: [1.34, 1.35, 1.36, 1.37, 1.38, 1.4, 1.41, 1.41, 1.42, 1.42, 1.42, 1.42],
    trendUnit: 'm',
    summary: 'Sub-Arctic thermal borehole transect measuring seasonal thaw progression and soil carbon release.',
  },
  {
    id: 'ushuaia-southern',
    name: 'Drake Passage Station',
    region: 'Tierra del Fuego, Argentina',
    category: 'atmospheric',
    lat: -54.8,
    lon: -68.3,
    elevationM: 18,
    status: 'Nominal',
    primaryMetricLabel: 'Total Column Ozone',
    primaryMetricValue: '286',
    primaryMetricUnit: 'DU',
    temperatureC: 6.4,
    co2Ppm: 420.4,
    pressureHpa: 989.6,
    windMs: 16.5,
    trend24h: [279, 281, 282, 284, 285, 287, 288, 287, 286, 285, 286, 286],
    trendUnit: 'DU',
    summary: 'Sub-Antarctic Dobson spectrophotometer and Southern Ocean westerly wind monitoring outpost.',
  },
  {
    id: 'sydney-tasman',
    name: 'Tasman Sea Ocean Node',
    region: 'New South Wales, Australia',
    category: 'oceanic',
    lat: -33.87,
    lon: 151.21,
    elevationM: 15,
    status: 'Nominal',
    primaryMetricLabel: 'Significant Wave Ht',
    primaryMetricValue: '2.35',
    primaryMetricUnit: 'm',
    temperatureC: 21.8,
    co2Ppm: 421.3,
    pressureHpa: 1019.4,
    windMs: 7.9,
    trend24h: [1.9, 2.0, 2.1, 2.2, 2.4, 2.5, 2.45, 2.4, 2.38, 2.35, 2.34, 2.35],
    trendUnit: 'm',
    summary: 'East Australian Current glider port monitoring marine heatwaves and South Pacific swell spectra.',
  },
];

export const SATELLITES: OrbitalSatellite[] = [
  {
    id: 'iss',
    name: 'ISS (Zarya)',
    agency: 'NASA / ESA / JAXA / CSA',
    orbitType: 'LEO',
    altitudeKm: 419,
    visualRadius: 1.155,
    inclinationDeg: 51.64,
    raanDeg: 28,
    initialPhaseRad: 0.4,
    angularSpeedRad: 0.24,
    velocityKms: 7.66,
    periodMin: 92.9,
    accentColor: '#38bdf8',
    mission: 'Crewed microgravity laboratory & external Earth-viewing ECOSTRESS thermal radiometer.',
    instrument: 'ECOSTRESS / GEDI Lidar',
  },
  {
    id: 'sentinel-2a',
    name: 'Sentinel-2A',
    agency: 'ESA Copernicus',
    orbitType: 'SSO',
    altitudeKm: 786,
    visualRadius: 1.22,
    inclinationDeg: 98.56,
    raanDeg: 112,
    initialPhaseRad: 2.1,
    angularSpeedRad: 0.175,
    velocityKms: 7.46,
    periodMin: 100.6,
    accentColor: '#2dd4bf',
    mission: 'High-resolution multispectral optical land, coastal water, and vegetation mapping.',
    instrument: '13-Band MSI Optical',
  },
  {
    id: 'landsat-9',
    name: 'Landsat 9',
    agency: 'USGS / NASA',
    orbitType: 'SSO',
    altitudeKm: 705,
    visualRadius: 1.20,
    inclinationDeg: 98.2,
    raanDeg: -65,
    initialPhaseRad: 4.0,
    angularSpeedRad: 0.19,
    velocityKms: 7.5,
    periodMin: 98.9,
    accentColor: '#f59e0b',
    mission: 'Continuous global land surface reflectance and thermal infrared climate record.',
    instrument: 'OLI-2 & TIRS-2',
  },
  {
    id: 'hubble',
    name: 'Hubble Space Telescope',
    agency: 'NASA / ESA',
    orbitType: 'LEO',
    altitudeKm: 525,
    visualRadius: 1.175,
    inclinationDeg: 28.47,
    raanDeg: 175,
    initialPhaseRad: 1.2,
    angularSpeedRad: 0.215,
    velocityKms: 7.59,
    periodMin: 95.1,
    accentColor: '#a78bfa',
    mission: 'Deep-space ultraviolet, optical, and near-infrared observatory in low inclination orbit.',
    instrument: 'WFC3 / COS Optical',
  },
  {
    id: 'terra-eos',
    name: 'Terra EOS AM-1',
    agency: 'NASA Earth System',
    orbitType: 'SSO',
    altitudeKm: 694,
    visualRadius: 1.245,
    inclinationDeg: 98.1,
    raanDeg: 15,
    initialPhaseRad: 5.1,
    angularSpeedRad: 0.165,
    velocityKms: 7.51,
    periodMin: 98.6,
    accentColor: '#34d399',
    mission: 'Flagship climate observatory measuring atmospheric carbon monoxide, clouds, and albedo.',
    instrument: 'MODIS / MOPITT / CERES',
  },
  {
    id: 'goes-18',
    name: 'GOES-18 West',
    agency: 'NOAA',
    orbitType: 'GEO',
    altitudeKm: 35786,
    visualRadius: 1.44,
    inclinationDeg: 0.4,
    raanDeg: -137,
    initialPhaseRad: 0.85,
    angularSpeedRad: 0.055,
    velocityKms: 3.07,
    periodMin: 1436.1,
    accentColor: '#fb7185',
    mission: 'Continuous geostationary weather imaging, lightning mapping, and solar magnetosphere watch.',
    instrument: 'ABI 16-Channel & GLM',
  },
];

export const DATA_ARCS: DataArc[] = [
  { id: 'arc-1', fromId: 'nyc-coastal', toId: 'zurich-cryo', kind: 'telemetry' },
  { id: 'arc-2', fromId: 'zurich-cryo', toId: 'svalbard', kind: 'atmospheric' },
  { id: 'arc-3', fromId: 'zurich-cryo', toId: 'cairo-lidar', kind: 'atmospheric' },
  { id: 'arc-4', fromId: 'cairo-lidar', toId: 'mumbai-monsoon', kind: 'atmospheric' },
  { id: 'arc-5', fromId: 'mumbai-monsoon', toId: 'singapore-strait', kind: 'oceanic' },
  { id: 'arc-6', fromId: 'singapore-strait', toId: 'tokyo-seismic', kind: 'telemetry' },
  { id: 'arc-7', fromId: 'tokyo-seismic', toId: 'mauna-loa', kind: 'telemetry' },
  { id: 'arc-8', fromId: 'mauna-loa', toId: 'san-francisco-fault', kind: 'telemetry' },
  { id: 'arc-9', fromId: 'san-francisco-fault', toId: 'nyc-coastal', kind: 'telemetry' },
  { id: 'arc-10', fromId: 'nyc-coastal', toId: 'amazon-flux', kind: 'atmospheric' },
  { id: 'arc-11', fromId: 'amazon-flux', toId: 'atacama-alma', kind: 'telemetry' },
  { id: 'arc-12', fromId: 'atacama-alma', toId: 'ushuaia-southern', kind: 'atmospheric' },
  { id: 'arc-13', fromId: 'singapore-strait', toId: 'gbr-marine', kind: 'oceanic' },
  { id: 'arc-14', fromId: 'cape-agulhas', toId: 'nairobi-rift', kind: 'oceanic' },
];
