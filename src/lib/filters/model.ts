/**
 * The minimal filter stack — docs/tabs/filters.md: gyro lowpass 2 (PT1) and the D-term lowpasses on the
 * firmware's filter sliders, RPM filter, dynamic notch. Everything else is switched off on save.
 *
 * Two messages carry the values, and they overlap: MSP_FILTER_CONFIG has every cutoff, MSP_SIMPLIFIED_TUNING
 * has the slider positions plus the cutoffs the sliders drive. Both raw payloads are kept in the snapshot
 * and patched (read-modify-write), so fields this app doesn't know stay as they are.
 */

/** Byte offsets in MSP_FILTER_CONFIG (92) / MSP_SET_FILTER_CONFIG (93); u16 unless the name says U8. */
const FC = {
  GYRO_LPF1_STATIC_U8: 0, // legacy copy, overwritten by the u16 at 20
  DTERM_LPF1_STATIC: 1,
  GYRO_NOTCH1_HZ: 5,
  GYRO_NOTCH1_CUTOFF: 7,
  DTERM_NOTCH_HZ: 9,
  DTERM_NOTCH_CUTOFF: 11,
  GYRO_NOTCH2_HZ: 13,
  GYRO_NOTCH2_CUTOFF: 15,
  GYRO_LPF1_STATIC: 20,
  GYRO_LPF2_STATIC: 22,
  GYRO_LPF2_TYPE_U8: 25,
  DTERM_LPF2_STATIC: 26,
  GYRO_LPF1_DYN_MIN: 29,
  GYRO_LPF1_DYN_MAX: 31,
  DTERM_LPF1_DYN_MIN: 33,
  DTERM_LPF1_DYN_MAX: 35,
  DYN_NOTCH_MIN_HZ: 41,
  RPM_HARMONICS_U8: 43,
  RPM_MIN_HZ_U8: 44,
  DYN_NOTCH_COUNT_U8: 48,
} as const
/** API 1.48: … + RPM filter fade range, Q and three harmonic weights. */
export const FILTER_CONFIG_LENGTH = 56

/** Byte offsets of the two filter slider blocks in MSP_SIMPLIFIED_TUNING (140/141), after 17 bytes of PID sliders. */
const ST = {
  DTERM_SLIDER_ON_U8: 17,
  DTERM_MULTIPLIER_U8: 18,
  DTERM_LPF1_STATIC: 19,
  DTERM_LPF2_STATIC: 21,
  DTERM_LPF1_DYN_MIN: 23,
  DTERM_LPF1_DYN_MAX: 25,
  GYRO_SLIDER_ON_U8: 35,
  GYRO_MULTIPLIER_U8: 36,
  GYRO_LPF1_STATIC: 37,
  GYRO_LPF2_STATIC: 39,
  GYRO_LPF1_DYN_MIN: 41,
  GYRO_LPF1_DYN_MAX: 43,
} as const
/** 17 PID slider bytes + 18 D-term + 18 gyro (each: on, multiplier, four u16 cutoffs, two reserved u32). */
export const SIMPLIFIED_TUNING_LENGTH = 53

/** Cutoffs both messages carry: [offset in MSP_FILTER_CONFIG, offset in MSP_SIMPLIFIED_TUNING]. */
const SHARED_CUTOFFS: [filterConfig: number, simplified: number][] = [
  [FC.DTERM_LPF1_STATIC, ST.DTERM_LPF1_STATIC],
  [FC.DTERM_LPF2_STATIC, ST.DTERM_LPF2_STATIC],
  [FC.DTERM_LPF1_DYN_MIN, ST.DTERM_LPF1_DYN_MIN],
  [FC.DTERM_LPF1_DYN_MAX, ST.DTERM_LPF1_DYN_MAX],
  [FC.GYRO_LPF1_STATIC, ST.GYRO_LPF1_STATIC],
  [FC.GYRO_LPF2_STATIC, ST.GYRO_LPF2_STATIC],
  [FC.GYRO_LPF1_DYN_MIN, ST.GYRO_LPF1_DYN_MIN],
  [FC.GYRO_LPF1_DYN_MAX, ST.GYRO_LPF1_DYN_MAX],
]

// Firmware defaults the sliders scale (gyro.h, pid.h). The static D-term lowpass 1 uses the dynamic minimum.
const GYRO_LPF1_DYN_MIN_HZ = 250
const GYRO_LPF1_DYN_MAX_HZ = 500
const GYRO_LPF2_HZ = 500
const DTERM_LPF1_DYN_MIN_HZ = 75
const DTERM_LPF1_DYN_MAX_HZ = 150
const DTERM_LPF2_HZ = 150
const LPF_MAX_HZ = 1000

const FILTER_PT1 = 0
const RPM_HARMONICS_DEFAULT = 3
/** `simplified_*_filter_multiplier` range in the CLI; MSP would accept less, `diff` output then couldn't be pasted back. */
const MULTIPLIER_MIN = 10
const MULTIPLIER_MAX = 200

export const GYRO_SLIDER = { min: 0, max: 200, step: 10 } as const
export const DTERM_SLIDER = { min: 50, max: 150, step: 5 } as const
export const RPM_MIN_HZ = { min: 30, max: 200, step: 5 } as const
export const DYN_NOTCH_MIN_HZ = { min: 20, max: 250, step: 5 } as const
/** Most notches this app offers; the firmware takes up to DYN_NOTCH_COUNT_FIRMWARE_MAX. */
export const DYN_NOTCH_COUNT_MAX = 2
const DYN_NOTCH_COUNT_FIRMWARE_MAX = 7
/** SPEC §2: one dynamic notch is enough next to a working RPM filter. */
export const DYN_NOTCH_COUNT_RECOMMENDED = 1

export interface FiltersSnapshot {
  /** Raw MSP_FILTER_CONFIG payload. */
  filterConfig: number[]
  /** Raw MSP_SIMPLIFIED_TUNING payload; the PID slider bytes are written back untouched. */
  simplified: number[]
  /** From MSP_MOTOR_CONFIG: without it the firmware has no RPM data and the RPM filter doesn't run. */
  bidirDshot: boolean
}

export interface FiltersDraft {
  /** Gyro lowpass 2 slider in percent (100 = 1.0 = 500 Hz); 0 = filter off. */
  gyroLpf2: number
  /** D-term filter slider in percent. */
  dterm: number
  rpmMinHz: number
  /** 0 = dynamic notch off. */
  dynNotchCount: number
  dynNotchMinHz: number
}

// ---- byte access; payloads shorter than expected read as 0 and are not extended ----

const u8At = (bytes: ArrayLike<number>, offset: number): number => bytes[offset] ?? 0
const u16At = (bytes: ArrayLike<number>, offset: number): number =>
  u8At(bytes, offset) | (u8At(bytes, offset + 1) << 8)

function setU8(bytes: Uint8Array, offset: number, value: number): void {
  if (offset < bytes.length) bytes[offset] = value
}

function setU16(bytes: Uint8Array, offset: number, value: number): void {
  if (offset + 1 >= bytes.length) return
  bytes[offset] = value & 0xff
  bytes[offset + 1] = value >> 8
}

// ---- slider math, as in the firmware's config/simplified_tuning.c (integer division) ----

const scaleHz = (defaultHz: number, percent: number): number =>
  Math.min(LPF_MAX_HZ, Math.floor((defaultHz * percent) / 100))

export function gyroLpf2Hz(percent: number): number {
  return scaleHz(GYRO_LPF2_HZ, percent)
}

export function dtermCutoffs(percent: number): {
  lpf1MinHz: number
  lpf1MaxHz: number
  lpf2Hz: number
} {
  return {
    lpf1MinHz: scaleHz(DTERM_LPF1_DYN_MIN_HZ, percent),
    lpf1MaxHz: scaleHz(DTERM_LPF1_DYN_MAX_HZ, percent),
    lpf2Hz: scaleHz(DTERM_LPF2_HZ, percent),
  }
}

const clampMultiplier = (percent: number): number =>
  Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, percent))

/** Slider position that comes closest to a hand-set cutoff (filter slider switched off on the FC). */
const nearestPercent = (hz: number, defaultHz: number, step: number): number =>
  clampMultiplier(Math.round((hz * 100) / defaultHz / step) * step)

// ---- logic ----

export function readFilters({ filterConfig, simplified }: FiltersSnapshot): FiltersDraft {
  const gyroLpf2 = u16At(filterConfig, FC.GYRO_LPF2_STATIC)
  const dtermLpf1 =
    u16At(filterConfig, FC.DTERM_LPF1_DYN_MIN) || u16At(filterConfig, FC.DTERM_LPF1_STATIC)
  /** 0 when the FC's slider is switched off (cutoffs were set by hand). */
  const sliderPercent = (on: number, multiplier: number) =>
    u8At(simplified, on) !== 0 ? u8At(simplified, multiplier) : 0
  return {
    gyroLpf2:
      gyroLpf2 === 0
        ? 0
        : sliderPercent(ST.GYRO_SLIDER_ON_U8, ST.GYRO_MULTIPLIER_U8) ||
          nearestPercent(gyroLpf2, GYRO_LPF2_HZ, GYRO_SLIDER.step),
    dterm:
      sliderPercent(ST.DTERM_SLIDER_ON_U8, ST.DTERM_MULTIPLIER_U8) ||
      (dtermLpf1 === 0 ? 100 : nearestPercent(dtermLpf1, DTERM_LPF1_DYN_MIN_HZ, DTERM_SLIDER.step)),
    rpmMinHz: u8At(filterConfig, FC.RPM_MIN_HZ_U8),
    // more than the app offers (stock firmware: 3) reads as the most it does; pinnedChanges says so
    dynNotchCount: Math.min(DYN_NOTCH_COUNT_MAX, u8At(filterConfig, FC.DYN_NOTCH_COUNT_U8)),
    dynNotchMinHz: u16At(filterConfig, FC.DYN_NOTCH_MIN_HZ),
  }
}

/** D-term slider range, widened if the FC's current value lies outside the normal one. */
export function dtermSliderBounds(value: number): { min: number; max: number } {
  return { min: Math.min(DTERM_SLIDER.min, value), max: Math.max(DTERM_SLIDER.max, value) }
}

export function validateFilters(draft: FiltersDraft): string[] {
  const problems: string[] = []
  const outside = (value: number, { min, max }: { min: number; max: number }) =>
    !Number.isInteger(value) || value < min || value > max
  if (outside(draft.rpmMinHz, RPM_MIN_HZ))
    problems.push(`RPM filter min frequency must be ${RPM_MIN_HZ.min}–${RPM_MIN_HZ.max} Hz.`)
  if (draft.dynNotchCount > 0 && outside(draft.dynNotchMinHz, DYN_NOTCH_MIN_HZ))
    problems.push(
      `Dynamic notch min frequency must be ${DYN_NOTCH_MIN_HZ.min}–${DYN_NOTCH_MIN_HZ.max} Hz.`,
    )
  if (outside(draft.dynNotchCount, { min: 0, max: DYN_NOTCH_COUNT_MAX }))
    problems.push(`Dynamic notch count must be 0–${DYN_NOTCH_COUNT_MAX}.`)
  return problems
}

/** Cutoffs both messages carry, as the draft wants them. Keyed by the MSP_FILTER_CONFIG offset. */
function sharedCutoffs(draft: FiltersDraft): Map<number, number> {
  const dterm = dtermCutoffs(draft.dterm)
  return new Map([
    [FC.DTERM_LPF1_STATIC, dterm.lpf1MinHz],
    [FC.DTERM_LPF2_STATIC, dterm.lpf2Hz],
    [FC.DTERM_LPF1_DYN_MIN, dterm.lpf1MinHz],
    [FC.DTERM_LPF1_DYN_MAX, dterm.lpf1MaxHz],
    [FC.GYRO_LPF1_STATIC, 0],
    [FC.GYRO_LPF2_STATIC, gyroLpf2Hz(draft.gyroLpf2)],
    [FC.GYRO_LPF1_DYN_MIN, 0],
    [FC.GYRO_LPF1_DYN_MAX, 0],
  ])
}

/** Payload for MSP_SET_FILTER_CONFIG (whole message): the draft plus everything this app pins. */
export function buildFilterConfig(snapshot: FiltersSnapshot, draft: FiltersDraft): Uint8Array {
  const payload = Uint8Array.from(snapshot.filterConfig)
  for (const [offset, hz] of sharedCutoffs(draft)) setU16(payload, offset, hz)
  setU8(payload, FC.GYRO_LPF1_STATIC_U8, 0)
  setU8(payload, FC.GYRO_LPF2_TYPE_U8, FILTER_PT1)
  for (const offset of [
    FC.GYRO_NOTCH1_HZ,
    FC.GYRO_NOTCH1_CUTOFF,
    FC.GYRO_NOTCH2_HZ,
    FC.GYRO_NOTCH2_CUTOFF,
    FC.DTERM_NOTCH_HZ,
    FC.DTERM_NOTCH_CUTOFF,
  ])
    setU16(payload, offset, 0)
  if (u8At(payload, FC.RPM_HARMONICS_U8) === 0)
    setU8(payload, FC.RPM_HARMONICS_U8, RPM_HARMONICS_DEFAULT)
  setU8(payload, FC.RPM_MIN_HZ_U8, draft.rpmMinHz)
  setU8(payload, FC.DYN_NOTCH_COUNT_U8, draft.dynNotchCount)
  // Not validated while the notch is off (the field is disabled), so the FC keeps the frequency it had.
  if (draft.dynNotchCount > 0) setU16(payload, FC.DYN_NOTCH_MIN_HZ, draft.dynNotchMinHz)
  return payload
}

/** Payload for MSP_SET_SIMPLIFIED_TUNING (whole message) — PID sliders are passed through untouched. */
export function buildFilterSliders(snapshot: FiltersSnapshot, draft: FiltersDraft): Uint8Array {
  const payload = Uint8Array.from(snapshot.simplified)
  const cutoffs = sharedCutoffs(draft)
  for (const [filterConfigOffset, offset] of SHARED_CUTOFFS)
    setU16(payload, offset, cutoffs.get(filterConfigOffset) ?? 0)
  setU8(payload, ST.DTERM_SLIDER_ON_U8, 1)
  setU8(payload, ST.DTERM_MULTIPLIER_U8, draft.dterm)
  setU8(payload, ST.GYRO_SLIDER_ON_U8, 1)
  // Slider at 0 = lowpass 2 off; the multiplier itself can't be 0, so the FC keeps the one it had.
  const keptMultiplier = clampMultiplier(u8At(snapshot.simplified, ST.GYRO_MULTIPLIER_U8) || 100)
  setU8(payload, ST.GYRO_MULTIPLIER_U8, draft.gyroLpf2 === 0 ? keptMultiplier : draft.gyroLpf2)
  return payload
}

/** What saving changes besides the visible controls — empty once the FC runs this app's filter stack. */
export function pinnedChanges(snapshot: FiltersSnapshot): string[] {
  const { filterConfig, simplified } = snapshot
  const draft = readFilters(snapshot)
  const differs = (pairs: [offset: number, hz: number][]) =>
    pairs.some(([offset, hz]) => u16At(filterConfig, offset) !== hz)
  const dterm = dtermCutoffs(draft.dterm)
  const changes: string[] = []

  if (
    u16At(filterConfig, FC.GYRO_LPF1_STATIC) !== 0 ||
    u16At(filterConfig, FC.GYRO_LPF1_DYN_MIN) !== 0
  )
    changes.push('gyro lowpass 1 is turned off')
  if (u16At(filterConfig, FC.GYRO_NOTCH1_HZ) !== 0 || u16At(filterConfig, FC.GYRO_NOTCH2_HZ) !== 0)
    changes.push('the static gyro notch filters are turned off')
  if (u16At(filterConfig, FC.DTERM_NOTCH_HZ) !== 0)
    changes.push('the D-term notch filter is turned off')
  if (draft.gyroLpf2 !== 0) {
    if (u8At(filterConfig, FC.GYRO_LPF2_TYPE_U8) !== FILTER_PT1)
      changes.push('gyro lowpass 2 becomes a PT1 filter')
    if (
      u8At(simplified, ST.GYRO_SLIDER_ON_U8) === 0 ||
      differs([[FC.GYRO_LPF2_STATIC, gyroLpf2Hz(draft.gyroLpf2)]])
    )
      changes.push(`gyro lowpass 2 is set to ${gyroLpf2Hz(draft.gyroLpf2)} Hz by the slider`)
  }
  if (
    u8At(simplified, ST.DTERM_SLIDER_ON_U8) === 0 ||
    differs([
      [FC.DTERM_LPF1_STATIC, dterm.lpf1MinHz],
      [FC.DTERM_LPF1_DYN_MIN, dterm.lpf1MinHz],
      [FC.DTERM_LPF1_DYN_MAX, dterm.lpf1MaxHz],
      [FC.DTERM_LPF2_STATIC, dterm.lpf2Hz],
    ])
  )
    changes.push(
      `the D-term lowpass filters are set to ${dterm.lpf1MinHz}–${dterm.lpf1MaxHz} Hz and ${dterm.lpf2Hz} Hz by the slider`,
    )
  if (u8At(filterConfig, FC.RPM_HARMONICS_U8) === 0) changes.push('the RPM filter is turned on')
  if (u8At(filterConfig, FC.DYN_NOTCH_COUNT_U8) > DYN_NOTCH_COUNT_MAX)
    changes.push(
      `the dynamic notch count goes from ${u8At(filterConfig, FC.DYN_NOTCH_COUNT_U8)} to ${draft.dynNotchCount}`,
    )
  return changes
}

// ---- firmware behaviour, for the mock FC ----

/** Stock Betaflight 2026.6 MSP_FILTER_CONFIG: gyro lowpass 1 dynamic 250–500 Hz, three dynamic notches, … */
export function defaultFilterConfig(): number[] {
  const payload = new Uint8Array(FILTER_CONFIG_LENGTH)
  setU8(payload, FC.GYRO_LPF1_STATIC_U8, GYRO_LPF1_DYN_MIN_HZ)
  setU16(payload, FC.DTERM_LPF1_STATIC, DTERM_LPF1_DYN_MIN_HZ)
  setU16(payload, 3, 100) // yaw_lowpass_hz
  setU16(payload, FC.GYRO_LPF1_STATIC, GYRO_LPF1_DYN_MIN_HZ)
  setU16(payload, FC.GYRO_LPF2_STATIC, GYRO_LPF2_HZ)
  setU16(payload, FC.DTERM_LPF2_STATIC, DTERM_LPF2_HZ)
  setU16(payload, FC.GYRO_LPF1_DYN_MIN, GYRO_LPF1_DYN_MIN_HZ)
  setU16(payload, FC.GYRO_LPF1_DYN_MAX, GYRO_LPF1_DYN_MAX_HZ)
  setU16(payload, FC.DTERM_LPF1_DYN_MIN, DTERM_LPF1_DYN_MIN_HZ)
  setU16(payload, FC.DTERM_LPF1_DYN_MAX, DTERM_LPF1_DYN_MAX_HZ)
  setU16(payload, 39, 300) // dyn_notch_q
  setU16(payload, FC.DYN_NOTCH_MIN_HZ, 100)
  setU8(payload, FC.RPM_HARMONICS_U8, RPM_HARMONICS_DEFAULT)
  setU8(payload, FC.RPM_MIN_HZ_U8, 100)
  setU16(payload, 45, 600) // dyn_notch_max_hz
  setU8(payload, 47, 5) // dterm_lpf1_dyn_expo
  setU8(payload, FC.DYN_NOTCH_COUNT_U8, 3)
  setU16(payload, 49, 50) // rpm_filter_fade_range_hz
  setU16(payload, 51, 500) // rpm_filter_q
  for (const offset of [53, 54, 55]) setU8(payload, offset, 100) // rpm_filter_weights
  return [...payload]
}

/** Stock filter part of MSP_SIMPLIFIED_TUNING (bytes 17–52): both sliders on at 1.0 with the default cutoffs. */
export function defaultFilterSliders(): number[] {
  const payload = new Uint8Array(SIMPLIFIED_TUNING_LENGTH)
  setU8(payload, ST.DTERM_SLIDER_ON_U8, 1)
  setU8(payload, ST.DTERM_MULTIPLIER_U8, 100)
  setU8(payload, ST.GYRO_SLIDER_ON_U8, 1)
  setU8(payload, ST.GYRO_MULTIPLIER_U8, 100)
  const filterConfig = defaultFilterConfig()
  for (const [from, to] of SHARED_CUTOFFS) setU16(payload, to, u16At(filterConfig, from))
  return [...payload.subarray(ST.DTERM_SLIDER_ON_U8)]
}

/**
 * What the firmware does with a MSP_SET_SIMPLIFIED_TUNING payload: a slider that is on rescales its filters
 * that aren't disabled (cutoff 0). Returns the payload as MSP_SIMPLIFIED_TUNING reports it afterwards.
 */
export function applyFilterSliders(simplified: ArrayLike<number>): number[] {
  const payload = Uint8Array.from(simplified)
  const rescale = (
    on: number,
    multiplier: number,
    cutoffs: [offset: number, defaultHz: number][],
  ) => {
    if (u8At(payload, on) === 0) return
    for (const [offset, defaultHz] of cutoffs)
      if (u16At(payload, offset) !== 0)
        setU16(payload, offset, scaleHz(defaultHz, u8At(payload, multiplier)))
  }
  rescale(ST.DTERM_SLIDER_ON_U8, ST.DTERM_MULTIPLIER_U8, [
    [ST.DTERM_LPF1_STATIC, DTERM_LPF1_DYN_MIN_HZ],
    [ST.DTERM_LPF2_STATIC, DTERM_LPF2_HZ],
    [ST.DTERM_LPF1_DYN_MIN, DTERM_LPF1_DYN_MIN_HZ],
    [ST.DTERM_LPF1_DYN_MAX, DTERM_LPF1_DYN_MAX_HZ],
  ])
  rescale(ST.GYRO_SLIDER_ON_U8, ST.GYRO_MULTIPLIER_U8, [
    [ST.GYRO_LPF1_STATIC, GYRO_LPF1_DYN_MIN_HZ],
    [ST.GYRO_LPF2_STATIC, GYRO_LPF2_HZ],
    [ST.GYRO_LPF1_DYN_MIN, GYRO_LPF1_DYN_MIN_HZ],
    [ST.GYRO_LPF1_DYN_MAX, GYRO_LPF1_DYN_MAX_HZ],
  ])
  return [...payload]
}

/** Both messages read the same firmware variables: copies the shared cutoffs from one payload into the other. */
export function copySharedCutoffs(
  direction: 'toFilterConfig' | 'toSimplified',
  filterConfig: number[],
  simplified: number[],
): number[] {
  const toFilterConfig = direction === 'toFilterConfig'
  const target = Uint8Array.from(toFilterConfig ? filterConfig : simplified)
  for (const [fc, st] of SHARED_CUTOFFS) {
    if (toFilterConfig) setU16(target, fc, u16At(simplified, st))
    else setU16(target, st, u16At(filterConfig, fc))
  }
  if (toFilterConfig)
    setU8(target, FC.GYRO_LPF1_STATIC_U8, u16At(target, FC.GYRO_LPF1_STATIC) & 0xff)
  return [...target]
}

/** True when the firmware would reject this MSP_SET_FILTER_CONFIG payload (msp.c: notch count, RPM Q / fade / weights). */
export function isFilterConfigRejected(payload: ArrayLike<number>): boolean {
  if (u8At(payload, FC.DYN_NOTCH_COUNT_U8) > DYN_NOTCH_COUNT_FIRMWARE_MAX) return true
  if (payload.length < FILTER_CONFIG_LENGTH) return false
  const q = u16At(payload, 51)
  return (
    u16At(payload, 49) > 1000 ||
    q < 250 ||
    q > 3000 ||
    [53, 54, 55].some((offset) => u8At(payload, offset) > 100)
  )
}
