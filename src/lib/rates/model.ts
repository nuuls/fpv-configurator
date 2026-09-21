/** Rates (stick → rotation speed) — docs/tabs/rates.md. Layout + formula: Betaflight 2026.6 msp.c / fc/rc.c. */

/** Betaflight `ratesType_e`. */
export const RATES_TYPE_NAMES = ['Betaflight', 'Raceflight', 'KISS', 'Actual', 'Quick']
export const RATES_TYPE_ACTUAL = 3

export const AXES = ['Roll', 'Pitch', 'Yaw'] as const

/** One axis in the units the user sees. */
export interface AxisRates {
  /** Center sensitivity in °/s (firmware stores /10). */
  center: number
  /** Max rate at full stick in °/s (firmware stores /10). */
  max: number
  /** Expo 0–100 (shown as 0.00–1.00). */
  expo: number
}

export type RateField = keyof AxisRates
export type SyncMode = 'all' | 'roll-pitch' | 'off'

export interface RatesSnapshot {
  /** Raw MSP_RC_TUNING payload; written back with only the rate bytes changed (throttle settings pass through). */
  raw: number[]
}

export interface RatesDraft {
  type: number
  /** roll, pitch, yaw */
  axes: AxisRates[]
}

/** Betaflight's defaults for Actual rates. */
export const ACTUAL_DEFAULTS: AxisRates = { center: 70, max: 670, expo: 0 }

export const LIMITS: Record<RateField, { min: number; max: number; step: number }> = {
  center: { min: 10, max: 2000, step: 10 },
  max: { min: 10, max: 2000, step: 10 },
  expo: { min: 0, max: 100, step: 1 },
}

/** Byte offsets in MSP_RC_TUNING (111) / MSP_SET_RC_TUNING (204), per axis [roll, pitch, yaw]. */
const OFFSET = {
  center: [0, 12, 11],
  expo: [1, 13, 10],
  max: [2, 3, 4],
  rateLimit: [16, 18, 20], // u16 each
  type: 22,
} as const

const FALLBACK_RATE_LIMIT = 1998

export function readRates({ raw }: RatesSnapshot): RatesDraft {
  return {
    type: raw[OFFSET.type] ?? RATES_TYPE_ACTUAL,
    axes: AXES.map((_, axis) => ({
      center: (raw[OFFSET.center[axis] ?? -1] ?? 0) * 10,
      max: (raw[OFFSET.max[axis] ?? -1] ?? 0) * 10,
      expo: raw[OFFSET.expo[axis] ?? -1] ?? 0,
    })),
  }
}

/** Per-axis hard cap in °/s that the firmware applies after the curve (`rate_limit`). */
export function rateLimits({ raw }: RatesSnapshot): number[] {
  return OFFSET.rateLimit.map((offset) => {
    const value = (raw[offset] ?? 0) | ((raw[offset + 1] ?? 0) << 8)
    return value > 0 ? value : FALLBACK_RATE_LIMIT
  })
}

export function buildRcTuning(snapshot: RatesSnapshot, draft: RatesDraft): Uint8Array {
  const payload = Uint8Array.from(snapshot.raw)
  payload[OFFSET.type] = draft.type
  draft.axes.forEach((rates, axis) => {
    const at = (offsets: readonly number[]) => offsets[axis] ?? -1
    payload[at(OFFSET.center)] = Math.round(rates.center / 10)
    payload[at(OFFSET.max)] = Math.round(rates.max / 10)
    payload[at(OFFSET.expo)] = rates.expo
  })
  return payload
}

export function validateRates(draft: RatesDraft): string[] {
  if (draft.type !== RATES_TYPE_ACTUAL) return []
  const problems: string[] = []
  draft.axes.forEach((rates, axis) => {
    for (const field of ['center', 'max', 'expo'] as const) {
      const { min, max } = LIMITS[field]
      const value = rates[field]
      if (!Number.isFinite(value) || value < min || value > max)
        problems.push(`${AXES[axis]} ${FIELD_LABELS[field].toLowerCase()} must be between ${format(field, min)} and ${format(field, max)}.`)
    }
  })
  return problems
}

export const FIELD_LABELS: Record<RateField, string> = {
  center: 'Center sensitivity',
  max: 'Max rate',
  expo: 'Expo',
}

const format = (field: RateField, value: number) => (field === 'expo' ? (value / 100).toFixed(2) : `${value}°/s`)

// ---- axis sync ----

/** Which sync mode the FC's current values are consistent with (the most linked one wins). */
export function detectSync(axes: AxisRates[]): SyncMode {
  const same = (a?: AxisRates, b?: AxisRates) => JSON.stringify(a) === JSON.stringify(b)
  if (same(axes[0], axes[1]) && same(axes[0], axes[2])) return 'all'
  return same(axes[0], axes[1]) ? 'roll-pitch' : 'off'
}

/** Axes that follow another axis (and are therefore not edited directly). */
export function followerAxes(sync: SyncMode): number[] {
  return sync === 'all' ? [1, 2] : sync === 'roll-pitch' ? [1] : []
}

/** Copies roll onto the axes that follow it. Used when a sync mode is switched on and after every edit. */
export function applySync(axes: AxisRates[], sync: SyncMode): AxisRates[] {
  const roll = axes[0]
  if (!roll) return axes
  const followers = followerAxes(sync)
  return axes.map((rates, axis) => (followers.includes(axis) ? { ...roll } : rates))
}

export function editAxis(axes: AxisRates[], sync: SyncMode, axis: number, field: RateField, value: number): AxisRates[] {
  return applySync(axes.map((rates, i) => (i === axis ? { ...rates, [field]: value } : rates)), sync)
}

// ---- curve ----

/** Betaflight "Actual" rates: rotation speed in °/s for a stick deflection of 0..1. */
export function actualRate(rates: AxisRates, stick: number, limit = FALLBACK_RATE_LIMIT): number {
  const expo = rates.expo / 100
  const curve = stick * (stick ** 5 * expo + stick * (1 - expo))
  const rate = stick * rates.center + Math.max(0, rates.max - rates.center) * curve
  return Math.min(rate, limit)
}

export interface CurveSeries {
  /** e.g. "Roll · Pitch" when synced axes share one curve. */
  label: string
  /** Index of the first axis in the group; picks the colour so it follows the axis, not the rank. */
  axis: number
  rates: AxisRates
  limit: number
}

/** One curve per distinct setting: identical axes would draw exactly on top of each other. */
export function curveSeries(axes: AxisRates[], limits: number[]): CurveSeries[] {
  const series: CurveSeries[] = []
  axes.forEach((rates, axis) => {
    const limit = limits[axis] ?? FALLBACK_RATE_LIMIT
    const twin = series.find((s) => JSON.stringify(s.rates) === JSON.stringify(rates) && s.limit === limit)
    if (twin) twin.label += ` · ${AXES[axis]}`
    else series.push({ label: AXES[axis] ?? '', axis, rates, limit })
  })
  return series
}

/** Rounds up to a tidy axis maximum (…, 500, 1000, 1200, 1500, 2000). */
export function niceMax(value: number): number {
  const steps = [200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000]
  return steps.find((step) => step >= value) ?? 2000
}
