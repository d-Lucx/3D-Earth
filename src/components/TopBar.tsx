import { CAMERA_PRESETS, type CameraPresetId } from '../data/earthData';

interface TopBarProps {
  activePreset: CameraPresetId | null;
  onSelectPreset: (presetId: CameraPresetId) => void;
  onResetView: () => void;
}

export function TopBar({ activePreset, onSelectPreset, onResetView }: TopBarProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between gap-8 h-14 px-6 bg-[#070b14]/90 border-b border-slate-800/80">
      {/* Zone 1: Single-element brand wordmark */}
      <span className="text-[17px] font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0 select-none">
        Terra Atlas
      </span>

      {/* Zone 2: Concise single-line regional navigation links */}
      <nav
        aria-label="Hemisphere viewpoints"
        className="hidden md:flex items-center gap-6 text-[13px] font-medium"
      >
        {CAMERA_PRESETS.map((preset) => {
          const isActive = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectPreset(preset.id)}
              className={`relative py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-sm ${
                isActive
                  ? 'text-cyan-300'
                  : 'text-slate-400 hover:text-slate-100'
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

      {/* Zone 3: Single primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onResetView}
          className="px-4 py-1.5 text-[13px] font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
        >
          Reset View
        </button>
      </div>
    </header>
  );
}
