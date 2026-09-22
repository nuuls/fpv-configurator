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
  /** `motor_output_reordering`: the (0-based) output each motor drives, `outputOrder[motor - 1]`. */
  outputOrder: number[]
}

export interface MotorsDraft {
  protocol: number
  bidirDshot: boolean
  poles: number
  /** "Props out": yaw_motors_reversed. */
  propsOut: boolean
  dynIdle: number
  outputOrder: number[]
}

export function readMotors(snapshot: MotorsSnapshot): MotorsDraft {
  return {
    protocol: snapshot.advancedConfig[ADVANCED_CONFIG_PROTOCOL_OFFSET] ?? 0,
    bidirDshot: snapshot.bidirDshot,
    poles: snapshot.poles,
    propsOut: snapshot.propsOut,
    dynIdle: snapshot.dynIdle,
    outputOrder: [...snapshot.outputOrder],
  }
}

export function validateMotors(draft: MotorsDraft, snapshot?: MotorsSnapshot): string[] {
  const problems: string[] = []
  // An untouched out-of-range value from the FC (typically 0 = off) is fine; an edited one must be in range.
  const untouched = snapshot !== undefined && draft.dynIdle === snapshot.dynIdle
  if (!untouched && (draft.dynIdle < DYN_IDLE_MIN || draft.dynIdle > DYN_IDLE_MAX))
    problems.push(`Dynamic idle must be between ${DYN_IDLE_MIN} and ${DYN_IDLE_MAX}.`)
  if (
    !Number.isInteger(draft.poles) ||
    draft.poles < 4 ||
    draft.poles > 40 ||
    draft.poles % 2 !== 0
  )
    problems.push(
      'Motor poles must be an even number between 4 and 40 (count the magnets; usually 12 or 14).',
    )
  const outputs = draft.outputOrder.slice(0, snapshot?.motorCount ?? draft.outputOrder.length)
  if (new Set(outputs).size !== outputs.length) problems.push('Every motor needs its own output.')
  return problems
}

// ---- MSP2_MOTOR_OUTPUT_REORDERING (0x3001) / SET (0x3002): count, then the output each motor drives ----

export const MAX_MOTORS = 8

export function decodeMotorOutputReordering(payload: Uint8Array): number[] {
  const r = new ByteReader(payload)
  const count = r.u8()
  const order: number[] = []
  for (let i = 0; i < count && r.remaining >= 1; i++) order.push(r.u8())
  return order
}

/** Same layout for reading and writing; the firmware fills motors beyond `order` with their own index. */
export function encodeMotorOutputReordering(order: number[]): Uint8Array {
  const w = new ByteWriter().u8(order.length)
  for (const output of order) w.u8(output)
  return w.toBytes()
}

export const isDefaultOutputOrder = (order: number[]) => order.every((output, i) => output === i)

/** Motors `a` and `b` (1-based) exchange their outputs: what `a`'s slider drove now answers to `b` and vice versa. */
export function swapMotorOutputs(order: number[], a: number, b: number): number[] {
  const next = [...order]
  const outputA = next[a - 1]
  const outputB = next[b - 1]
  if (outputA === undefined || outputB === undefined || a === b) return next
  next[a - 1] = outputB
  next[b - 1] = outputA
  return next
}

/** The motors (1-based) that don't drive the output of the same number, for the hint under the drawing. */
export function remappedMotors(
  order: number[],
  count: number,
): { motor: number; output: number }[] {
  return order
    .slice(0, count)
    .map((output, i) => ({ motor: i + 1, output: output + 1 }))
    .filter(({ motor, output }) => motor !== output)
}

// ---- MSP2_SEND_DSHOT_COMMAND (0x3003): type, motor index, count, commands ----

/** `dshotCommands_e`; direction commands are stored by the ESC once SAVE_SETTINGS follows. */
export const DSHOT_CMD = {
  SPIN_DIRECTION_NORMAL: 7,
  SPIN_DIRECTION_REVERSED: 8,
  SAVE_SETTINGS: 12,
} as const

export const DSHOT_CMD_TYPE = { INLINE: 0, BLOCKING: 1 } as const
export const DSHOT_ALL_MOTORS = 255

export interface DshotCommandRequest {
  type: number
  /** 0-based motor index, or DSHOT_ALL_MOTORS. */
  motorIndex: number
  commands: number[]
}

export function encodeDshotCommand(request: DshotCommandRequest): Uint8Array {
  const w = new ByteWriter().u8(request.type).u8(request.motorIndex).u8(request.commands.length)
  for (const command of request.commands) w.u8(command)
  return w.toBytes()
}

export function decodeDshotCommand(payload: Uint8Array): DshotCommandRequest {
  const r = new ByteReader(payload)
  const type = r.u8()
  const motorIndex = r.u8()
  const count = r.u8()
  const commands: number[] = []
  for (let i = 0; i < count && r.remaining >= 1; i++) commands.push(r.u8())
  return { type, motorIndex, commands }
}

/**
 * How a direction flip is checked, like the Betaflight Configurator's wizard does it: the motor is stopped and
 * the ESC given time to notice (Bluejay and AM32 drop commands while the motor turns; the Configurator pauses
 * 400 ms), the command is sent, the ESC gets a moment to store it (AM32 chimes), then the motor is spun so the
 * new direction can be seen.
 */
export const DIRECTION_CHECK = {
  stopMs: 500,
  settleMs: 500,
  spinMs: 2000,
  spinValue: 1100,
} as const

/**
 * Sets and stores the spin direction of one motor's ESC. Blocking, like the Betaflight Configurator's direction
 * wizard: the FC pauses the motor outputs, repeats each command as often as the ESC needs, and resumes.
 */
export function spinDirectionRequest(motor: number, reversed: boolean): DshotCommandRequest {
  return {
    type: DSHOT_CMD_TYPE.BLOCKING,
    motorIndex: motor - 1,
    commands: [
      reversed ? DSHOT_CMD.SPIN_DIRECTION_REVERSED : DSHOT_CMD.SPIN_DIRECTION_NORMAL,
      DSHOT_CMD.SAVE_SETTINGS,
    ],
  }
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
export const DYN_IDLE_ZONES: Record<
  DroneType,
  { label: string; goodMin: number; goodMax: number; warningMargin: number }
> = {
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
  for (const m of motors)
    w.u32(m.rpm)
      .u16(Math.round(m.invalidPercent * 100))
      .zeros(7)
  return w.toBytes()
}

/** Expected spin direction seen from above. Betaflight Quad X, props in: 1 CW, 2 CCW, 3 CCW, 4 CW; props out is the opposite. */
export function spinsClockwise(motor: number, propsOut: boolean): boolean {
  return (motor === 1 || motor === 4) !== propsOut
}
