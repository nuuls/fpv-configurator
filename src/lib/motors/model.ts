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
/** `dyn_idle_min_rpm` inside MSP_PID_ADVANCED (94). Same offset with and without USE_DYN_IDLE. */
const PID_ADVANCED_DYN_IDLE_OFFSET = 49

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
  /** `dyn_idle_min_rpm` of the current PID profile, in units of 100 rpm. 0 = dynamic idle off. */
  dynIdle: number
}

export interface MotorsDraft {
  protocol: number
  bidirDshot: boolean
  poles: number
  /** "Props out": yaw_motors_reversed. */
  propsOut: boolean
  dynIdle: number
}

export function readMotors(snapshot: MotorsSnapshot): MotorsDraft {
  return {
    protocol: snapshot.advancedConfig[ADVANCED_CONFIG_PROTOCOL_OFFSET] ?? 0,
    bidirDshot: snapshot.bidirDshot,
    poles: snapshot.poles,
    propsOut: snapshot.propsOut,
    dynIdle: snapshot.dynIdle,
  }
}

export function validateMotors(draft: MotorsDraft, snapshot?: MotorsSnapshot): string[] {
  const problems: string[] = []
  // An untouched out-of-range value from the FC (typically 0 = off) is fine; an edited one must be in range.
  const untouched = snapshot !== undefined && draft.dynIdle === snapshot.dynIdle
  if (!untouched && (draft.dynIdle < DYN_IDLE_MIN || draft.dynIdle > DYN_IDLE_MAX))
    problems.push(`Dynamic idle must be between ${DYN_IDLE_MIN} and ${DYN_IDLE_MAX}.`)
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

// ---- dynamic idle (dyn_idle_min_rpm, ×100 rpm) ----

export const DYN_IDLE_MIN = 12
export const DYN_IDLE_MAX = 40

export type DroneType = 'five-inch'
export type IdleZone = 'good' | 'warning' | 'danger'

/** Recommended idle per drone type (SPEC §2 Motors). Everything outside good ± warningMargin is danger. */
export const DYN_IDLE_ZONES: Record<DroneType, { label: string; goodMin: number; goodMax: number; warningMargin: number }> = {
  'five-inch': { label: '5"', goodMin: 18, goodMax: 25, warningMargin: 3 },
}

export function decodeDynIdle(pidAdvanced: Uint8Array): number {
  return pidAdvanced[PID_ADVANCED_DYN_IDLE_OFFSET] ?? 0
}

export function dynIdleZone(value: number, type: DroneType): IdleZone {
  const { goodMin, goodMax, warningMargin } = DYN_IDLE_ZONES[type]
  if (value >= goodMin && value <= goodMax) return 'good'
  return value >= goodMin - warningMargin && value <= goodMax + warningMargin ? 'warning' : 'danger'
}

/** Contiguous zones across the slider range, for colouring its track. `to` is inclusive. */
export function dynIdleSegments(type: DroneType): { from: number; to: number; zone: IdleZone }[] {
  const segments: { from: number; to: number; zone: IdleZone }[] = []
  for (let value = DYN_IDLE_MIN; value <= DYN_IDLE_MAX; value++) {
    const zone = dynIdleZone(value, type)
    const last = segments.at(-1)
    if (last && last.zone === zone) last.to = value
    else segments.push({ from: value, to: value, zone })
  }
  return segments
}

// ---- MSP_MOTOR_TELEMETRY (139): count, then per motor rpm:u32 invalid:u16 temp:u8 voltage:u16 current:u16 mAh:u16 ----

export interface MotorTelemetry {
  rpm: number
  /** Share of bad telemetry packets in percent (100 = no telemetry at all). */
  invalidPercent: number
}

export function decodeMotorTelemetry(payload: Uint8Array): MotorTelemetry[] {
  const r = new ByteReader(payload)
  const count = r.u8()
  const motors: MotorTelemetry[] = []
  for (let i = 0; i < count && r.remaining >= 13; i++) {
    motors.push({ rpm: r.u32(), invalidPercent: r.u16() / 100 })
    r.skip(7)
  }
  return motors
}

export function encodeMotorTelemetry(motors: MotorTelemetry[]): Uint8Array {
  const w = new ByteWriter().u8(motors.length)
  for (const m of motors) w.u32(m.rpm).u16(Math.round(m.invalidPercent * 100)).zeros(7)
  return w.toBytes()
}

/** Expected spin direction seen from above. Betaflight Quad X, props in: 1 CW, 2 CCW, 3 CCW, 4 CW; props out is the opposite. */
export function spinsClockwise(motor: number, propsOut: boolean): boolean {
  return (motor === 1 || motor === 4) !== propsOut
}
