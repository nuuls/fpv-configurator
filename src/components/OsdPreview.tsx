import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { Canvas, Cell } from '@/lib/osd/model'

export interface PreviewElement extends Cell {
  index: number
  label: string
  sample: string
}

interface OsdPreviewProps {
  canvas: Canvas
  elements: PreviewElement[]
  /** Called with the wanted cell; the caller clamps it to the canvas. */
  onMove: (index: number, cell: Cell) => void
}

const ARROWS: Record<string, Cell> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/** Monospace glyphs are about 0.6em wide and need about 1.2em of height. */
const GLYPH_WIDTH_EM = 0.62
const GLYPH_HEIGHT_EM = 1.25

/**
 * The goggles' character grid with one sample text per shown element. Elements are dragged with the pointer or
 * moved with the arrow keys while focused. Always dark: it stands in for a video feed, not for app chrome.
 */
export function OsdPreview({ canvas, elements, onMove }: OsdPreviewProps) {
  const screen = useRef<HTMLDivElement>(null)
  /** Cells between the grabbed character and the element's first one. */
  const grab = useRef(0)

  const hd = canvas.cols > 30
  const aspect = hd ? 16 / 9 : 4 / 3
  // Largest font (in % of the screen's width) whose glyphs fit a cell both ways.
  const fontCqw =
    100 * Math.min(1 / (canvas.cols * GLYPH_WIDTH_EM), 1 / (aspect * canvas.rows * GLYPH_HEIGHT_EM))

  const cellAt = (e: PointerEvent): Cell | null => {
    const rect = screen.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: Math.floor(((e.clientX - rect.left) / rect.width) * canvas.cols),
      y: Math.floor(((e.clientY - rect.top) / rect.height) * canvas.rows),
    }
  }

  const startDrag = (e: PointerEvent<HTMLButtonElement>, el: PreviewElement) => {
    const cell = cellAt(e)
    if (!cell) return
    grab.current = cell.x - el.x
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const drag = (e: PointerEvent<HTMLButtonElement>, el: PreviewElement) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const cell = cellAt(e)
    if (cell) onMove(el.index, { x: cell.x - grab.current, y: cell.y })
  }

  const nudge = (e: KeyboardEvent, el: PreviewElement) => {
    const step = ARROWS[e.key]
    if (!step) return
    e.preventDefault()
    onMove(el.index, { x: el.x + step.x, y: el.y + step.y })
  }

  return (
    <div className="[container-type:inline-size]">
      <div
        ref={screen}
        role="group"
        aria-label={`OSD preview, ${canvas.cols} by ${canvas.rows} characters`}
        className="relative w-full touch-none overflow-hidden rounded-md bg-gradient-to-b from-slate-600 to-slate-800 font-mono font-semibold text-white select-none"
        style={{ aspectRatio: aspect, fontSize: `${fontCqw}cqw` }}
      >
        {elements.map((el) => (
          <button
            key={el.index}
            type="button"
            aria-label={`${el.label}, column ${el.x}, row ${el.y}`}
            className="absolute flex cursor-grab items-center rounded-xs outline-offset-1 [text-shadow:0_0_2px_#000,0_0_2px_#000] hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white active:cursor-grabbing"
            style={{
              left: `${(el.x / canvas.cols) * 100}%`,
              top: `${(el.y / canvas.rows) * 100}%`,
              width: `${(el.sample.length / canvas.cols) * 100}%`,
              height: `${100 / canvas.rows}%`,
            }}
            onPointerDown={(e) => startDrag(e, el)}
            onPointerMove={(e) => drag(e, el)}
            onKeyDown={(e) => nudge(e, el)}
          >
            {[...el.sample].map((char, i) => (
              <span key={i} className="flex-1 text-center leading-none">
                {char}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  )
}
