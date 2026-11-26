import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Crosshair,
  Layers,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import {
  COSMIC_CLOCK_MILESTONES,
  DEEP_TIME_CHAPTERS,
  EARTH_INTERIOR_LAYERS,
  getDeepTimeChapter,
  type DeepTimeEraId,
  type DeepTimeSandboxDefaults,
  type StoryBeacon,
} from '../data/deepTimeData';
import { formatCoord } from '../data/earthData';

export interface FieldCheckFeedback {
  correct: boolean;
  distanceDeg: number;
  directionHint: string;
  clickedLat: number;
  clickedLon: number;
}

interface DeepTimeDrawerProps {
  open: boolean;
  activeEra: DeepTimeEraId;
  activeBeaconId: string | null;
  coreCutaway: boolean;
  sandbox: DeepTimeSandboxDefaults;
  fieldCheckActive: boolean;
  fieldCheckFeedback: FieldCheckFeedback | null;
  onToggleOpen: () => void;
  onSelectEra: (eraId: DeepTimeEraId) => void;
  onToggleCoreCutaway: () => void;
  onSelectBeacon: (beacon: StoryBeacon) => void;
  onUpdateSandbox: (patch: Partial<DeepTimeSandboxDefaults>) => void;
  onResetSandbox: () => void;
  onToggleFieldCheck: () => void;
}

// True proportional 24-hour Cosmic Clock spans (4.54 Ga -> 24.000 hours)
const ERA_CLOCK_SPANS: Record<
  DeepTimeEraId,
  { startHr: number; endHr: number; scaleNote: string }
> = {
  accretion: {
    startHr: 0.0,
    endHr: 0.22,
    scaleNote: 'Earth and the Moon formed in the first 13 minutes after midnight.',
  },
  hadean: {
    startHr: 0.74,
    endHr: 3.91,
    scaleNote: 'Oceans condensed before 01:30 AM while heavy bombardment lasted nearly 4 hours.',
  },
  archean: {
    startHr: 5.5,
    endHr: 12.9,
    scaleNote: 'Microbial life ruled for over 16 hours before complex animals even existed.',
  },
  snowball: {
    startHr: 20.19,
    endHr: 20.64,
    scaleNote: 'Over 84% of Earth’s history had passed before Cryogenian glaciers reached the tropics.',
  },
  pangaea: {
    startHr: 22.23,
    endHr: 23.07,
    scaleNote: 'Pangaea assembled past 10:13 PM—leaving less than two hours to the present.',
  },
  cretaceous: {
    startHr: 23.65,
    endHr: 24.0,
    scaleNote: 'Chicxulub struck at 23:39; modern humans appear in the last 4 seconds (23:59:56).',
  },
};

function polarToCartesian(cx: number, cy: number, r: number, hour24: number) {
  // 00:00 at 12-o'clock (-90°), sweeping clockwise across 24 hours
  const angleRad = ((hour24 / 24) * 360 - 90) * (Math.PI / 180);
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startHr: number,
  endHr: number,
): string {
  // Ensure very brief eras (like Accretion or Snowball) remain clearly visible on the dial
  const minSpanHr = 0.42;
  const clampedEnd = Math.min(24, Math.max(endHr, startHr + minSpanHr));
  const start = polarToCartesian(cx, cy, r, startHr);
  const end = polarToCartesian(cx, cy, r, clampedEnd);
  const largeArcFlag = clampedEnd - startHr > 12 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

interface CosmicClockProps {
  activeEra: DeepTimeEraId;
  onSelectEra: (eraId: DeepTimeEraId) => void;
}

export function CosmicClock({ activeEra, onSelectEra }: CosmicClockProps) {
  const chapter = getDeepTimeChapter(activeEra);
  const span = ERA_CLOCK_SPANS[activeEra];
  const pointerHr = chapter.cosmicClockNorm * 24;
  const elapsedPct = chapter.cosmicClockNorm * 100;

  const cx = 64;
  const cy = 64;
  const outerR = 52;
  const trackR = 45;
  const handTip = polarToCartesian(cx, cy, 37, pointerHr);
  const handDot = polarToCartesian(cx, cy, trackR, pointerHr);

  const majorHours = [0, 6, 12, 18];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span>24-Hour Cosmic Clock</span>
        </div>
        <span className="text-[11px] font-mono tabular-nums text-slate-400">
          4.54 Ga = 24h
        </span>
      </div>

      <div className="flex items-center gap-3.5">
        {/* Precision 24-Hour Radial Scientific Dial */}
        <div className="relative shrink-0 w-[128px] h-[128px]">
          <svg
            viewBox="0 0 128 128"
            className="w-full h-full overflow-visible"
            role="img"
            aria-label={`Cosmic Clock showing ${chapter.title} at ${chapter.cosmicClockTime} on Earth's 24-hour timeline`}
          >
            {/* Subtle concentric calibration rings */}
            <circle
              cx={cx}
              cy={cy}
              r={outerR}
              fill="#060a14"
              stroke="#1e293b"
              strokeWidth="1"
            />
            <circle
              cx={cx}
              cy={cy}
              r={trackR}
              fill="none"
              stroke="#141e33"
              strokeWidth="6"
            />

            {/* 24 hourly perimeter tick marks */}
            {Array.from({ length: 24 }, (_, hr) => {
              const isMajor = hr % 6 === 0;
              const inner = polarToCartesian(cx, cy, isMajor ? outerR - 5 : outerR - 2.5, hr);
              const outer = polarToCartesian(cx, cy, outerR, hr);
              return (
                <line
                  key={hr}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={isMajor ? '#64748b' : '#334155'}
                  strokeWidth={isMajor ? 1.25 : 0.8}
                />
              );
            })}

            {/* Clickable Era Arc Segments */}
            {DEEP_TIME_CHAPTERS.map((item) => {
              const itemSpan = ERA_CLOCK_SPANS[item.id];
              const isActive = item.id === activeEra;
              return (
                <path
                  key={item.id}
                  d={describeArc(cx, cy, trackR, itemSpan.startHr, itemSpan.endHr)}
                  fill="none"
                  stroke={item.accentColor}
                  strokeWidth={isActive ? 7.5 : 4.5}
                  strokeOpacity={isActive ? 1 : 0.4}
                  strokeLinecap="round"
                  className="cursor-pointer transition-opacity hover:opacity-100"
                  onClick={() => onSelectEra(item.id)}
                >
                  <title>{`${item.title} (${item.cosmicClockTime})`}</title>
                </path>
              );
            })}

            {/* Calibrated radial clock hand */}
            <line
              x1={cx}
              y1={cy}
              x2={handTip.x}
              y2={handTip.y}
              stroke={chapter.accentColor}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <circle cx={handDot.x} cy={handDot.y} r="3.2" fill={chapter.accentColor} />
            <circle cx={cx} cy={cy} r="2.4" fill="#e2e8f0" />

            {/* Cardinal 24-hour dial labels */}
            {majorHours.map((hr) => {
              const pt = polarToCartesian(cx, cy, outerR + 9, hr);
              return (
                <text
                  key={hr}
                  x={pt.x}
                  y={pt.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-500 font-mono text-[8px] tabular-nums select-none"
                >
                  {String(hr).padStart(2, '0')}h
                </text>
              );
            })}
          </svg>

          {/* Center Digital Cosmic Time Readout */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-5">
            <span className="font-mono tabular-nums text-[12px] font-semibold text-slate-100 leading-none">
              {chapter.cosmicClockTime.split('–')[0].trim()}
            </span>
            <span className="font-mono tabular-nums text-[9px] text-slate-400 mt-0.5">
              {elapsedPct.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Scale Context & Proportional Ratio Readout */}
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div
              className="font-mono tabular-nums text-[13px] font-semibold"
              style={{ color: chapter.accentColor }}
            >
              {chapter.cosmicClockTime}
            </div>
            <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
              {chapter.timeframe}
            </div>
          </div>

          <p className="text-[11px] text-slate-300 leading-snug">{span.scaleNote}</p>

          <div className="text-[10px] font-mono tabular-nums text-slate-500 pt-1 border-t border-slate-800/80">
            1 hr = 189 Myr · 1 sec = 52.5 kyr
          </div>
        </div>
      </div>

      {/* Compact Clickable 24-Hour Landmark Index */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-slate-800/70">
        {COSMIC_CLOCK_MILESTONES.slice(0, 6).map((ms) => {
          const isCurrent = ms.eraId === activeEra;
          return (
            <button
              key={`${ms.time}-${ms.label}`}
              type="button"
              onClick={() => onSelectEra(ms.eraId)}
              className={`flex items-center justify-between gap-1.5 text-left text-[11px] py-0.5 transition-colors cursor-pointer ${
                isCurrent ? 'text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="truncate">{ms.label}</span>
              <span className="font-mono tabular-nums text-[10px] text-cyan-400/90 shrink-0">
                {ms.time}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DeepTimeDrawer({
  open,
  activeEra,
  activeBeaconId,
  coreCutaway,
  sandbox,
  fieldCheckActive,
  fieldCheckFeedback,
  onToggleOpen,
  onSelectEra,
  onToggleCoreCutaway,
  onSelectBeacon,
  onUpdateSandbox,
  onResetSandbox,
  onToggleFieldCheck,
}: DeepTimeDrawerProps) {
  const chapter = getDeepTimeChapter(activeEra);
  const tidalMultiplier = 1 / Math.pow(Math.max(0.4, sandbox.lunarDistanceRe), 3);
  const co2TempDeltaC = Math.round(3.1 * Math.log2(Math.max(0.2, sandbox.co2Multiplier)) * 10) / 10;

  return (
    <aside
      aria-label="Deep Time Field Guide"
      className="fixed top-16 right-4 z-20 flex items-start pointer-events-none"
      style={{ maxHeight: 'calc(100vh - 210px)' }}
    >
      {/* Collapsible Side Toggle Handle */}
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        title={open ? 'Collapse Field Guide' : 'Expand Field Guide'}
        className="pointer-events-auto mt-3 mr-1.5 inline-flex items-center gap-1 px-2.5 py-2 text-[12px] font-medium text-slate-200 hover:text-white bg-[#0a101d]/95 border border-slate-800 rounded-lg shadow-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        {open ? (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        ) : (
          <>
            <ChevronLeft className="w-4 h-4 text-cyan-400" />
            <BookOpen className="w-3.5 h-3.5 text-cyan-300" />
            <span>Field Guide</span>
          </>
        )}
      </button>

      {open && (
        <div className="pointer-events-auto w-[min(368px,88vw)] max-h-[calc(100vh-210px)] overflow-y-auto terra-scroll bg-[#0a101d]/95 border border-slate-800 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.72)] divide-y divide-slate-800/80">
          {/* 1. Chapter Narrative & Stats */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
              <span style={{ color: chapter.accentColor }}>
                Chapter 0{chapter.index} · {chapter.timeframe}
              </span>
              <span className="text-slate-400">Clock {chapter.cosmicClockTime}</span>
            </div>
            <h2 className="text-[16px] font-semibold text-slate-100 mt-1">
              {chapter.title}
            </h2>
            <p className="text-[12px] text-slate-300 leading-relaxed mt-2">
              {chapter.summary}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">
              <span className="text-slate-300 font-medium">Focus: </span>
              {chapter.educationalFocus}
            </p>

            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800/80">
              {chapter.keyStats.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <div className="text-[10px] text-slate-400 truncate">{stat.label}</div>
                  <div className="font-mono tabular-nums text-[12px] font-semibold text-slate-100 truncate mt-0.5">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. 24-Hour Cosmic Clock Visualizer */}
          <CosmicClock activeEra={activeEra} onSelectEra={onSelectEra} />

          {/* 3. Interactive 90° Core Cutaway Mode */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <div className="text-[13px] font-semibold text-slate-100">
                    Planetary Core Cutaway
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Peel 90° octant to inspect internal layers
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-pressed={coreCutaway}
                onClick={onToggleCoreCutaway}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  coreCutaway
                    ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                {coreCutaway ? 'Cutaway On' : 'Slice Core'}
              </button>
            </div>

            {coreCutaway && (
              <div className="mt-3 space-y-2 pt-2.5 border-t border-slate-800/70">
                {EARTH_INTERIOR_LAYERS.map((layer) => (
                  <div key={layer.name} className="flex items-start gap-2.5 text-[11px]">
                    <span
                      className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0"
                      style={{ backgroundColor: layer.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-200">{layer.name}</span>
                        <span className="font-mono tabular-nums text-slate-400">
                          {layer.temp}
                        </span>
                      </div>
                      <div className="text-slate-400 leading-snug mt-0.5">
                        {layer.depthRange} — {layer.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Chapter Story Beacons */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200 mb-2.5">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>Story Beacons ({chapter.beacons.length})</span>
            </div>
            <div className="space-y-2">
              {chapter.beacons.map((beacon) => {
                const isSelected = activeBeaconId === beacon.id;
                return (
                  <button
                    key={beacon.id}
                    type="button"
                    onClick={() => onSelectBeacon(beacon)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#122038] border-cyan-500/60'
                        : 'bg-[#070c17] border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-slate-100 truncate">
                        {beacon.name}
                      </span>
                      <span
                        className="text-[11px] font-mono tabular-nums shrink-0"
                        style={{ color: beacon.accentColor }}
                      >
                        {beacon.ageLabel}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span className="truncate">{beacon.region}</span>
                      <span className="font-mono tabular-nums text-slate-300 shrink-0">
                        {beacon.metricValue}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug mt-1.5">
                      {beacon.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. Interactive "What If?" Planetary Sandbox */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>“What If?” Planetary Sandbox</span>
              </div>
              <button
                type="button"
                onClick={onResetSandbox}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            <div className="space-y-3">
              {/* Axial Tilt Slider */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-300">Axial Tilt (Obliquity)</span>
                  <span className="font-mono tabular-nums text-cyan-300">
                    {sandbox.axialTiltDeg.toFixed(1)}°
                    <span className="text-slate-500 ml-1">
                      {sandbox.axialTiltDeg < 6
                        ? '(No Seasons)'
                        : sandbox.axialTiltDeg > 38
                          ? '(Extreme)'
                          : '(Temperate)'}
                    </span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={55}
                  step={0.5}
                  value={sandbox.axialTiltDeg}
                  aria-label="Axial Tilt degrees"
                  onChange={(e) => onUpdateSandbox({ axialTiltDeg: Number(e.target.value) })}
                  className="terra-slider w-full"
                />
              </div>

              {/* Atmospheric CO2 Slider */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-300">Atmospheric CO₂</span>
                  <span className="font-mono tabular-nums text-amber-300">
                    {sandbox.co2Multiplier.toFixed(1)}×
                    <span className="text-slate-400 ml-1">
                      ({co2TempDeltaC >= 0 ? '+' : ''}
                      {co2TempDeltaC.toFixed(1)} °C)
                    </span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={10}
                  step={0.1}
                  value={sandbox.co2Multiplier}
                  aria-label="Atmospheric CO2 multiplier"
                  onChange={(e) => onUpdateSandbox({ co2Multiplier: Number(e.target.value) })}
                  className="terra-slider w-full"
                />
              </div>

              {/* Lunar Distance Slider */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-300">Lunar Distance</span>
                  <span className="font-mono tabular-nums text-sky-300">
                    {Math.round(sandbox.lunarDistanceRe * 384)}k km · Tides{' '}
                    {tidalMultiplier.toFixed(1)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={1.5}
                  step={0.02}
                  value={sandbox.lunarDistanceRe}
                  aria-label="Lunar distance multiplier"
                  onChange={(e) => onUpdateSandbox({ lunarDistanceRe: Number(e.target.value) })}
                  className="terra-slider w-full"
                />
              </div>
            </div>
          </div>

          {/* 6. Spatial "Field Check" Globe Quiz */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200">
                <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                <span>Spatial Field Check</span>
              </div>
              <button
                type="button"
                aria-pressed={fieldCheckActive}
                onClick={onToggleFieldCheck}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  fieldCheckActive
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                {fieldCheckActive ? 'Armed · Click Globe' : 'Start Check'}
              </button>
            </div>

            <p className="text-[12px] text-slate-300 leading-relaxed">
              {chapter.fieldCheck.prompt}
            </p>

            {fieldCheckActive && !fieldCheckFeedback && (
              <p className="text-[11px] text-cyan-300/90 mt-1.5">
                Click directly on the 3D Earth surface to test your answer.
              </p>
            )}

            {fieldCheckFeedback && (
              <div
                className={`mt-2.5 p-2.5 rounded-lg border text-[11px] leading-relaxed ${
                  fieldCheckFeedback.correct
                    ? 'bg-emerald-950/50 border-emerald-500/50 text-emerald-200'
                    : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {fieldCheckFeedback.correct && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {fieldCheckFeedback.correct
                      ? `Verified: ${chapter.fieldCheck.targetName}`
                      : `Off by ${Math.round(fieldCheckFeedback.distanceDeg)}° · Move ${fieldCheckFeedback.directionHint}`}
                  </span>
                  <span className="font-mono tabular-nums text-[10px] opacity-80">
                    {formatCoord(fieldCheckFeedback.clickedLat, fieldCheckFeedback.clickedLon)}
                  </span>
                </div>
                <p className="mt-1 text-slate-200/90">
                  {fieldCheckFeedback.correct
                    ? chapter.fieldCheck.explanation
                    : chapter.fieldCheck.hint}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
