import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import {
  CAMERA_PRESETS,
  formatCoord,
  type CameraPresetId,
  type SelectedTarget,
} from '../data/earthData';
import {
  searchLocalLocations,
  searchRemoteGeocoding,
  type SearchResultItem,
} from '../services/locationSearch';

import { getDeepTimeChapter, type DeepTimeEraId } from '../data/deepTimeData';
import type { AppMode } from '../three/EarthSceneEngine';

interface TopBarProps {
  appMode: AppMode;
  activeDeepTimeEra: DeepTimeEraId;
  activePreset: CameraPresetId | null;
  onChangeAppMode: (mode: AppMode) => void;
  onSelectPreset: (presetId: CameraPresetId) => void;
  onSelectSearchTarget: (target: SelectedTarget) => void;
  onResetView: () => void;
}

export function TopBar({
  appMode,
  activeDeepTimeEra,
  activePreset,
  onChangeAppMode,
  onSelectPreset,
  onSelectSearchTarget,
  onResetView,
}: TopBarProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [remoteResults, setRemoteResults] = useState<SearchResultItem[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const localResults = useMemo(() => searchLocalLocations(query), [query]);

  // Debounced live worldwide city geocoding for queries >= 2 chars
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemoteResults([]);
      setIsSearchingRemote(false);
      return;
    }

    const controller = new AbortController();
    setIsSearchingRemote(true);

    const timer = window.setTimeout(async () => {
      try {
        const fetched = await searchRemoteGeocoding(trimmed, controller.signal);
        if (!controller.signal.aborted) {
          setRemoteResults(fetched);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingRemote(false);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Merge local + remote results with geographic/name deduplication
  const results = useMemo(() => {
    const merged: SearchResultItem[] = [...localResults];
    const seenNames = new Set(localResults.map((r) => r.title.toLowerCase()));

    for (const remote of remoteResults) {
      const normalized = remote.title.toLowerCase();
      const duplicateNearby = merged.some(
        (existing) =>
          existing.title.toLowerCase() === normalized &&
          existing.lat !== undefined &&
          remote.lat !== undefined &&
          Math.abs(existing.lat - remote.lat) < 0.8 &&
          Math.abs((existing.lon ?? 0) - (remote.lon ?? 0)) < 0.8,
      );
      if (!duplicateNearby && (!seenNames.has(normalized) || merged.length < 4)) {
        merged.push(remote);
      }
      if (merged.length >= 9) break;
    }

    return merged;
  }, [localResults, remoteResults]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [query, results.length]);

  // Close dropdown on click outside
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  // Global "/" shortcut to focus the location search bar
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      setIsOpen(true);
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const commitSelection = (item: SearchResultItem) => {
    onSelectSearchTarget(item.target);
    setQuery(item.title);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIdx((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIdx((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
      );
    } else if (event.key === 'Enter') {
      if (results.length > 0) {
        event.preventDefault();
        commitSelection(results[Math.min(highlightedIdx, results.length - 1)]);
      }
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const activeChapter = getDeepTimeChapter(activeDeepTimeEra);

  return (
    <header className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between gap-4 h-14 px-5 bg-[#070b14]/94 border-b border-slate-800/80">
      {/* Zone 1: Brand wordmark + Telemetry | Deep Time mode switch */}
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-[17px] font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0 select-none">
          Terra Atlas
        </span>

        <div
          role="group"
          aria-label="Atlas exploration mode"
          className="flex items-center gap-0.5 p-0.5 bg-[#0b1220] rounded-lg border border-slate-800 shrink-0"
        >
          <button
            type="button"
            aria-pressed={appMode === 'telemetry'}
            onClick={() => onChangeAppMode('telemetry')}
            className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              appMode === 'telemetry'
                ? 'bg-slate-800 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Telemetry
          </button>
          <button
            type="button"
            aria-pressed={appMode === 'deep-time'}
            onClick={() => onChangeAppMode('deep-time')}
            className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              appMode === 'deep-time'
                ? 'bg-amber-500/20 text-amber-200'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Deep Time
          </button>
        </div>
      </div>

      {/* Zone 2: Hemisphere presets (Telemetry) OR active Geological Chapter summary (Deep Time) */}
      {appMode === 'telemetry' ? (
        <nav
          aria-label="Hemisphere viewpoints"
          className="hidden xl:flex items-center gap-5 text-[13px] font-medium"
        >
          {CAMERA_PRESETS.map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectPreset(preset.id)}
                className={`relative py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-sm ${
                  isActive ? 'text-cyan-300' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {preset.label}
                <span
                  aria-hidden="true"
                  className={`absolute left-0 right-0 -bottom-0.5 h-[1.5px] bg-cyan-400 transition-opacity duration-150 ${
                    isActive ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </nav>
      ) : (
        <div className="hidden lg:flex items-center gap-2.5 text-[12px] min-w-0">
          <span
            className="font-mono tabular-nums font-semibold whitespace-nowrap shrink-0"
            style={{ color: activeChapter.accentColor }}
          >
            {activeChapter.timeframe}
          </span>
          <span aria-hidden="true" className="text-slate-700">
            ·
          </span>
          <span className="text-slate-200 font-medium truncate">
            {activeChapter.title}
          </span>
        </div>
      )}

      {/* Zone 3: Global Location Search + Reset View Action */}
      <div className="flex items-center gap-3 shrink-0">
        <div ref={containerRef} className="relative w-52 sm:w-64 md:w-72">
          <div className="flex items-center h-9 px-3 rounded-md bg-[#0b1220] border border-slate-800 focus-within:border-cyan-400/70 transition-colors">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-2" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onFocus={() => setIsOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setIsOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search city, station, or lat, lon"
              role="combobox"
              aria-label="Search global locations, cities, stations, or satellites"
              aria-expanded={isOpen}
              aria-controls="terra-location-results"
              aria-autocomplete="list"
              className="w-full bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none truncate"
            />
            {isSearchingRemote ? (
              <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0 ml-1.5" />
            ) : query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setRemoteResults([]);
                  inputRef.current?.focus();
                  setIsOpen(true);
                }}
                aria-label="Clear search query"
                className="p-0.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer shrink-0 ml-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-block font-mono text-[11px] text-slate-500 px-1.5 py-0.5 border border-slate-800 rounded shrink-0 ml-1.5 select-none">
                /
              </kbd>
            )}
          </div>

          {isOpen && (
            <div
              id="terra-location-results"
              role="listbox"
              className="absolute right-0 mt-1.5 w-full min-w-[290px] max-h-[340px] overflow-y-auto terra-scroll rounded-lg bg-[#0a101d] border border-slate-800 shadow-[0_18px_42px_rgba(0,0,0,0.75)] py-1 z-30"
            >
              {!query.trim() && (
                <div className="px-3 py-1.5 text-[11px] text-slate-500 border-b border-slate-800/70">
                  Suggested global targets
                </div>
              )}

              {results.length === 0 ? (
                <div className="px-3.5 py-4 text-[12px] text-slate-400 text-center">
                  {isSearchingRemote
                    ? 'Searching global locations...'
                    : `No locations matched "${query.trim()}"`}
                </div>
              ) : (
                results.map((item, idx) => {
                  const isHighlighted = idx === highlightedIdx;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setHighlightedIdx(idx)}
                      onClick={() => commitSelection(item)}
                      className={`w-full text-left px-3 py-2 flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                        isHighlighted ? 'bg-[#122038]' : 'hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-slate-100 truncate">
                          {item.title}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate mt-0.5">
                          <span className="truncate">{item.subtitle}</span>
                          {item.lat !== undefined && item.lon !== undefined && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums text-slate-500 shrink-0">
                                {formatCoord(item.lat, item.lon)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] whitespace-nowrap shrink-0 mt-0.5 ${
                          item.target.kind === 'satellite'
                            ? 'text-violet-300'
                            : item.target.kind === 'station'
                              ? 'text-amber-300'
                              : 'text-cyan-300'
                        }`}
                      >
                        {item.badge}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setQuery('');
            setIsOpen(false);
            onResetView();
          }}
          className="px-4 py-1.5 text-[13px] font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
        >
          Reset View
        </button>
      </div>
    </header>
  );
}
