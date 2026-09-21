import { useEffect, useRef, useState } from 'react'
import type { Attitude } from '@/lib/msp/messages'
import type { BoardAlignment } from '@/lib/orientation/model'
import { angleDelta, renderQuad, type Part } from '@/lib/orientation/view3d'

const LEVEL: Attitude = { roll: 0, pitch: 0, yaw: 0 }

const STYLE: Record<Part, { fill: string; stroke: string }> = {
  arm: { fill: 'var(--muted-foreground)', stroke: 'none' },
  plate: { fill: 'var(--muted)', stroke: 'var(--muted-foreground)' },
  'prop-front': { fill: 'color-mix(in oklab, var(--primary) 18%, transparent)', stroke: 'var(--primary)' },
  'prop-rear': { fill: 'color-mix(in oklab, var(--muted-foreground) 15%, transparent)', stroke: 'var(--muted-foreground)' },
  board: { fill: 'var(--card)', stroke: 'var(--primary)' },
  'board-mark': { fill: 'var(--muted-foreground)', stroke: 'none' },
  arrow: { fill: 'var(--primary)', stroke: 'none' },
}

interface BoardViewProps {
  /** How the board is mounted (the user's current selection). */
  alignment: BoardAlignment
  /** Live attitude from the FC, yaw already relative to the viewer. null = not available yet. */
  attitude: Attitude | null
}

/**
 * 3D preview: the quad follows the live attitude (roll, pitch and yaw), the flight controller board
 * inside it is rotated by the chosen alignment. Orange props and the arrow are the quad's front, whatever the
 * alignment; the small grey mark is where the board's own arrow points. Rendering is a small software
 * projection (`lib/orientation/view3d`) drawn as SVG.
 */
export function BoardView({ alignment, attitude }: BoardViewProps) {
  const shown = useSmoothed(attitude ?? LEVEL)
  const polygons = renderQuad(shown, alignment)

  return (
    <svg
      role="img"
      aria-label={`Flight controller rotated yaw ${alignment.yaw}°, roll ${alignment.roll}°, pitch ${alignment.pitch}°`}
      viewBox="-1.45 -1.2 2.9 2.4"
      className="w-full max-w-md"
    >
      {polygons.map(({ part, points, facingCamera }, index) => {
        // The mark is printed on the top of the board, the arrow lies on top of the quad: invisible from below.
        if ((part === 'arrow' || part === 'board-mark') && !facingCamera) return null
        const underside = part === 'board' && !facingCamera
        return (
          <polygon
            key={index}
            points={points}
            fill={underside ? 'var(--muted)' : STYLE[part].fill}
            stroke={underside ? 'var(--muted-foreground)' : STYLE[part].stroke}
            strokeWidth={0.015}
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}

/** Eases towards the latest sample every animation frame, so 20 Hz telemetry doesn't look choppy. */
function useSmoothed(target: Attitude): Attitude {
  const [shown, setShown] = useState(target)
  const latest = useRef(target)
  useEffect(() => {
    latest.current = target
  }, [target])

  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return
    let frame = requestAnimationFrame(function step() {
      setShown((current) => {
        const next = {
          roll: current.roll + angleDelta(current.roll, latest.current.roll) * 0.35,
          pitch: current.pitch + angleDelta(current.pitch, latest.current.pitch) * 0.35,
          yaw: current.yaw + angleDelta(current.yaw, latest.current.yaw) * 0.35,
        }
        const settled = Math.abs(next.roll - current.roll) + Math.abs(next.pitch - current.pitch) + Math.abs(next.yaw - current.yaw) < 0.01
        return settled ? current : next
      })
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  return shown
}
