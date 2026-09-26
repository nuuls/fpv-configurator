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
/** `motor_idle` (u16, 0.01 %) inside MSP_ADVANCED_CONFIG, after the protocol byte and the PWM rate. */
const ADVANCED_CONFIG_MOTOR_IDLE_OFFSET = 6
/** `dyn_idle_min_rpm` inside MSP_PID_ADVANCED (94). Same offset with and without USE_DYN_IDLE. */
const PID_ADVANCED_DYN_IDLE_OFFSET = 49

export interface MotorsSnapshot {
  /** Raw MSP_ADVANCED_CONFIG payload; written back with only the protocol byte and motor idle changed. */
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
  /** `motor_idle` in 0.01 % of full throttle (550 = 5.5 %). */
  motorIdle: number
  outputOrder: number[]
}

export function readMotors(snapshot: MotorsSnapshot): MotorsDraft {
  return {
    protocol: snapshot.advancedConfig[ADVANCED_CONFIG_PROTOCOL_OFFSET] ?? 0,
    bidirDshot: snapshot.bidirDshot,
    poles: snapshot.poles,
    propsOut: snapshot.propsOut,
    dynIdle: snapshot.dynIdle,
    motorIdle: decodeMotorIdle(snapshot.advancedConfig),
    outputOrder: [...snapshot.outputOrder],
  }
}

export function validateMotors(draft: MotorsDraft, snapshot?: MotorsSnapshot): string[] {
  const problems: string[] = []
  // An untouched out-of-range value from the FC (typically 0 = off) is fine; an edited one must be in range.
  const untouched = snapshot !== undefined && draft.dynIdle === snapshot.dynIdle
  if (!untouched && (draft.dynIdle < DYN_IDLE_MIN || draft.dynIdle > DYN_IDLE_MAX))
    problems.push(`Dynamic idle must be between ${DYN_IDLE_MIN} and ${DYN_IDLE_MAX}.`)
  const idleUntouched =
    snapshot !== undefined && draft.motorIdle === decodeMotorIdle(snapshot.advancedConfig)
  if (!idleUntouched && (draft.motorIdle < MOTOR_IDLE_MIN || draft.motorIdle > MOTOR_IDLE_MAX))
    problems.push(
      `Motor idle must be between ${formatMotorIdle(MOTOR_IDLE_MIN)} and ${formatMotorIdle(MOTOR_IDLE_MAX)}.`,
    )
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

/** Everything but the output order differs — the edits that lock the motor test until saved. */
export function motorSettingsChanged(draft: MotorsDraft, snapshot: MotorsSnapshot): boolean {
  const { outputOrder: _draftOrder, ...settings } = draft
  const { outputOrder: _fcOrder, ...current } = readMotors(snapshot)
  return JSON.stringify(settings) !== JSON.stringify(current)
}

/**
 * The pending order is applied on this side until it is saved: for each motor as the drawing shows it (the
 * draft's order), the FC's motor index that currently drives the same ESC output — where its slider values
 * go, where its RPM and its direction command come from. Identity once the draft matches the FC.
 */
export function fcMotorIndexes(fcOrder: number[], draftOrder: number[], count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const output = draftOrder[i] ?? i
    const index = fcOrder.slice(0, count).indexOf(output)
    return index >= 0 ? index : i
  })
}

/** Slider values by shown motor → the MSP_SET_MOTOR slots the FC expects (all 8; unused ones stopped). */
export function toFcOutputs(values: number[], indexes: number[]): number[] {
  const outputs = new Array<number>(MAX_MOTORS).fill(MOTOR_STOP)
  values.forEach((value, i) => {
    const index = indexes[i]
    if (index !== undefined && index < MAX_MOTORS) outputs[index] = value
  })
  return outputs
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
 * Pauses around a direction flip, like the Betaflight Configurator's wizard: the motors are stopped and the
 * ESC given time to notice (Bluejay and AM32 drop commands while the motor turns; the Configurator pauses
 * 400 ms), the command is sent, the ESC gets a moment to store it (AM32 chimes), then the motors get their
 * slider values back.
 */
export const DIRECTION_CHECK = { stopMs: 500, settleMs: 500 } as const

/** A swap while motors turn stops them for this long before they come back — the cue that it happened. */
export const SWAP_RESTART_MS = 600

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

// ---- MSP_ADVANCED_CONFIG (90) / SET (91): read-modify-write, only the protocol byte and motor idle change ----

export function decodeMotorIdle(advancedConfig: number[]): number {
  const low = advancedConfig[ADVANCED_CONFIG_MOTOR_IDLE_OFFSET] ?? 0
  const high = advancedConfig[ADVANCED_CONFIG_MOTOR_IDLE_OFFSET + 1] ?? 0
  return low | (high << 8)
}

export function encodeSetAdvancedConfig(snapshot: MotorsSnapshot, draft: MotorsDraft): Uint8Array {
  const payload = Uint8Array.from(snapshot.advancedConfig)
  payload[ADVANCED_CONFIG_PROTOCOL_OFFSET] = draft.protocol
  if (payload.length >= ADVANCED_CONFIG_MOTOR_IDLE_OFFSET + 2) {
    payload[ADVANCED_CONFIG_MOTOR_IDLE_OFFSET] = draft.motorIdle & 0xff
    payload[ADVANCED_CONFIG_MOTOR_IDLE_OFFSET + 1] = (draft.motorIdle >> 8) & 0xff
  }
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

// ---- drone types: pick the recommended ranges; nothing is written to the FC ----

/**
 * By prop size, not battery voltage: builders pick the motor KV to suit the voltage, so a 5" on 4S and on 6S reach
 * about the same RPM and want the same idle. Until the drone-type setup step (SPEC §2) exists, the Motors tab
 * picks one of these for its recommendations only.
 */
export const DRONE_TYPES = ['whoop', 'three-inch', 'five-inch', 'seven-inch'] as const
export type DroneType = (typeof DRONE_TYPES)[number]

export const DRONE_TYPE_INFO: Record<
  DroneType,
  { label: string; name: string; description: string }
> = {
  whoop: { label: 'Whoop', name: 'whoop', description: '65–75 mm whoops, 1–2S' },
  'three-inch': { label: '3"', name: '3"', description: '2.5–3.5": toothpicks, cinewhoops' },
  'five-inch': { label: '5"', name: '5"', description: '5" freestyle and racing' },
  'seven-inch': { label: '7"', name: '7"', description: '6–7" long range' },
}

export const DEFAULT_DRONE_TYPE: DroneType = 'five-inch'

// ---- idle zones: good, a warning band either side, danger beyond ----

export type IdleZone = 'good' | 'warning' | 'danger'

/** Bounds are inclusive. Everything below `warningMin` or above `warningMax` is danger. */
export interface IdleZones {
  warningMin: number
  goodMin: number
  goodMax: number
  warningMax: number
}

export function idleZone(value: number, zones: IdleZones): IdleZone {
  if (value >= zones.goodMin && value <= zones.goodMax) return 'good'
  return value >= zones.warningMin && value <= zones.warningMax ? 'warning' : 'danger'
}

/** Contiguous zones across a slider's range, for colouring its track. `to` is inclusive. */
export function idleSegments(
  min: number,
  max: number,
  step: number,
  zones: IdleZones,
): { from: number; to: number; zone: IdleZone }[] {
  const segments: { from: number; to: number; zone: IdleZone }[] = []
  for (let value = min; value <= max; value += step) {
    const zone = idleZone(value, zones)
    const last = segments.at(-1)
    if (last && last.zone === zone) last.to = value
    else segments.push({ from: value, to: value, zone })
  }
  return segments
}

// ---- dynamic idle (dyn_idle_min_rpm, ×100 rpm) ----

/**
 * Slider range and recommended zones per drone type (SPEC §2 Motors). 5" is the user's; the others are estimates
 * of each class's RPM at the default 5.5 % static idle (KV × volts × idle), which reproduces the 5" range.
 */
export const DYN_IDLE_SCALES: Record<DroneType, IdleZones & { min: number; max: number }> = {
  whoop: { min: 30, max: 80, warningMin: 39, goodMin: 45, goodMax: 60, warningMax: 66 },
  'three-inch': { min: 16, max: 50, warningMin: 24, goodMin: 28, goodMax: 36, warningMax: 40 },
  'five-inch': { min: 12, max: 40, warningMin: 15, goodMin: 18, goodMax: 25, warningMax: 28 },
  'seven-inch': { min: 8, max: 32, warningMin: 11, goodMin: 14, goodMax: 20, warningMax: 23 },
}

/** What an edited value must stay within: the union of the sliders of all drone types. */
export const DYN_IDLE_MIN = Math.min(...DRONE_TYPES.map((type) => DYN_IDLE_SCALES[type].min))
export const DYN_IDLE_MAX = Math.max(...DRONE_TYPES.map((type) => DYN_IDLE_SCALES[type].max))

export function decodeDynIdle(pidAdvanced: Uint8Array): number {
  return pidAdvanced[PID_ADVANCED_DYN_IDLE_OFFSET] ?? 0
}

export const dynIdleZone = (value: number, type: DroneType) =>
  idleZone(value, DYN_IDLE_SCALES[type])

export const dynIdleSegments = (type: DroneType) => {
  const scale = DYN_IDLE_SCALES[type]
  return idleSegments(scale.min, scale.max, 1, scale)
}

// ---- motor idle (motor_idle, 0.01 % of full throttle) ----

/** Slider: 2–12 % in steps of 0.1 %. Betaflight itself accepts 0–20 %. */
export const MOTOR_IDLE_MIN = 200
export const MOTOR_IDLE_MAX = 1200
export const MOTOR_IDLE_STEP = 10

/**
 * Recommended motor idle (SPEC §2 Motors), the same for every drone type: a share of full throttle already scales
 * with KV × volts. The warning bands differ: 3–4 % and 8–10 %.
 */
export const MOTOR_IDLE_ZONES: IdleZones = {
  warningMin: 300,
  goodMin: 400,
  goodMax: 800,
  warningMax: 1000,
}

/** 550 → "5.5 %". */
export const formatMotorIdle = (value: number) => `${(value / 100).toFixed(1)} %`

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
