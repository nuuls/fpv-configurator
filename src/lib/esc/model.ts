import { INTERFACE_MODE } from './fourway'

/**
 * What the ESCs report about themselves, decoded from the settings block each ESC firmware keeps in flash.
 * Read-only: nothing here builds a payload for an ESC. Sources for the layouts are listed in docs/tabs/esc.md.
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
}

const SILABS_LAYOUT_SIZE = 0x70
/** Up to `input_type`; the startup tune and the CAN block follow. */
const AM32_LAYOUT_SIZE = 48
export const FILE_NAME_LENGTH = 16
export const CODE_PROBE_LENGTH = 0x80

const SILABS_MCUS: Record<number, { mcu: string; settingsAddress: number }> = {
  0xe8b1: { mcu: 'EFM8BB10', settingsAddress: 0x1a00 },
  0xe8b2: { mcu: 'EFM8BB21', settingsAddress: 0x1a00 },
  0xe8b5: { mcu: 'EFM8BB51', settingsAddress: 0x3000 },
}

/** AM32 bootloader signature = flash size code << 8 | 0x06. 128 k parts take addresses shifted right by 2. */
const AM32_MCUS: Record<number, { mcu: string; settingsAddress: number; fileNameAddress: number }> = {
  0x1f06: { mcu: 'ARM, 32 k flash', settingsAddress: 0x7c00, fileNameAddress: 0x7c00 - 32 },
  0x3506: { mcu: 'ARM, 64 k flash', settingsAddress: 0xf800, fileNameAddress: 0xf800 - 32 },
  0x2b06: { mcu: 'ARM, 128 k flash', settingsAddress: 0x1f800 >> 2, fileNameAddress: (0x1f800 - 32) >> 2 },
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
    }
  }
  if (info.interfaceMode === INTERFACE_MODE.ARM_BLB) {
    const mcu = AM32_MCUS[info.signature]
    if (!mcu || !AM32_PIN_CODES.includes(info.bootByte)) return null
    return { family: 'arm', ...mcu, settingsLength: AM32_LAYOUT_SIZE, codeProbeAddress: null }
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
    }
  | { status: 'unknown'; description: string }
  | { status: 'missing'; description: string }

type Format = (raw: number) => string | null

interface SettingDef {
  key: string
  label: string
  offset: number
  /** First / last layout revision that has the setting. */
  from?: number
  to?: number
  perMotor?: boolean
  /** null hides the row (value not meaningful in this firmware version). */
  format: Format
}

const onOff: Format = (raw) => (raw ? 'On' : 'Off')
const plain: Format = (raw) => String(raw)
const oneOf =
  (names: Record<number, string>): Format =>
  (raw) =>
    names[raw] ?? `Unknown (${raw})`

const DIRECTION = oneOf({ 1: 'Normal', 2: 'Reversed', 3: 'Bidirectional (3D)', 4: 'Bidirectional (3D), reversed' })
const DEMAG = oneOf({ 1: 'Off', 2: 'Low', 3: 'High' })
const BEACON_DELAY = oneOf({ 1: '1 minute', 2: '2 minutes', 3: '5 minutes', 4: '10 minutes', 5: 'Never' })
const TEMPERATURE_PROTECTION: Format = (raw) =>
  raw === 0 ? 'Off' : raw <= 7 ? `${70 + raw * 10} °C` : `Unknown (${raw})`

const BLHELI_S_STARTUP_POWER = ['0.031', '0.047', '0.063', '0.094', '0.125', '0.188', '0.25', '0.38', '0.50', '0.75', '1.00', '1.25', '1.50']

const BLHELI_S_SETTINGS: SettingDef[] = [
  { key: 'direction', label: 'Motor direction', offset: 0x0b, perMotor: true, format: DIRECTION },
  { key: 'startupPower', label: 'Startup power', offset: 0x09, format: (raw) => BLHELI_S_STARTUP_POWER[raw - 1] ?? `Unknown (${raw})` },
  { key: 'timing', label: 'Motor timing', offset: 0x15, format: oneOf({ 1: 'Low', 2: 'Medium low', 3: 'Medium', 4: 'Medium high', 5: 'High' }) },
  { key: 'demag', label: 'Demag compensation', offset: 0x1f, format: DEMAG },
  { key: 'temperature', label: 'Temperature protection', offset: 0x23, to: 32, format: onOff },
  { key: 'temperature', label: 'Temperature protection', offset: 0x23, from: 33, format: TEMPERATURE_PROTECTION },
  { key: 'lowRpmProtection', label: 'Low RPM power protection', offset: 0x24, format: onOff },
  { key: 'brakeOnStop', label: 'Brake on stop', offset: 0x27, format: onOff },
  { key: 'beepStrength', label: 'Beep strength', offset: 0x1b, format: plain },
  { key: 'beaconStrength', label: 'Beacon strength', offset: 0x1c, format: plain },
  { key: 'beaconDelay', label: 'Beacon delay', offset: 0x1d, format: BEACON_DELAY },
]

const BLUEJAY_RAMPUP_200: Record<number, string> = { 1: '0.5 %', 7: '5 %', 8: '7 %', 9: '10 %', 10: '15 %', 11: '20 %', 12: '24 %', 13: '29 %' }

const BLUEJAY_SETTINGS: SettingDef[] = [
  { key: 'direction', label: 'Motor direction', offset: 0x0b, perMotor: true, format: DIRECTION },
  {
    key: 'pwmFrequency',
    label: 'PWM frequency',
    offset: 0x0a,
    // A setting only in layout 205 and from 209 on; otherwise the byte tells what the firmware was built for.
    format: (raw) => (raw === 24 || raw === 48 || raw === 96 ? `${raw} kHz` : raw === 0 || raw === 192 ? 'Dynamic' : null),
  },
  { key: 'startupPowerMin', label: 'Minimum startup power', offset: 0x04, format: (raw) => String(Math.round(1000 + raw * (1000 / 2047))) },
  { key: 'startupPowerMax', label: 'Maximum startup power', offset: 0x07, from: 201, format: (raw) => String(1000 + raw * 4) },
  {
    key: 'timing',
    label: 'Motor timing',
    offset: 0x15,
    format: oneOf({ 1: '0° (low)', 2: '7.5° (medium low)', 3: '15° (medium)', 4: '22.5° (medium high)', 5: '30° (high)' }),
  },
  { key: 'demag', label: 'Demag compensation', offset: 0x1f, format: DEMAG },
  { key: 'rampupPower', label: 'Rampup power', offset: 0x09, to: 200, format: oneOf(BLUEJAY_RAMPUP_200) },
  { key: 'rampupPower', label: 'Rampup power', offset: 0x09, from: 201, format: (raw) => (raw === 0 ? 'Off' : raw <= 13 ? `${raw}x` : `Unknown (${raw})`) },
  { key: 'temperature', label: 'Temperature protection', offset: 0x23, format: TEMPERATURE_PROTECTION },
  { key: 'brakeOnStop', label: 'Brake on stop', offset: 0x27, format: onOff },
  { key: 'brakingStrength', label: 'Braking strength', offset: 0x10, from: 202, to: 202, format: plain },
  { key: 'brakingStrength', label: 'Braking strength', offset: 0x10, from: 204, format: plain },
  { key: 'powerRating', label: 'Power rating', offset: 0x29, from: 206, format: oneOf({ 1: '1S', 2: '2S+' }) },
  { key: 'forceEdtArm', label: 'Force EDT arm', offset: 0x2a, from: 207, format: onOff },
  { key: 'beepStrength', label: 'Beep strength', offset: 0x1b, format: plain },
  { key: 'beaconStrength', label: 'Beacon strength', offset: 0x1c, format: plain },
  { key: 'beaconDelay', label: 'Beacon delay', offset: 0x1d, format: BEACON_DELAY },
]

/** Offsets as in AM32 `Inc/eeprom.h`; "layout revision" is its `eeprom_version`. */
const AM32_SETTINGS: SettingDef[] = [
  { key: 'direction', label: 'Motor direction', offset: 17, perMotor: true, format: (raw) => (raw ? 'Reversed' : 'Normal') },
  { key: 'bidirectional', label: 'Bidirectional (3D) mode', offset: 18, format: onOff },
  { key: 'variablePwm', label: 'Variable PWM frequency', offset: 21, format: oneOf({ 0: 'Off', 1: 'On', 2: 'Automatic' }) },
  { key: 'pwmFrequency', label: 'PWM frequency', offset: 24, format: (raw) => `${raw} kHz` },
  {
    key: 'timing',
    label: 'Timing advance',
    offset: 23,
    // 0–3: steps of 7.5° (configurators before 1.90); 10–42: steps of 0.9375° above 10.
    format: (raw) => (raw <= 3 ? `${raw * 7.5}°` : raw >= 10 && raw <= 42 ? `${trim((raw - 10) * 0.9375)}°` : `Unknown (${raw})`),
  },
  { key: 'startupPower', label: 'Startup power', offset: 25, format: plain },
  { key: 'motorKv', label: 'Motor KV', offset: 26, format: (raw) => String(raw * 40 + 20) },
  { key: 'motorPoles', label: 'Motor poles', offset: 27, format: plain },
  { key: 'complementaryPwm', label: 'Complementary PWM', offset: 20, format: onOff },
  { key: 'brakeOnStop', label: 'Brake on stop', offset: 28, format: oneOf({ 0: 'Off', 1: 'On', 2: 'Active brake' }) },
  { key: 'stuckRotorProtection', label: 'Stuck rotor protection', offset: 22, format: onOff },
  { key: 'stallProtection', label: 'Stall protection', offset: 29, format: onOff },
  { key: 'sineStartup', label: 'Sinusoidal startup', offset: 19, format: onOff },
  { key: 'protocol', label: 'Signal protocol', offset: 46, from: 2, format: oneOf({ 0: 'Auto', 1: 'DShot', 2: 'Servo', 3: 'Serial', 4: 'EDT ARM' }) },
  { key: 'temperatureLimit', label: 'Temperature limit', offset: 43, from: 2, format: (raw) => (raw >= 70 && raw <= 140 ? `${raw} °C` : 'Off') },
  { key: 'currentLimit', label: 'Current limit', offset: 44, from: 2, format: (raw) => (raw > 0 && raw <= 100 ? `${raw * 2} A` : 'Off') },
  { key: 'lowVoltageCutoff', label: 'Low voltage cutoff', offset: 36, from: 1, format: oneOf({ 0: 'Off', 1: 'Per cell', 2: 'Absolute' }) },
  { key: 'lowVoltageThreshold', label: 'Cutoff voltage per cell', offset: 37, from: 1, format: (raw) => `${((raw + 250) / 100).toFixed(2)} V` },
  { key: 'beepVolume', label: 'Beep volume', offset: 30, from: 1, format: plain },
  { key: 'telemetry', label: '30 ms telemetry', offset: 31, from: 1, format: onOff },
]

/** Layout revisions the tables above were checked against; anything else is shown without settings. */
const KNOWN_LAYOUTS: Record<EscFirmware, [from: number, to: number]> = {
  BLHeli_S: [32, 33],
  Bluejay: [200, 209],
  // eeprom_version 3 moved nothing we show (it reuses the old name field), so newer ones are accepted too.
  AM32: [0, 255],
}

const trim = (value: number) => String(Number(value.toFixed(2)))

/** ASCII up to the first NUL / erased byte, trimmed. */
function decodeText(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) {
    if (byte === 0 || byte === 0xff) break
    text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ''
  }
  return text.trim()
}

function listSettings(defs: SettingDef[], bytes: Uint8Array, layoutRevision: number): EscSetting[] {
  const settings: EscSetting[] = []
  for (const def of defs) {
    if (layoutRevision < (def.from ?? 0) || layoutRevision > (def.to ?? Infinity)) continue
    const raw = bytes[def.offset]
    if (raw === undefined) continue // shorter block than expected
    const value = def.format(raw)
    if (value !== null) settings.push({ key: def.key, label: def.label, value, perMotor: def.perMotor ?? false })
  }
  return settings
}

function report(firmware: EscFirmware, version: string, hardware: string, layoutRevision: number, defs: SettingDef[], bytes: Uint8Array): EscReport {
  const [from, to] = KNOWN_LAYOUTS[firmware]
  const known = layoutRevision >= from && layoutRevision <= to
  return {
    status: 'ok',
    firmware,
    version,
    hardware,
    layoutRevision,
    settings: known ? listSettings(defs, bytes, layoutRevision) : [],
    note: known ? null : `Settings layout ${layoutRevision} is not known to this app — the settings can't be shown.`,
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
  return { status: 'unknown', description: `${what} (signature ${hex(info.signature)}). Not supported.` }
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
  if (erased) return { status: 'unknown', description: `No ESC firmware found (${plan.mcu}, settings are empty).` }

  if (plan.family === 'arm') {
    const layoutRevision = bytes[1] ?? 0
    const version = `${bytes[3] ?? 0}.${String(bytes[4] ?? 0).padStart(2, '0')}`
    const fileName = raw.fileName ? decodeText(raw.fileName) : ''
    const hardware = /^[A-Z0-9_]+$/.test(fileName) ? fileName : plan.mcu
    return report('AM32', version, hardware, layoutRevision, AM32_SETTINGS, bytes)
  }

  const main = bytes[0] ?? 0
  const sub = bytes[1] ?? 0
  const layoutRevision = bytes[2] ?? 0
  const name = decodeText(bytes.subarray(0x60, 0x70))
  // "#Z_H_30#" → "Z-H-30", the way ESC Configurator names the board layouts
  const layout = decodeText(bytes.subarray(0x40, 0x50)).replace(/#/g, '').replace(/_/g, '-')
  const hardware = [layout, plan.mcu].filter(Boolean).join(' · ')

  if (name.startsWith('Bluejay')) {
    return report('Bluejay', bluejayVersion(main, sub, name), hardware, layoutRevision, BLUEJAY_SETTINGS, bytes)
  }
  if (name !== '') return { status: 'unknown', description: `Unknown ESC firmware "${name}" ${main}.${sub} (${hardware}).` }
  // Blank name: BLHeli_S — or one of its closed-source forks, which keep their settings to themselves.
  if (containsJescMarker(raw.codeProbe)) return { status: 'unknown', description: `JESC ${main}.${sub} (${hardware}). Not supported.` }
  if (main === 16 && (sub === 8 || sub === 9)) return { status: 'unknown', description: `BLHeli_M ${main}.${sub} (${hardware}). Not supported.` }
  return report('BLHeli_S', `${main}.${sub}`, hardware, layoutRevision, BLHELI_S_SETTINGS, bytes)
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
      (other) => other.status === 'ok' && other.firmware === current.firmware && other.layoutRevision === current.layoutRevision,
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
