interface SparklineChartProps {
  values: number[];
  unit: string;
  strokeColor?: string;
}

export function SparklineChart({
  values,
  unit,
  strokeColor = '#38bdf8',
}: SparklineChartProps) {
  if (values.length < 2) return null;

  const width = 180;
  const height = 44;
  const padX = 4;
  const padY = 6;

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = Math.max(1e-4, maxVal - minVal);

  const coords = values.map((v, idx) => {
    const x = padX + (idx / (values.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (v - minVal) / span) * (height - padY * 2);
    return { x, y };
  });

  const linePath = coords
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(height - 2).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(height - 2).toFixed(1)} Z`;
  const lastPt = coords[coords.length - 1];

  return (
    <div className="flex flex-col gap-1 shrink-0">
      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
        <span>24h Trend</span>
        <span>
          {minVal.toFixed(1)}–{maxVal.toFixed(1)} {unit}
        </span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        role="img"
        aria-label={`24 hour trend ranging from ${minVal} to ${maxVal} ${unit}`}
      >
        <line
          x1={padX}
          y1={height / 2}
          x2={width - padX}
          y2={height / 2}
          stroke="#1e293b"
          strokeDasharray="2 3"
          strokeWidth="1"
        />
        <path d={areaPath} fill={strokeColor} fillOpacity="0.12" />
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastPt.x} cy={lastPt.y} r="2.8" fill={strokeColor} />
      </svg>
    </div>
  );
}
