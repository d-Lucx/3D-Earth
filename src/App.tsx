import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BottomControlDock,
  type DockTab,
  type TimelineMode,
} from './components/BottomControlDock';
import {
  DeepTimeDrawer,
  type FieldCheckFeedback,
} from './components/DeepTimeDrawer';
import { TopBar } from './components/TopBar';
import type { CameraPresetId, SelectedTarget } from './data/earthData';
import {
  DEEP_TIME_CHAPTERS,
  getDeepTimeChapter,
  type DeepTimeEraId,
  type DeepTimeSandboxDefaults,
  type StoryBeacon,
  type StoryBeaconAction,
} from './data/deepTimeData';
import {
  EarthSceneEngine,
  type AppMode,
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

const DEFAULT_CHAPTER = DEEP_TIME_CHAPTERS[0];

const INITIAL_SETTINGS: SceneSettings = {
  appMode: 'telemetry',
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
  deepTimeEra: DEFAULT_CHAPTER.id,
  coreCutaway: false,
  sandbox: { ...DEFAULT_CHAPTER.sandboxDefaults },
  fieldCheckActive: false,
};

function computeSphericalFeedback(
  clickedLat: number,
  clickedLon: number,
  targetLat: number,
  targetLon: number,
  toleranceDeg: number,
): FieldCheckFeedback {
  const toRad = Math.PI / 180;
  const lat1 = clickedLat * toRad;
  const lat2 = targetLat * toRad;
  const dLat = (targetLat - clickedLat) * toRad;
  const dLon = (targetLon - clickedLon) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  const distanceDeg = c / toRad;

  let wrappedDLon = targetLon - clickedLon;
  if (wrappedDLon > 180) wrappedDLon -= 360;
  if (wrappedDLon < -180) wrappedDLon += 360;

  const ns = Math.abs(targetLat - clickedLat) > 6 ? (targetLat > clickedLat ? 'North' : 'South') : '';
  const ew = Math.abs(wrappedDLon) > 6 ? (wrappedDLon > 0 ? 'East' : 'West') : '';
  const directionHint = [ns, ew].filter(Boolean).join('-') || 'Closer';

  return {
    correct: distanceDeg <= toleranceDeg,
    distanceDeg,
    directionHint,
    clickedLat,
    clickedLon,
  };
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EarthSceneEngine | null>(null);

  const [settings, setSettings] = useState<SceneSettings>(INITIAL_SETTINGS);
  const settingsRef = useRef<SceneSettings>(INITIAL_SETTINGS);
  settingsRef.current = settings;

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

  // Deep Time ("Chrono-Atlas") UI state
  const [deepTimeDrawerOpen, setDeepTimeDrawerOpen] = useState(true);
  const [activeBeaconId, setActiveBeaconId] = useState<string | null>(null);
  const [tourPlaying, setTourPlaying] = useState(false);
  const [driftPlaying, setDriftPlaying] = useState(false);
  const [fieldCheckFeedback, setFieldCheckFeedback] = useState<FieldCheckFeedback | null>(
    null,
  );

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
      onSelectBeacon: (beacon: StoryBeacon) => {
        setActiveBeaconId(beacon.id);
        setDeepTimeDrawerOpen(true);
        if (beacon.action === 'volcanic-rift-melt') {
          setSettings((prev) => ({
            ...prev,
            sandbox: { ...prev.sandbox, riftMeltProgress: 0.82 },
          }));
        } else if (beacon.action === 'himalayan-uplift') {
          setDriftPlaying(true);
        }
      },
      onGlobeClickCoords: (coords) => {
        const cur = settingsRef.current;
        if (cur.appMode !== 'deep-time' || !cur.fieldCheckActive) return;
        const chapter = getDeepTimeChapter(cur.deepTimeEra);
        const fb = computeSphericalFeedback(
          coords.lat,
          coords.lon,
          chapter.fieldCheck.targetLat,
          chapter.fieldCheck.targetLon,
          chapter.fieldCheck.toleranceDeg,
        );
        setFieldCheckFeedback(fb);
        if (fb.correct) {
          setSettings((prev) => ({ ...prev, fieldCheckActive: false }));
          engineRef.current?.triggerDeepTimeAction(chapter.defaultAction);
          engineRef.current?.flyToCoordinates(
            chapter.fieldCheck.targetLat,
            chapter.fieldCheck.targetLon,
            2.38,
          );
          if (chapter.id === 'snowball') {
            setSettings((prev) => ({
              ...prev,
              sandbox: { ...prev.sandbox, riftMeltProgress: 0.85 },
            }));
          }
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

  // Deep Time Chronological Tour playback loop
  useEffect(() => {
    if (!tourPlaying || settings.appMode !== 'deep-time') return;
    const id = window.setInterval(() => {
      setSettings((prev) => {
        const idx = DEEP_TIME_CHAPTERS.findIndex((c) => c.id === prev.deepTimeEra);
        const nextChapter = DEEP_TIME_CHAPTERS[(idx + 1) % DEEP_TIME_CHAPTERS.length];
        return {
          ...prev,
          deepTimeEra: nextChapter.id,
          sandbox: { ...nextChapter.sandboxDefaults },
          fieldCheckActive: false,
        };
      });
      setFieldCheckFeedback(null);
      setActiveBeaconId(null);
    }, 9500);
    return () => window.clearInterval(id);
  }, [tourPlaying, settings.appMode]);

  // Pangaea Continental Drift animation loop
  useEffect(() => {
    if (!driftPlaying || settings.appMode !== 'deep-time' || settings.deepTimeEra !== 'pangaea') {
      return;
    }
    const id = window.setInterval(() => {
      setSettings((prev) => {
        const nextVal = prev.sandbox.driftProgress + 0.015;
        if (nextVal >= 1.0) {
          setDriftPlaying(false);
          return {
            ...prev,
            sandbox: { ...prev.sandbox, driftProgress: 1.0 },
          };
        }
        return {
          ...prev,
          sandbox: { ...prev.sandbox, driftProgress: nextVal },
        };
      });
    }, 55);
    return () => window.clearInterval(id);
  }, [driftPlaying, settings.appMode, settings.deepTimeEra]);

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

  // Keyboard shortcuts: H toggles Zen mode, Escape clears selected target / armed quiz
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
        setSettings((prev) => ({
          ...prev,
          selectedTarget: null,
          fieldCheckActive: false,
        }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUpdateSettings = useCallback((patch: Partial<SceneSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleChangeAppMode = useCallback((mode: AppMode) => {
    setTourPlaying(false);
    setDriftPlaying(false);
    setFieldCheckFeedback(null);
    setActiveBeaconId(null);
    if (mode === 'deep-time') {
      setHistoryPlaying(false);
      setDeepTimeDrawerOpen(true);
      setDockCollapsed(false);
      setSettings((prev) => {
        const chapter = getDeepTimeChapter(prev.deepTimeEra);
        return {
          ...prev,
          appMode: 'deep-time',
          selectedTarget: null,
          fieldCheckActive: false,
          sandbox: { ...chapter.sandboxDefaults },
        };
      });
    } else {
      setSettings((prev) => ({
        ...prev,
        appMode: 'telemetry',
        coreCutaway: false,
        fieldCheckActive: false,
      }));
    }
  }, []);

  const handleSelectDeepTimeEra = useCallback((eraId: DeepTimeEraId) => {
    const chapter = getDeepTimeChapter(eraId);
    setDriftPlaying(false);
    setActiveBeaconId(null);
    setFieldCheckFeedback(null);
    setSettings((prev) => ({
      ...prev,
      deepTimeEra: eraId,
      sandbox: { ...chapter.sandboxDefaults },
      fieldCheckActive: false,
    }));
  }, []);

  const handleTriggerDeepTimeAction = useCallback((action: StoryBeaconAction) => {
    engineRef.current?.triggerDeepTimeAction(action);
    if (action === 'volcanic-rift-melt') {
      setSettings((prev) => ({
        ...prev,
        sandbox: {
          ...prev.sandbox,
          riftMeltProgress: prev.sandbox.riftMeltProgress > 0.75 ? 0.0 : 0.88,
        },
      }));
    } else if (action === 'himalayan-uplift') {
      setSettings((prev) => ({
        ...prev,
        sandbox: {
          ...prev.sandbox,
          driftProgress: prev.sandbox.driftProgress > 0.92 ? 0.0 : prev.sandbox.driftProgress,
        },
      }));
      setDriftPlaying(true);
    } else if (action === 'chicxulub-impact') {
      engineRef.current?.flyToCoordinates(21.4, -89.5, 2.45);
    }
  }, []);

  const handleSelectBeacon = useCallback((beacon: StoryBeacon) => {
    setActiveBeaconId(beacon.id);
    engineRef.current?.flyToCoordinates(beacon.lat, beacon.lon, 2.38);
    handleTriggerDeepTimeAction(beacon.action);
  }, [handleTriggerDeepTimeAction]);

  const handleUpdateSandbox = useCallback((patch: Partial<DeepTimeSandboxDefaults>) => {
    setSettings((prev) => ({
      ...prev,
      sandbox: { ...prev.sandbox, ...patch },
    }));
  }, []);

  const handleResetSandbox = useCallback(() => {
    setDriftPlaying(false);
    setSettings((prev) => {
      const chapter = getDeepTimeChapter(prev.deepTimeEra);
      return {
        ...prev,
        sandbox: { ...chapter.sandboxDefaults },
      };
    });
  }, []);

  const handleSelectPreset = useCallback((presetId: CameraPresetId) => {
    setActivePreset(presetId);
    setSettings((prev) => ({ ...prev, selectedTarget: null }));
    engineRef.current?.flyToPreset(presetId);
  }, []);

  const handleResetView = useCallback(() => {
    setActivePreset('global');
    setTourPlaying(false);
    setDriftPlaying(false);
    setFieldCheckFeedback(null);
    setActiveBeaconId(null);
    setTimelineMode('live');
    setHistoryOffsetHours(0);
    setHistoryPlaying(false);
    setDockCollapsed(false);
    setSettings((prev) => {
      if (prev.appMode === 'deep-time') {
        const chapter = getDeepTimeChapter(prev.deepTimeEra);
        engineRef.current?.flyToCoordinates(
          chapter.cameraFocus.lat,
          chapter.cameraFocus.lon,
          chapter.cameraFocus.distance,
        );
        return {
          ...prev,
          coreCutaway: false,
          fieldCheckActive: false,
          sandbox: { ...chapter.sandboxDefaults },
        };
      }
      engineRef.current?.flyToPreset('global');
      return INITIAL_SETTINGS;
    });
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
      appMode: 'telemetry',
      showStations: true,
      selectedTarget: { kind: 'station', id: stationId },
    }));
    engineRef.current?.flyToStation(stationId);
  }, []);

  const handleSelectSatellite = useCallback((satId: string) => {
    setActivePreset(null);
    setSettings((prev) => ({
      ...prev,
      appMode: 'telemetry',
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
      appMode: 'telemetry',
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
        appMode: 'telemetry',
        showStations: true,
        selectedTarget: target,
      }));
      engineRef.current?.flyToStation(target.id);
    } else if (target.kind === 'satellite') {
      setSettings((prev) => ({
        ...prev,
        appMode: 'telemetry',
        showSatellites: true,
        selectedTarget: target,
      }));
      engineRef.current?.flyToSatellite(target.id);
    } else if (target.kind === 'earthquake') {
      setSettings((prev) => ({
        ...prev,
        appMode: 'telemetry',
        showEarthquakes: true,
        selectedTarget: target,
      }));
      engineRef.current?.flyToCoordinates(target.event.lat, target.event.lon, 2.08);
    } else {
      setSettings((prev) => ({
        ...prev,
        appMode: 'telemetry',
        selectedTarget: target,
      }));
      engineRef.current?.flyToCoordinates(target.location.lat, target.location.lon, 2.12);
    }
  }, []);

  const handleClearTarget = useCallback(() => {
    setSettings((prev) => ({ ...prev, selectedTarget: null }));
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#04070f] text-slate-100 select-none">
      {/* Isolated full-viewport 3D WebGL mount container */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full"
        aria-label="Interactive 3D Earth viewport"
      />

      {/* Graceful fallback if WebGL2 cannot be initialized */}
      {webglUnavailable && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-[#04070f]">
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

      {/* Minimal 3-Zone Top Bar with Telemetry | Deep Time Mode Switch & Global Search */}
      <TopBar
        appMode={settings.appMode}
        activeDeepTimeEra={settings.deepTimeEra}
        activePreset={activePreset}
        onChangeAppMode={handleChangeAppMode}
        onSelectPreset={handleSelectPreset}
        onSelectSearchTarget={handleSelectSearchTarget}
        onResetView={handleResetView}
      />

      {/* Collapsible Deep Time ("Chrono-Atlas") Field Guide Drawer */}
      {settings.appMode === 'deep-time' && !webglUnavailable && (
        <DeepTimeDrawer
          open={deepTimeDrawerOpen}
          activeEra={settings.deepTimeEra}
          activeBeaconId={activeBeaconId}
          coreCutaway={settings.coreCutaway}
          sandbox={settings.sandbox}
          fieldCheckActive={settings.fieldCheckActive}
          fieldCheckFeedback={fieldCheckFeedback}
          onToggleOpen={() => setDeepTimeDrawerOpen((prev) => !prev)}
          onSelectEra={handleSelectDeepTimeEra}
          onToggleCoreCutaway={() =>
            setSettings((prev) => ({ ...prev, coreCutaway: !prev.coreCutaway }))
          }
          onSelectBeacon={handleSelectBeacon}
          onUpdateSandbox={handleUpdateSandbox}
          onResetSandbox={handleResetSandbox}
          onToggleFieldCheck={() => {
            setFieldCheckFeedback(null);
            setSettings((prev) => ({ ...prev, fieldCheckActive: !prev.fieldCheckActive }));
          }}
        />
      )}

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
            style={{
              color:
                hoverInfo.kind === 'earthquake' || hoverInfo.kind === 'beacon'
                  ? hoverInfo.accentColor
                  : '#f1f5f9',
            }}
          >
            {hoverInfo.label}
          </div>
          <div
            className={`text-[11px] truncate mt-0.5 ${
              hoverInfo.kind === 'earthquake' || hoverInfo.kind === 'beacon'
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

      {/* Unified Collapsible Bottom Control Dock (switches cleanly to GeologicalScrubber in Deep Time) */}
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
          tourPlaying={tourPlaying}
          driftPlaying={driftPlaying}
          onSelectDeepTimeEra={handleSelectDeepTimeEra}
          onToggleTourPlay={() => setTourPlaying((prev) => !prev)}
          onTriggerDeepTimeAction={handleTriggerDeepTimeAction}
          onChangeDriftProgress={(val) => {
            setDriftPlaying(false);
            handleUpdateSandbox({ driftProgress: val });
          }}
          onToggleDriftPlay={() => {
            setSettings((prev) =>
              prev.sandbox.driftProgress >= 0.99
                ? { ...prev, sandbox: { ...prev.sandbox, driftProgress: 0 } }
                : prev,
            );
            setDriftPlaying((prev) => !prev);
          }}
          onChangeRiftMelt={(val) => handleUpdateSandbox({ riftMeltProgress: val })}
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
