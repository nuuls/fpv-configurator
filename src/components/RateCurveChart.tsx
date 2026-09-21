import { useState, type PointerEvent } from 'react'
import { niceMax, rateAt, type CurveSeries } from '@/lib/rates/model'

const WIDTH = 480
const HEIGHT = 300
const MARGIN = { top: 12, right: 16, bottom: 34, left: 48 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom
const SAMPLES = 50

/** Colour follows the axis (roll/pitch/yaw), never the series' position in the list. */
const SERIES_COLOR = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)']

/** Rotation speed over stick deflection, one line per distinct axis setting. Hover for exact values. */
export function RateCurveChart({ series }: { series: CurveSeries[] }) {
  const [hoverStick, setHoverStick] = useState<number | null>(null)

  const top = niceMax(Math.max(...series.map((s) => rateAt(s.type, s.rates, 1, s.limit)), 1))
  const x = (stick: number) => MARGIN.left + stick * PLOT_WIDTH
  const y = (rate: number) => MARGIN.top + PLOT_HEIGHT - (rate / top) * PLOT_HEIGHT
  const color = (s: CurveSeries) => SERIES_COLOR[s.axis] ?? 'var(--foreground)'

  const handleMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const stick = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    setHoverStick(Math.round(stick * 100) / 100)
  }

  return (
    <figure className="relative w-full">
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Legend">
        {series.map((s) => (
          <li key={s.axis} className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full" style={{ background: color(s) }} />
            <span>{s.label}</span>
            <span className="text-muted-foreground tabular-nums">max {Math.round(rateAt(s.type, s.rates, 1, s.limit))}°/s</span>
          </li>
        ))}
      </ul>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Rate curve: rotation speed over stick deflection">
        {/* recessive grid + axes */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction} className="text-muted-foreground" fontSize={11}>
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(top * fraction)} y2={y(top * fraction)} stroke="var(--border)" />
            <text x={MARGIN.left - 8} y={y(top * fraction)} textAnchor="end" dominantBaseline="middle" fill="currentColor">
              {Math.round(top * fraction)}
            </text>
            <text x={x(fraction)} y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle" fill="currentColor">
              {fraction * 100}%
            </text>
          </g>
        ))}
        <text x={MARGIN.left + PLOT_WIDTH / 2} y={HEIGHT - 2} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
          stick deflection
        </text>
        <text x={12} y={MARGIN.top + PLOT_HEIGHT / 2} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)" transform={`rotate(-90 12 ${MARGIN.top + PLOT_HEIGHT / 2})`}>
          °/s
        </text>

        {series.map((s) => (
          <polyline
            key={s.axis}
            fill="none"
            stroke={color(s)}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={Array.from({ length: SAMPLES + 1 }, (_, i) => {
              const stick = i / SAMPLES
              return `${x(stick).toFixed(1)},${y(rateAt(s.type, s.rates, stick, s.limit)).toFixed(1)}`
            }).join(' ')}
          />
        ))}

        {hoverStick !== null && (
          <g pointerEvents="none">
            <line x1={x(hoverStick)} x2={x(hoverStick)} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.axis} cx={x(hoverStick)} cy={y(rateAt(s.type, s.rates, hoverStick, s.limit))} r={4.5} fill={color(s)} stroke="var(--card)" strokeWidth={2} />
            ))}
          </g>
        )}
        {/* hit target: the whole plot, not just the thin lines */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={PLOT_WIDTH}
          height={PLOT_HEIGHT}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverStick(null)}
        />
      </svg>

      {hoverStick !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-10 z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={hoverStick < 0.55 ? { left: `${(x(hoverStick) / WIDTH) * 100 + 3}%` } : { right: `${100 - (x(hoverStick) / WIDTH) * 100 + 3}%` }}
        >
          <div className="mb-1 text-muted-foreground">{Math.round(hoverStick * 100)}% stick</div>
          {series.map((s) => (
            <div key={s.axis} className="flex items-center gap-2 tabular-nums">
              <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: color(s) }} />
              <span>{s.label}</span>
              <span className="ml-auto pl-3 font-medium">{Math.round(rateAt(s.type, s.rates, hoverStick, s.limit))}°/s</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  )
}
