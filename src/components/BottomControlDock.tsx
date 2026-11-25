import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  X,
} from 'lucide-react';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  DATA_MODES,
  SATELLITES,
  STATIONS,
  formatCoord,
  type DataLayerMode,
  type StationCategory,
} from '../data/earthData';
import type {
  MagneticProbeReading,
  SatelliteLivePos,
  SceneSettings,
} from '../three/EarthSceneEngine';
import type {
  GlobalWeatherSnapshot,
  StationWeatherReading,
} from '../services/weatherTelemetry';
import {
  formatEventUtcTime,
  formatRelativeTime,
  magnitudeColorHex,
  type EarthquakeEvent,
  type SeismicSnapshot,
} from '../services/seismicTelemetry';
import { SparklineChart } from './SparklineChart';

export type DockTab = 'overview' | 'layers' | 'seismic' | 'stations' | 'satellites';
export type TimelineMode = 'live' | 'historical';

interface BottomControlDockProps {
  settings: SceneSettings;
  collapsed: boolean;
  activeTab: DockTab;
  cursorCoords: { lat: number; lon: number } | null;
  magneticProbe: MagneticProbeReading | null;
  satellitePositions: SatelliteLivePos[];
  weatherSnapshot: GlobalWeatherSnapshot;
  weatherLoading: boolean;
  seismicSnapshot: SeismicSnapshot;
  seismicLoading: boolean;
  timelineMode: TimelineMode;
  historyOffsetHours: number;
  historyPlaying: boolean;
  activeTimestampMs: number;
  focusedLocationWeather: StationWeatherReading | null;
  onSetTimelineMode: (mode: TimelineMode) => void;
  onScrubHistoryOffset: (offsetHours: number) => void;
  onToggleHistoryPlay: () => void;
  onRefreshWeather: () => void;
  onRefreshSeismic: () => void;
  onToggleCollapse: () => void;
  onChangeTab: (tab: DockTab) => void;
  onUpdateSettings: (patch: Partial<SceneSettings>) => void;
  onSelectStation: (stationId: string) => void;
  onSelectSatellite: (satId: string) => void;
  onSelectEarthquake: (event: EarthquakeEvent) => void;
  onClearTarget: () => void;
}

function formatUtcClock(hourDecimal: number): string {
  const wrapped = ((hourDecimal % 24) + 24) % 24;
  const hrs = Math.floor(wrapped);
  const mins = Math.floor((wrapped - hrs) * 60);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')} UTC`;
}

function formatUpdatedUtc(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'UTC';
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function BottomControlDock({
  settings,
  collapsed,
  activeTab,
  cursorCoords,
  magneticProbe,
  satellitePositions,
  weatherSnapshot,
  weatherLoading,
  seismicSnapshot,
  seismicLoading,
  timelineMode,
  historyOffsetHours,
  historyPlaying,
  activeTimestampMs,
  focusedLocationWeather,
  onSetTimelineMode,
  onScrubHistoryOffset,
  onToggleHistoryPlay,
  onRefreshWeather,
  onRefreshSeismic,
  onToggleCollapse,
  onChangeTab,
  onUpdateSettings,
  onSelectStation,
  onSelectSatellite,
  onSelectEarthquake,
  onClearTarget,
}: BottomControlDockProps) {
  const [stationFilter, setStationFilter] = useState<'all' | StationCategory>('all');
  const [seismicMinMag, setSeismicMinMag] = useState<number>(0);
  const isHistorical = timelineMode === 'historical' && historyOffsetHours < 0;

  const selectedStation = useMemo(() => {
    if (settings.selectedTarget?.kind !== 'station') return null;
    return STATIONS.find((s) => s.id === settings.selectedTarget?.id) ?? null;
  }, [settings.selectedTarget]);

  const selectedSatellite = useMemo(() => {
    if (settings.selectedTarget?.kind !== 'satellite') return null;
    return SATELLITES.find((s) => s.id === settings.selectedTarget?.id) ?? null;
  }, [settings.selectedTarget]);

  const selectedLocation = useMemo(() => {
    if (settings.selectedTarget?.kind !== 'location') return null;
    return settings.selectedTarget.location;
  }, [settings.selectedTarget]);

  const selectedEarthquake = useMemo(() => {
    if (settings.selectedTarget?.kind !== 'earthquake') return null;
    return settings.selectedTarget.event;
  }, [settings.selectedTarget]);

  const satPosMap = useMemo(() => {
    const map = new Map<string, SatelliteLivePos>();
    for (const p of satellitePositions) map.set(p.id, p);
    return map;
  }, [satellitePositions]);

  const filteredStations = useMemo(() => {
    if (stationFilter === 'all') return STATIONS;
    return STATIONS.filter((s) => s.category === stationFilter);
  }, [stationFilter]);

  const filteredEarthquakes = useMemo(() => {
    if (seismicMinMag <= 0) return seismicSnapshot.events;
    return seismicSnapshot.events.filter((ev) => ev.magnitude >= seismicMinMag);
  }, [seismicSnapshot.events, seismicMinMag]);

  const activeDataModeSpec = useMemo(
    () => DATA_MODES.find((m) => m.id === settings.dataMode) ?? DATA_MODES[0],
    [settings.dataMode],
  );

  const layerToggles: {
    key: keyof Pick<
      SceneSettings,
      | 'showClouds'
      | 'showCityLights'
      | 'showMagneticField'
      | 'showEarthquakes'
      | 'showStations'
      | 'showSatellites'
      | 'showArcs'
      | 'showGraticule'
    >;
    label: string;
  }[] = [
    { key: 'showMagneticField', label: 'Magnetic Field' },
    { key: 'showEarthquakes', label: 'Earthquakes' },
    { key: 'showClouds', label: 'Clouds' },
    { key: 'showCityLights', label: 'City Lights' },
    { key: 'showStations', label: 'Stations' },
    { key: 'showSatellites', label: 'Satellites' },
    { key: 'showArcs', label: 'Data Arcs' },
    { key: 'showGraticule', label: 'Grid' },
  ];

  const statusTone = (status: 'Nominal' | 'Elevated' | 'Advisory') => {
    if (status === 'Advisory') return 'text-rose-400';
    if (status === 'Elevated') return 'text-amber-400';
    return 'text-emerald-400';
  };

  return (
    <div
      className="fixed bottom-4 left-1/2 z-20 w-[min(960px,94vw)] pointer-events-none transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        transform: collapsed
          ? 'translate(-50%, calc(100% - 34px))'
          : 'translate(-50%, 0)',
      }}
    >
      {/* Top center Zen/Cinema drawer handle */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title="Toggle controls (H)"
          className="pointer-events-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium text-slate-300 hover:text-white bg-[#0a101d] border border-b-0 border-slate-800 rounded-t-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {collapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              <span>Hide Controls</span>
            </>
          )}
        </button>
      </div>

      {/* Unified Dock Body (solid translucent surface, zero backdrop-blur over WebGL) */}
      <section
        aria-label="Earth telemetry and controls"
        className="pointer-events-auto bg-[#0a101d]/96 border border-slate-800 rounded-xl shadow-[0_18px_48px_rgba(0,0,0,0.65)] overflow-hidden"
      >
        {/* Contextual Selected Target Telemetry Strip */}
        {selectedStation && (
          <div className="px-5 py-3.5 bg-[#0e1628] border-b border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-400">
                <span style={{ color: CATEGORY_COLORS[selectedStation.category] }}>
                  {CATEGORY_LABELS[selectedStation.category]}
                </span>
                <span aria-hidden="true">·</span>
                <span>{selectedStation.region}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatCoord(selectedStation.lat, selectedStation.lon)}
                </span>
                <span aria-hidden="true">·</span>
                <span className={`font-medium ${statusTone(selectedStation.status)}`}>
                  {selectedStation.status}
                </span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <h2 className="text-[15px] font-semibold text-slate-100 truncate">
                  {selectedStation.name}
                </h2>
                <span className="text-[12px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
                  Elev {selectedStation.elevationM.toLocaleString()} m
                </span>
              </div>
              <p className="text-[12px] text-slate-400 mt-1 line-clamp-1">
                {selectedStation.summary}
              </p>
            </div>

            <div className="flex items-center gap-5 shrink-0">
              {(() => {
                const liveWeather = weatherSnapshot.stationReadings[selectedStation.id];
                const displayTemp =
                  liveWeather?.temperatureC !== undefined
                    ? liveWeather.temperatureC
                    : selectedStation.temperatureC;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-l border-slate-800 pl-4">
                    <div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">
                        {selectedStation.primaryMetricLabel}
                      </div>
                      <div className="font-mono tabular-nums text-[16px] font-semibold text-slate-100 whitespace-nowrap">
                        {selectedStation.primaryMetricValue}
                        <span className="text-[11px] font-normal text-slate-400 ml-1">
                          {selectedStation.primaryMetricUnit}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">
                        Cloud Cover
                      </div>
                      <div className="font-mono tabular-nums text-[15px] font-medium text-cyan-200 whitespace-nowrap">
                        {liveWeather ? liveWeather.cloudCoverPct : '—'}
                        <span className="text-[11px] text-slate-400 ml-0.5">%</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">
                        Precipitation
                      </div>
                      <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                        {liveWeather ? liveWeather.precipitationMm.toFixed(1) : '0.0'}
                        <span className="text-[11px] text-slate-400 ml-1">mm/h</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">Air Temp</div>
                      <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                        {displayTemp > 0 ? '+' : ''}
                        {displayTemp.toFixed(1)}
                        <span className="text-[11px] text-slate-400 ml-1">°C</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="hidden sm:block border-l border-slate-800 pl-4">
                <SparklineChart
                  values={selectedStation.trend24h}
                  unit={selectedStation.trendUnit}
                  strokeColor={CATEGORY_COLORS[selectedStation.category]}
                />
              </div>

              <button
                type="button"
                onClick={onClearTarget}
                aria-label="Close station details"
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-md transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {selectedSatellite && (
          <div className="px-5 py-3.5 bg-[#0e1628] border-b border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-400">
                <span style={{ color: selectedSatellite.accentColor }}>
                  {selectedSatellite.orbitType} Orbit
                </span>
                <span aria-hidden="true">·</span>
                <span>{selectedSatellite.agency}</span>
                <span aria-hidden="true">·</span>
                <span>{selectedSatellite.instrument}</span>
                {satPosMap.get(selectedSatellite.id) && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-cyan-300">
                      {formatCoord(
                        satPosMap.get(selectedSatellite.id)!.lat,
                        satPosMap.get(selectedSatellite.id)!.lon,
                      )}
                    </span>
                  </>
                )}
              </div>
              <h2 className="text-[15px] font-semibold text-slate-100 mt-1 truncate">
                {selectedSatellite.name}
              </h2>
              <p className="text-[12px] text-slate-400 mt-0.5 line-clamp-1">
                {selectedSatellite.mission}
              </p>
            </div>

            <div className="flex items-center gap-5 shrink-0">
              <div className="grid grid-cols-4 gap-4 border-l border-slate-800 pl-4">
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Altitude</div>
                  <div className="font-mono tabular-nums text-[15px] font-semibold text-slate-100 whitespace-nowrap">
                    {selectedSatellite.altitudeKm.toLocaleString()}
                    <span className="text-[11px] font-normal text-slate-400 ml-1">km</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Velocity</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {selectedSatellite.velocityKms.toFixed(2)}
                    <span className="text-[11px] text-slate-400 ml-1">km/s</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Inclination</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {selectedSatellite.inclinationDeg.toFixed(1)}
                    <span className="text-[11px] text-slate-400 ml-0.5">°</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Period</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {selectedSatellite.periodMin.toFixed(1)}
                    <span className="text-[11px] text-slate-400 ml-1">min</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClearTarget}
                aria-label="Close satellite details"
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-md transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {selectedLocation && (
          <div className="px-5 py-3.5 bg-[#0e1628] border-b border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-400">
                <span className="text-cyan-300">{selectedLocation.kindLabel}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {selectedLocation.region !== selectedLocation.country
                    ? `${selectedLocation.region}, ${selectedLocation.country}`
                    : selectedLocation.country}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatCoord(selectedLocation.lat, selectedLocation.lon)}
                </span>
                {selectedLocation.elevationM !== undefined && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Elev {selectedLocation.elevationM.toLocaleString()} m
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <h2 className="text-[15px] font-semibold text-slate-100 truncate">
                  {selectedLocation.name}
                </h2>
                {selectedLocation.population !== undefined &&
                  selectedLocation.population > 0 && (
                    <span className="text-[12px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
                      Pop {selectedLocation.population.toLocaleString()}
                    </span>
                  )}
              </div>
              {selectedLocation.summary && (
                <p className="text-[12px] text-slate-400 mt-0.5 line-clamp-1">
                  {selectedLocation.summary}
                </p>
              )}
            </div>

            <div className="flex items-center gap-5 shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-l border-slate-800 pl-4">
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Air Temp</div>
                  <div className="font-mono tabular-nums text-[15px] font-semibold text-slate-100 whitespace-nowrap">
                    {focusedLocationWeather?.temperatureC !== undefined
                      ? `${focusedLocationWeather.temperatureC > 0 ? '+' : ''}${focusedLocationWeather.temperatureC.toFixed(1)}`
                      : '—'}
                    <span className="text-[11px] font-normal text-slate-400 ml-1">°C</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Cloud Cover</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-cyan-200 whitespace-nowrap">
                    {focusedLocationWeather ? focusedLocationWeather.cloudCoverPct : '—'}
                    <span className="text-[11px] text-slate-400 ml-0.5">%</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Precipitation</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {focusedLocationWeather
                      ? focusedLocationWeather.precipitationMm.toFixed(1)
                      : '—'}
                    <span className="text-[11px] text-slate-400 ml-1">mm/h</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Local Solar</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {formatUtcClock(settings.solarHourUtc + selectedLocation.lon / 15).replace(
                      ' UTC',
                      '',
                    )}
                    <span className="text-[11px] text-slate-400 ml-1">LST</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClearTarget}
                aria-label="Close location details"
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-md transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {selectedEarthquake && (
          <div className="px-5 py-3.5 bg-[#0e1628] border-b border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-400">
                <span
                  className="font-semibold"
                  style={{ color: magnitudeColorHex(selectedEarthquake.magnitude) }}
                >
                  Seismic Event · {selectedEarthquake.severity}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatCoord(selectedEarthquake.lat, selectedEarthquake.lon)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-300">
                  {formatRelativeTime(selectedEarthquake.timeMs, activeTimestampMs)} (
                  {formatEventUtcTime(selectedEarthquake.timeMs)})
                </span>
                {selectedEarthquake.tsunami && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-rose-400 font-medium">Tsunami Advisory</span>
                  </>
                )}
              </div>
              <h2 className="text-[15px] font-semibold text-slate-100 mt-1 truncate">
                {selectedEarthquake.place}
              </h2>
            </div>

            <div className="flex items-center gap-5 shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-l border-slate-800 pl-4">
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Magnitude</div>
                  <div
                    className="font-mono tabular-nums text-[16px] font-semibold whitespace-nowrap"
                    style={{ color: magnitudeColorHex(selectedEarthquake.magnitude) }}
                  >
                    {selectedEarthquake.magnitude.toFixed(1)}
                    <span className="text-[11px] font-normal text-slate-400 ml-1 uppercase">
                      {selectedEarthquake.magType}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Hypocenter</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {selectedEarthquake.depthKm.toFixed(1)}
                    <span className="text-[11px] text-slate-400 ml-1">km</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Felt Reports</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {selectedEarthquake.felt !== null
                      ? selectedEarthquake.felt.toLocaleString()
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">Origin UTC</div>
                  <div className="font-mono tabular-nums text-[15px] font-medium text-slate-200 whitespace-nowrap">
                    {formatEventUtcTime(selectedEarthquake.timeMs).replace(' UTC', '')}
                    <span className="text-[11px] text-slate-400 ml-1">UTC</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClearTarget}
                aria-label="Close earthquake details"
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-md transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Primary Tab Strip + Live Surface Coordinate & Geomagnetic Readout */}
        <div className="px-4 py-2 border-b border-slate-800/80 flex items-center justify-between gap-4">
          <div
            role="tablist"
            aria-label="Dashboard sections"
            className="flex items-center gap-1 p-0.5 bg-[#060911] rounded-lg border border-slate-800/80 overflow-x-auto terra-scroll"
          >
            {(
              [
                { id: 'overview', label: 'Overview' },
                { id: 'layers', label: 'Data Layers' },
                { id: 'seismic', label: 'Seismic' },
                { id: 'stations', label: 'Stations' },
                { id: 'satellites', label: 'Satellites' },
              ] as { id: DockTab; label: string }[]
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => onChangeTab(tab.id)}
                  className={`px-3.5 py-1.5 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                    active
                      ? 'bg-slate-800 text-cyan-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="hidden md:flex items-center gap-3 text-[12px] font-mono tabular-nums text-slate-400 shrink-0">
            {settings.showMagneticField && magneticProbe ? (
              <span className="text-indigo-300 whitespace-nowrap">
                |B| {magneticProbe.intensityUt.toFixed(1)} µT · Dip{' '}
                {magneticProbe.inclinationDeg > 0 ? '+' : ''}
                {magneticProbe.inclinationDeg.toFixed(0)}°
              </span>
            ) : (
              <span className="whitespace-nowrap">
                {cursorCoords
                  ? formatCoord(cursorCoords.lat, cursorCoords.lon)
                  : 'Drag to orbit · Scroll to zoom'}
              </span>
            )}
            <span aria-hidden="true" className="text-slate-700">
              /
            </span>
            <span className="text-slate-200 whitespace-nowrap">
              {formatUtcClock(settings.solarHourUtc)}
            </span>
          </div>
        </div>

        {/* Real-Time vs 24h Historical Weather & Seismic Time-Scrubber Bar */}
        <div className="px-4 py-2 bg-[#070c17] border-b border-slate-800/80 flex flex-wrap md:flex-nowrap items-center justify-between gap-3">
          {/* Live / 24h History Mode Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Telemetry timeline mode"
              className="flex items-center gap-0.5 p-0.5 bg-[#050811] rounded-md border border-slate-800/90"
            >
              <button
                type="button"
                aria-pressed={!isHistorical}
                onClick={() => onSetTimelineMode('live')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  !isHistorical
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Live
              </button>
              <button
                type="button"
                aria-pressed={isHistorical}
                onClick={() => onSetTimelineMode('historical')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  isHistorical
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                24h History
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleHistoryPlay}
              aria-label={historyPlaying ? 'Pause 24-hour playback' : 'Play 24-hour history'}
              title={historyPlaying ? 'Pause 24h replay' : 'Replay past 24 hours'}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                historyPlaying
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-slate-600'
              }`}
            >
              {historyPlaying ? (
                <Pause className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              <span>{historyPlaying ? 'Pause' : 'Replay'}</span>
            </button>
          </div>

          {/* 24-Hour Historical Snapshot Scrubber */}
          <div className="flex items-center gap-2.5 flex-1 min-w-[200px]">
            <span className="text-[11px] font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
              -24h
            </span>
            <input
              type="range"
              min={-24}
              max={0}
              step={1}
              value={isHistorical ? historyOffsetHours : 0}
              aria-label="Scrub historical weather and seismic snapshots over the past 24 hours"
              onChange={(e) => onScrubHistoryOffset(Number(e.target.value))}
              className="terra-slider w-full"
            />
            <span className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
              Now
            </span>
          </div>

          {/* Active Snapshot Timestamp & Synced Weather/Seismic Summary */}
          <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums shrink-0">
            <span
              className={`font-semibold whitespace-nowrap ${
                isHistorical ? 'text-amber-300' : 'text-cyan-300'
              }`}
            >
              {isHistorical
                ? `T${historyOffsetHours}h · ${formatEventUtcTime(activeTimestampMs)}`
                : `Live · ${formatEventUtcTime(activeTimestampMs)}`}
            </span>
            <span aria-hidden="true" className="text-slate-700 hidden sm:inline">
              ·
            </span>
            <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
              Cloud {weatherSnapshot.meanCloudCoverPct}% · {seismicSnapshot.events.length} quakes
            </span>
          </div>
        </div>

        {/* Tab Panel Body */}
        <div className="px-5 py-3.5">
          {activeTab === 'overview' && (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Global Planetary Telemetry Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 shrink-0">
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">
                    Mean Surface Temp
                  </div>
                  <div className="font-mono tabular-nums text-[17px] font-semibold text-slate-100 mt-0.5 whitespace-nowrap">
                    +14.92
                    <span className="text-[11px] font-normal text-slate-400 ml-1">°C</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">
                    Atmospheric CO₂
                  </div>
                  <div className="font-mono tabular-nums text-[17px] font-semibold text-slate-100 mt-0.5 whitespace-nowrap">
                    426.8
                    <span className="text-[11px] font-normal text-slate-400 ml-1">ppm</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">
                    Global Cloud Cover
                  </div>
                  <div className="font-mono tabular-nums text-[17px] font-semibold text-slate-100 mt-0.5 whitespace-nowrap">
                    {weatherSnapshot.meanCloudCoverPct}
                    <span className="text-[11px] font-normal text-slate-400 ml-1">%</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">
                    Tracked Orbits
                  </div>
                  <div className="font-mono tabular-nums text-[17px] font-semibold text-slate-100 mt-0.5 whitespace-nowrap">
                    {SATELLITES.length}
                    <span className="text-[11px] font-normal text-slate-400 ml-1">craft</span>
                  </div>
                </div>
              </div>

              {/* Solar Terminator Time Scrubber & Rotation Controls */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 lg:border-l lg:border-slate-800 lg:pl-5 flex-1">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ solarAutoAdvance: !settings.solarAutoAdvance })
                  }
                  aria-label={
                    settings.solarAutoAdvance ? 'Pause solar time' : 'Animate solar time'
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    settings.solarAutoAdvance
                      ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
                  }`}
                >
                  {settings.solarAutoAdvance ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>Solar Cycle</span>
                </button>

                <div className="flex flex-col flex-1 min-w-[140px] gap-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Terminator Time</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {formatUtcClock(settings.solarHourUtc)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={0.1}
                    value={settings.solarHourUtc}
                    aria-label="Solar UTC hour"
                    onChange={(e) =>
                      onUpdateSettings({
                        solarHourUtc: Number(e.target.value),
                        solarAutoAdvance: false,
                      })
                    }
                    className="terra-slider w-full"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onUpdateSettings({ autoRotate: !settings.autoRotate })}
                  aria-pressed={settings.autoRotate}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    settings.autoRotate
                      ? 'bg-slate-800 border-slate-600 text-slate-100'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Spin</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'layers' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Scientific Surface Map Mode Switcher */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {DATA_MODES.map((mode) => {
                    const active = settings.dataMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => onUpdateSettings({ dataMode: mode.id as DataLayerMode })}
                        className={`px-3 py-1.5 text-[12px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-200'
                            : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>

                {/* Calibrated Color Ramp Legend */}
                <div className="flex flex-col gap-1 min-w-[210px] lg:w-[236px] shrink-0">
                  <div
                    className="h-2 w-full rounded-sm border border-slate-700/70"
                    style={{ background: activeDataModeSpec.gradientCss }}
                  />
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                    <span>{activeDataModeSpec.minLabel}</span>
                    <span>{activeDataModeSpec.midLabel}</span>
                    <span>{activeDataModeSpec.maxLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/70">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-slate-400">
                  {settings.dataMode === 'precipitation' ? (
                    <>
                      <span
                        className={`font-medium ${
                          isHistorical ? 'text-amber-300' : 'text-cyan-300'
                        }`}
                      >
                        {isHistorical
                          ? `Archive T${historyOffsetHours}h`
                          : weatherSnapshot.source === 'live'
                            ? 'Open-Meteo Live'
                            : 'Synoptic Model'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-300">
                        Cloud {weatherSnapshot.meanCloudCoverPct}%
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-300">
                        Peak {weatherSnapshot.peakPrecipitationMm.toFixed(1)} mm/h
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatUpdatedUtc(weatherSnapshot.updatedAtIso)}
                      </span>
                      <button
                        type="button"
                        onClick={onRefreshWeather}
                        disabled={weatherLoading}
                        className="inline-flex items-center gap-1 ml-1 px-2.5 py-0.5 text-[11px] font-medium text-slate-200 hover:text-white bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${weatherLoading ? 'animate-spin' : ''}`}
                        />
                        <span>{weatherLoading ? 'Updating' : 'Refresh'}</span>
                      </button>
                    </>
                  ) : settings.showMagneticField ? (
                    <>
                      <span className="text-indigo-300 font-medium">
                        IGRF Dipole Vector Field
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-300">
                        23–65 µT
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {magneticProbe
                          ? `Probe ${magneticProbe.intensityUt.toFixed(1)} µT · Inc ${magneticProbe.inclinationDeg > 0 ? '+' : ''}${magneticProbe.inclinationDeg.toFixed(1)}° · Dec ${magneticProbe.declinationDeg > 0 ? '+' : ''}${magneticProbe.declinationDeg.toFixed(1)}°`
                          : 'Hover globe surface to inspect local B-field inclination & flux'}
                      </span>
                    </>
                  ) : (
                    <span>{activeDataModeSpec.description}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {layerToggles.map((toggle) => {
                    const isOn = settings[toggle.key];
                    const isMagnetic = toggle.key === 'showMagneticField';
                    return (
                      <button
                        key={toggle.key}
                        type="button"
                        aria-pressed={isOn}
                        onClick={() => onUpdateSettings({ [toggle.key]: !isOn })}
                        className={`px-3 py-1 text-[12px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isOn
                            ? isMagnetic
                              ? 'bg-indigo-500/20 border-indigo-400/60 text-indigo-200'
                              : 'bg-slate-800 border-slate-600 text-slate-100'
                            : 'bg-[#070b14] border-slate-800/80 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {toggle.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'seismic' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto terra-scroll">
                  {(
                    [
                      { min: 0, label: 'All Events' },
                      { min: 4.5, label: 'M 4.5+' },
                      { min: 5.0, label: 'M 5.0+' },
                    ] as const
                  ).map((opt) => {
                    const active = seismicMinMag === opt.min;
                    return (
                      <button
                        key={opt.min}
                        type="button"
                        onClick={() => setSeismicMinMag(opt.min)}
                        className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-slate-800 text-amber-300'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    aria-pressed={settings.showEarthquakes}
                    onClick={() =>
                      onUpdateSettings({ showEarthquakes: !settings.showEarthquakes })
                    }
                    className={`ml-1 px-3 py-1 text-[12px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      settings.showEarthquakes
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                        : 'bg-[#070b14] border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {settings.showEarthquakes ? 'Pins Visible' : 'Pins Hidden'}
                  </button>
                </div>

                <div className="flex items-center gap-2.5 text-[12px] text-slate-400 shrink-0">
                  <span className="text-amber-300 font-medium whitespace-nowrap">
                    {isHistorical
                      ? `Archive T${historyOffsetHours}h`
                      : seismicSnapshot.source === 'live'
                        ? 'USGS Live'
                        : 'Seismic Model'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums whitespace-nowrap">
                    {filteredEarthquakes.length} events · Max M {seismicSnapshot.maxMagnitude.toFixed(1)}
                  </span>
                  <button
                    type="button"
                    onClick={onRefreshSeismic}
                    disabled={seismicLoading}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium text-slate-200 hover:text-white bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${seismicLoading ? 'animate-spin' : ''}`}
                    />
                    <span>{seismicLoading ? 'Updating' : 'Refresh'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1 terra-scroll">
                {filteredEarthquakes.length === 0 ? (
                  <div className="text-[12px] text-slate-400 py-3">
                    No recorded earthquakes match this magnitude threshold in the selected 24-hour window.
                  </div>
                ) : (
                  filteredEarthquakes.map((ev) => {
                    const isSelected =
                      settings.selectedTarget?.kind === 'earthquake' &&
                      settings.selectedTarget.id === ev.id;
                    const magColor = magnitudeColorHex(ev.magnitude);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => onSelectEarthquake(ev)}
                        className={`text-left px-3.5 py-2 rounded-lg border transition-colors shrink-0 w-[236px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                          isSelected
                            ? 'bg-[#1a1826] border-amber-400/70'
                            : 'bg-[#070b14] border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                          <span className="font-semibold" style={{ color: magColor }}>
                            M {ev.magnitude.toFixed(1)} · {ev.severity}
                          </span>
                          <span className="text-slate-400">
                            {formatRelativeTime(ev.timeMs, activeTimestampMs)}
                          </span>
                        </div>
                        <div className="text-[13px] font-medium text-slate-100 truncate mt-0.5">
                          {ev.place}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1 text-[11px] font-mono tabular-nums text-slate-400">
                          <span>Depth {ev.depthKm.toFixed(1)} km</span>
                          <span className="text-slate-300">
                            {formatEventUtcTime(ev.timeMs)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'stations' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto terra-scroll">
                  {(['all', 'climate', 'seismic', 'oceanic', 'atmospheric'] as const).map(
                    (cat) => {
                      const active = stationFilter === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setStationFilter(cat)}
                          className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? 'bg-slate-800 text-cyan-300'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {cat === 'all' ? 'All Stations' : CATEGORY_LABELS[cat]}
                        </button>
                      );
                    },
                  )}
                </div>
                <span className="text-[12px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
                  {filteredStations.length} nodes
                </span>
              </div>

              <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1 terra-scroll">
                {filteredStations.map((station) => {
                  const isSelected =
                    settings.selectedTarget?.kind === 'station' &&
                    settings.selectedTarget.id === station.id;
                  return (
                    <button
                      key={station.id}
                      type="button"
                      onClick={() => onSelectStation(station.id)}
                      className={`text-left px-3.5 py-2 rounded-lg border transition-colors shrink-0 w-[212px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                        isSelected
                          ? 'bg-[#122038] border-cyan-400/70'
                          : 'bg-[#070b14] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span style={{ color: CATEGORY_COLORS[station.category] }}>
                          {CATEGORY_LABELS[station.category]}
                        </span>
                        <span className={statusTone(station.status)}>{station.status}</span>
                      </div>
                      <div className="text-[13px] font-medium text-slate-100 truncate mt-0.5">
                        {station.name}
                      </div>
                      <div className="flex items-baseline justify-between gap-2 mt-1 text-[12px]">
                        <span className="text-slate-400 truncate">{station.region}</span>
                        <span className="font-mono tabular-nums font-medium text-slate-200 whitespace-nowrap shrink-0">
                          {station.primaryMetricValue} {station.primaryMetricUnit}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'satellites' && (
            <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1 terra-scroll">
              {SATELLITES.map((sat) => {
                const isSelected =
                  settings.selectedTarget?.kind === 'satellite' &&
                  settings.selectedTarget.id === sat.id;
                const live = satPosMap.get(sat.id);
                return (
                  <button
                    key={sat.id}
                    type="button"
                    onClick={() => onSelectSatellite(sat.id)}
                    className={`text-left px-3.5 py-2 rounded-lg border transition-colors shrink-0 w-[224px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                      isSelected
                        ? 'bg-[#122038] border-cyan-400/70'
                        : 'bg-[#070b14] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span style={{ color: sat.accentColor }}>{sat.orbitType}</span>
                      <span className="font-mono tabular-nums">
                        {sat.altitudeKm.toLocaleString()} km
                      </span>
                    </div>
                    <div className="text-[13px] font-medium text-slate-100 truncate mt-0.5">
                      {sat.name}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 text-[11px] font-mono tabular-nums text-slate-400">
                      <span>{sat.velocityKms.toFixed(2)} km/s</span>
                      <span className="text-slate-300 truncate">
                        {live ? formatCoord(live.lat, live.lon) : `${sat.inclinationDeg}° inc`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
