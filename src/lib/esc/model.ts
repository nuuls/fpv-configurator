import { INTERFACE_MODE } from './fourway'

/**
 * What the ESCs report about themselves, decoded from the settings block each ESC firmware keeps in flash, and
 * the settings this app can change in it. A changed block is always the block that was read with single bytes
 * patched (read-modify-write). Sources for the layouts are listed in docs/tabs/esc.md.
 */
export type EscFirmware = 'BLHeli_S' | 'Bluejay' | 'AM32'

/** Reply to cmd_DeviceInitFlash: bootloader signature (lo, hi), its 4th boot message byte, interface mode. */
export interface EscDeviceInfo {
  signature: number
  /** BLHeli bootloaders: a letter. AM32: the signal pin code (port << 4 | pin). */
  bootByte: number
  interfaceMode: number
}

export function decodeDeviceInfo(params: Uint8Array): EscDeviceInfo {
  return {
    signature: ((params[1] ?? 0) << 8) | (params[0] ?? 0),
    bootByte: params[2] ?? 0,
    interfaceMode: params[3] ?? 0,
  }
}

/** Where `io.ts` has to read for this ESC; null when the MCU isn't one we know the flash map of. */
export interface EscReadPlan {
  family: 'silabs' | 'arm'
  mcu: string
  settingsAddress: number
  settingsLength: number
  /** AM32: 16 bytes with the firmware file name, 32 bytes below the settings. */
  fileNameAddress: number | null
  /** SiLabs: start of the code that is searched for the "JESC" marker when the name field is blank. */
  codeProbeAddress: number | null
  /** SiLabs: cmd_DevicePageErase parameter (address / 512) of the settings page. AM32's bootloader erases by itself. */
  erasePage: number | null
  /** false: this app doesn't know the flash map well enough to write to it. */
  writable: boolean
}

/** Settings, layout / MCU / name tags, startup melody: what ESC Configurator reads and writes back as one block. */
const SILABS_LAYOUT_SIZE = 0xff
/** Settings, startup tune and the CAN block up to `term_enable`: the block the AM32 configurator writes back. */
const AM32_LAYOUT_SIZE = 0xb8
const SILABS_ERASE_UNIT = 512
export const FILE_NAME_LENGTH = 16
export const CODE_PROBE_LENGTH = 0x80

const SILABS_MCUS: Record<number, { mcu: string; settingsAddress: number }> = {
  0xe8b1: { mcu: 'EFM8BB10', settingsAddress: 0x1a00 },
  0xe8b2: { mcu: 'EFM8BB21', settingsAddress: 0x1a00 },
  0xe8b5: { mcu: 'EFM8BB51', settingsAddress: 0x3000 },
}

/**
 * AM32 bootloader signature = flash size code << 8 | 0x06. 128 k parts take addresses shifted right by 2 — newer
 * bootloaders report their own flash map instead (AM32 configurator "v3 devinfo"), so those are only read.
 */
const AM32_MCUS: Record<
  number,
  { mcu: string; settingsAddress: number; fileNameAddress: number; writable: boolean }
> = {
  0x1f06: {
    mcu: 'ARM, 32 k flash',
    settingsAddress: 0x7c00,
    fileNameAddress: 0x7c00 - 32,
    writable: true,
  },
  0x3506: {
    mcu: 'ARM, 64 k flash',
    settingsAddress: 0xf800,
    fileNameAddress: 0xf800 - 32,
    writable: true,
  },
  0x2b06: {
    mcu: 'ARM, 128 k flash',
    settingsAddress: 0x1f800 >> 2,
    fileNameAddress: (0x1f800 - 32) >> 2,
    writable: false,
  },
}

/** Signal pins the AM32 bootloader is built for (PA2, PB4, PA6); anything else on an ARM is BLHeli_32. */
const AM32_PIN_CODES = [0x02, 0x14, 0x06]

export function readPlan(info: EscDeviceInfo): EscReadPlan | null {
  if (info.interfaceMode === INTERFACE_MODE.SILABS_BLB) {
    const mcu = SILABS_MCUS[info.signature]
    if (!mcu) return null
    return {
      family: 'silabs',
      ...mcu,
      settingsLength: SILABS_LAYOUT_SIZE,
      fileNameAddress: null,
      codeProbeAddress: 0x80,
      erasePage: mcu.settingsAddress / SILABS_ERASE_UNIT,
      writable: true,
    }
  }
  if (info.interfaceMode === INTERFACE_MODE.ARM_BLB) {
    const mcu = AM32_MCUS[info.signature]
    if (!mcu || !AM32_PIN_CODES.includes(info.bootByte)) return null
    return {
      family: 'arm',
      ...mcu,
      settingsLength: AM32_LAYOUT_SIZE,
      codeProbeAddress: null,
      erasePage: null,
    }
  }
  return null
}

/** Everything read from one ESC, still as bytes. */
export interface EscRawRead {
  info: EscDeviceInfo
  plan: EscReadPlan
  settings: Uint8Array
  fileName: Uint8Array | null
  codeProbe: Uint8Array | null
}

export interface EscSetting {
  key: string
  label: string
  value: string
  /** Meant to be different from motor to motor, so never flagged as "differs". */
  perMotor: boolean
}

/** The only versions this app reads settings of and writes to (SPEC §2 "ESC"). BLHeli_S is shown, never changed. */
export const SUPPORTED_VERSION = { Bluejay: '0.21', AM32: '2.21' } as const

export type EscReport =
  | {
      status: 'ok'
      firmware: EscFirmware
      version: string
      /** Board layout / firmware file name and MCU, e.g. "Z-H-30 · EFM8BB21". */
      hardware: string
      layoutRevision: number
      settings: EscSetting[]
      /** Set when the settings can't be listed (layout newer or older than the ones we know). */
      note: string | null
      /** Things about this ESC the pilot should fix, e.g. a PWM frequency that flies badly. */
      warnings: string[]
      /** The settings block as read, and where it came from: what a change is patched into and written back to. */
      block: Uint8Array
      plan: EscReadPlan
      /** Settings of this ESC can be changed: a supported firmware on flash this app may write to. */
      editable: boolean
    }
  /** A firmware we know, in a version this app doesn't work with. `description` says what to do about it. */
  | {
      status: 'unsupported'
      firmware: EscFirmware
      version: string
      hardware: string
      description: string
    }
  | { status: 'unknown'; description: string }
  | { status: 'missing'; description: string }

type Format = (raw: number) => string | null

/** How a setting is edited. Numbers are shown as `raw × scale + offset`. */
export type EscControl =
  | { kind: 'select'; options: { raw: number; label: string }[] }
  | { kind: 'switch' }
  | {
      kind: 'number'
      min: number
      max: number
      step: number
      unit: string
      scale: number
      offset: number
      /** Shown as a slider with this range marked as recommended (inclusive, in shown numbers). */
      recommended?: { min: number; max: number }
    }

export interface EscSettingDef {
  key: string
  label: string
  offset: number
  /** First / last layout revision that has the setting. */
  from?: number
  to?: number
  perMotor?: boolean
  /** null hides the row (value not meaningful in this firmware version). */
  format: Format
  /** Only on settings this app can change. */
  control?: EscControl
  /** Heading the setting is listed under in the editor. */
  group?: string
  hint?: string
  /** false greys the control out: another setting (looked up by key, raw value) makes it meaningless. */
  enabled?: (raw: (key: string) => number) => boolean
}

const onOff: Format = (raw) => (raw ? 'On' : 'Off')
const plain: Format = (raw) => String(raw)
const oneOf =
  (names: Record<number, string>): Format =>
  (raw) =>
    names[raw] ?? `Unknown (${raw})`

const decimals = (step: number) => (String(step).split('.')[1] ?? '').length

/** The number a `number` control shows for a raw byte, rounded to the precision of its step. */
export function rawToNumber(control: Extract<EscControl, { kind: 'number' }>, raw: number): number {
  return Number((raw * control.scale + control.offset).toFixed(decimals(control.step)))
}

/** The byte for a typed number: limited to the control's range, then to the nearest value the ESC can store. */
export function numberToRaw(
  control: Extract<EscControl, { kind: 'number' }>,
  value: number,
): number {
  const limited = Math.min(control.max, Math.max(control.min, value))
  return Math.min(255, Math.max(0, Math.round((limited - control.offset) / control.scale)))
}

export type RecommendedZone = 'low' | 'good' | 'high'

/** Where a shown number lies relative to the control's recommended range. */
export function recommendedZone(
  range: { min: number; max: number },
  value: number,
): RecommendedZone {
  return value < range.min ? 'low' : value > range.max ? 'high' : 'good'
}

type Editable = Pick<EscSettingDef, 'format' | 'control'>

function number(range: {
  min: number
  max: number
  step?: number
  unit?: string
  scale?: number
  offset?: number
  recommended?: { min: number; max: number }
}): Editable {
  const control = { kind: 'number', step: 1, unit: '', scale: 1, offset: 0, ...range } as const
  return {
    control,
    format: (raw) => `${rawToNumber(control, raw)}${control.unit && ` ${control.unit}`}`,
  }
}

function select(names: Record<number, string>): Editable {
  const options = Object.entries(names).map(([raw, label]) => ({ raw: Number(raw), label }))
  return { control: { kind: 'select', options }, format: oneOf(names) }
}

const toggle: Editable = { control: { kind: 'switch' }, format: onOff }

const DIRECTION = oneOf({
  1: 'Normal',
  2: 'Reversed',
  3: 'Bidirectional (3D)',
  4: 'Bidirectional (3D), reversed',
})
const DEMAG = oneOf({ 1: 'Off', 2: 'Low', 3: 'High' })
const BEACON_DELAY = oneOf({
  1: '1 minute',
  2: '2 minutes',
  3: '5 minutes',
  4: '10 minutes',
  5: 'Never',
})
const TEMPERATURE_PROTECTION: Format = (raw) =>
  raw === 0 ? 'Off' : raw <= 7 ? `${70 + raw * 10} °C` : `Unknown (${raw})`

const BLHELI_S_STARTUP_POWER = [
  '0.031',
  '0.047',
  '0.063',
  '0.094',
  '0.125',
  '0.188',
  '0.25',
  '0.38',
  '0.50',
  '0.75',
  '1.00',
  '1.25',
  '1.50',
]

const BLHELI_S_SETTINGS: EscSettingDef[] = [
  { key: 'direction', label: 'Motor direction', offset: 0x0b, perMotor: true, format: DIRECTION },
  {
    key: 'startupPower',
    label: 'Startup power',
    offset: 0x09,
    format: (raw) => BLHELI_S_STARTUP_POWER[raw - 1] ?? `Unknown (${raw})`,
  },
  {
    key: 'timing',
    label: 'Motor timing',
    offset: 0x15,
    format: oneOf({ 1: 'Low', 2: 'Medium low', 3: 'Medium', 4: 'Medium high', 5: 'High' }),
  },
  { key: 'demag', label: 'Demag compensation', offset: 0x1f, format: DEMAG },
  { key: 'temperature', label: 'Temperature protection', offset: 0x23, to: 32, format: onOff },
  {
    key: 'temperature',
    label: 'Temperature protection',
    offset: 0x23,
    from: 33,
    format: TEMPERATURE_PROTECTION,
  },
  { key: 'lowRpmProtection', label: 'Low RPM power protection', offset: 0x24, format: onOff },
  { key: 'brakeOnStop', label: 'Brake on stop', offset: 0x27, format: onOff },
  { key: 'beepStrength', label: 'Beep strength', offset: 0x1b, format: plain },
  { key: 'beaconStrength', label: 'Beacon strength', offset: 0x1c, format: plain },
  { key: 'beaconDelay', label: 'Beacon delay', offset: 0x1d, format: BEACON_DELAY },
]

/** PWM frequency Bluejay should be built for; SPEC §2: anything else flies a lot worse. */
export const BLUEJAY_GOOD_PWM_KHZ = 24
const BLUEJAY_PWM_OFFSET = 0x0a

/** Bluejay 0.21, settings layout 208 (`Bluejay.asm`). Ranges and steps of the editable ones as in ESC Configurator. */
const BLUEJAY_SETTINGS: EscSettingDef[] = [
  { key: 'direction', label: 'Motor direction', offset: 0x0b, perMotor: true, format: DIRECTION },
  {
    key: 'pwmFrequency',
    label: 'PWM frequency',
    offset: BLUEJAY_PWM_OFFSET,
    // Not a setting: the byte tells what the firmware was built for (`24 SHL PWM_FREQ`). Changing it means flashing.
    format: (raw) => (raw === 24 || raw === 48 || raw === 96 ? `${raw} kHz` : null),
  },
  {
    key: 'startupPowerMin',
    label: 'Minimum startup power',
    offset: 0x04,
    hint: 'Throttle the motor starts with.',
    ...number({
      min: 1000,
      max: 1125,
      step: 5,
      scale: 1000 / 2047,
      offset: 1000,
      recommended: { min: 1025, max: 1050 },
    }),
  },
  {
    key: 'startupPowerMax',
    label: 'Maximum startup power',
    offset: 0x07,
    hint: 'Throttle limit while the motor starts.',
    // The firmware's factor is 1000 / 255; 4 keeps the numbers round (ESC Configurator does the same).
    ...number({
      min: 1004,
      max: 1300,
      step: 4,
      scale: 4,
      offset: 1000,
      recommended: { min: 1050, max: 1200 },
    }),
  },
  {
    key: 'timing',
    label: 'Motor timing',
    offset: 0x15,
    ...select({
      1: '0° (low)',
      2: '7.5° (medium low)',
      3: '15° (medium)',
      4: '22.5° (medium high)',
      5: '30° (high)',
    }),
  },
  { key: 'demag', label: 'Demag compensation', offset: 0x1f, format: DEMAG },
  {
    key: 'rampupPower',
    label: 'Rampup power',
    offset: 0x09,
    format: (raw) => (raw === 0 ? 'Off' : raw <= 13 ? `${raw}x` : `Unknown (${raw})`),
  },
  {
    key: 'temperature',
    label: 'Temperature protection',
    offset: 0x23,
    format: TEMPERATURE_PROTECTION,
  },
  { key: 'brakeOnStop', label: 'Brake on stop', offset: 0x27, format: onOff },
  { key: 'brakingStrength', label: 'Braking strength', offset: 0x10, format: plain },
  { key: 'powerRating', label: 'Power rating', offset: 0x29, format: oneOf({ 1: '1S', 2: '2S+' }) },
  { key: 'forceEdtArm', label: 'Force EDT arm', offset: 0x2a, format: onOff },
  { key: 'beepStrength', label: 'Beep strength', offset: 0x1b, format: plain },
  { key: 'beaconStrength', label: 'Beacon strength', offset: 0x1c, format: plain },
  { key: 'beaconDelay', label: 'Beacon delay', offset: 0x1d, format: BEACON_DELAY },
]

/** Raw 10–42 is (raw − 10) × 0.9375°; 0–3 is the format of old configurators, ×7.5° (`loadEEpromSettings`). */
const AM32_TIMING = Object.fromEntries(
  Array.from({ length: 33 }, (_, step) => [step + 10, `${trim(step * 0.9375)}°`]),
)
const am32Timing = select(AM32_TIMING)

const noCarBraking = (raw: (key: string) => number) => raw('rcCarReversing') === 0

/**
 * AM32 2.21, `eeprom_version` 4. Offsets from AM32 `Inc/eeprom.h`; groups, ranges, units and what disables what
 * from the AM32 configurator (`pages/configurator.vue`) — all of its settings except the startup tune.
 */
const AM32_SETTINGS: EscSettingDef[] = [
  {
    key: 'protocol',
    label: 'Signal protocol',
    offset: 46,
    group: 'Essentials',
    ...select({ 0: 'Auto', 1: 'DShot', 2: 'Servo', 3: 'Serial', 4: 'EDT ARM' }),
  },
  {
    key: 'disableStickCalibration',
    label: 'Disable stick calibration',
    offset: 7,
    group: 'Essentials',
    ...toggle,
  },

  {
    key: 'direction',
    label: 'Motor direction',
    offset: 17,
    perMotor: true,
    group: 'Motor',
    ...select({ 0: 'Normal', 1: 'Reversed' }),
  },
  { key: 'bidirectional', label: 'Bidirectional (3D) mode', offset: 18, group: 'Motor', ...toggle },
  {
    key: 'variablePwm',
    label: 'PWM type',
    offset: 21,
    group: 'Motor',
    ...select({ 0: 'Fixed', 1: 'Variable', 2: 'By RPM' }),
  },
  {
    key: 'pwmFrequency',
    label: 'PWM frequency',
    offset: 24,
    group: 'Motor',
    hint: 'Variable PWM runs between this frequency and twice as much.',
    enabled: (raw) => raw('variablePwm') < 2,
    ...number({ min: 8, max: 144, unit: 'kHz' }),
  },
  { key: 'autoAdvance', label: 'Auto timing advance', offset: 47, group: 'Motor', ...toggle },
  {
    key: 'timing',
    label: 'Timing advance',
    offset: 23,
    group: 'Motor',
    enabled: (raw) => raw('autoAdvance') !== 1,
    ...am32Timing,
    format: (raw) => (raw <= 3 ? `${raw * 7.5}°` : am32Timing.format(raw)),
  },
  {
    key: 'startupPower',
    label: 'Startup power',
    offset: 25,
    group: 'Motor',
    ...number({ min: 50, max: 150, unit: '%' }),
  },
  {
    key: 'motorKv',
    label: 'Motor KV',
    offset: 26,
    group: 'Motor',
    ...number({ min: 20, max: 10220, step: 40, scale: 40, offset: 20 }),
  },
  {
    key: 'motorPoles',
    label: 'Motor poles',
    offset: 27,
    group: 'Motor',
    ...number({ min: 2, max: 36 }),
  },
  { key: 'complementaryPwm', label: 'Complementary PWM', offset: 20, group: 'Motor', ...toggle },
  {
    key: 'stuckRotorProtection',
    label: 'Stuck rotor protection',
    offset: 22,
    group: 'Motor',
    ...toggle,
  },
  { key: 'stallProtection', label: 'Stall protection', offset: 29, group: 'Motor', ...toggle },
  { key: 'hallSensors', label: 'Use hall sensors', offset: 39, group: 'Motor', ...toggle },
  { key: 'telemetry', label: '30 ms telemetry', offset: 31, group: 'Motor', ...toggle },
  {
    key: 'beepVolume',
    label: 'Beep volume',
    offset: 30,
    group: 'Motor',
    ...number({ min: 0, max: 11 }),
  },

  {
    key: 'maxRamp',
    label: 'Ramp rate',
    offset: 5,
    group: 'Extended settings',
    ...number({ min: 0.1, max: 20, step: 0.1, scale: 0.1, unit: '% duty cycle per ms' }),
  },
  {
    key: 'minimumDutyCycle',
    label: 'Minimum duty cycle',
    offset: 6,
    group: 'Extended settings',
    ...number({ min: 0, max: 25, step: 0.5, scale: 0.5, unit: '%' }),
  },

  {
    key: 'lowVoltageCutoff',
    label: 'Low voltage cutoff',
    offset: 36,
    group: 'Limits',
    ...select({ 0: 'Off', 1: 'Per cell', 2: 'Absolute' }),
  },
  {
    key: 'lowVoltageThreshold',
    label: 'Cutoff voltage per cell',
    offset: 37,
    group: 'Limits',
    enabled: (raw) => raw('lowVoltageCutoff') === 1,
    ...number({ min: 2.5, max: 3.5, step: 0.01, scale: 0.01, offset: 2.5, unit: 'V' }),
    format: (raw) => `${((raw + 250) / 100).toFixed(2)} V`,
  },
  {
    key: 'absoluteVoltageCutoff',
    label: 'Absolute cutoff voltage',
    offset: 8,
    group: 'Limits',
    enabled: (raw) => raw('lowVoltageCutoff') === 2,
    ...number({ min: 0.5, max: 50, step: 0.5, scale: 0.5, unit: 'V' }),
  },
  {
    key: 'temperatureLimit',
    label: 'Temperature limit',
    offset: 43,
    group: 'Limits',
    hint: '141 switches the limit off.',
    ...number({ min: 70, max: 141, unit: '°C' }),
    format: (raw) => (raw >= 70 && raw <= 140 ? `${raw} °C` : 'Off'),
  },
  {
    key: 'currentLimit',
    label: 'Current limit',
    offset: 44,
    group: 'Limits',
    hint: '0 or 202 switches the limit off.',
    ...number({ min: 0, max: 202, step: 2, scale: 2, unit: 'A' }),
    format: (raw) => (raw > 0 && raw <= 100 ? `${raw * 2} A` : 'Off'),
  },

  // Only used while the current limit is on.
  {
    key: 'currentP',
    label: 'Current P',
    offset: 9,
    group: 'Current control',
    ...number({ min: 0, max: 255 }),
  },
  {
    key: 'currentI',
    label: 'Current I',
    offset: 10,
    group: 'Current control',
    ...number({ min: 0, max: 255 }),
  },
  {
    key: 'currentD',
    label: 'Current D',
    offset: 11,
    group: 'Current control',
    ...number({ min: 0, max: 255 }),
  },

  {
    key: 'sineStartup',
    label: 'Sinusoidal startup',
    offset: 19,
    group: 'Sinusoidal startup',
    ...toggle,
  },
  {
    key: 'sineModeRange',
    label: 'Sine mode range',
    offset: 40,
    group: 'Sinusoidal startup',
    enabled: (raw) => raw('sineStartup') !== 0 && noCarBraking(raw),
    ...number({ min: 5, max: 25, unit: '% throttle' }),
  },
  {
    key: 'sineModePower',
    label: 'Sine mode power',
    offset: 45,
    group: 'Sinusoidal startup',
    enabled: (raw) => raw('sineStartup') !== 0 && noCarBraking(raw),
    ...number({ min: 1, max: 10 }),
  },

  {
    key: 'brakeOnStop',
    label: 'Brake on stop',
    offset: 28,
    group: 'Brake',
    ...select({ 0: 'Off', 1: 'On', 2: 'Active brake' }),
  },
  {
    key: 'rcCarReversing',
    label: 'Car type reverse braking',
    offset: 38,
    group: 'Brake',
    ...toggle,
  },
  {
    key: 'brakeStrength',
    label: 'Brake strength',
    offset: 41,
    group: 'Brake',
    enabled: (raw) => raw('brakeOnStop') !== 0 && noCarBraking(raw),
    ...number({ min: 1, max: 10 }),
  },
  {
    key: 'runningBrakeLevel',
    label: 'Running brake level',
    offset: 42,
    group: 'Brake',
    enabled: noCarBraking,
    ...number({ min: 1, max: 10 }),
  },
  {
    key: 'activeBrakePower',
    label: 'Active brake power',
    offset: 12,
    group: 'Brake',
    hint: '0 switches it off.',
    enabled: (raw) => raw('brakeOnStop') === 2,
    ...number({ min: 0, max: 5, unit: '% duty cycle' }),
  },

  {
    key: 'servoLow',
    label: 'Servo low threshold',
    offset: 32,
    group: 'Servo input',
    ...number({ min: 750, max: 1250, step: 2, scale: 2, offset: 750, unit: 'µs' }),
  },
  {
    key: 'servoHigh',
    label: 'Servo high threshold',
    offset: 33,
    group: 'Servo input',
    ...number({ min: 1750, max: 2250, step: 2, scale: 2, offset: 1750, unit: 'µs' }),
  },
  {
    key: 'servoNeutral',
    label: 'Servo neutral',
    offset: 34,
    group: 'Servo input',
    ...number({ min: 1374, max: 1629, offset: 1374, unit: 'µs' }),
  },
  {
    key: 'servoDeadBand',
    label: 'Servo dead band',
    offset: 35,
    group: 'Servo input',
    ...number({ min: 0, max: 100 }),
  },
]

const SETTINGS: Record<EscFirmware, EscSettingDef[]> = {
  BLHeli_S: BLHELI_S_SETTINGS,
  Bluejay: BLUEJAY_SETTINGS,
  AM32: AM32_SETTINGS,
}

/** Layout revisions the tables above were checked against; anything else is shown without settings. */
const KNOWN_LAYOUTS: Record<EscFirmware, [from: number, to: number]> = {
  BLHeli_S: [32, 33],
  Bluejay: [208, 208],
  // AM32: its `eeprom_version`, which 2.21 raises to 4 when it first starts.
  AM32: [4, 4],
}

function trim(value: number): string {
  return String(Number(value.toFixed(2)))
}

/** ASCII up to the first NUL / erased byte, trimmed. */
function decodeText(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) {
    if (byte === 0 || byte === 0xff) break
    text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ''
  }
  return text.trim()
}

function listSettings(
  defs: EscSettingDef[],
  bytes: Uint8Array,
  layoutRevision: number,
): EscSetting[] {
  const settings: EscSetting[] = []
  for (const def of defs) {
    if (layoutRevision < (def.from ?? 0) || layoutRevision > (def.to ?? Infinity)) continue
    const raw = bytes[def.offset]
    if (raw === undefined) continue // shorter block than expected
    const value = def.format(raw)
    if (value !== null)
      settings.push({ key: def.key, label: def.label, value, perMotor: def.perMotor ?? false })
  }
  return settings
}

function warningsFor(firmware: EscFirmware, bytes: Uint8Array): string[] {
  const pwm = bytes[BLUEJAY_PWM_OFFSET]
  if (firmware !== 'Bluejay' || pwm === undefined || pwm === BLUEJAY_GOOD_PWM_KHZ) return []
  return [
    `This Bluejay is the ${pwm} kHz build. Flight performance is greatly reduced with anything but ${BLUEJAY_GOOD_PWM_KHZ} kHz — ` +
      `flash the ${BLUEJAY_GOOD_PWM_KHZ} kHz build of Bluejay ${SUPPORTED_VERSION.Bluejay} with ESC Configurator.`,
  ]
}

function report(
  firmware: EscFirmware,
  version: string,
  hardware: string,
  layoutRevision: number,
  raw: EscRawRead,
): EscReport {
  const [from, to] = KNOWN_LAYOUTS[firmware]
  const known = layoutRevision >= from && layoutRevision <= to
  const defs = SETTINGS[firmware]
  return {
    status: 'ok',
    firmware,
    version,
    hardware,
    layoutRevision,
    settings: known ? listSettings(defs, raw.settings, layoutRevision) : [],
    note: known
      ? null
      : `Settings layout ${layoutRevision} is not known to this app — the settings can't be shown.`,
    warnings: known ? warningsFor(firmware, raw.settings) : [],
    block: raw.settings,
    plan: raw.plan,
    editable: known && raw.plan.writable && defs.some((def) => def.control),
  }
}

/** The same ESC after its settings block was written: what was read back replaces what it said before. */
export function withBlock(esc: ReadableEsc, block: Uint8Array): ReadableEsc {
  return {
    ...esc,
    block,
    settings: listSettings(SETTINGS[esc.firmware], block, esc.layoutRevision),
    warnings: warningsFor(esc.firmware, block),
  }
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`

/** Used when `readPlan` has no answer for the ESC. */
export function describeUnsupported(info: EscDeviceInfo): EscReport {
  const what =
    info.interfaceMode === INTERFACE_MODE.ARM_BLB
      ? 'ARM ESC that is not running AM32 — probably BLHeli_32'
      : info.interfaceMode === INTERFACE_MODE.SILABS_BLB
        ? 'SiLabs ESC with an unknown MCU'
        : 'Atmel / SimonK ESC'
  return {
    status: 'unknown',
    description: `${what} (signature ${hex(info.signature)}). Not supported.`,
  }
}

/** Bluejay version = main.sub plus the patch level it keeps in brackets in its name: "Bluejay (.1 RC2)". */
function bluejayVersion(main: number, sub: number, name: string): string {
  if (main === 0 && sub < 20) return `${main}.${sub}`
  const suffix = /\((.*)\)/.exec(name)?.[1]
  if (suffix === undefined) return `${main}.${sub}.0`
  return `${main}.${sub}${suffix.startsWith('.') || suffix.startsWith(' ') ? suffix : `.0 ${suffix}`}`
}

function containsJescMarker(code: Uint8Array | null): boolean {
  if (!code) return false
  const marker = [0x4a, 0x45, 0x53, 0x43] // "JESC"
  for (let i = 0; i + marker.length <= code.length; i++) {
    if (marker.every((byte, j) => code[i + j] === byte)) return true
  }
  return false
}

/** BLHeli_S leaves its name field blank — and so do its forks, which only their code tells apart. */
export function needsCodeProbe(settings: Uint8Array): boolean {
  return decodeText(settings.subarray(0x60, 0x70)) === ''
}

export function describeEsc(raw: EscRawRead): EscReport {
  const { settings: bytes, plan } = raw
  const erased = bytes.length === 0 || bytes.every((byte) => byte === 0xff)
  if (erased)
    return {
      status: 'unknown',
      description: `No ESC firmware found (${plan.mcu}, settings are empty).`,
    }

  if (plan.family === 'arm') {
    const layoutRevision = bytes[1] ?? 0
    const version = `${bytes[3] ?? 0}.${String(bytes[4] ?? 0).padStart(2, '0')}`
    const fileName = raw.fileName ? decodeText(raw.fileName) : ''
    const hardware = /^[A-Z0-9_]+$/.test(fileName) ? fileName : plan.mcu
    if (version !== SUPPORTED_VERSION.AM32) {
      return {
        status: 'unsupported',
        firmware: 'AM32',
        version,
        hardware,
        description: `AM32 ${version} is not supported: this app only works with AM32 ${SUPPORTED_VERSION.AM32}. Flash it with the AM32 configurator (am32.ca), then read the ESCs again.`,
      }
    }
    return report('AM32', version, hardware, layoutRevision, raw)
  }

  const main = bytes[0] ?? 0
  const sub = bytes[1] ?? 0
  const layoutRevision = bytes[2] ?? 0
  const name = decodeText(bytes.subarray(0x60, 0x70))
  // "#Z_H_30#" → "Z-H-30", the way ESC Configurator names the board layouts
  const layout = decodeText(bytes.subarray(0x40, 0x50)).replace(/#/g, '').replace(/_/g, '-')
  const hardware = [layout, plan.mcu].filter(Boolean).join(' · ')

  if (name.startsWith('Bluejay')) {
    const version = bluejayVersion(main, sub, name)
    if (`${main}.${sub}` !== SUPPORTED_VERSION.Bluejay) {
      const older = main === 0 && sub < 21
      return {
        status: 'unsupported',
        firmware: 'Bluejay',
        version,
        hardware,
        description: older
          ? `Bluejay ${version} is too old: this app only works with Bluejay ${SUPPORTED_VERSION.Bluejay}. Update the ESCs with ESC Configurator (esc-configurator.com), then read them again.`
          : `Bluejay ${version} is newer than this app knows: it only works with Bluejay ${SUPPORTED_VERSION.Bluejay}.`,
      }
    }
    return report('Bluejay', version, hardware, layoutRevision, raw)
  }
  if (name !== '')
    return {
      status: 'unknown',
      description: `Unknown ESC firmware "${name}" ${main}.${sub} (${hardware}).`,
    }
  // Blank name: BLHeli_S — or one of its closed-source forks, which keep their settings to themselves.
  if (containsJescMarker(raw.codeProbe))
    return { status: 'unknown', description: `JESC ${main}.${sub} (${hardware}). Not supported.` }
  if (main === 16 && (sub === 8 || sub === 9))
    return {
      status: 'unknown',
      description: `BLHeli_M ${main}.${sub} (${hardware}). Not supported.`,
    }
  return report('BLHeli_S', `${main}.${sub}`, hardware, layoutRevision, raw)
}

export interface CombinedEscSetting {
  key: string
  label: string
  /** One value when every ESC has the same; one per ESC, in motor order, for a `perMotor` setting that varies. */
  values: string[]
}

/** How the page shows a finished read: one view for ESCs that are all alike, otherwise a card per ESC. */
export type EscOverview =
  | {
      view: 'combined'
      count: number
      firmware: EscFirmware
      version: string
      hardware: string
      settings: CombinedEscSetting[]
      note: string | null
      warnings: string[]
    }
  /** `reason`: why the ESCs can't share a view, unless the cards say so themselves (an ESC that wasn't read). */
  | { view: 'separate'; reason: string | null }

export type ReadableEsc = Extract<EscReport, { status: 'ok' }>

/**
 * All ESCs of a quad should be the same hardware, run the same firmware and be set up alike — except for what is
 * `perMotor`. Only then they are shown as one.
 */
export function combineReports(reports: EscReport[]): EscOverview {
  const escs = reports.filter((report): report is ReadableEsc => report.status === 'ok')
  const first = escs[0]
  if (!first || reports.length < 2 || escs.length < reports.length)
    return { view: 'separate', reason: null }

  const sameFirmware = escs.every(
    (esc) =>
      esc.firmware === first.firmware &&
      esc.version === first.version &&
      esc.layoutRevision === first.layoutRevision,
  )
  if (!sameFirmware)
    return {
      view: 'separate',
      reason: "The ESCs don't all run the same firmware, so they are listed one by one.",
    }
  if (!escs.every((esc) => esc.hardware === first.hardware)) {
    return {
      view: 'separate',
      reason: 'The ESCs are not all the same hardware, so they are listed one by one.',
    }
  }

  // Same firmware and layout: the same rows — unless a value hides one (`format` returning null).
  const rows = new Map<string, EscSetting>()
  for (const esc of escs)
    for (const setting of esc.settings) if (!rows.has(setting.key)) rows.set(setting.key, setting)

  const settings: CombinedEscSetting[] = []
  const differing: string[] = []
  for (const { key, label, perMotor } of rows.values()) {
    const values = escs.map(
      (esc) => esc.settings.find((setting) => setting.key === key)?.value ?? '—',
    )
    const same = values.every((value) => value === values[0])
    if (!same && !perMotor) differing.push(label)
    settings.push({ key, label, values: same ? values.slice(0, 1) : values })
  }
  if (differing.length > 0) {
    return {
      view: 'separate',
      reason: `The ESCs are not set up alike (${differing.join(', ')}), so they are listed one by one.`,
    }
  }
  return {
    view: 'combined',
    count: escs.length,
    firmware: first.firmware,
    version: first.version,
    hardware: first.hardware,
    settings,
    note: first.note,
    warnings: first.warnings,
  }
}

/**
 * Keys of the settings that differ from the first ESC running the same firmware and layout, per ESC.
 * All ESCs of a quad should be set up alike — except for what is `perMotor`.
 */
export function differingSettings(reports: EscReport[]): Set<string>[] {
  return reports.map((current) => {
    const differing = new Set<string>()
    if (current.status !== 'ok') return differing
    const reference = reports.find(
      (other) =>
        other.status === 'ok' &&
        other.firmware === current.firmware &&
        other.layoutRevision === current.layoutRevision,
    )
    if (!reference || reference === current || reference.status !== 'ok') return differing
    for (const setting of current.settings) {
      if (setting.perMotor) continue
      const expected = reference.settings.find((other) => other.key === setting.key)
      if (expected && expected.value !== setting.value) differing.add(setting.key)
    }
    return differing
  })
}

/** Editable copy of the settings blocks, one per ESC in motor order; null for an ESC whose settings can't be changed. */
export type EscDraft = (number[] | null)[]

export function toEscDraft(reports: EscReport[]): EscDraft {
  return reports.map((report) =>
    report.status === 'ok' && report.editable ? Array.from(report.block) : null,
  )
}

/** ESCs that are edited as one: same firmware (the supported version of it), so the same settings. */
export interface EscGroup {
  firmware: EscFirmware
  version: string
  /** Indices into the reports / the draft. */
  escs: number[]
  /** The settings this app can change, in the order they are shown. */
  settings: EscSettingDef[]
}

export function editableGroups(reports: EscReport[]): EscGroup[] {
  const groups: EscGroup[] = []
  reports.forEach((report, index) => {
    if (report.status !== 'ok' || !report.editable) return
    const group = groups.find((other) => other.firmware === report.firmware)
    if (group) group.escs.push(index)
    else {
      const settings = SETTINGS[report.firmware].filter((def) => def.control)
      groups.push({ firmware: report.firmware, version: report.version, escs: [index], settings })
    }
  })
  return groups
}

export function draftRaw(draft: EscDraft, esc: number, def: EscSettingDef): number {
  return draft[esc]?.[def.offset] ?? 0
}

/** Patches one byte into the blocks of these ESCs — nothing else of a block ever changes. */
export function setDraftRaw(
  draft: EscDraft,
  escs: number[],
  def: EscSettingDef,
  raw: number,
): EscDraft {
  return draft.map((block, index) =>
    block && escs.includes(index) ? block.with(def.offset, raw & 0xff) : block,
  )
}

/** Labels of the group's shared settings that are not the same on all of its ESCs. */
export function unevenSettings(draft: EscDraft, group: EscGroup): string[] {
  const first = group.escs[0]
  if (first === undefined) return []
  return group.settings
    .filter(
      (def) =>
        !def.perMotor &&
        group.escs.some((esc) => draftRaw(draft, esc, def) !== draftRaw(draft, first, def)),
    )
    .map((def) => def.label)
}

/** Gives every ESC of the group the first one's value of each shared setting. */
export function alignGroup(draft: EscDraft, group: EscGroup): EscDraft {
  const first = group.escs[0]
  if (first === undefined) return draft
  return group.settings
    .filter((def) => !def.perMotor)
    .reduce((next, def) => setDraftRaw(next, group.escs, def, draftRaw(draft, first, def)), draft)
}

/** Indices of the ESCs whose block is no longer what was read from them. */
export function changedEscs(reports: EscReport[], draft: EscDraft): number[] {
  return reports.flatMap((report, index) => {
    const block = draft[index]
    if (report.status !== 'ok' || !block) return []
    return block.length === report.block.length &&
      block.every((byte, i) => byte === report.block[i])
      ? []
      : [index]
  })
}
