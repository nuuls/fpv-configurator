/** Mode (AUX switch) ranges — docs/tabs/modes.md. Layouts: Betaflight 2026.6 msp.c / msp_box.c. */
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'

/** The only modes this app shows. `id` is Betaflight's permanent box id. */
export const MODE_BOXES = [
  { id: 0, label: 'Arm', hint: 'Enables the motors.' },
  { id: 1, label: 'Angle', hint: 'Self-levelling flight mode.' },
  { id: 35, label: 'Turtle mode', hint: 'Flip over after a crash.' },
  { id: 13, label: 'Beeper', hint: 'Sounds the buzzer to find the quad.' },
] as const

export const PWM_MIN = 900
export const PWM_MAX = 2100
export const PWM_STEP = 25
/** RC channels 1-4 are the sticks; AUX1 is channel 5. */
export const FIRST_AUX_CHANNEL = 4

/** One of the FC's 20 mode activation slots. A slot with start >= end is unused. */
export interface ModeSlot {
  boxId: number
  /** 0 = AUX1 */
  auxChannel: number
  /** PWM microseconds, multiples of 25 between 900 and 2100. */
  start: number
  end: number
}

export interface ModeRange {
  auxChannel: number
  start: number
  end: number
}

/** What the user edits: the ranges of each managed mode the FC supports. */
export type ModesDraft = { boxId: number; ranges: ModeRange[] }[]

export interface ModesSnapshot {
  slots: ModeSlot[]
  /** Permanent ids of the modes this firmware build offers. */
  boxIds: number[]
}

const toPwm = (step: number) => PWM_MIN + step * PWM_STEP
const toStep = (pwm: number) => Math.round((pwm - PWM_MIN) / PWM_STEP)

const EMPTY_SLOT: ModeSlot = { boxId: 0, auxChannel: 0, start: PWM_MIN, end: PWM_MIN }

// ---- MSP_MODE_RANGES (34) / MSP_SET_MODE_RANGE (35) ----

export function decodeModeRanges(payload: Uint8Array): ModeSlot[] {
  const r = new ByteReader(payload)
  const slots: ModeSlot[] = []
  while (r.remaining >= 4) {
    slots.push({ boxId: r.u8(), auxChannel: r.u8(), start: toPwm(r.u8()), end: toPwm(r.u8()) })
  }
  return slots
}

export function encodeModeRanges(slots: ModeSlot[]): Uint8Array {
  const w = new ByteWriter()
  for (const s of slots) w.u8(s.boxId).u8(s.auxChannel).u8(toStep(s.start)).u8(toStep(s.end))
  return w.toBytes()
}

/** Trailing modeLogic = 0 (OR) and linkedTo = 0 (none): this app doesn't do linked modes. */
export function encodeSetModeRange(index: number, slot: ModeSlot): Uint8Array {
  return new ByteWriter()
    .u8(index)
    .u8(slot.boxId)
    .u8(slot.auxChannel)
    .u8(toStep(slot.start))
    .u8(toStep(slot.end))
    .u8(0)
    .u8(0)
    .toBytes()
}

export function decodeSetModeRange(payload: Uint8Array): { index: number; slot: ModeSlot } {
  const r = new ByteReader(payload)
  return {
    index: r.u8(),
    slot: { boxId: r.u8(), auxChannel: r.u8(), start: toPwm(r.u8()), end: toPwm(r.u8()) },
  }
}

// ---- MSP_BOXIDS (119): one permanent id per byte · MSP_RC (105): one u16 per channel ----

export function decodeBoxIds(payload: Uint8Array): number[] {
  return [...payload]
}

export function decodeRc(payload: Uint8Array): number[] {
  const r = new ByteReader(payload)
  const channels: number[] = []
  while (r.remaining >= 2) channels.push(r.u16())
  return channels
}

export function encodeRc(channels: number[]): Uint8Array {
  const w = new ByteWriter()
  for (const value of channels) w.u16(value)
  return w.toBytes()
}

// ---- logic ----

const isUsed = (slot: ModeSlot) => slot.start < slot.end
const isManaged = (boxId: number) => MODE_BOXES.some((box) => box.id === boxId)

export function readModes(snapshot: ModesSnapshot): ModesDraft {
  return MODE_BOXES.filter((box) => snapshot.boxIds.includes(box.id)).map((box) => ({
    boxId: box.id,
    ranges: snapshot.slots
      .filter((slot) => isUsed(slot) && slot.boxId === box.id)
      .map(({ auxChannel, start, end }) => ({ auxChannel, start, end })),
  }))
}

/** Slots taken by modes this app doesn't show (set up elsewhere); they are never touched. */
export function unmanagedSlotCount(snapshot: ModesSnapshot): number {
  return snapshot.slots.filter((slot) => isUsed(slot) && !isManaged(slot.boxId)).length
}

export function validateModes(snapshot: ModesSnapshot, draft: ModesDraft): string[] {
  const problems: string[] = []
  const ranges = draft.flatMap((mode) => mode.ranges)
  if (ranges.some((range) => range.start >= range.end))
    problems.push('A range needs a start below its end.')
  const capacity = snapshot.slots.length - unmanagedSlotCount(snapshot)
  if (ranges.length > capacity)
    problems.push(`Too many ranges: the flight controller has room for ${capacity}.`)
  return problems
}

/** Slot writes that turn the FC's current ranges into the draft. Only changed slots are returned. */
export function planModeWrites(
  snapshot: ModesSnapshot,
  draft: ModesDraft,
): { index: number; slot: ModeSlot }[] {
  const wanted: ModeSlot[] = draft.flatMap((mode) =>
    mode.ranges.map((range) => ({ boxId: mode.boxId, ...range })),
  )

  // Reuse the slots our modes already occupy first, then free ones; never an unmanaged mode's slot.
  const indexed = snapshot.slots.map((current, index) => ({ current, index }))
  const pool = [
    ...indexed.filter(({ current }) => isUsed(current) && isManaged(current.boxId)),
    ...indexed.filter(({ current }) => !isUsed(current)),
  ]

  const writes: { index: number; slot: ModeSlot }[] = []
  pool.forEach(({ current, index }, position) => {
    const next = wanted[position] ?? EMPTY_SLOT
    const unchanged = isUsed(current)
      ? JSON.stringify(current) === JSON.stringify(next)
      : !isUsed(next)
    if (!unchanged) writes.push({ index, slot: next })
  })
  return writes
}

export function isRangeActive(range: ModeRange, channels: number[]): boolean {
  const value = channels[FIRST_AUX_CHANNEL + range.auxChannel]
  return value !== undefined && value >= range.start && value <= range.end
}

/** Number of AUX channels to offer, from the live channel count (at least 4). */
export function auxChannelCount(channels: number[]): number {
  return Math.max(4, channels.length - FIRST_AUX_CHANNEL)
}
