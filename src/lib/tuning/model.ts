/**
 * Slider-based PID tuning and RC smoothing presets — docs/tabs/pid-tuning.md.
 * The firmware computes the PIDs from the sliders (Betaflight "simplified tuning"); this app only
 * exposes three (master, damping, and the two pitch sliders moved as one) and pins the rest.
 */
import { ByteReader } from '@/lib/msp/bytes'
import type { SettingWrite } from '@/lib/ports/model'

/** Byte offsets of the PID sliders at the start of MSP_SIMPLIFIED_TUNING (values are percent, 100 = 1.0). */
const OFFSET = {
  MODE: 0,
  MASTER: 1,
  /** `simplified_roll_pitch_ratio`: multiplies D and D max on pitch only ("Pitch damping"). */
  ROLL_PITCH_RATIO: 2,
  I_GAIN: 3,
  D_GAIN: 4,
  PI_GAIN: 5,
  D_MAX_GAIN: 6,
  FEEDFORWARD_GAIN: 7,
  /** `simplified_pitch_pi_gain`: multiplies P, I and FF on pitch only ("Pitch tracking"). */
  PITCH_PI_GAIN: 8,
} as const
const PID_SLIDER_BYTES = 9 + 8 // sliders + two reserved u32

const PIDS_MODE_RPY = 2

/** Sliders the user never sees and the value they are pinned to (SPEC §2 "PID Tuning"). */
const LOCKED: [offset: number, value: number][] = [
  [OFFSET.MODE, PIDS_MODE_RPY],
  [OFFSET.I_GAIN, 100],
  [OFFSET.PI_GAIN, 100],
  [OFFSET.D_MAX_GAIN, 0],
]

export const SLIDER_STEP = 5
export const SLIDER_MIN = 50
export const SLIDER_MAX = 150

export type SmoothingPreset = 'direct' | 'light' | 'strong'

interface SmoothingDefinition {
  label: string
  description: string
  rcSmoothing: boolean
  autoFactor: number
  feedforwardGain: number
  feedforwardSmoothFactor: number
}

/** Betaflight's default; 2026.6 adapts feedforward to the detected link rate by itself. */
const DEFAULT_FF_SMOOTH_FACTOR = 65
/** SPEC marks "higher feed forward smoothing" as TBD — this is a placeholder value to be tuned. */
const STRONG_FF_SMOOTH_FACTOR = 80

export const SMOOTHING_PRESETS: Record<SmoothingPreset, SmoothingDefinition> = {
  direct: {
    label: 'Direct',
    description: 'No RC smoothing, full feedforward. Most connected feel; needs a clean, fast link.',
    rcSmoothing: false,
    autoFactor: 30,
    feedforwardGain: 100,
    feedforwardSmoothFactor: DEFAULT_FF_SMOOTH_FACTOR,
  },
  light: {
    label: 'Light smoothing',
    description: 'Light RC smoothing (25) with full feedforward. Racing and sharp freestyle.',
    rcSmoothing: true,
    autoFactor: 25,
    feedforwardGain: 100,
    feedforwardSmoothFactor: DEFAULT_FF_SMOOTH_FACTOR,
  },
  strong: {
    label: 'Strong smoothing',
    description: 'More RC smoothing (30), smoother and halved feedforward. Flowing freestyle and HD footage.',
    rcSmoothing: true,
    autoFactor: 30,
    feedforwardGain: 50,
    feedforwardSmoothFactor: STRONG_FF_SMOOTH_FACTOR,
  },
}

export interface TuningSnapshot {
  /** Raw MSP_SIMPLIFIED_TUNING payload; written back with only the PID slider bytes changed. */
  simplified: number[]
  rcSmoothing: boolean
  rcSmoothingAutoFactor: number
}

export interface TuningDraft {
  /** Percent, 100 = 1.0 */
  master: number
  damping: number
  /** Pitch gains: written to both pitch sliders, so it scales every pitch gain like the master does. */
  pitch: number
  smoothing: SmoothingPreset | 'custom'
}

export interface AxisPids {
  p: number
  i: number
  d: number
  dMax: number
  f: number
}

// ---- MSP_RX_CONFIG (44): RC smoothing fields ----

const RX_CONFIG_AUTO_FACTOR_OFFSET = 30
const RX_CONFIG_RC_SMOOTHING_OFFSET = 31

export function decodeRcSmoothing(rxConfig: Uint8Array): { rcSmoothing: boolean; rcSmoothingAutoFactor: number } {
  return {
    rcSmoothingAutoFactor: rxConfig[RX_CONFIG_AUTO_FACTOR_OFFSET] ?? 30,
    rcSmoothing: (rxConfig[RX_CONFIG_RC_SMOOTHING_OFFSET] ?? 1) !== 0,
  }
}

// ---- MSP_CALCULATE_SIMPLIFIED_PID (142) response: roll, pitch, yaw ----

export function decodePidfs(payload: Uint8Array): AxisPids[] {
  const r = new ByteReader(payload)
  const axes: AxisPids[] = []
  while (r.remaining >= 6) axes.push({ p: r.u8(), i: r.u8(), d: r.u8(), dMax: r.u8(), f: r.u16() })
  return axes
}

// ---- logic ----

function detectSmoothing(snapshot: TuningSnapshot): TuningDraft['smoothing'] {
  const ff = snapshot.simplified[OFFSET.FEEDFORWARD_GAIN]
  const match = (Object.keys(SMOOTHING_PRESETS) as SmoothingPreset[]).find((key) => {
    const preset = SMOOTHING_PRESETS[key]
    if (preset.feedforwardGain !== ff || preset.rcSmoothing !== snapshot.rcSmoothing) return false
    return !preset.rcSmoothing || preset.autoFactor === snapshot.rcSmoothingAutoFactor
  })
  return match ?? 'custom'
}

export function readTuning(snapshot: TuningSnapshot): TuningDraft {
  return {
    master: snapshot.simplified[OFFSET.MASTER] ?? 100,
    damping: snapshot.simplified[OFFSET.D_GAIN] ?? 100,
    pitch: snapshot.simplified[OFFSET.PITCH_PI_GAIN] ?? 100,
    smoothing: detectSmoothing(snapshot),
  }
}

/** True when the FC has slider values this app pins (or sliders off): saving will reset them. */
export function hasHiddenTuning(snapshot: TuningSnapshot): boolean {
  const { simplified } = snapshot
  // The Pitch gains slider shows the pitch P/I/FF slider; a different pitch D slider gets overwritten with it.
  if (simplified[OFFSET.ROLL_PITCH_RATIO] !== simplified[OFFSET.PITCH_PI_GAIN]) return true
  return LOCKED.some(([offset, value]) => simplified[offset] !== value)
}

/** Slider range, widened if the FC's current value lies outside the normal one. */
export function sliderBounds(value: number): { min: number; max: number } {
  return { min: Math.min(SLIDER_MIN, value), max: Math.max(SLIDER_MAX, value) }
}

/** Payload for MSP_SET_SIMPLIFIED_TUNING (whole message) — filter sliders are passed through untouched. */
export function buildSimplifiedTuning(snapshot: TuningSnapshot, draft: TuningDraft): Uint8Array {
  const payload = Uint8Array.from(snapshot.simplified)
  for (const [offset, value] of LOCKED) payload[offset] = value
  payload[OFFSET.MASTER] = draft.master
  payload[OFFSET.D_GAIN] = draft.damping
  payload[OFFSET.ROLL_PITCH_RATIO] = draft.pitch
  payload[OFFSET.PITCH_PI_GAIN] = draft.pitch
  if (draft.smoothing !== 'custom') payload[OFFSET.FEEDFORWARD_GAIN] = SMOOTHING_PRESETS[draft.smoothing].feedforwardGain
  return payload
}

/** Payload for MSP_CALCULATE_SIMPLIFIED_PID: just the PID slider block. */
export function buildCalculateRequest(snapshot: TuningSnapshot, draft: TuningDraft): Uint8Array {
  return buildSimplifiedTuning(snapshot, draft).subarray(0, PID_SLIDER_BYTES)
}

/** CLI settings to write when the smoothing preset changed. Empty = nothing to do (no reboot needed). */
export function smoothingWrites(snapshot: TuningSnapshot, draft: TuningDraft): SettingWrite[] {
  if (draft.smoothing === 'custom' || draft.smoothing === detectSmoothing(snapshot)) return []
  const preset = SMOOTHING_PRESETS[draft.smoothing]
  return [
    { name: 'rc_smoothing', value: preset.rcSmoothing ? 'ON' : 'OFF' },
    { name: 'rc_smoothing_auto_factor', value: String(preset.autoFactor) },
    { name: 'rc_smoothing_auto_factor_throttle', value: String(preset.autoFactor) },
    { name: 'feedforward_smooth_factor', value: String(preset.feedforwardSmoothFactor) },
  ]
}
