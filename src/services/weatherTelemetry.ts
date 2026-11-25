import { STATIONS } from '../data/earthData';

export interface WeatherSample {
  lat: number;
  lon: number;
  cloudCoverPct: number; // 0 - 100
  precipitationMm: number; // mm/h
  rainMm: number;
  snowfallCm: number;
}

export interface StationWeatherReading {
  cloudCoverPct: number;
  precipitationMm: number;
  temperatureC?: number;
  pressureHpa?: number;
  windMs?: number;
}

export interface GlobalWeatherSnapshot {
  source: 'live' | 'modeled';
  updatedAtIso: string;
  samples: WeatherSample[];
  stationReadings: Record<string, StationWeatherReading>;
  meanCloudCoverPct: number;
  activeRainNodes: number;
  peakPrecipitationMm: number;
}

export interface WeatherTimelineFrame {
  /** Integer hours relative to anchor time: -24 (24h ago) ... 0 (Live / Now) */
  offsetHours: number;
  timestampMs: number;
  timestampIso: string;
  snapshot: GlobalWeatherSnapshot;
}

export interface GlobalWeatherTimeline {
  source: 'live' | 'modeled';
  updatedAtIso: string;
  anchorTimeMs: number;
  /** Ordered from offsetHours = -24 to offsetHours = 0 (25 frames total) */
  frames: WeatherTimelineFrame[];
}

interface OpenMeteoEntry {
  latitude: number;
  longitude: number;
  current?: {
    time?: string;
    cloud_cover?: number;
    precipitation?: number;
    rain?: number;
    snowfall?: number;
    temperature_2m?: number;
    surface_pressure?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    cloud_cover?: (number | null)[];
    precipitation?: (number | null)[];
    rain?: (number | null)[];
    snowfall?: (number | null)[];
    temperature_2m?: (number | null)[];
    surface_pressure?: (number | null)[];
    wind_speed_10m?: (number | null)[];
  };
}

// 72 globally distributed synoptic grid coordinates (6 latitude bands x 12 longitude bands)
const GRID_LATS = [-55, -32, -8, 12, 36, 58];
const GRID_LONS = [-165, -135, -105, -75, -45, -15, 15, 45, 75, 105, 135, 165];

function buildGlobalGrid(): { lat: number; lon: number }[] {
  const pts: { lat: number; lon: number }[] = [];
  for (const lat of GRID_LATS) {
    for (const lon of GRID_LONS) {
      pts.push({ lat, lon });
    }
  }
  return pts;
}

const GLOBAL_GRID = buildGlobalGrid();

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Deterministic real-time synoptic climatology fallback keyed to a specific UTC Date
 * (used when live Open-Meteo API is unreachable or blocked in offline sandboxes).
 */
export function buildModeledWeatherSnapshot(atDate = new Date()): GlobalWeatherSnapshot {
  const totalUtcHours = atDate.getTime() / 3_600_000;
  const hourPhase = totalUtcHours * 0.26;
  const dayPhase = (totalUtcHours / 24) * 0.45;

  const evalSynoptic = (
    lat: number,
    lon: number,
  ): WeatherSample & { temperatureC: number } => {
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;

    // ITCZ equatorial convergence band + mid-latitude cyclone storm tracks (~45-58°)
    const itcz = Math.exp(-Math.pow((lat - 3) / 11, 2));
    const midLatStorm = Math.exp(-Math.pow((Math.abs(lat) - 48) / 14, 2));
    const subtropicDry = Math.exp(-Math.pow((Math.abs(lat) - 24) / 9, 2));

    // Advecting Rossby-wave planetary synoptic pattern (propagates smoothly over 24h)
    const waveA =
      Math.sin(lonRad * 3 - hourPhase * 0.55 + Math.cos(latRad * 2)) * 0.5 + 0.5;
    const waveB =
      Math.cos(lonRad * 5 - hourPhase * 0.85 - dayPhase + Math.sin(latRad * 3.5) * 1.4) *
        0.5 +
      0.5;
    const cycloneCell = Math.pow(waveA * 0.6 + waveB * 0.4, 1.35);

    const rawCloud =
      18 +
      itcz * 54 * (0.45 + 0.55 * waveA) +
      midLatStorm * 62 * (0.35 + 0.65 * cycloneCell) -
      subtropicDry * 36 +
      waveB * 22;

    const cloudCoverPct = Math.round(clamp(rawCloud, 0, 100));

    // Active convective precipitation where cloud cover & convergence exceed threshold
    let precipitationMm = 0;
    if (cloudCoverPct > 64) {
      const excess = (cloudCoverPct - 64) / 36;
      const intensity = Math.pow(excess, 2.2) * (itcz * 14.5 + midLatStorm * 9.5 + 3.2);
      precipitationMm = Number(clamp(intensity * (0.45 + 0.8 * waveB), 0, 26).toFixed(2));
    }

    const isCold = Math.abs(lat) > 54;
    // Diurnal temperature cycle synchronized to local solar hour
    const localSolarHour = (atDate.getUTCHours() + atDate.getUTCMinutes() / 60 + lon / 15 + 24) % 24;
    const diurnalSwing = Math.sin(((localSolarHour - 9) / 24) * Math.PI * 2) * 3.8;
    const temperatureC = Number(
      (27 * Math.cos(latRad) - 4 + diurnalSwing + (waveA - 0.5) * 2.5).toFixed(1),
    );

    return {
      lat,
      lon,
      cloudCoverPct,
      precipitationMm,
      rainMm: isCold ? 0 : precipitationMm,
      snowfallCm: isCold ? Number((precipitationMm * 0.7).toFixed(2)) : 0,
      temperatureC,
    };
  };

  const samples: WeatherSample[] = GLOBAL_GRID.map((p) => {
    const s = evalSynoptic(p.lat, p.lon);
    return {
      lat: s.lat,
      lon: s.lon,
      cloudCoverPct: s.cloudCoverPct,
      precipitationMm: s.precipitationMm,
      rainMm: s.rainMm,
      snowfallCm: s.snowfallCm,
    };
  });

  const stationReadings: Record<string, StationWeatherReading> = {};

  for (const st of STATIONS) {
    const s = evalSynoptic(st.lat, st.lon);
    samples.push({
      lat: s.lat,
      lon: s.lon,
      cloudCoverPct: s.cloudCoverPct,
      precipitationMm: s.precipitationMm,
      rainMm: s.rainMm,
      snowfallCm: s.snowfallCm,
    });
    const diurnalDelta = Math.sin(
      (((atDate.getUTCHours() + st.lon / 15 + 24) % 24 - 9) / 24) * Math.PI * 2,
    ) * 2.2;
    stationReadings[st.id] = {
      cloudCoverPct: s.cloudCoverPct,
      precipitationMm: s.precipitationMm,
      temperatureC: Number((st.temperatureC + diurnalDelta).toFixed(1)),
    };
  }

  return summarizeSnapshot('modeled', atDate.toISOString(), samples, stationReadings);
}

/**
 * Builds a complete 25-frame (-24h .. Now) modeled weather timeline for offline fallback
 * or immediate initial render before live Open-Meteo data arrives.
 */
export function buildModeledWeatherTimeline(now = new Date()): GlobalWeatherTimeline {
  const anchorTimeMs = now.getTime();
  const frames: WeatherTimelineFrame[] = [];

  for (let offset = -24; offset <= 0; offset++) {
    const tsMs = anchorTimeMs + offset * 3_600_000;
    const frameDate = new Date(tsMs);
    frames.push({
      offsetHours: offset,
      timestampMs: tsMs,
      timestampIso: frameDate.toISOString(),
      snapshot: buildModeledWeatherSnapshot(frameDate),
    });
  }

  return {
    source: 'modeled',
    updatedAtIso: now.toISOString(),
    anchorTimeMs,
    frames,
  };
}

export function getWeatherFrameAtOffset(
  timeline: GlobalWeatherTimeline,
  offsetHours: number,
): WeatherTimelineFrame {
  const clamped = Math.round(clamp(offsetHours, -24, 0));
  const idx = clamped + 24;
  return timeline.frames[idx] ?? timeline.frames[timeline.frames.length - 1];
}

function summarizeSnapshot(
  source: 'live' | 'modeled',
  updatedAtIso: string,
  samples: WeatherSample[],
  stationReadings: Record<string, StationWeatherReading>,
): GlobalWeatherSnapshot {
  let cloudSum = 0;
  let activeRainNodes = 0;
  let peakPrecipitationMm = 0;

  for (const s of samples) {
    cloudSum += s.cloudCoverPct;
    if (s.precipitationMm >= 0.1) activeRainNodes += 1;
    if (s.precipitationMm > peakPrecipitationMm) {
      peakPrecipitationMm = s.precipitationMm;
    }
  }

  return {
    source,
    updatedAtIso,
    samples,
    stationReadings,
    meanCloudCoverPct: samples.length > 0 ? Math.round(cloudSum / samples.length) : 0,
    activeRainNodes,
    peakPrecipitationMm: Number(peakPrecipitationMm.toFixed(1)),
  };
}

function parseUtcIso(raw: string | undefined, fallbackMs: number): number {
  if (!raw) return fallbackMs;
  const iso = raw.endsWith('Z') ? raw : `${raw}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

/**
 * Fetches a live 24-hour historical + current global weather timeline from Open-Meteo's
 * keyless meteorological API across 72 synoptic grid points + all 18 monitoring stations.
 * Falls back cleanly to a UTC-synchronized 24h synoptic model if offline.
 */
export async function fetchGlobalWeatherTimeline(
  externalSignal?: AbortSignal,
): Promise<GlobalWeatherTimeline> {
  const allCoords = [
    ...GLOBAL_GRID.map((p) => ({ lat: p.lat, lon: p.lon, stationId: null as string | null })),
    ...STATIONS.map((s) => ({ lat: s.lat, lon: s.lon, stationId: s.id })),
  ];

  // Split into two balanced batch requests (~45 points each) to stay within URL length limits
  const midpoint = Math.ceil(allCoords.length / 2);
  const chunks = [allCoords.slice(0, midpoint), allCoords.slice(midpoint)];

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 9000);

  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const responses = await Promise.all(
      chunks.map(async (chunk) => {
        const lats = chunk.map((c) => c.lat.toFixed(2)).join(',');
        const lons = chunk.map((c) => c.lon.toFixed(2)).join(',');
        const url =
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${lats}&longitude=${lons}` +
          `&current=cloud_cover,precipitation,rain,snowfall,temperature_2m,surface_pressure,wind_speed_10m` +
          `&hourly=cloud_cover,precipitation,rain,snowfall,temperature_2m,surface_pressure,wind_speed_10m` +
          `&past_hours=24&forecast_hours=1` +
          `&wind_speed_unit=ms&timezone=UTC`;

        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Open-Meteo HTTP ${res.status}`);
        }
        const json = await res.json();
        return Array.isArray(json) ? (json as OpenMeteoEntry[]) : [json as OpenMeteoEntry];
      }),
    );

    const flatEntries = responses.flat();
    if (flatEntries.length !== allCoords.length) {
      throw new Error('Unexpected weather batch length');
    }

    const nowMs = Date.now();
    const refHourlyTimes = flatEntries[0]?.hourly?.time ?? [];
    const hourlyCount = refHourlyTimes.length;
    const frames: WeatherTimelineFrame[] = [];

    // Build 25 frames: offsetHours = -24 .. -1 from hourly history, 0 from live current
    for (let offset = -24; offset <= 0; offset++) {
      const isLive = offset === 0;
      const fallbackTsMs = nowMs + offset * 3_600_000;

      // Map offsetHours (-24..0) onto the returned hourly array (length typically 25)
      const hourlyIdx =
        hourlyCount > 0
          ? clamp(hourlyCount - 1 + offset, 0, hourlyCount - 1)
          : -1;

      const frameTsMs = isLive
        ? nowMs
        : parseUtcIso(hourlyIdx >= 0 ? refHourlyTimes[hourlyIdx] : undefined, fallbackTsMs);
      const frameIso = new Date(frameTsMs).toISOString();

      const samples: WeatherSample[] = [];
      const stationReadings: Record<string, StationWeatherReading> = {};

      for (let i = 0; i < allCoords.length; i++) {
        const meta = allCoords[i];
        const entry = flatEntries[i];
        const cur = entry?.current;
        const h = entry?.hourly;

        const useCurrent = isLive && Boolean(cur);

        const rawCloud = useCurrent
          ? cur?.cloud_cover
          : hourlyIdx >= 0
            ? h?.cloud_cover?.[hourlyIdx]
            : cur?.cloud_cover;
        const rawPrecip = useCurrent
          ? cur?.precipitation
          : hourlyIdx >= 0
            ? h?.precipitation?.[hourlyIdx]
            : cur?.precipitation;
        const rawRain = useCurrent
          ? cur?.rain
          : hourlyIdx >= 0
            ? h?.rain?.[hourlyIdx]
            : cur?.rain;
        const rawSnow = useCurrent
          ? cur?.snowfall
          : hourlyIdx >= 0
            ? h?.snowfall?.[hourlyIdx]
            : cur?.snowfall;

        const cloudCoverPct = Math.round(clamp(Number(rawCloud ?? 0), 0, 100));
        const precipitationMm = Number(clamp(Number(rawPrecip ?? 0), 0, 120).toFixed(2));
        const rainMm = Number(clamp(Number(rawRain ?? 0), 0, 120).toFixed(2));
        const snowfallCm = Number(clamp(Number(rawSnow ?? 0), 0, 50).toFixed(2));

        samples.push({
          lat: meta.lat,
          lon: meta.lon,
          cloudCoverPct,
          precipitationMm,
          rainMm,
          snowfallCm,
        });

        if (meta.stationId) {
          const rawTemp = useCurrent
            ? cur?.temperature_2m
            : hourlyIdx >= 0
              ? h?.temperature_2m?.[hourlyIdx]
              : cur?.temperature_2m;
          const rawPressure = useCurrent
            ? cur?.surface_pressure
            : hourlyIdx >= 0
              ? h?.surface_pressure?.[hourlyIdx]
              : cur?.surface_pressure;
          const rawWind = useCurrent
            ? cur?.wind_speed_10m
            : hourlyIdx >= 0
              ? h?.wind_speed_10m?.[hourlyIdx]
              : cur?.wind_speed_10m;

          stationReadings[meta.stationId] = {
            cloudCoverPct,
            precipitationMm,
            temperatureC: typeof rawTemp === 'number' ? rawTemp : undefined,
            pressureHpa: typeof rawPressure === 'number' ? rawPressure : undefined,
            windMs: typeof rawWind === 'number' ? rawWind : undefined,
          };
        }
      }

      frames.push({
        offsetHours: offset,
        timestampMs: frameTsMs,
        timestampIso: frameIso,
        snapshot: summarizeSnapshot('live', frameIso, samples, stationReadings),
      });
    }

    return {
      source: 'live',
      updatedAtIso: new Date(nowMs).toISOString(),
      anchorTimeMs: nowMs,
      frames,
    };
  } catch {
    return buildModeledWeatherTimeline(new Date());
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Convenience wrapper returning the live (offset 0) weather snapshot.
 */
export async function fetchGlobalWeatherSnapshot(
  externalSignal?: AbortSignal,
): Promise<GlobalWeatherSnapshot> {
  const timeline = await fetchGlobalWeatherTimeline(externalSignal);
  return getWeatherFrameAtOffset(timeline, 0).snapshot;
}

/**
 * Fetches live current weather for an arbitrary searched latitude/longitude,
 * falling back cleanly to a UTC-synchronized synoptic estimate if offline.
 */
export async function fetchPointWeather(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<StationWeatherReading> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
      `&current=cloud_cover,precipitation,temperature_2m,surface_pressure,wind_speed_10m` +
      `&wind_speed_unit=ms&timezone=UTC`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('Point weather fetch failed');
    const data = (await res.json()) as OpenMeteoEntry;
    const cur = data.current;
    return {
      cloudCoverPct: Math.round(clamp(Number(cur?.cloud_cover ?? 0), 0, 100)),
      precipitationMm: Number(clamp(Number(cur?.precipitation ?? 0), 0, 120).toFixed(2)),
      temperatureC: typeof cur?.temperature_2m === 'number' ? cur.temperature_2m : undefined,
      pressureHpa:
        typeof cur?.surface_pressure === 'number' ? cur.surface_pressure : undefined,
      windMs: typeof cur?.wind_speed_10m === 'number' ? cur.wind_speed_10m : undefined,
    };
  } catch {
    // Synoptic fallback keyed to latitude & UTC time
    const now = new Date();
    const hourPhase = (now.getUTCHours() + now.getUTCMinutes() / 60) * 0.26;
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    const cloud = Math.round(
      clamp(
        42 + Math.sin(lonRad * 3 + hourPhase) * 26 + Math.cos(latRad * 2) * 18,
        5,
        96,
      ),
    );
    const estTemp = Number(
      (28 * Math.cos(latRad) - 4 + Math.sin(lonRad + hourPhase) * 3).toFixed(1),
    );
    return {
      cloudCoverPct: cloud,
      precipitationMm: cloud > 75 ? Number(((cloud - 75) * 0.14).toFixed(1)) : 0,
      temperatureC: estTemp,
      pressureHpa: 1013.2,
      windMs: 5.4,
    };
  }
}
