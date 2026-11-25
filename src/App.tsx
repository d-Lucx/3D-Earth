import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BottomControlDock,
  type DockTab,
  type TimelineMode,
} from './components/BottomControlDock';
import { TopBar } from './components/TopBar';
import type { CameraPresetId, SelectedTarget } from './data/earthData';
import {
  EarthSceneEngine,
  type HoverInfo,
  type MagneticProbeReading,
  type SatelliteLivePos,
  type SceneSettings,
} from './three/EarthSceneEngine';
import {
  buildModeledWeatherTimeline,
  fetchGlobalWeatherTimeline,
  fetchPointWeather,
  getWeatherFrameAtOffset,
  type GlobalWeatherTimeline,
  type StationWeatherReading,
} from './services/weatherTelemetry';
import {
  buildFallbackSeismicSnapshot,
  fetchRealTimeSeismicSnapshot,
  sliceSeismicSnapshotAtTime,
  type EarthquakeEvent,
  type SeismicSnapshot,
} from './services/seismicTelemetry';

const INITIAL_SETTINGS: SceneSettings = {
  dataMode: 'natural',
  showClouds: true,
  showCityLights: true,
  showStations: true,
  showSatellites: true,
  showArcs: true,
  showGraticule: false,
  showMagneticField: false,
  showEarthquakes: true,
  autoRotate: true,
  solarHourUtc: 15.5,
  solarAutoAdvance: false,
  selectedTarget: null,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EarthSceneEngine | null>(null);

  const [settings, setSettings] = useState<SceneSettings>(INITIAL_SETTINGS);
  const [activePreset, setActivePreset] = useState<CameraPresetId | null>('global');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<DockTab>('overview');
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [magneticProbe, setMagneticProbe] = useState<MagneticProbeReading | null>(null);
  const [satellitePositions, setSatellitePositions] = useState<SatelliteLivePos[]>([]);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [weatherTimeline, setWeatherTimeline] = useState<GlobalWeatherTimeline>(() =>
    buildModeledWeatherTimeline(),
  );
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [seismicArchive, setSeismicArchive] = useState<SeismicSnapshot>(() =>
    buildFallbackSeismicSnapshot(),
  );
  const [seismicLoading, setSeismicLoading] = useState(false);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('live');
  const [historyOffsetHours, setHistoryOffsetHours] = useState<number>(0);
  const [historyPlaying, setHistoryPlaying] = useState<boolean>(false);
  const [focusedLocationWeather, setFocusedLocationWeather] =
    useState<StationWeatherReading | null>(null);
  const weatherAbortRef = useRef<AbortController | null>(null);
  const seismicAbortRef = useRef<AbortController | null>(null);

  const effectiveOffsetHours = timelineMode === 'live' ? 0 : historyOffsetHours;

  const activeWeatherFrame = useMemo(
    () => getWeatherFrameAtOffset(weatherTimeline, effectiveOffsetHours),
    [weatherTimeline, effectiveOffsetHours],
  );

  const activeTimestampMs = activeWeatherFrame.timestampMs;
  const activeWeatherSnapshot = activeWeatherFrame.snapshot;

  const activeSeismicSnapshot = useMemo(
    () =>
      sliceSeismicSnapshotAtTime(
        seismicArchive,
        activeTimestampMs,
        effectiveOffsetHours,
      ),
    [seismicArchive, activeTimestampMs, effectiveOffsetHours],
  );

  // Mount Three.js engine once inside isolated container ref
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new EarthSceneEngine(container, INITIAL_SETTINGS, {
      onSelectTarget: (target) => {
        setActivePreset(null);
        setSettings((prev) => ({ ...prev, selectedTarget: target }));
        if (target) {
          setDockCollapsed(false);
        }
      },
      onHoverTarget: (info) => {
        setHoverInfo(info);
      },
      onCursorCoords: (coords) => {
        setCursorCoords(coords);
      },
      onMagneticProbe: (reading) => {
        setMagneticProbe(reading);
      },
      onSolarHourTick: (hourUtc) => {
        setSettings((prev) => ({ ...prev, solarHourUtc: hourUtc }));
      },
      onSatellitePositions: (positions) => {
        setSatellitePositions(positions);
      },
      onWebGLUnavailable: () => {
        setWebglUnavailable(true);
      },
    });

    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Push React setting updates into the Three.js engine without remounting WebGL
  useEffect(() => {
    engineRef.current?.applySettings(settings);
  }, [settings]);

  // Synchronize active (live or historical) weather textures to the 3D globe
  useEffect(() => {
    engineRef.current?.updateWeatherData(activeWeatherSnapshot.samples);
  }, [activeWeatherSnapshot]);

  // Synchronize active (live or historical) seismic pins to the 3D globe
  useEffect(() => {
    engineRef.current?.updateEarthquakes(activeSeismicSnapshot.events, activeTimestampMs);
  }, [activeSeismicSnapshot, activeTimestampMs]);

  // Historical 24-hour replay playback loop
  useEffect(() => {
    if (!historyPlaying) return;
    const id = window.setInterval(() => {
      setHistoryOffsetHours((prev) => {
        if (prev >= 0) return -24;
        return prev + 1;
      });
    }, 850);
    return () => window.clearInterval(id);
  }, [historyPlaying]);

  // Align Earth's solar UTC terminator with scrubbed historical timestamps
  useEffect(() => {
    if (timelineMode !== 'historical') return;
    const d = new Date(activeTimestampMs);
    if (Number.isNaN(d.getTime())) return;
    const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;
    setSettings((prev) => ({
      ...prev,
      solarAutoAdvance: false,
      solarHourUtc: utcHour,
    }));
  }, [timelineMode, activeTimestampMs]);

  // Fetch real-time + past-24h global cloud cover & precipitation timeline
  const refreshWeather = useCallback(async () => {
    weatherAbortRef.current?.abort();
    const controller = new AbortController();
    weatherAbortRef.current = controller;
    setWeatherLoading(true);
    try {
      const timeline = await fetchGlobalWeatherTimeline(controller.signal);
      if (!controller.signal.aborted) {
        setWeatherTimeline(timeline);
      }
    } finally {
      if (!controller.signal.aborted) {
        setWeatherLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshWeather();
    const intervalId = window.setInterval(() => {
      void refreshWeather();
    }, 10 * 60 * 1000);
    return () => {
      window.clearInterval(intervalId);
      weatherAbortRef.current?.abort();
    };
  }, [refreshWeather]);

  // Fetch real-time + 48h global USGS seismic archive (auto-refresh every 5 minutes)
  const refreshSeismic = useCallback(async () => {
    seismicAbortRef.current?.abort();
    const controller = new AbortController();
    seismicAbortRef.current = controller;
    setSeismicLoading(true);
    try {
      const snapshot = await fetchRealTimeSeismicSnapshot(controller.signal);
      if (!controller.signal.aborted) {
        setSeismicArchive(snapshot);
      }
    } finally {
      if (!controller.signal.aborted) {
        setSeismicLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshSeismic();
    const intervalId = window.setInterval(() => {
      void refreshSeismic();
    }, 5 * 60 * 1000);
    return () => {
      window.clearInterval(intervalId);
      seismicAbortRef.current?.abort();
    };
  }, [refreshSeismic]);

  // Fetch live current weather whenever a searched global city/location is selected
  useEffect(() => {
    if (settings.selectedTarget?.kind !== 'location') {
      setFocusedLocationWeather(null);
      return;
    }
    const { lat, lon } = settings.selectedTarget.location;
    const controller = new AbortController();
    setFocusedLocationWeather(null);
    void fetchPointWeather(lat, lon, controller.signal).then((reading) => {
      if (!controller.signal.aborted) {
        setFocusedLocationWeather(reading);
      }
    });
    return () => controller.abort();
  }, [settings.selectedTarget]);

  // Keyboard shortcuts: H toggles Zen mode, Escape clears selected target
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'h' || event.key === 'H') {
        setDockCollapsed((prev) => !prev);
      } else if (event.key === 'Escape') {
        setSettings((prev) =>
          prev.selectedTarget ? { ...prev, selectedTarget: null } : prev,
        );
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUpdateSettings = useCallback((patch: Partial<SceneSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectPreset = useCallback((presetId: CameraPresetId) => {
    setActivePreset(presetId);
    setSettings((prev) => ({ ...prev, selectedTarget: null }));
    engineRef.current?.flyToPreset(presetId);
  }, []);

  const handleResetView = useCallback(() => {
    setActivePreset('global');
    setSettings(INITIAL_SETTINGS);
    setTimelineMode('live');
    setHistoryOffsetHours(0);
    setHistoryPlaying(false);
    setDockCollapsed(false);
    engineRef.current?.flyToPreset('global');
  }, []);

  const handleSetTimelineMode = useCallback((mode: TimelineMode) => {
    setHistoryPlaying(false);
    if (mode === 'live') {
      setTimelineMode('live');
      setHistoryOffsetHours(0);
      const now = new Date();
      setSettings((prev) => ({
        ...prev,
        solarHourUtc: now.getUTCHours() + now.getUTCMinutes() / 60,
      }));
    } else {
      setTimelineMode('historical');
      setHistoryOffsetHours((prev) => (prev === 0 ? -6 : prev));
    }
  }, []);

  const handleScrubHistoryOffset = useCallback((offsetHours: number) => {
    const clamped = Math.max(-24, Math.min(0, Math.round(offsetHours)));
    setHistoryPlaying(false);
    if (clamped === 0) {
      setTimelineMode('live');
      setHistoryOffsetHours(0);
      const now = new Date();
      setSettings((prev) => ({
        ...prev,
        solarHourUtc: now.getUTCHours() + now.getUTCMinutes() / 60,
      }));
    } else {
      setTimelineMode('historical');
      setHistoryOffsetHours(clamped);
    }
  }, []);

  const handleToggleHistoryPlay = useCallback(() => {
    if (historyPlaying) {
      setHistoryPlaying(false);
      return;
    }
    setTimelineMode('historical');
    setHistoryOffsetHours((prev) => (prev >= 0 ? -24 : prev));
    setHistoryPlaying(true);
  }, [historyPlaying]);

  const handleSelectStation = useCallback((stationId: string) => {
    setActivePreset(null);
    setSettings((prev) => ({
      ...prev,
      showStations: true,
      selectedTarget: { kind: 'station', id: stationId },
    }));
    engineRef.current?.flyToStation(stationId);
  }, []);

  const handleSelectSatellite = useCallback((satId: string) => {
    setActivePreset(null);
    setSettings((prev) => ({
      ...prev,
      showSatellites: true,
      selectedTarget: { kind: 'satellite', id: satId },
    }));
    engineRef.current?.flyToSatellite(satId);
  }, []);

  const handleSelectEarthquake = useCallback((event: EarthquakeEvent) => {
    setActivePreset(null);
    setDockCollapsed(false);
    setSettings((prev) => ({
      ...prev,
      showEarthquakes: true,
      selectedTarget: { kind: 'earthquake', id: event.id, event },
    }));
    engineRef.current?.flyToCoordinates(event.lat, event.lon, 2.08);
  }, []);

  const handleSelectSearchTarget = useCallback((target: SelectedTarget) => {
    setActivePreset(null);
    setDockCollapsed(false);
    if (target.kind === 'station') {
      setSettings((prev) => ({
        ...prev,
        showStations: true,
        selectedTarget: target,
      }));
      engineRef.current?.flyToStation(target.id);
    } else if (target.kind === 'satellite') {
      setSettings((prev) => ({
        ...prev,
        showSatellites: true,
        selectedTarget: target,
      }));
      engineRef.current?.flyToSatellite(target.id);
    } else if (target.kind === 'earthquake') {
      setSettings((prev) => ({
        ...prev,
        showEarthquakes: true,
        selectedTarget: target,
      }));
      engineRef.current?.flyToCoordinates(target.event.lat, target.event.lon, 2.08);
    } else {
      setSettings((prev) => ({
        ...prev,
        selectedTarget: target,
      }));
      engineRef.current?.flyToCoordinates(target.location.lat, target.location.lon, 2.12);
    }
  }, []);

  const handleClearTarget = useCallback(() => {
    setSettings((prev) => ({ ...prev, selectedTarget: null }));
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#060911] text-slate-100 select-none">
      {/* Isolated full-viewport 3D WebGL mount container */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full"
        aria-label="Interactive 3D Earth viewport"
      />

      {/* Graceful fallback if WebGL2 cannot be initialized */}
      {webglUnavailable && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-[#060911]">
          <div className="max-w-md w-full p-6 rounded-xl bg-[#0a101d] border border-slate-800 text-center">
            <h1 className="text-lg font-semibold text-slate-100">
              3D WebGL Context Unavailable
            </h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              Terra Atlas requires WebGL acceleration to render the interactive planetary globe.
              Enable hardware acceleration in your browser settings and reload the page.
            </p>
          </div>
        </div>
      )}

      {/* Minimal 3-Zone Top Bar with Global Location Search */}
      <TopBar
        activePreset={activePreset}
        onSelectPreset={handleSelectPreset}
        onSelectSearchTarget={handleSelectSearchTarget}
        onResetView={handleResetView}
      />

      {/* Lightweight non-blocking 3D hover tooltip */}
      {hoverInfo && !webglUnavailable && (
        <div
          className="fixed z-30 pointer-events-none px-3 py-2 rounded-md bg-[#0a101d]/96 border border-slate-700/90 shadow-lg max-w-[300px]"
          style={{
            left: `${Math.min(Math.max(hoverInfo.x + 14, 16), window.innerWidth - 310)}px`,
            top: `${Math.min(Math.max(hoverInfo.y - (hoverInfo.details ? 64 : 46), 68), window.innerHeight - 130)}px`,
          }}
        >
          <div
            className="text-[12px] font-semibold truncate"
            style={{ color: hoverInfo.kind === 'earthquake' ? hoverInfo.accentColor : '#f1f5f9' }}
          >
            {hoverInfo.label}
          </div>
          <div
            className={`text-[11px] truncate mt-0.5 ${
              hoverInfo.kind === 'earthquake'
                ? 'text-slate-200 font-medium'
                : 'font-mono tabular-nums text-cyan-300'
            }`}
          >
            {hoverInfo.sublabel}
          </div>
          {hoverInfo.details && (
            <div className="text-[11px] font-mono tabular-nums text-slate-400 truncate mt-0.5">
              {hoverInfo.details}
            </div>
          )}
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      {!webglUnavailable && (
        <BottomControlDock
          settings={settings}
          collapsed={dockCollapsed}
          activeTab={activeTab}
          cursorCoords={cursorCoords}
          magneticProbe={magneticProbe}
          satellitePositions={satellitePositions}
          weatherSnapshot={activeWeatherSnapshot}
          weatherLoading={weatherLoading}
          seismicSnapshot={activeSeismicSnapshot}
          seismicLoading={seismicLoading}
          timelineMode={timelineMode}
          historyOffsetHours={historyOffsetHours}
          historyPlaying={historyPlaying}
          activeTimestampMs={activeTimestampMs}
          focusedLocationWeather={focusedLocationWeather}
          onSetTimelineMode={handleSetTimelineMode}
          onScrubHistoryOffset={handleScrubHistoryOffset}
          onToggleHistoryPlay={handleToggleHistoryPlay}
          onRefreshWeather={() => void refreshWeather()}
          onRefreshSeismic={() => void refreshSeismic()}
          onToggleCollapse={() => setDockCollapsed((prev) => !prev)}
          onChangeTab={setActiveTab}
          onUpdateSettings={handleUpdateSettings}
          onSelectStation={handleSelectStation}
          onSelectSatellite={handleSelectSatellite}
          onSelectEarthquake={handleSelectEarthquake}
          onClearTarget={handleClearTarget}
        />
      )}
    </div>
  );
}
