import { describe, expect, it } from 'vitest'
import { angleDelta, betaflightRotation, project, renderQuad, rotate, type Vec3 } from './view3d'

const NOSE: Vec3 = [0, 1, 0]
const RIGHT: Vec3 = [1, 0, 0]
const TOP: Vec3 = [0, 0, 1]
const close = (v: Vec3, expected: Vec3) => v.forEach((value, i) => expect(value).toBeCloseTo(expected[i] ?? NaN, 6))

describe('betaflightRotation follows Betaflight sign conventions', () => {
  it('positive roll lowers the right side', () => {
    expect(rotate(betaflightRotation(30, 0, 0), RIGHT)[2]).toBeLessThan(0)
  })

  it('positive pitch lowers the nose', () => {
    expect(rotate(betaflightRotation(0, 30, 0), NOSE)[2]).toBeLessThan(0)
  })

  it('positive yaw turns the nose clockwise (to the right)', () => {
    close(rotate(betaflightRotation(0, 0, 90), NOSE), [1, 0, 0])
  })

  it('roll 180 is upside down', () => {
    close(rotate(betaflightRotation(180, 0, 0), TOP), [0, 0, -1])
  })

  it('applies yaw, then pitch, then roll (intrinsic)', () => {
    // Yawed 90° right then pitched nose-down: the nose points right and down, not forward.
    const nose = rotate(betaflightRotation(0, 45, 90), NOSE)
    expect(nose[0]).toBeGreaterThan(0.5)
    expect(nose[1]).toBeCloseTo(0, 6)
    expect(nose[2]).toBeLessThan(-0.5)
  })
})

describe('projection', () => {
  it('draws forward up the screen and farther away', () => {
    const nose = project(NOSE)
    const tail = project([0, -1, 0])
    expect(nose.y).toBeLessThan(tail.y) // SVG y grows downwards
    expect(nose.depth).toBeGreaterThan(tail.depth)
    expect(Math.abs(nose.x)).toBeLessThan(Math.abs(project([1, 1, 0]).x))
  })
})

describe('renderQuad', () => {
  const level = { roll: 0, pitch: 0, yaw: 0 }
  const flat = { roll: 0, pitch: 0, yaw: 0 }
  const board = (attitude: typeof level, alignment: typeof flat) => {
    const polygon = renderQuad(attitude, alignment).find((p) => p.part === 'board')
    if (!polygon) throw new Error('no board')
    return polygon
  }
  const tip = (part: 'arrow' | 'board-mark', alignment: typeof flat) => {
    const polygon = renderQuad(level, alignment).find((p) => p.part === part)
    const [x, y] = (polygon?.points.split(' ')[0] ?? '').split(',').map(Number)
    return { x: x ?? NaN, y: y ?? NaN }
  }

  it('sorts far-to-near and shows the top of a level board', () => {
    const polygons = renderQuad(level, flat)
    expect(polygons.map((p) => p.depth)).toEqual([...polygons.map((p) => p.depth)].sort((a, b) => b - a))
    expect(board(level, flat).facingCamera).toBe(true)
  })

  it('shows the underside when the board (or the whole quad) is upside down', () => {
    expect(board(level, { ...flat, roll: 180 }).facingCamera).toBe(false)
    expect(board({ ...level, roll: 180 }, flat).facingCamera).toBe(false)
    expect(board({ ...level, roll: 180 }, { ...flat, roll: 180 }).facingCamera).toBe(true)
  })

  it('keeps the arrow pointing to the front of the quad, whatever the alignment', () => {
    const forward = renderQuad(level, flat).find((p) => p.part === 'arrow')
    expect(tip('arrow', flat).x).toBeCloseTo(0, 6)
    for (const alignment of [{ ...flat, yaw: 90 }, { ...flat, yaw: 180 }, { ...flat, yaw: 315 }, { roll: 180, pitch: 45, yaw: 270 }]) {
      const arrow = renderQuad(level, alignment).find((p) => p.part === 'arrow')
      expect(arrow?.points, JSON.stringify(alignment)).toBe(forward?.points)
      expect(arrow?.facingCamera, JSON.stringify(alignment)).toBe(true)
    }
  })

  it('points the board mark right for a 90° yaw alignment and back for 180°', () => {
    expect(tip('board-mark', flat).x).toBeCloseTo(0, 6)
    expect(tip('board-mark', { ...flat, yaw: 90 }).x).toBeGreaterThan(0.1)
    expect(tip('board-mark', { ...flat, yaw: 270 }).x).toBeLessThan(-0.1)
    expect(tip('board-mark', { ...flat, yaw: 180 }).y).toBeGreaterThan(tip('board-mark', flat).y)
  })

  it('paints the mark and the arrow on top of the board, whichever way the quad and the board are turned', () => {
    for (let yaw = 0; yaw < 360; yaw += 15) {
      for (const attitude of [{ ...level, yaw }, { roll: 25, pitch: -20, yaw }, { roll: -40, pitch: 35, yaw }]) {
        for (const alignment of [flat, { ...flat, yaw: 90 }, { ...flat, yaw: 180 }, { roll: 0, pitch: 180, yaw: 270 }]) {
          const parts = renderQuad(attitude, alignment).map((p) => p.part)
          const at = parts.indexOf('board')
          expect(parts.slice(at, at + 3), JSON.stringify({ attitude, alignment })).toEqual(['board', 'board-mark', 'arrow'])
        }
      }
    }
  })

  it('moves the whole quad with live yaw', () => {
    const tipX = (yaw: number) => {
      const arrow = renderQuad({ ...level, yaw }, flat).find((p) => p.part === 'arrow')
      return Number((arrow?.points.split(' ')[0] ?? '').split(',')[0])
    }
    expect(tipX(45)).toBeGreaterThan(0.05)
    expect(tipX(-45)).toBeLessThan(-0.05)
  })
})

describe('angleDelta', () => {
  it('takes the short way around the 0/360 wrap', () => {
    expect(angleDelta(350, 10)).toBe(20)
    expect(angleDelta(10, 350)).toBe(-20)
    expect(angleDelta(0, 180)).toBe(-180)
    expect(angleDelta(90, 90)).toBe(0)
  })
})
