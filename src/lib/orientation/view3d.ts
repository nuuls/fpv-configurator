/**
 * Tiny software 3D renderer for the orientation preview: rotation math + perspective projection of a
 * low-poly quad model into 2D polygons (drawn as SVG). Pure functions, so conventions are unit-tested
 * instead of eyeballed.
 *
 * Betaflight angle conventions (flight/imu.c, North-West-Up world frame):
 *   roll  > 0  right side down
 *   pitch > 0  nose DOWN
 *   yaw   > 0  clockwise seen from above (compass heading)
 * applied as intrinsic yaw → pitch → roll.
 *
 * View/world axes used here: x = right, y = forward (away from the viewer), z = up.
 */
import type { BoardAlignment } from './model'

export type Vec3 = readonly [x: number, y: number, z: number]
/** Row-major 3×3 rotation matrix. */
export type Mat3 = readonly [Vec3, Vec3, Vec3]

const rad = (degrees: number) => (degrees * Math.PI) / 180

function multiply(a: Mat3, b: Mat3): Mat3 {
  const cell = (r: 0 | 1 | 2, c: 0 | 1 | 2) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]
  return [
    [cell(0, 0), cell(0, 1), cell(0, 2)],
    [cell(1, 0), cell(1, 1), cell(1, 2)],
    [cell(2, 0), cell(2, 1), cell(2, 2)],
  ]
}

export function rotate(m: Mat3, [x, y, z]: Vec3): Vec3 {
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z,
    m[1][0] * x + m[1][1] * y + m[1][2] * z,
    m[2][0] * x + m[2][1] * y + m[2][2] * z,
  ]
}

// Right-handed rotations about the view axes.
const aboutX = (a: number): Mat3 => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]
const aboutY = (a: number): Mat3 => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]
const aboutZ = (a: number): Mat3 => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]

/** Body → world rotation for Betaflight roll/pitch/yaw in degrees. Also used for board alignment angles. */
export function betaflightRotation(roll: number, pitch: number, yaw: number): Mat3 {
  // Signs follow from the conventions above: about +y a positive angle lowers the right side, about +x a
  // positive angle RAISES the nose (so pitch is negated), about +z a positive angle turns LEFT (negated).
  return multiply(aboutZ(rad(-yaw)), multiply(aboutX(rad(-pitch)), aboutY(rad(roll))))
}

// ---- model (body frame, 1 unit ≈ motor distance from centre) ----

export type Part = 'arm' | 'plate' | 'prop-front' | 'prop-rear' | 'board' | 'board-mark' | 'arrow'

interface Face {
  part: Part
  /** Moves with the board alignment instead of just the frame. */
  onBoard: boolean
  points: Vec3[]
}

const MOTOR = 0.72
const BOARD_Z = 0.16
const ARROW_Z = BOARD_Z + 0.002

function bar(from: Vec3, to: Vec3, halfWidth: number): Vec3[] {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]]
  const length = Math.hypot(dx, dy)
  const [nx, ny] = [(-dy / length) * halfWidth, (dx / length) * halfWidth]
  return [
    [from[0] + nx, from[1] + ny, from[2]],
    [to[0] + nx, to[1] + ny, to[2]],
    [to[0] - nx, to[1] - ny, to[2]],
    [from[0] - nx, from[1] - ny, from[2]],
  ]
}

function ring(cx: number, cy: number, z: number, radius: number, segments = 28): Vec3[] {
  return Array.from({ length: segments }, (_, i): Vec3 => {
    const a = (i / segments) * 2 * Math.PI
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]
  })
}

const square = (half: number, z: number): Vec3[] => [[-half, half, z], [half, half, z], [half, -half, z], [-half, -half, z]]

const MODEL: Face[] = [
  { part: 'arm', onBoard: false, points: bar([-MOTOR, -MOTOR, 0], [MOTOR, MOTOR, 0], 0.05) },
  { part: 'arm', onBoard: false, points: bar([-MOTOR, MOTOR, 0], [MOTOR, -MOTOR, 0], 0.05) },
  { part: 'plate', onBoard: false, points: square(0.3, 0.02) },
  { part: 'prop-front', onBoard: false, points: ring(-MOTOR, MOTOR, 0.06, 0.34) },
  { part: 'prop-front', onBoard: false, points: ring(MOTOR, MOTOR, 0.06, 0.34) },
  { part: 'prop-rear', onBoard: false, points: ring(-MOTOR, -MOTOR, 0.06, 0.34) },
  { part: 'prop-rear', onBoard: false, points: ring(MOTOR, -MOTOR, 0.06, 0.34) },
  { part: 'board', onBoard: true, points: square(0.24, 0) },
  // small mark at the edge the board's own printed arrow points to: turns with the alignment
  { part: 'board-mark', onBoard: true, points: [[0, 0.23, 0.001], [0.05, 0.17, 0.001], [-0.05, 0.17, 0.001]] },
  // the quad's forward direction, drawn over the board: part of the frame, so it never turns with the alignment
  {
    part: 'arrow',
    onBoard: false,
    points: [[0, 0.15, ARROW_Z], [0.12, -0.01, ARROW_Z], [0.045, -0.01, ARROW_Z], [0.045, -0.16, ARROW_Z], [-0.045, -0.16, ARROW_Z], [-0.045, -0.01, ARROW_Z], [-0.12, -0.01, ARROW_Z]],
  },
]

// ---- projection ----

/** Camera looks at the quad from behind and above. */
const CAMERA_ELEVATION = aboutX(rad(38))
const CAMERA_DISTANCE = 7

export interface Polygon {
  part: Part
  /** SVG `points` in a viewBox of -1..1 (y grows downwards, as in SVG). */
  points: string
  /** True when the face's top side is towards the camera (the board shows its underside otherwise). */
  facingCamera: boolean
  depth: number
}

export function project(world: Vec3): { x: number; y: number; depth: number } {
  const [x, depth, z] = rotate(CAMERA_ELEVATION, world)
  const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE + depth)
  return { x: x * scale, y: -z * scale, depth }
}

/**
 * Polygons to draw, farthest first. `attitude` = live FC angles (yaw already zeroed by the caller),
 * `alignment` = how the board is mounted in the frame.
 */
export function renderQuad(attitude: { roll: number; pitch: number; yaw: number }, alignment: BoardAlignment): Polygon[] {
  const frame = betaflightRotation(attitude.roll, attitude.pitch, attitude.yaw)
  const board = betaflightRotation(alignment.roll, alignment.pitch, alignment.yaw)

  const polygons = MODEL.map(({ part, onBoard, points }) => {
    const projected = points.map((p) => {
      const inFrame: Vec3 = onBoard ? lift(rotate(board, p)) : p
      return project(rotate(frame, inFrame))
    })
    // Signed area tells which side faces the camera (model faces are wound clockwise on screen from the top).
    let area = 0
    projected.forEach((a, i) => {
      const b = projected[(i + 1) % projected.length]
      if (b) area += a.x * b.y - b.x * a.y
    })
    return {
      part,
      points: projected.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' '),
      facingCamera: area > 0,
      depth: projected.reduce((sum, p) => sum + p.depth, 0) / projected.length,
    }
  })

  // The board mark and the arrow lie (practically) in the board's plane: sorted by their own centroids they
  // would end up underneath the board whenever they are turned away from the camera. They take the board's
  // depth instead — the sort is stable and the model lists the board first, so they are painted right after it.
  const boardDepth = polygons.find((p) => p.part === 'board')?.depth
  return polygons
    .map((p) => ((p.part === 'arrow' || p.part === 'board-mark') && boardDepth !== undefined ? { ...p, depth: boardDepth } : p))
    .sort((a, b) => b.depth - a.depth)
}

/** The board sits on standoffs above the frame, whichever way it is rotated. */
const lift = ([x, y, z]: Vec3): Vec3 => [x, y, z + BOARD_Z]

/** Shortest signed difference a → b in degrees, for angles that wrap at 360. */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}
