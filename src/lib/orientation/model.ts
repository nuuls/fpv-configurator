/** Board alignment (docs/tabs/orientation.md). MSP_BOARD_ALIGNMENT_CONFIG: roll, pitch, yaw in degrees. */
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'

export interface BoardAlignment {
  roll: number
  pitch: number
  yaw: number
}

/**
 * How long to keep still after MSP_ACC_CALIBRATION. The firmware averages 400 accelerometer samples (~0.4 s at
 * 1 kHz) and doesn't report when it's done; Betaflight Configurator waits 2 s as well.
 */
export const ACC_CALIBRATION_MS = 2000

export const ALIGNMENT_STEPS = [0, 45, 90, 135, 180, 225, 270, 315] as const

/** The firmware stores signed degrees in a u16; normalise everything to 0..359. */
export function normalizeDegrees(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360
}

export function decodeBoardAlignment(payload: Uint8Array): BoardAlignment {
  const r = new ByteReader(payload)
  return {
    roll: normalizeDegrees(r.i16()),
    pitch: normalizeDegrees(r.i16()),
    yaw: normalizeDegrees(r.i16()),
  }
}

export function encodeBoardAlignment(a: BoardAlignment): Uint8Array {
  return new ByteWriter().i16(a.roll).i16(a.pitch).i16(a.yaw).toBytes()
}

/** Dropdown options: the 45° steps, plus the FC's current value when it isn't one of them. */
export function alignmentOptions(current: number): number[] {
  const steps: number[] = [...ALIGNMENT_STEPS]
  return steps.includes(current) ? steps : [...steps, current].sort((a, b) => a - b)
}
