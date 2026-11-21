import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomControlDock, type DockTab } from './components/BottomControlDock';
import { TopBar } from './components/TopBar';
import type { CameraPresetId } from './data/earthData';
import {
  EarthSceneEngine,
  type HoverInfo,
  type SatelliteLivePos,
  type SceneSettings,
} from './three/EarthSceneEngine';

const INITIAL_SETTINGS: SceneSettings = {
  dataMode: 'natural',
  showClouds: true,
  showCityLights: true,
  showStations: true,
  showSatellites: true,
  showArcs: true,
  showGraticule: false,
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
  const [satellitePositions, setSatellitePositions] = useState<SatelliteLivePos[]>([]);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

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
    setDockCollapsed(false);
    engineRef.current?.flyToPreset('global');
  }, []);

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

      {/* Minimal 3-Zone Top Bar */}
      <TopBar
        activePreset={activePreset}
        onSelectPreset={handleSelectPreset}
        onResetView={handleResetView}
      />

      {/* Lightweight non-blocking 3D hover tooltip */}
      {hoverInfo && !webglUnavailable && (
        <div
          className="fixed z-30 pointer-events-none px-3 py-1.5 rounded-md bg-[#0a101d]/95 border border-slate-700/90 shadow-lg max-w-[260px]"
          style={{
            left: `${Math.min(Math.max(hoverInfo.x + 14, 16), window.innerWidth - 260)}px`,
            top: `${Math.min(Math.max(hoverInfo.y - 44, 68), window.innerHeight - 120)}px`,
          }}
        >
          <div className="text-[12px] font-semibold text-slate-100 truncate">
            {hoverInfo.label}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-cyan-300 truncate">
            {hoverInfo.sublabel}
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      {!webglUnavailable && (
        <BottomControlDock
          settings={settings}
          collapsed={dockCollapsed}
          activeTab={activeTab}
          cursorCoords={cursorCoords}
          satellitePositions={satellitePositions}
          onToggleCollapse={() => setDockCollapsed((prev) => !prev)}
          onChangeTab={setActiveTab}
          onUpdateSettings={handleUpdateSettings}
          onSelectStation={handleSelectStation}
          onSelectSatellite={handleSelectSatellite}
          onClearTarget={handleClearTarget}
        />
      )}
    </div>
  );
}
