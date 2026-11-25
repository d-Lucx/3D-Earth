import {
  CATEGORY_LABELS,
  SATELLITES,
  STATIONS,
  type GlobalLocation,
  type SelectedTarget,
} from '../data/earthData';

export interface SearchResultItem {
  key: string;
  title: string;
  subtitle: string;
  badge: string;
  lat?: number;
  lon?: number;
  target: SelectedTarget;
}

export const GLOBAL_LOCATIONS: GlobalLocation[] = [
  {
    id: 'city-london',
    name: 'London',
    region: 'Greater London',
    country: 'United Kingdom',
    lat: 51.5074,
    lon: -0.1278,
    elevationM: 11,
    population: 8982000,
    kindLabel: 'City',
    summary: 'Prime Meridian reference metropolitan basin on the Thames estuary.',
  },
  {
    id: 'city-paris',
    name: 'Paris',
    region: 'Île-de-France',
    country: 'France',
    lat: 48.8566,
    lon: 2.3522,
    elevationM: 35,
    population: 2161000,
    kindLabel: 'City',
    summary: 'Western European temperate lowland hub along the Seine River basin.',
  },
  {
    id: 'city-berlin',
    name: 'Berlin',
    region: 'Berlin',
    country: 'Germany',
    lat: 52.52,
    lon: 13.405,
    elevationM: 34,
    population: 3645000,
    kindLabel: 'City',
    summary: 'North European Plain urban center straddling maritime and continental air masses.',
  },
  {
    id: 'city-madrid',
    name: 'Madrid',
    region: 'Community of Madrid',
    country: 'Spain',
    lat: 40.4168,
    lon: -3.7038,
    elevationM: 667,
    population: 3223000,
    kindLabel: 'City',
    summary: 'High-plateau Iberian metropolis on the central Meseta Central.',
  },
  {
    id: 'city-rome',
    name: 'Rome',
    region: 'Lazio',
    country: 'Italy',
    lat: 41.9028,
    lon: 12.4964,
    elevationM: 21,
    population: 2873000,
    kindLabel: 'City',
    summary: 'Central Mediterranean coastal lowland adjacent to the Tyrrhenian Sea.',
  },
  {
    id: 'city-moscow',
    name: 'Moscow',
    region: 'Central Federal District',
    country: 'Russia',
    lat: 55.7558,
    lon: 37.6173,
    elevationM: 156,
    population: 12655000,
    kindLabel: 'City',
    summary: 'High-latitude continental basin on the East European Plain.',
  },
  {
    id: 'city-istanbul',
    name: 'Istanbul',
    region: 'Marmara',
    country: 'Turkey',
    lat: 41.0082,
    lon: 28.9784,
    elevationM: 40,
    population: 15460000,
    kindLabel: 'City',
    summary: 'Transcontinental Bosphorus strait corridor near the North Anatolian Fault.',
  },
  {
    id: 'city-dubai',
    name: 'Dubai',
    region: 'Dubai',
    country: 'United Arab Emirates',
    lat: 25.2048,
    lon: 55.2708,
    elevationM: 5,
    population: 3490000,
    kindLabel: 'City',
    summary: 'Hyper-arid Arabian Gulf coastline with strong summer marine thermal flux.',
  },
  {
    id: 'city-delhi',
    name: 'New Delhi',
    region: 'Delhi NCR',
    country: 'India',
    lat: 28.6139,
    lon: 77.209,
    elevationM: 216,
    population: 16787000,
    kindLabel: 'City',
    summary: 'Indo-Gangetic Plain megacity shaped by seasonal monsoon circulation.',
  },
  {
    id: 'city-beijing',
    name: 'Beijing',
    region: 'Beijing',
    country: 'China',
    lat: 39.9042,
    lon: 116.4074,
    elevationM: 43,
    population: 21893000,
    kindLabel: 'City',
    summary: 'North China Plain basin bordered by the Yanshan and Taihang mountain arcs.',
  },
  {
    id: 'city-shanghai',
    name: 'Shanghai',
    region: 'Yangtze Delta',
    country: 'China',
    lat: 31.2304,
    lon: 121.4737,
    elevationM: 4,
    population: 24870000,
    kindLabel: 'City',
    summary: 'Low-lying East China Sea estuarine metropolis at the mouth of the Yangtze.',
  },
  {
    id: 'city-seoul',
    name: 'Seoul',
    region: 'Seoul Capital Area',
    country: 'South Korea',
    lat: 37.5665,
    lon: 126.978,
    elevationM: 38,
    population: 9776000,
    kindLabel: 'City',
    summary: 'Korean Peninsula basin along the Han River influenced by East Asian monsoons.',
  },
  {
    id: 'city-tokyo',
    name: 'Tokyo',
    region: 'Kanto',
    country: 'Japan',
    lat: 35.6762,
    lon: 139.6503,
    elevationM: 40,
    population: 13960000,
    kindLabel: 'City',
    summary: 'Pacific Ring of Fire megacity positioned above a triple tectonic plate junction.',
  },
  {
    id: 'city-bangkok',
    name: 'Bangkok',
    region: 'Central Thailand',
    country: 'Thailand',
    lat: 13.7563,
    lon: 100.5018,
    elevationM: 2,
    population: 10539000,
    kindLabel: 'City',
    summary: 'Tropical Chao Phraya delta lowland facing Gulf of Thailand sea-level sensitivity.',
  },
  {
    id: 'city-manila',
    name: 'Manila',
    region: 'Metro Manila',
    country: 'Philippines',
    lat: 14.5995,
    lon: 120.9842,
    elevationM: 16,
    population: 13484000,
    kindLabel: 'City',
    summary: 'Western Pacific typhoon corridor urban center on Manila Bay.',
  },
  {
    id: 'city-jakarta',
    name: 'Jakarta',
    region: 'Java',
    country: 'Indonesia',
    lat: -6.2088,
    lon: 106.8456,
    elevationM: 8,
    population: 10562000,
    kindLabel: 'City',
    summary: 'Equatorial Sunda Arc coastal basin on the Java Sea.',
  },
  {
    id: 'city-los-angeles',
    name: 'Los Angeles',
    region: 'California',
    country: 'United States',
    lat: 34.0522,
    lon: -118.2437,
    elevationM: 89,
    population: 3898000,
    kindLabel: 'City',
    summary: 'Southern California coastal basin adjacent to the San Andreas transform system.',
  },
  {
    id: 'city-chicago',
    name: 'Chicago',
    region: 'Illinois',
    country: 'United States',
    lat: 41.8781,
    lon: -87.6298,
    elevationM: 181,
    population: 2746000,
    kindLabel: 'City',
    summary: 'Great Lakes continental hub on the southwestern shore of Lake Michigan.',
  },
  {
    id: 'city-toronto',
    name: 'Toronto',
    region: 'Ontario',
    country: 'Canada',
    lat: 43.6532,
    lon: -79.3832,
    elevationM: 76,
    population: 2794000,
    kindLabel: 'City',
    summary: 'Lake Ontario north-shore metropolitan corridor with lake-effect microclimates.',
  },
  {
    id: 'city-mexico-city',
    name: 'Mexico City',
    region: 'Valley of Mexico',
    country: 'Mexico',
    lat: 19.4326,
    lon: -99.1332,
    elevationM: 2240,
    population: 9209000,
    kindLabel: 'City',
    summary: 'High-altitude Trans-Mexican Volcanic Belt basin surrounded by alpine peaks.',
  },
  {
    id: 'city-sao-paulo',
    name: 'São Paulo',
    region: 'São Paulo',
    country: 'Brazil',
    lat: -23.5505,
    lon: -46.6333,
    elevationM: 760,
    population: 12325000,
    kindLabel: 'City',
    summary: 'Tropic of Capricorn upland plateau metropolis in southeastern Brazil.',
  },
  {
    id: 'city-buenos-aires',
    name: 'Buenos Aires',
    region: 'Pampas',
    country: 'Argentina',
    lat: -34.6037,
    lon: -58.3816,
    elevationM: 25,
    population: 3075000,
    kindLabel: 'City',
    summary: 'South Atlantic temperate estuary on the Río de la Plata.',
  },
  {
    id: 'city-lagos',
    name: 'Lagos',
    region: 'Lagos State',
    country: 'Nigeria',
    lat: 6.5244,
    lon: 3.3792,
    elevationM: 11,
    population: 15388000,
    kindLabel: 'City',
    summary: 'West African Gulf of Guinea coastal lagoon megacity.',
  },
  {
    id: 'city-johannesburg',
    name: 'Johannesburg',
    region: 'Gauteng',
    country: 'South Africa',
    lat: -26.2041,
    lon: 28.0473,
    elevationM: 1753,
    population: 5635000,
    kindLabel: 'City',
    summary: 'Highveld continental plateau city perched atop the Witwatersrand ridge.',
  },
  {
    id: 'city-auckland',
    name: 'Auckland',
    region: 'North Island',
    country: 'New Zealand',
    lat: -36.8485,
    lon: 174.7633,
    elevationM: 26,
    population: 1657000,
    kindLabel: 'City',
    summary: 'Maritime isthmus bridging the Tasman Sea and Hauraki Gulf volcanic field.',
  },
  {
    id: 'city-honolulu',
    name: 'Honolulu',
    region: 'Hawaii',
    country: 'United States',
    lat: 21.3069,
    lon: -157.8583,
    elevationM: 6,
    population: 350964,
    kindLabel: 'City',
    summary: 'Central North Pacific trade-wind archipelago harbor on Oʻahu.',
  },
  {
    id: 'landmark-everest',
    name: 'Mount Everest',
    region: 'Mahalangur Himal',
    country: 'Nepal / Tibet',
    lat: 27.9881,
    lon: 86.925,
    elevationM: 8849,
    kindLabel: 'Landmark',
    summary: 'Earth highest summit along the active Indian-Eurasian continental collision belt.',
  },
  {
    id: 'landmark-mariana',
    name: 'Mariana Trench',
    region: 'Western Pacific',
    country: 'Pacific Ocean',
    lat: 11.3733,
    lon: 142.5917,
    elevationM: -10984,
    kindLabel: 'Landmark',
    summary: 'Deepest oceanic subduction trench on Earth at Challenger Deep.',
  },
  {
    id: 'landmark-galapagos',
    name: 'Galápagos Islands',
    region: 'Eastern Pacific',
    country: 'Ecuador',
    lat: -0.9538,
    lon: -90.9656,
    elevationM: 1707,
    kindLabel: 'Landmark',
    summary: 'Equatorial volcanic hotspot sitting at the confluence of El Niño ocean currents.',
  },
  {
    id: 'landmark-mcmurdo',
    name: 'McMurdo Station',
    region: 'Ross Island',
    country: 'Antarctica',
    lat: -77.8419,
    lon: 166.6863,
    elevationM: 10,
    kindLabel: 'Landmark',
    summary: 'Primary Antarctic polar research logistics base bordering the Ross Ice Shelf.',
  },
];

/**
 * Parses direct latitude/longitude input strings such as "35.68, 139.69" or "-33.86 151.20".
 */
function parseDirectCoords(raw: string): GlobalLocation | null {
  const match = raw
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NnSs])?\s*[,\s]+\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EeWw])?$/);
  if (!match) return null;

  let lat = Number(match[1]);
  let lon = Number(match[3]);
  if (match[2] && match[2].toUpperCase() === 'S') lat = -Math.abs(lat);
  if (match[4] && match[4].toUpperCase() === 'W') lon = -Math.abs(lon);

  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return {
    id: `coord-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    name: `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`,
    region: 'Direct Coordinate Focus',
    country: 'Global Grid',
    lat,
    lon,
    kindLabel: 'Coordinates',
    summary: 'User-entered geographic coordinate focus on the planetary sphere.',
  };
}

/**
 * Synchronous instant search across local stations, satellites, curated cities/landmarks,
 * and direct lat/lon coordinates.
 */
export function searchLocalLocations(query: string): SearchResultItem[] {
  const trimmed = query.trim();
  const q = trimmed.toLowerCase();

  if (!trimmed) {
    // Featured quick-jump targets when search input is focused empty
    return [
      ...GLOBAL_LOCATIONS.slice(0, 4).map((loc) => ({
        key: `loc-${loc.id}`,
        title: loc.name,
        subtitle: loc.country,
        badge: loc.kindLabel,
        lat: loc.lat,
        lon: loc.lon,
        target: { kind: 'location' as const, id: loc.id, location: loc },
      })),
      ...STATIONS.slice(0, 2).map((st) => ({
        key: `station-${st.id}`,
        title: st.name,
        subtitle: st.region,
        badge: `${CATEGORY_LABELS[st.category]} Station`,
        lat: st.lat,
        lon: st.lon,
        target: { kind: 'station' as const, id: st.id },
      })),
    ];
  }

  const results: SearchResultItem[] = [];

  const parsedCoord = parseDirectCoords(trimmed);
  if (parsedCoord) {
    results.push({
      key: parsedCoord.id,
      title: parsedCoord.name,
      subtitle: 'Jump to exact coordinates',
      badge: 'Coordinates',
      lat: parsedCoord.lat,
      lon: parsedCoord.lon,
      target: { kind: 'location', id: parsedCoord.id, location: parsedCoord },
    });
  }

  // Match monitoring stations
  for (const st of STATIONS) {
    const hay = `${st.name} ${st.region} ${st.category}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({
        key: `station-${st.id}`,
        title: st.name,
        subtitle: st.region,
        badge: `${CATEGORY_LABELS[st.category]} Station`,
        lat: st.lat,
        lon: st.lon,
        target: { kind: 'station', id: st.id },
      });
    }
  }

  // Match global cities & landmarks
  for (const loc of GLOBAL_LOCATIONS) {
    const hay = `${loc.name} ${loc.region} ${loc.country}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({
        key: `loc-${loc.id}`,
        title: loc.name,
        subtitle: loc.region !== loc.name ? `${loc.region}, ${loc.country}` : loc.country,
        badge: loc.kindLabel,
        lat: loc.lat,
        lon: loc.lon,
        target: { kind: 'location', id: loc.id, location: loc },
      });
    }
  }

  // Match satellites
  for (const sat of SATELLITES) {
    const hay = `${sat.name} ${sat.agency} ${sat.orbitType} ${sat.instrument}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({
        key: `sat-${sat.id}`,
        title: sat.name,
        subtitle: `${sat.agency} · ${sat.orbitType}`,
        badge: 'Satellite',
        target: { kind: 'satellite', id: sat.id },
      });
    }
  }

  // Sort exact prefix matches first
  results.sort((a, b) => {
    const aStarts = a.title.toLowerCase().startsWith(q) ? 0 : 1;
    const bStarts = b.title.toLowerCase().startsWith(q) ? 0 : 1;
    return aStarts - bStarts;
  });

  return results.slice(0, 8);
}

interface OpenMeteoGeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  country?: string;
  admin1?: string;
  population?: number;
}

/**
 * Live keyless worldwide city/place geocoding via Open-Meteo Geocoding API.
 * Gracefully returns an empty array if offline or aborted.
 */
export async function searchRemoteGeocoding(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=6&language=en&format=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: OpenMeteoGeoResult[] };
    if (!Array.isArray(data.results)) return [];

    return data.results.map((entry) => {
      const region = entry.admin1 || entry.country || 'Global';
      const country = entry.country || 'International';
      const loc: GlobalLocation = {
        id: `geo-${entry.id}`,
        name: entry.name,
        region,
        country,
        lat: entry.latitude,
        lon: entry.longitude,
        elevationM: typeof entry.elevation === 'number' ? Math.round(entry.elevation) : undefined,
        population: entry.population,
        kindLabel: 'City',
        summary: `Focused global location in ${region !== country ? `${region}, ${country}` : country}.`,
      };
      return {
        key: `geo-${entry.id}`,
        title: entry.name,
        subtitle: region !== country ? `${region}, ${country}` : country,
        badge: 'City',
        lat: entry.latitude,
        lon: entry.longitude,
        target: { kind: 'location', id: loc.id, location: loc },
      };
    });
  } catch {
    return [];
  }
}
