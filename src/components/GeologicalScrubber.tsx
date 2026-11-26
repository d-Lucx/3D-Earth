import { Flame, Pause, Play, Sparkles } from 'lucide-react';
import {
  COSMIC_CLOCK_MILESTONES,
  DEEP_TIME_CHAPTERS,
  getDeepTimeChapter,
  type DeepTimeEraId,
  type StoryBeaconAction,
} from '../data/deepTimeData';

interface GeologicalScrubberProps {
  activeEra: DeepTimeEraId;
  tourPlaying: boolean;
  driftProgress: number;
  driftPlaying: boolean;
  riftMeltProgress: number;
  onSelectEra: (eraId: DeepTimeEraId) => void;
  onToggleTourPlay: () => void;
  onTriggerAction: (action: StoryBeaconAction) => void;
  onChangeDriftProgress: (val: number) => void;
  onToggleDriftPlay: () => void;
  onChangeRiftMelt: (val: number) => void;
}

export function GeologicalScrubber({
  activeEra,
  tourPlaying,
  driftProgress,
  driftPlaying,
  riftMeltProgress,
  onSelectEra,
  onToggleTourPlay,
  onTriggerAction,
  onChangeDriftProgress,
  onToggleDriftPlay,
  onChangeRiftMelt,
}: GeologicalScrubberProps) {
  const chapter = getDeepTimeChapter(activeEra);
  const driftMa = Math.round(250 * (1 - driftProgress));

  return (
    <div className="flex flex-col">
      {/* Row 1: Logarithmic 6-Chapter Epoch Selector + Tour & Era Action Controls */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleTourPlay}
            aria-label={tourPlaying ? 'Pause geological timeline tour' : 'Play geological timeline tour'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              tourPlaying
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:text-white hover:border-slate-500'
            }`}
          >
            {tourPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{tourPlaying ? 'Pause Tour' : 'Play Tour'}</span>
          </button>

          <button
            type="button"
            onClick={() => onTriggerAction(chapter.defaultAction)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-slate-700 bg-[#111a2e] hover:bg-[#16233d] text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {activeEra === 'snowball' ? (
              <Flame className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            )}
            <span>{chapter.actionButtonLabel}</span>
          </button>
        </div>

        {/* Logarithmic Chapter Epochs */}
        <div
          role="tablist"
          aria-label="Geological chapters"
          className="flex items-center gap-1 overflow-x-auto terra-scroll py-0.5 flex-1 lg:justify-end"
        >
          {DEEP_TIME_CHAPTERS.map((item) => {
            const isActive = item.id === activeEra;
            return (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => onSelectEra(item.id)}
                className={`flex flex-col items-start px-2.5 py-1 rounded-md border text-left transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  isActive
                    ? 'bg-[#122038] border-slate-600 text-slate-100'
                    : 'bg-[#070c17] border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.accentColor }}
                  />
                  <span className={isActive ? 'text-slate-200' : 'text-slate-500'}>
                    {item.timeframe.split('–')[0].trim()}
                  </span>
                </div>
                <span className="text-[12px] font-medium leading-tight mt-0.5">
                  {item.shortTitle}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Contextual Interactive Simulation Bar: Pangaea Drift OR Snowball Rift Thaw */}
      {activeEra === 'pangaea' && (
        <div className="px-4 py-2 bg-[#08101e] border-b border-slate-800/80 flex flex-wrap sm:flex-nowrap items-center gap-3">
          <button
            type="button"
            onClick={onToggleDriftPlay}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              driftPlaying
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {driftPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{driftPlaying ? 'Drifting' : 'Drift Plates'}</span>
          </button>

          <span className="text-[11px] font-mono tabular-nums text-emerald-300 whitespace-nowrap shrink-0">
            250 Ma Pangaea
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={driftProgress}
            aria-label="Continental drift progression from Pangaea to Modern Earth"
            onChange={(e) => onChangeDriftProgress(Number(e.target.value))}
            className="terra-slider flex-1 min-w-[160px]"
          />
          <span className="text-[11px] font-mono tabular-nums text-slate-300 whitespace-nowrap shrink-0">
            Present
          </span>
          <span className="text-[11px] font-mono tabular-nums text-amber-300 whitespace-nowrap shrink-0 border-l border-slate-800 pl-3">
            {driftMa === 0 ? 'Modern Geography' : `${driftMa} Ma`}
          </span>
        </div>
      )}

      {activeEra === 'snowball' && (
        <div className="px-4 py-2 bg-[#08101e] border-b border-slate-800/80 flex flex-wrap sm:flex-nowrap items-center gap-3">
          <span className="text-[11px] font-medium text-rose-300 whitespace-nowrap shrink-0">
            Volcanic Rift Outgassing
          </span>
          <span className="text-[11px] font-mono tabular-nums text-sky-300 whitespace-nowrap shrink-0">
            Global Freeze
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={riftMeltProgress}
            aria-label="Volcanic rift CO2 melt progress"
            onChange={(e) => onChangeRiftMelt(Number(e.target.value))}
            className="terra-slider flex-1 min-w-[160px]"
          />
          <span className="text-[11px] font-mono tabular-nums text-amber-300 whitespace-nowrap shrink-0">
            Super-Greenhouse Thaw
          </span>
        </div>
      )}

      {/* Row 2: Persistent 24-Hour Cosmic Clock Context Bar */}
      <div className="px-4 py-2.5 bg-[#070b15] flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-4 text-[11px]">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="font-medium text-slate-200">24-Hour Cosmic Clock</span>
            <span aria-hidden="true" className="text-slate-700">
              ·
            </span>
            <span className="hidden sm:inline">
              4.54 billion years compressed into one day
            </span>
          </div>
          <div className="font-mono tabular-nums text-cyan-300 whitespace-nowrap shrink-0">
            {chapter.cosmicClockTime} · {chapter.title}
          </div>
        </div>

        {/* Cosmic Clock Progress Track + Clickable Landmarks */}
        <div className="relative pt-1 pb-4">
          <div className="h-1.5 w-full rounded-full bg-slate-800/90 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.max(2, chapter.cosmicClockNorm * 100)}%`,
                background:
                  'linear-gradient(90deg, #fb923c 0%, #f59e0b 20%, #2dd4bf 55%, #7dd3fc 82%, #34d399 93%, #f43f5e 100%)',
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-1 mt-1.5 overflow-x-auto terra-scroll">
            {COSMIC_CLOCK_MILESTONES.map((ms) => {
              const isCurrentEra = ms.eraId === activeEra;
              return (
                <button
                  key={`${ms.time}-${ms.label}`}
                  type="button"
                  onClick={() => onSelectEra(ms.eraId)}
                  className={`flex items-center gap-1 text-[10px] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isCurrentEra ? 'text-slate-100 font-medium' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className="font-mono tabular-nums text-cyan-400/90">{ms.time}</span>
                  <span>{ms.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
