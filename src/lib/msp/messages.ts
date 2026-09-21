/**
 * Typed MSP payload decoders/encoders — pure functions, one pair per message.
 * Layouts follow Betaflight's `src/main/msp/msp.c`. Encoders exist so the mock FC (and tests)
 * produce exactly what the decoders expect.
 */
import { ByteReader, ByteWriter } from './bytes'

// ---- MSP_API_VERSION (1) ----

export interface ApiVersion {
  protocolVersion: number
  major: number
  minor: number
}

export function decodeApiVersion(payload: Uint8Array): ApiVersion {
  const r = new ByteReader(payload)
  return { protocolVersion: r.u8(), major: r.u8(), minor: r.u8() }
}

export function encodeApiVersion(v: ApiVersion): Uint8Array {
  return new ByteWriter().u8(v.protocolVersion).u8(v.major).u8(v.minor).toBytes()
}

// ---- MSP_FC_VARIANT (2) ----

/** 4-character firmware identifier, e.g. "BTFL" (Betaflight) or "INAV". */
export function decodeFcVariant(payload: Uint8Array): string {
  return new ByteReader(payload).ascii(4)
}

export function encodeFcVariant(variant: string): Uint8Array {
  return new ByteWriter().ascii(variant.padEnd(4).slice(0, 4)).toBytes()
}

// ---- MSP_FC_VERSION (3) ----

export interface FcVersion {
  /** Betaflight 2025.12+ uses calendar versions: major = year - 2000, minor = month. */
  major: number
  minor: number
  patch: number
  /** Full version string, e.g. "2026.6.2". Empty on API < 1.47. */
  versionString: string
}

export function decodeFcVersion(payload: Uint8Array): FcVersion {
  const r = new ByteReader(payload)
  return {
    major: r.u8(),
    minor: r.u8(),
    patch: r.u8(),
    versionString: r.remaining >= 1 ? r.pascalString() : '',
  }
}

export function encodeFcVersion(v: FcVersion): Uint8Array {
  return new ByteWriter().u8(v.major).u8(v.minor).u8(v.patch).pascalString(v.versionString).toBytes()
}

// ---- MSP_BOARD_INFO (4) ----

export interface BoardInfo {
  /** 4-character board identifier, e.g. "S405". */
  identifier: string
  hardwareRevision: number
  /** Present on API >= 1.39; empty strings on older firmware. */
  targetName: string
  boardName: string
  manufacturerId: string
}

export function decodeBoardInfo(payload: Uint8Array): BoardInfo {
  const r = new ByteReader(payload)
  const info: BoardInfo = {
    identifier: r.ascii(4),
    hardwareRevision: r.u16(),
    targetName: '',
    boardName: '',
    manufacturerId: '',
  }
  // boardType:u8, targetCapabilities:u8, then the length-prefixed names
  if (r.remaining >= 3) {
    r.skip(2)
    info.targetName = r.pascalString()
  }
  if (r.remaining >= 1) info.boardName = r.pascalString()
  if (r.remaining >= 1) info.manufacturerId = r.pascalString()
  return info
}

export function encodeBoardInfo(info: BoardInfo): Uint8Array {
  return new ByteWriter()
    .ascii(info.identifier.padEnd(4).slice(0, 4))
    .u16(info.hardwareRevision)
    .u8(0) // boardType
    .u8(0) // targetCapabilities
    .pascalString(info.targetName)
    .pascalString(info.boardName)
    .pascalString(info.manufacturerId)
    .zeros(32) // signature
    .toBytes()
}

// ---- MSP_STATUS (101) ----

export interface Status {
  /** Main loop time in microseconds. */
  cycleTimeUs: number
  i2cErrors: number
  /** Bitmask: bit0 acc, bit1 baro, bit2 mag, bit3 gps, bit4 rangefinder, bit5 gyro. */
  sensors: number
  /** Bitmask of active flight-mode boxes (first 32). */
  modeFlags: number
  pidProfile: number
  /** Percent; 0 when the firmware doesn't report it. */
  cpuLoad: number
}

export function decodeStatus(payload: Uint8Array): Status {
  const r = new ByteReader(payload)
  return {
    cycleTimeUs: r.u16(),
    i2cErrors: r.u16(),
    sensors: r.u16(),
    modeFlags: r.u32(),
    pidProfile: r.u8(),
    cpuLoad: r.remaining >= 2 ? r.u16() : 0,
  }
}

export function encodeStatus(s: Status): Uint8Array {
  return new ByteWriter()
    .u16(s.cycleTimeUs)
    .u16(s.i2cErrors)
    .u16(s.sensors)
    .u32(s.modeFlags)
    .u8(s.pidProfile)
    .u16(s.cpuLoad)
    .toBytes()
}

// ---- MSP_ATTITUDE (108) ----

export interface Attitude {
  /** Degrees. */
  roll: number
  pitch: number
  yaw: number
}

export function decodeAttitude(payload: Uint8Array): Attitude {
  const r = new ByteReader(payload)
  return { roll: r.i16() / 10, pitch: r.i16() / 10, yaw: r.i16() }
}

export function encodeAttitude(a: Attitude): Uint8Array {
  return new ByteWriter()
    .i16(Math.round(a.roll * 10))
    .i16(Math.round(a.pitch * 10))
    .i16(Math.round(a.yaw))
    .toBytes()
}

// ---- MSP_ANALOG (110) ----

export interface Analog {
  /** Volts. */
  voltage: number
  mAhDrawn: number
  rssi: number
  /** Amps. */
  amperage: number
}

export function decodeAnalog(payload: Uint8Array): Analog {
  const r = new ByteReader(payload)
  const legacyVoltage = r.u8() / 10
  const analog: Analog = {
    voltage: legacyVoltage,
    mAhDrawn: r.u16(),
    rssi: r.u16(),
    amperage: r.i16() / 100,
  }
  // API >= 1.41 appends a higher-resolution voltage (0.01 V steps).
  if (r.remaining >= 2) analog.voltage = r.u16() / 100
  return analog
}

export function encodeAnalog(a: Analog): Uint8Array {
  return new ByteWriter()
    .u8(Math.min(255, Math.round(a.voltage * 10)))
    .u16(a.mAhDrawn)
    .u16(a.rssi)
    .i16(Math.round(a.amperage * 100))
    .u16(Math.round(a.voltage * 100))
    .toBytes()
}

// ---- MSP_FEATURE_CONFIG (36) / MSP_SET_FEATURE_CONFIG (37) ----

/** Feature bits from Betaflight `config/feature.h` (only the ones this app touches). */
export const FEATURE = {
  RX_SERIAL: 1 << 3,
  GPS: 1 << 7,
  TELEMETRY: 1 << 10,
  OSD: 1 << 18,
  AIRMODE: 1 << 22,
  RX_SPI: 1 << 25,
  ESC_SENSOR: 1 << 27,
} as const

export function decodeFeatureMask(payload: Uint8Array): number {
  return new ByteReader(payload).u32()
}

export function encodeFeatureMask(mask: number): Uint8Array {
  return new ByteWriter().u32(mask).toBytes()
}

// ---- MSP_RX_CONFIG (44) ----

/** `serialrx_provider` values from Betaflight `rx/rx.h`. */
export const SERIALRX_PROVIDER_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'SPEKTRUM2048',
  2: 'SBUS',
  3: 'SUMD',
  4: 'SUMH',
  5: 'XBUS_MODE_B',
  6: 'XBUS_MODE_B_RJ01',
  7: 'IBUS',
  8: 'JETIEXBUS',
  9: 'CRSF',
  10: 'SRXL',
  11: 'CUSTOM',
  12: 'FPORT',
  13: 'SRXL2',
  14: 'GHST',
  15: 'SPEKTRUM1024',
  16: 'MAVLINK',
}

export const SERIALRX_CRSF = 9

/** Only the first field is decoded; the rest of MSP_RX_CONFIG isn't needed yet. */
export function decodeSerialRxProvider(payload: Uint8Array): number {
  return new ByteReader(payload).u8()
}

// ---- MSP2_COMMON_SERIAL_CONFIG (0x1009) / MSP2_COMMON_SET_SERIAL_CONFIG (0x100A) ----

export interface SerialPortConfig {
  /** Betaflight `serialPortIdentifier_e`: 20 = USB VCP, 30+ = SOFTSERIAL, 40+ = LPUART, 51 = UART1, ... */
  identifier: number
  /** Bitmask of `serialPortFunction_e`, see `lib/ports/model.ts`. */
  functionMask: number
  /** Baud rates are indexes into Betaflight's `baudRates` table (5 = 115200). */
  mspBaud: number
  gpsBaud: number
  telemetryBaud: number
  blackboxBaud: number
}

export function decodeSerialConfig(payload: Uint8Array): SerialPortConfig[] {
  const r = new ByteReader(payload)
  const count = r.u8()
  const ports: SerialPortConfig[] = []
  for (let i = 0; i < count; i++) {
    ports.push({
      identifier: r.u8(),
      functionMask: r.u32(),
      mspBaud: r.u8(),
      gpsBaud: r.u8(),
      telemetryBaud: r.u8(),
      blackboxBaud: r.u8(),
    })
  }
  return ports
}

export function encodeSerialConfig(ports: SerialPortConfig[]): Uint8Array {
  const w = new ByteWriter().u8(ports.length)
  for (const port of ports) {
    w.u8(port.identifier)
      .u32(port.functionMask)
      .u8(port.mspBaud)
      .u8(port.gpsBaud)
      .u8(port.telemetryBaud)
      .u8(port.blackboxBaud)
  }
  return w.toBytes()
}

// ---- MSP2_CLI_SETTING (0x3010) ----

/** Request payload that sets a CLI variable: ASCII `name = value`, same syntax as the CLI's `set`. */
export function encodeCliSettingWrite(name: string, value: string): Uint8Array {
  return new ByteWriter().ascii(`${name} = ${value}`).toBytes()
}

/** Parses `name = value` (request or echoed response). Returns null if there is no `=`. */
export function decodeCliSetting(payload: Uint8Array): { name: string; value: string } | null {
  const text = new ByteReader(payload).ascii(payload.length)
  const eq = text.indexOf('=')
  if (eq < 0) return null
  return { name: text.slice(0, eq).trim(), value: text.slice(eq + 1).trim() }
}

// ---- MSP_REBOOT (68) ----

export const REBOOT_MODE = { FIRMWARE: 0 } as const

export function encodeReboot(mode: number = REBOOT_MODE.FIRMWARE): Uint8Array {
  return Uint8Array.of(mode)
}
