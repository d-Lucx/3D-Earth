export interface EarthquakeEvent {
  id: string;
  magnitude: number;
  magType: string;
  place: string;
  lat: number;
  lon: number;
  depthKm: number;
  timeMs: number;
  tsunami: boolean;
  alert: 'green' | 'yellow' | 'orange' | 'red' | null;
  felt: number | null;
  url: string;
  severity: 'Minor' | 'Light' | 'Moderate' | 'Strong' | 'Major';
}

export interface SeismicSnapshot {
  source: 'live' | 'modeled';
  feedLabel: string;
  updatedAtIso: string;
  anchorTimeMs: number;
  events: EarthquakeEvent[];
  maxMagnitude: number;
  significantCount: number; // M >= 4.5
}

interface UsgsGeoJsonFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    magType?: string | null;
    place?: string | null;
    time?: number | null;
    tsunami?: number | null;
    alert?: 'green' | 'yellow' | 'orange' | 'red' | null;
    felt?: number | null;
    url?: string | null;
    type?: string | null;
  };
  geometry?: {
    coordinates?: [number, number, number];
  };
}

interface UsgsGeoJsonResponse {
  features?: UsgsGeoJsonFeature[];
}

export function classifyMagnitude(mag: number): EarthquakeEvent['severity'] {
  if (mag >= 7.0) return 'Major';
  if (mag >= 6.0) return 'Strong';
  if (mag >= 5.0) return 'Moderate';
  if (mag >= 4.0) return 'Light';
  return 'Minor';
}

export function magnitudeColorHex(mag: number): string {
  if (mag >= 6.0) return '#f43f5e'; // crimson alert
  if (mag >= 5.0) return '#ef4444'; // vivid red
  if (mag >= 4.0) return '#f97316'; // amber-orange
  return '#facc15'; // warm yellow
}

export function formatRelativeTime(timeMs: number, referenceMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((referenceMs - timeMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHr < 24) return remMin > 0 ? `${diffHr}h ${remMin}m ago` : `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function formatEventUtcTime(timeMs: number): string {
  const d = new Date(timeMs);
  if (Number.isNaN(d.getTime())) return 'UTC';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

function summarizeSnapshot(
  source: 'live' | 'modeled',
  feedLabel: string,
  events: EarthquakeEvent[],
  anchorTimeMs: number,
): SeismicSnapshot {
  let maxMagnitude = 0;
  let significantCount = 0;
  for (const ev of events) {
    if (ev.magnitude > maxMagnitude) maxMagnitude = ev.magnitude;
    if (ev.magnitude >= 4.5) significantCount += 1;
  }
  return {
    source,
    feedLabel,
    updatedAtIso: new Date(anchorTimeMs).toISOString(),
    anchorTimeMs,
    events,
    maxMagnitude: Number(maxMagnitude.toFixed(1)),
    significantCount,
  };
}

/**
 * Produces a 24-hour trailing seismic snapshot ending at `targetTimeMs`.
 * Because the master feed spans 48 hours, every scrubber position from -24h to Now
 * renders an accurate trailing 24-hour historical earthquake window.
 */
export function sliceSeismicSnapshotAtTime(
  master: SeismicSnapshot,
  targetTimeMs: number,
  offsetHours: number,
  maxVisible = 56,
): SeismicSnapshot {
  const windowStartMs = targetTimeMs - 24 * 3_600_000;
  const inWindow = master.events.filter(
    (ev) => ev.timeMs <= targetTimeMs && ev.timeMs >= windowStartMs,
  );

  // Prioritize stronger & more recent events if the window exceeds maxVisible
  const prioritized = [...inWindow]
    .sort((a, b) => {
      const scoreA = a.magnitude * 1.35 + a.timeMs / 1e12;
      const scoreB = b.magnitude * 1.35 + b.timeMs / 1e12;
      return scoreB - scoreA;
    })
    .slice(0, maxVisible)
    .sort((a, b) => b.timeMs - a.timeMs);

  const labelSuffix =
    offsetHours === 0
      ? 'Live (24h window)'
      : `Historical T${offsetHours}h (24h window)`;

  return summarizeSnapshot(
    master.source,
    `${master.source === 'live' ? 'USGS' : 'Model'} · ${labelSuffix}`,
    prioritized,
    targetTimeMs,
  );
}

/**
 * Fallback 48-hour tectonic catalog anchored along active subduction & transform zones,
 * used when the live USGS GeoJSON feed cannot be reached so all scrubber hours (-24h..Now)
 * have authentic, temporally evolving seismic snapshots.
 */
export function buildFallbackSeismicSnapshot(nowMs = Date.now()): SeismicSnapshot {
  const minute = 60_000;
  const hour = 3_600_000;
  const templates: Omit<EarthquakeEvent, 'severity' | 'url'>[] = [
    // Last 24h events
    {
      id: 'sim-eq-1',
      magnitude: 6.1,
      magType: 'mww',
      place: '78 km E of Petropavlovsk-Kamchatsky, Russia',
      lat: 53.04,
      lon: 160.12,
      depthKm: 41.2,
      timeMs: nowMs - 26 * minute,
      tsunami: false,
      alert: 'green',
      felt: 42,
    },
    {
      id: 'sim-eq-2',
      magnitude: 5.6,
      magType: 'mww',
      place: '112 km WSW of Coquimbo, Chile',
      lat: -30.28,
      lon: -72.42,
      depthKm: 28.6,
      timeMs: nowMs - 1.2 * hour,
      tsunami: false,
      alert: 'green',
      felt: 89,
    },
    {
      id: 'sim-eq-3',
      magnitude: 5.4,
      magType: 'mb',
      place: '64 km ESE of Ishinomaki, Japan',
      lat: 38.22,
      lon: 142.06,
      depthKm: 48.5,
      timeMs: nowMs - 2.1 * hour,
      tsunami: false,
      alert: 'green',
      felt: 64,
    },
    {
      id: 'sim-eq-4',
      magnitude: 5.8,
      magType: 'mww',
      place: '148 km SSW of Nukuʻalofa, Tonga',
      lat: -22.36,
      lon: -175.64,
      depthKm: 118.4,
      timeMs: nowMs - 3.4 * hour,
      tsunami: false,
      alert: 'green',
      felt: 11,
    },
    {
      id: 'sim-eq-5',
      magnitude: 4.9,
      magType: 'mb',
      place: '52 km NNW of Tobelo, Indonesia',
      lat: 2.18,
      lon: 127.84,
      depthKm: 92.1,
      timeMs: nowMs - 4.0 * hour,
      tsunami: false,
      alert: null,
      felt: 19,
    },
    {
      id: 'sim-eq-6',
      magnitude: 4.7,
      magType: 'mb',
      place: '34 km S of Heraklion, Greece',
      lat: 35.02,
      lon: 25.18,
      depthKm: 24.3,
      timeMs: nowMs - 5.2 * hour,
      tsunami: false,
      alert: null,
      felt: 105,
    },
    {
      id: 'sim-eq-7',
      magnitude: 4.4,
      magType: 'ml',
      place: '19 km WNW of Petrolia, California',
      lat: 40.39,
      lon: -124.48,
      depthKm: 14.8,
      timeMs: nowMs - 6.3 * hour,
      tsunami: false,
      alert: null,
      felt: 74,
    },
    {
      id: 'sim-eq-8',
      magnitude: 5.1,
      magType: 'mb',
      place: '86 km SE of Sand Point, Alaska',
      lat: 54.81,
      lon: -159.42,
      depthKm: 33.0,
      timeMs: nowMs - 7.5 * hour,
      tsunami: false,
      alert: null,
      felt: 6,
    },
    {
      id: 'sim-eq-9',
      magnitude: 4.6,
      magType: 'mb',
      place: '41 km ENE of Hualien City, Taiwan',
      lat: 24.14,
      lon: 121.98,
      depthKm: 19.5,
      timeMs: nowMs - 8.4 * hour,
      tsunami: false,
      alert: null,
      felt: 51,
    },
    {
      id: 'sim-eq-10',
      magnitude: 4.8,
      magType: 'mb',
      place: '73 km SSW of Acapulco, Mexico',
      lat: 16.24,
      lon: -100.16,
      depthKm: 22.0,
      timeMs: nowMs - 9.8 * hour,
      tsunami: false,
      alert: null,
      felt: 33,
    },
    {
      id: 'sim-eq-11',
      magnitude: 5.2,
      magType: 'mww',
      place: 'Reykjanes Ridge, North Atlantic',
      lat: 63.88,
      lon: -22.34,
      depthKm: 10.0,
      timeMs: nowMs - 11.2 * hour,
      tsunami: false,
      alert: 'green',
      felt: 128,
    },
    {
      id: 'sim-eq-12',
      magnitude: 4.5,
      magType: 'mb',
      place: '62 km SSE of Farkhar, Afghanistan',
      lat: 36.12,
      lon: 70.18,
      depthKm: 164.2,
      timeMs: nowMs - 12.6 * hour,
      tsunami: false,
      alert: null,
      felt: 17,
    },
    {
      id: 'sim-eq-13',
      magnitude: 4.2,
      magType: 'mb',
      place: '95 km NE of Gisborne, New Zealand',
      lat: -38.05,
      lon: 178.78,
      depthKm: 35.4,
      timeMs: nowMs - 14.1 * hour,
      tsunami: false,
      alert: null,
      felt: 22,
    },
    {
      id: 'sim-eq-14',
      magnitude: 3.8,
      magType: 'ml',
      place: '14 km SW of Volcano, Hawaii',
      lat: 19.34,
      lon: -155.34,
      depthKm: 6.4,
      timeMs: nowMs - 15.5 * hour,
      tsunami: false,
      alert: null,
      felt: 38,
    },
    {
      id: 'sim-eq-15',
      magnitude: 4.9,
      magType: 'mb',
      place: '122 km W of Padang, Indonesia',
      lat: -1.14,
      lon: 99.26,
      depthKm: 31.8,
      timeMs: nowMs - 17.2 * hour,
      tsunami: false,
      alert: null,
      felt: 27,
    },
    {
      id: 'sim-eq-16',
      magnitude: 5.0,
      magType: 'mb',
      place: '155 km ESE of Madang, Papua New Guinea',
      lat: -5.68,
      lon: 147.06,
      depthKm: 74.5,
      timeMs: nowMs - 19.4 * hour,
      tsunami: false,
      alert: null,
      felt: 8,
    },
    {
      id: 'sim-eq-17',
      magnitude: 4.3,
      magType: 'mb',
      place: '28 km E of Malatya, Turkey',
      lat: 38.36,
      lon: 38.64,
      depthKm: 11.2,
      timeMs: nowMs - 20.8 * hour,
      tsunami: false,
      alert: null,
      felt: 63,
    },
    {
      id: 'sim-eq-18',
      magnitude: 3.6,
      magType: 'ml',
      place: '45 km N of San Juan, Puerto Rico',
      lat: 18.87,
      lon: -66.08,
      depthKm: 28.9,
      timeMs: nowMs - 22.1 * hour,
      tsunami: false,
      alert: null,
      felt: 14,
    },
    // Preceding 24h–48h historical baseline events for scrubbing back to -24h
    {
      id: 'sim-eq-19',
      magnitude: 5.7,
      magType: 'mww',
      place: '91 km SSE of Severo-Kurilsk, Russia',
      lat: 49.94,
      lon: 156.62,
      depthKm: 52.0,
      timeMs: nowMs - 25.4 * hour,
      tsunami: false,
      alert: 'green',
      felt: 19,
    },
    {
      id: 'sim-eq-20',
      magnitude: 4.8,
      magType: 'mb',
      place: '58 km W of Antofagasta, Chile',
      lat: -23.62,
      lon: -70.96,
      depthKm: 39.2,
      timeMs: nowMs - 27.2 * hour,
      tsunami: false,
      alert: null,
      felt: 46,
    },
    {
      id: 'sim-eq-21',
      magnitude: 5.3,
      magType: 'mww',
      place: '134 km ESE of Davao, Philippines',
      lat: 6.52,
      lon: 126.74,
      depthKm: 64.8,
      timeMs: nowMs - 29.8 * hour,
      tsunami: false,
      alert: 'green',
      felt: 35,
    },
    {
      id: 'sim-eq-22',
      magnitude: 4.6,
      magType: 'mb',
      place: '82 km S of Nikolski, Alaska',
      lat: 52.21,
      lon: -168.94,
      depthKm: 29.4,
      timeMs: nowMs - 31.6 * hour,
      tsunami: false,
      alert: null,
      felt: 4,
    },
    {
      id: 'sim-eq-23',
      magnitude: 6.0,
      magType: 'mww',
      place: '115 km NW of Port Vila, Vanuatu',
      lat: -16.92,
      lon: 167.54,
      depthKm: 36.1,
      timeMs: nowMs - 34.0 * hour,
      tsunami: false,
      alert: 'green',
      felt: 29,
    },
    {
      id: 'sim-eq-24',
      magnitude: 4.5,
      magType: 'mb',
      place: '47 km WSW of Lima, Peru',
      lat: -12.22,
      lon: -77.45,
      depthKm: 44.5,
      timeMs: nowMs - 36.5 * hour,
      tsunami: false,
      alert: null,
      felt: 82,
    },
    {
      id: 'sim-eq-25',
      magnitude: 4.9,
      magType: 'mb',
      place: '74 km E of Naze, Japan',
      lat: 28.34,
      lon: 130.25,
      depthKm: 25.0,
      timeMs: nowMs - 38.9 * hour,
      tsunami: false,
      alert: null,
      felt: 21,
    },
    {
      id: 'sim-eq-26',
      magnitude: 4.4,
      magType: 'mb',
      place: '31 km NE of Messina, Italy',
      lat: 38.39,
      lon: 15.82,
      depthKm: 18.4,
      timeMs: nowMs - 41.2 * hour,
      tsunami: false,
      alert: null,
      felt: 94,
    },
    {
      id: 'sim-eq-27',
      magnitude: 5.1,
      magType: 'mb',
      place: 'Central Mid-Atlantic Ridge',
      lat: 7.45,
      lon: -35.88,
      depthKm: 10.0,
      timeMs: nowMs - 43.7 * hour,
      tsunami: false,
      alert: null,
      felt: null,
    },
    {
      id: 'sim-eq-28',
      magnitude: 4.7,
      magType: 'mb',
      place: '64 km SSW of Oaxaca, Mexico',
      lat: 16.51,
      lon: -96.92,
      depthKm: 48.2,
      timeMs: nowMs - 45.8 * hour,
      tsunami: false,
      alert: null,
      felt: 55,
    },
  ];

  const events: EarthquakeEvent[] = templates.map((t) => ({
    ...t,
    severity: classifyMagnitude(t.magnitude),
    url: 'https://earthquake.usgs.gov/earthquakes/map/',
  }));

  return summarizeSnapshot('modeled', 'Global Seismic Model (48h archive)', events, nowMs);
}

function parseUsgsFeatures(
  features: UsgsGeoJsonFeature[],
  cutoffMs: number,
  maxItems = 220,
): EarthquakeEvent[] {
  const parsed: EarthquakeEvent[] = [];

  for (const f of features) {
    const coords = f.geometry?.coordinates;
    const props = f.properties;
    if (!coords || coords.length < 2 || !props) continue;

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const depthKm = Number.isFinite(Number(coords[2])) ? Math.max(0, Number(coords[2])) : 10;
    const mag = Number(props.mag);
    const timeMs = Number(props.time);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(mag) ||
      mag < 2.0 ||
      !Number.isFinite(timeMs) ||
      timeMs < cutoffMs
    ) {
      continue;
    }

    parsed.push({
      id: f.id || `eq-${lat.toFixed(2)}-${lon.toFixed(2)}-${timeMs}`,
      magnitude: Number(mag.toFixed(1)),
      magType: (props.magType || 'ml').toLowerCase(),
      place: (props.place || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`).trim(),
      lat,
      lon,
      depthKm: Number(depthKm.toFixed(1)),
      timeMs,
      tsunami: Boolean(props.tsunami && props.tsunami > 0),
      alert: props.alert ?? null,
      felt: typeof props.felt === 'number' && props.felt > 0 ? props.felt : null,
      url: props.url || 'https://earthquake.usgs.gov/earthquakes/map/',
      severity: classifyMagnitude(mag),
    });
  }

  return parsed.sort((a, b) => b.timeMs - a.timeMs).slice(0, maxItems);
}

/**
 * Fetches real-time + 48h historical global M2.5+ earthquakes from the keyless USGS
 * Earthquake Hazards GeoJSON API so scrubbing across the past 24 hours displays
 * genuine trailing 24-hour seismic windows at every hour.
 */
export async function fetchRealTimeSeismicSnapshot(
  externalSignal?: AbortSignal,
): Promise<SeismicSnapshot> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8500);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const nowMs = Date.now();
    // Retain 48h of events so scrubbing back to T-24h shows the full trailing 24h window [T-48h..T-24h]
    const cutoff48h = nowMs - 48 * 3_600_000;

    const res = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
      { signal: controller.signal },
    );
    if (!res.ok) {
      throw new Error(`USGS HTTP ${res.status}`);
    }
    const data = (await res.json()) as UsgsGeoJsonResponse;
    let events = parseUsgsFeatures(data.features ?? [], cutoff48h, 240);

    // If extremely sparse in 48h, retain wider window from the 7-day response
    if (events.length < 14) {
      events = parseUsgsFeatures(data.features ?? [], nowMs - 7 * 24 * 3_600_000, 140);
    }

    if (events.length === 0) {
      throw new Error('Empty USGS feed');
    }

    return summarizeSnapshot('live', 'USGS M2.5+ (48h archive)', events, nowMs);
  } catch {
    return buildFallbackSeismicSnapshot(Date.now());
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
