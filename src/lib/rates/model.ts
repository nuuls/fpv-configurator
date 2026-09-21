/** Rates (stick → rotation speed) — docs/tabs/rates.md. Layout + formulas: Betaflight 2026.6 msp.c / fc/rc.c. */

/** Betaflight `ratesType_e`. */
export const RATES_TYPE = { BETAFLIGHT: 0, RACEFLIGHT: 1, KISS: 2, ACTUAL: 3, QUICK: 4 } as const

export const AXES = ['Roll', 'Pitch', 'Yaw'] as const

/**
 * One axis, named after the firmware's three numbers (`rc_rate`, `srate`, `expo`). What they mean, and the unit
 * the user sees, depends on the rate type — see `RATES_TYPES`. Values are in draft units (`FieldSpec`).
 */
export interface AxisRates {
  rcRate: number
  rate: number
  expo: number
}

export type RateField = keyof AxisRates
export type SyncMode = 'all' | 'roll-pitch' | 'off'

export const RATE_FIELDS: RateField[] = ['rcRate', 'rate', 'expo']

export interface RatesSnapshot {
  /** Raw MSP_RC_TUNING payload; written back with only the rate bytes changed (throttle settings pass through). */
  raw: number[]
}

export interface RatesDraft {
  type: number
  /** roll, pitch, yaw */
  axes: AxisRates[]
}

/** How one number of a rate type is shown and stored. */
export interface FieldSpec {
  /** Table column label, sentence case. */
  label: string
  unit: '°/s' | ''
  /** Decimals shown; the draft holds the shown value × 10^decimals, so it stays an integer. */
  decimals: 0 | 2
  /** Draft units per step of the firmware byte: °/s values are stored / 10. */
  perByte: 1 | 10
  /** Range and step in draft units (`ratesSettingLimits` in fc/controlrate_profile.c). */
  min: number
  max: number
  step: number
}

export interface RatesTypeSpec {
  name: string
  /** One sentence explaining the three numbers. */
  help: string
  fields: Record<RateField, FieldSpec>
  /** Betaflight Configurator's starting values for the type. */
  defaults: AxisRates
}

const degrees = (label: string, maxByte: number): FieldSpec => ({ label, unit: '°/s', decimals: 0, perByte: 10, min: 10, max: maxByte * 10, step: 10 })
const fraction = (label: string, minByte: number, maxByte: number): FieldSpec => ({ label, unit: '', decimals: 2, perByte: 1, min: minByte, max: maxByte, step: 1 })
const plain = (label: string, maxByte: number): FieldSpec => ({ label, unit: '', decimals: 0, perByte: 1, min: 0, max: maxByte, step: 1 })

export const RATES_TYPES: Record<number, RatesTypeSpec> = {
  [RATES_TYPE.BETAFLIGHT]: {
    name: 'Betaflight',
    help: 'RC rate sets the overall rotation speed, super rate adds more towards full stick, RC expo softens the feel around mid-stick.',
    fields: { rcRate: fraction('RC rate', 1, 255), rate: fraction('Super rate', 0, 100), expo: fraction('RC expo', 0, 100) },
    defaults: { rcRate: 100, rate: 70, expo: 0 },
  },
  [RATES_TYPE.RACEFLIGHT]: {
    name: 'Raceflight',
    help: 'Rate is the rotation speed at full stick before Acro+, Acro+ adds that many percent on top towards full stick, expo softens the feel around mid-stick.',
    fields: { rcRate: degrees('Rate', 200), rate: plain('Acro+', 255), expo: plain('Expo', 100) },
    defaults: { rcRate: 370, rate: 80, expo: 50 },
  },
  [RATES_TYPE.KISS]: {
    name: 'KISS',
    help: 'RC rate sets the overall rotation speed, rate adds more towards full stick, RC curve softens the feel around mid-stick.',
    fields: { rcRate: fraction('RC rate', 1, 255), rate: fraction('Rate', 0, 99), expo: fraction('RC curve', 0, 100) },
    defaults: { rcRate: 100, rate: 70, expo: 0 },
  },
  [RATES_TYPE.ACTUAL]: {
    name: 'Actual',
    help: 'Center sensitivity is how twitchy the quad feels around mid-stick, max rate is the rotation speed at full stick, expo bends the curve between the two.',
    fields: { rcRate: degrees('Center sensitivity', 200), rate: degrees('Max rate', 200), expo: fraction('Expo', 0, 100) },
    defaults: { rcRate: 70, rate: 670, expo: 0 },
  },
  [RATES_TYPE.QUICK]: {
    name: 'Quick',
    help: 'RC rate is how twitchy the quad feels around mid-stick (1.00 is 200°/s), max rate is the rotation speed at full stick, expo bends the curve between the two.',
    fields: { rcRate: fraction('RC rate', 1, 255), rate: degrees('Max rate', 200), expo: fraction('Expo', 0, 100) },
    defaults: { rcRate: 100, rate: 670, expo: 0 },
  },
}

/** "Type 7" for a rate type from a firmware newer than this app. */
export const ratesTypeName = (type: number) => RATES_TYPES[type]?.name ?? `Type ${type}`

/** The draft a rate type starts from: numbers of different types aren't comparable, so nothing carries over. */
export function defaultRates(type: number): RatesDraft | null {
  const spec = RATES_TYPES[type]
  return spec ? { type, axes: AXES.map(() => ({ ...spec.defaults })) } : null
}

/** Byte offsets in MSP_RC_TUNING (111) / MSP_SET_RC_TUNING (204), per axis [roll, pitch, yaw]. */
const OFFSET = {
  rcRate: [0, 12, 11],
  expo: [1, 13, 10],
  rate: [2, 3, 4],
  rateLimit: [16, 18, 20], // u16 each
  type: 22,
} as const

const FALLBACK_RATE_LIMIT = 1998

/** Unknown rate types keep the plain bytes, so they are written back unchanged. */
const perByte = (type: number, field: RateField) => RATES_TYPES[type]?.fields[field].perByte ?? 1

export function readRates({ raw }: RatesSnapshot): RatesDraft {
  const type = raw[OFFSET.type] ?? RATES_TYPE.ACTUAL
  const read = (field: RateField, axis: number) => (raw[OFFSET[field][axis] ?? -1] ?? 0) * perByte(type, field)
  return {
    type,
    axes: AXES.map((_, axis) => ({ rcRate: read('rcRate', axis), rate: read('rate', axis), expo: read('expo', axis) })),
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
    for (const field of RATE_FIELDS) payload[OFFSET[field][axis] ?? -1] = Math.round(rates[field] / perByte(draft.type, field))
  })
  return payload
}

export function validateRates(draft: RatesDraft): string[] {
  const spec = RATES_TYPES[draft.type]
  if (!spec) return []
  const problems: string[] = []
  draft.axes.forEach((rates, axis) => {
    for (const field of RATE_FIELDS) {
      const { min, max } = spec.fields[field]
      const value = rates[field]
      if (!Number.isFinite(value) || value < min || value > max)
        problems.push(`${fieldName(spec.fields[field], axis)} must be between ${format(spec.fields[field], min)} and ${format(spec.fields[field], max)}.`)
    }
  })
  return problems
}

/** "Roll max rate", "Yaw RC expo" — names an input, and the field in a validation message. */
export function fieldName(field: FieldSpec, axis: number): string {
  const label = field.label.startsWith('RC ') ? field.label : field.label.toLowerCase()
  return `${AXES[axis]} ${label}`
}

/** Draft units → the number the user sees. */
export const shown = (field: FieldSpec, value: number) => value / 10 ** field.decimals

const format = (field: FieldSpec, value: number) => `${shown(field, value).toFixed(field.decimals)}${field.unit}`

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

const RC_RATE_INCREMENTAL = 14.54
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Rotation speed in °/s for a stick deflection of 0..1 — `applyBetaflightRates` … `applyQuickRates` in fc/rc.c,
 * then capped at `rate_limit`. 0 for a rate type this app doesn't know.
 */
export function rateAt(type: number, rates: AxisRates, stick: number, limit = FALLBACK_RATE_LIMIT): number {
  // the firmware's byte values; not rounded, so a half-typed number still moves the curve smoothly
  const rcRate = rates.rcRate / perByte(type, 'rcRate')
  const rate = rates.rate / perByte(type, 'rate')
  const expo = rates.expo / 100
  return Math.min(curve(type, rcRate, rate, expo, stick), FALLBACK_RATE_LIMIT, limit)
}

function curve(type: number, rcRate: number, rate: number, expo: number, stick: number): number {
  switch (type) {
    case RATES_TYPE.BETAFLIGHT: {
      const command = stick * stick ** 3 * expo + stick * (1 - expo)
      const scaled = rcRate / 100
      const rcRateFactor = scaled > 2 ? scaled + RC_RATE_INCREMENTAL * (scaled - 2) : scaled
      return (200 * rcRateFactor * command) / clamp(1 - stick * (rate / 100), 0.01, 1)
    }
    case RATES_TYPE.RACEFLIGHT: {
      const command = (1 + expo * (stick * stick - 1)) * stick
      return 10 * rcRate * command * (1 + stick * rate * 0.01)
    }
    case RATES_TYPE.KISS: {
      const command = (stick ** 3 * expo + stick * (1 - expo)) * (rcRate / 1000)
      return (2000 * command) / clamp(1 - stick * (rate / 100), 0.01, 1)
    }
    case RATES_TYPE.ACTUAL: {
      const centerSensitivity = rcRate * 10
      const command = stick * (stick ** 5 * expo + stick * (1 - expo))
      return stick * centerSensitivity + Math.max(0, rate * 10 - centerSensitivity) * command
    }
    case RATES_TYPE.QUICK: {
      // `quick_rates_rc_expo` isn't in any MSP message; this is the curve for its default, OFF
      const centerSensitivity = rcRate * 2
      if (centerSensitivity <= 0) return 0
      const maxRate = Math.max(rate * 10, centerSensitivity)
      const superFactorConfig = (maxRate / centerSensitivity - 1) / (maxRate / centerSensitivity)
      const command = stick ** 3 * expo + stick * (1 - expo)
      return (stick * centerSensitivity) / clamp(1 - command * superFactorConfig, 0.01, 1)
    }
    default:
      return 0
  }
}

export interface CurveSeries {
  /** e.g. "Roll · Pitch" when synced axes share one curve. */
  label: string
  /** Index of the first axis in the group; picks the colour so it follows the axis, not the rank. */
  axis: number
  type: number
  rates: AxisRates
  limit: number
}

/** One curve per distinct setting: identical axes would draw exactly on top of each other. */
export function curveSeries({ type, axes }: RatesDraft, limits: number[]): CurveSeries[] {
  const series: CurveSeries[] = []
  axes.forEach((rates, axis) => {
    const limit = limits[axis] ?? FALLBACK_RATE_LIMIT
    const twin = series.find((s) => JSON.stringify(s.rates) === JSON.stringify(rates) && s.limit === limit)
    if (twin) twin.label += ` · ${AXES[axis]}`
    else series.push({ label: AXES[axis] ?? '', axis, type, rates, limit })
  })
  return series
}

/** Rounds up to a tidy axis maximum (…, 500, 1000, 1200, 1500, 2000). */
export function niceMax(value: number): number {
  const steps = [200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000]
  return steps.find((step) => step >= value) ?? 2000
}
