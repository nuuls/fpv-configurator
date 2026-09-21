/** ESC/motor settings and motor testing — docs/tabs/motors.md. Layouts: Betaflight 2026.6 msp.c. */
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'

/** Betaflight `motorProtocolTypes_e`, by value. */
export const MOTOR_PROTOCOL_NAMES = [
  'PWM',
  'ONESHOT125',
  'ONESHOT42',
  'MULTISHOT',
  'BRUSHED',
  'DSHOT150',
  'DSHOT300',
  'DSHOT600',
  'PROSHOT1000',
]

/** The protocols this app offers. Anything else is shown read-only until changed. */
export const SELECTABLE_PROTOCOLS = [5, 6, 7]

export const isDshot = (protocol: number) => SELECTABLE_PROTOCOLS.includes(protocol)

export const MOTOR_STOP = 1000
export const MOTOR_MAX = 2000
/** Motor test is capped well below full throttle; bench testing never needs more. */
export const MOTOR_TEST_MAX = 1300

const ADVANCED_CONFIG_PROTOCOL_OFFSET = 3

export interface MotorsSnapshot {
  /** Raw MSP_ADVANCED_CONFIG payload; written back with only the protocol byte changed. */
  advancedConfig: number[]
  motorCount: number
  maxThrottle: number
  minCommand: number
  poles: number
  bidirDshot: boolean
  mixerMode: number
  propsOut: boolean
}

export interface MotorsDraft {
  protocol: number
  bidirDshot: boolean
  poles: number
  /** "Props out": yaw_motors_reversed. */
  propsOut: boolean
}

export function readMotors(snapshot: MotorsSnapshot): MotorsDraft {
  return {
    protocol: snapshot.advancedConfig[ADVANCED_CONFIG_PROTOCOL_OFFSET] ?? 0,
    bidirDshot: snapshot.bidirDshot,
    poles: snapshot.poles,
    propsOut: snapshot.propsOut,
  }
}

export function validateMotors(draft: MotorsDraft): string[] {
  const problems: string[] = []
  if (!Number.isInteger(draft.poles) || draft.poles < 4 || draft.poles > 40 || draft.poles % 2 !== 0)
    problems.push('Motor poles must be an even number between 4 and 40 (count the magnets; usually 12 or 14).')
  return problems
}

// ---- MSP_MOTOR_CONFIG (131) / MSP_SET_MOTOR_CONFIG (222) ----

export function decodeMotorConfig(payload: Uint8Array) {
  const r = new ByteReader(payload)
  r.skip(2) // was minthrottle
  return {
    maxThrottle: r.u16(),
    minCommand: r.u16(),
    motorCount: r.u8(),
    poles: r.u8(),
    bidirDshot: r.u8() !== 0,
  }
}

export function encodeMotorConfig(s: MotorsSnapshot): Uint8Array {
  return new ByteWriter()
    .u16(0)
    .u16(s.maxThrottle)
    .u16(s.minCommand)
    .u8(s.motorCount)
    .u8(s.poles)
    .u8(s.bidirDshot ? 1 : 0)
    .u8(0) // ESC sensor available
    .toBytes()
}

export function encodeSetMotorConfig(snapshot: MotorsSnapshot, draft: MotorsDraft): Uint8Array {
  return new ByteWriter()
    .u16(0)
    .u16(snapshot.maxThrottle)
    .u16(snapshot.minCommand)
    .u8(draft.poles)
    .u8(draft.bidirDshot && isDshot(draft.protocol) ? 1 : 0)
    .toBytes()
}

export function decodeSetMotorConfig(payload: Uint8Array) {
  const r = new ByteReader(payload)
  r.skip(6)
  return { poles: r.u8(), bidirDshot: r.u8() !== 0 }
}

// ---- MSP_ADVANCED_CONFIG (90) / SET (91): read-modify-write, only the protocol byte changes ----

export function encodeSetAdvancedConfig(snapshot: MotorsSnapshot, draft: MotorsDraft): Uint8Array {
  const payload = Uint8Array.from(snapshot.advancedConfig)
  payload[ADVANCED_CONFIG_PROTOCOL_OFFSET] = draft.protocol
  return payload
}

// ---- MSP_MIXER_CONFIG (42) / SET (43): mixerMode, yaw_motors_reversed ----

export function decodeMixerConfig(payload: Uint8Array) {
  const r = new ByteReader(payload)
  return { mixerMode: r.u8(), propsOut: r.remaining >= 1 ? r.u8() !== 0 : false }
}

export function encodeMixerConfig(mixerMode: number, propsOut: boolean): Uint8Array {
  return Uint8Array.of(mixerMode, propsOut ? 1 : 0)
}

// ---- MSP_SET_MOTOR (214): 8 × u16 · MSP_SET_ARMING_DISABLED (99) ----

export function encodeSetMotor(values: number[]): Uint8Array {
  const w = new ByteWriter()
  for (let i = 0; i < 8; i++) w.u16(values[i] ?? MOTOR_STOP)
  return w.toBytes()
}

export function decodeSetMotor(payload: Uint8Array): number[] {
  const r = new ByteReader(payload)
  const values: number[] = []
  while (r.remaining >= 2) values.push(r.u16())
  return values
}

/** Second byte: keep runaway-takeoff prevention enabled. */
export function encodeArmingDisabled(disabled: boolean): Uint8Array {
  return Uint8Array.of(disabled ? 1 : 0, 0)
}
