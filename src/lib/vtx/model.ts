/**
 * Analog VTX: selected band / channel / power plus the VTX table (docs/tabs/vtx.md).
 * Byte layouts from Betaflight 2026.6.2 `msp.c`: MSP_VTX_CONFIG (88/89), MSP_VTXTABLE_BAND (137/227),
 * MSP_VTXTABLE_POWERLEVEL (138/228). Bands, channels and power levels are 1-based on the wire; 0 = none.
 */
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'

// drivers/vtx_table.h
export const VTX_MAX_BANDS = 8
export const VTX_MAX_CHANNELS = 8
export const VTX_MAX_POWER_LEVELS = 8
export const VTX_BAND_NAME_LENGTH = 8
export const VTX_POWER_LABEL_LENGTH = 3
/** `vtx_freq` range; a table entry of 0 means "this channel doesn't exist". */
export const VTX_MIN_FREQUENCY = 5000
export const VTX_MAX_FREQUENCY = 5999
/** Channels a band gets when the table is started from scratch. */
export const VTX_DEFAULT_CHANNELS = 8

/** vtxDevType_e (drivers/vtx_common.h). 0xFF = no VTX found on any port. */
export const VTX_DEVICE_NAMES: Record<number, string> = {
  1: 'RTC6705 (on board)',
  3: 'SmartAudio',
  4: 'Tramp',
  5: 'MSP',
}

export interface VtxConfig {
  deviceType: number
  /** 0 = frequency set directly (`vtx_freq`), otherwise an index into the table. */
  band: number
  channel: number
  /** Index into the power levels; 0 = unknown. */
  power: number
  pitMode: boolean
  frequency: number
  deviceReady: boolean
  lowPowerDisarm: number
  pitModeFrequency: number
  /** False on firmware built without USE_VTX_TABLE. */
  tableAvailable: boolean
  bands: number
  channels: number
  powerLevels: number
}

export interface VtxBand {
  name: string
  letter: string
  /** FACTORY: the VTX is told band + channel. CUSTOM (false): it is told the frequency. */
  isFactory: boolean
  /** One entry per channel, MHz; 0 = not available. */
  frequencies: number[]
}

export interface VtxPowerLevel {
  /** What is sent to the VTX: an index (SmartAudio 2.0), dBm (SmartAudio 2.1) or mW (Tramp). */
  value: number
  label: string
}

export interface VtxTable {
  bands: VtxBand[]
  powerLevels: VtxPowerLevel[]
}

export interface VtxSnapshot {
  config: VtxConfig
  table: VtxTable
}

export interface VtxDraft {
  band: number
  channel: number
  power: number
  table: VtxTable
}

// ---- payload codecs ----

export function decodeVtxConfig(payload: Uint8Array): VtxConfig {
  const r = new ByteReader(payload)
  const config: VtxConfig = {
    deviceType: r.u8(),
    band: r.u8(),
    channel: r.u8(),
    power: r.u8(),
    pitMode: r.u8() !== 0,
    frequency: r.u16(),
    deviceReady: r.u8() !== 0,
    lowPowerDisarm: r.u8(),
    pitModeFrequency: 0,
    tableAvailable: false,
    bands: 0,
    channels: 0,
    powerLevels: 0,
  }
  // API 1.42
  if (r.remaining >= 2) config.pitModeFrequency = r.u16()
  if (r.remaining >= 4) {
    config.tableAvailable = r.u8() !== 0
    config.bands = r.u8()
    config.channels = r.u8()
    config.powerLevels = r.u8()
  }
  return config
}

export function encodeVtxConfig(c: VtxConfig): Uint8Array {
  return new ByteWriter()
    .u8(c.deviceType)
    .u8(c.band)
    .u8(c.channel)
    .u8(c.power)
    .u8(c.pitMode ? 1 : 0)
    .u16(c.frequency)
    .u8(c.deviceReady ? 1 : 0)
    .u8(c.lowPowerDisarm)
    .u16(c.pitModeFrequency)
    .u8(c.tableAvailable ? 1 : 0)
    .u8(c.bands)
    .u8(c.channels)
    .u8(c.powerLevels)
    .toBytes()
}

export interface SetVtxConfig {
  band: number
  channel: number
  frequency: number
  power: number
  pitMode: boolean
  lowPowerDisarm: number
  pitModeFrequency: number
  bands: number
  channels: number
  powerLevels: number
  /** Wipes the whole table; the band and power level messages that follow fill it again. */
  clearTable: boolean
}

export function encodeSetVtxConfig(c: SetVtxConfig): Uint8Array {
  return (
    new ByteWriter()
      // Legacy combined field: (band, channel) packed into 0..63, or the frequency. Overridden by the fields below.
      .u16(c.band > 0 ? (c.band - 1) * 8 + (c.channel - 1) : c.frequency)
      .u8(c.power)
      .u8(c.pitMode ? 1 : 0)
      .u8(c.lowPowerDisarm)
      .u16(c.pitModeFrequency)
      .u8(c.band)
      .u8(c.channel)
      .u16(c.frequency)
      .u8(c.bands)
      .u8(c.channels)
      .u8(c.powerLevels)
      .u8(c.clearTable ? 1 : 0)
      .toBytes()
  )
}

export function decodeSetVtxConfig(payload: Uint8Array): SetVtxConfig {
  const r = new ByteReader(payload)
  r.skip(2)
  const power = r.u8()
  const pitMode = r.u8() !== 0
  const lowPowerDisarm = r.u8()
  const pitModeFrequency = r.u16()
  const band = r.u8()
  const channel = r.u8()
  const frequency = r.u16()
  return {
    band,
    channel,
    frequency,
    power,
    pitMode,
    lowPowerDisarm,
    pitModeFrequency,
    bands: r.u8(),
    channels: r.u8(),
    powerLevels: r.u8(),
    clearTable: r.u8() !== 0,
  }
}

/** The firmware pads names with spaces to their fixed length. */
const unpad = (text: string) => text.replace(/[\s\0]+$/, '')

/** Same payload for the MSP_VTXTABLE_BAND response and the MSP_SET_VTXTABLE_BAND request. */
export function encodeVtxBand(index: number, band: VtxBand): Uint8Array {
  const w = new ByteWriter()
    .u8(index)
    .pascalString(band.name.slice(0, VTX_BAND_NAME_LENGTH))
    .ascii(band.letter.slice(0, 1) || ' ')
    .u8(band.isFactory ? 1 : 0)
    .u8(band.frequencies.length)
  for (const frequency of band.frequencies) w.u16(frequency)
  return w.toBytes()
}

export function decodeVtxBand(payload: Uint8Array): { index: number; band: VtxBand } {
  const r = new ByteReader(payload)
  const index = r.u8()
  const name = unpad(r.pascalString())
  const letter = unpad(r.ascii(1))
  const isFactory = r.u8() !== 0
  const frequencies = Array.from({ length: r.u8() }, () => r.u16())
  return { index, band: { name, letter, isFactory, frequencies } }
}

/** Same payload for the MSP_VTXTABLE_POWERLEVEL response and the MSP_SET_VTXTABLE_POWERLEVEL request. */
export function encodeVtxPowerLevel(index: number, level: VtxPowerLevel): Uint8Array {
  return new ByteWriter()
    .u8(index)
    .u16(level.value)
    .pascalString(level.label.slice(0, VTX_POWER_LABEL_LENGTH))
    .toBytes()
}

export function decodeVtxPowerLevel(payload: Uint8Array): { index: number; level: VtxPowerLevel } {
  const r = new ByteReader(payload)
  const index = r.u8()
  const value = r.u16()
  return { index, level: { value, label: unpad(r.pascalString()) } }
}

// ---- snapshot → draft → writes ----

const cloneTable = (table: VtxTable): VtxTable => ({
  bands: table.bands.map((band) => ({ ...band, frequencies: [...band.frequencies] })),
  powerLevels: table.powerLevels.map((level) => ({ ...level })),
})

export function readVtx(snapshot: VtxSnapshot): VtxDraft {
  const { band, channel, power } = snapshot.config
  return { band, channel, power, table: cloneTable(snapshot.table) }
}

export function channelCount(table: VtxTable): number {
  return table.bands[0]?.frequencies.length ?? 0
}

/** MHz of a table entry, or 0 when the band/channel doesn't exist. */
export function frequencyOf(table: VtxTable, band: number, channel: number): number {
  return table.bands[band - 1]?.frequencies[channel - 1] ?? 0
}

/** Band letter + channel the way pilots say it: "R1", "F4". */
export function channelName(table: VtxTable, band: number, channel: number): string {
  return `${table.bands[band - 1]?.letter ?? '?'}${channel}`
}

/**
 * Replaces the table (loading a preset) and keeps the selection where it still points at something:
 * the same band letter if the new table has it, the first power level if the old index is gone.
 */
export function applyTable(draft: VtxDraft, table: VtxTable): VtxDraft {
  const power =
    draft.power >= 1 && draft.power <= table.powerLevels.length
      ? draft.power
      : Math.min(1, table.powerLevels.length)
  const next = { ...draft, power, table: cloneTable(table) }
  if (draft.band === 0) return next // frequency set directly: the table doesn't matter

  const letter = draft.table.bands[draft.band - 1]?.letter
  const band = table.bands.findIndex((candidate) => candidate.letter === letter) + 1 || draft.band
  if (frequencyOf(table, band, draft.channel) > 0) return { ...next, band }
  return { ...next, ...(firstChannel(table, band) ?? {}) }
}

/** First usable channel, looking in `preferredBand` first. */
function firstChannel(
  table: VtxTable,
  preferredBand: number,
): { band: number; channel: number } | null {
  const order = [preferredBand, ...table.bands.map((_, i) => i + 1)]
  for (const band of order) {
    const channel = (table.bands[band - 1]?.frequencies.findIndex((f) => f > 0) ?? -1) + 1
    if (channel > 0) return { band, channel }
  }
  return null
}

export function newBand(table: VtxTable): VtxBand {
  const channels = channelCount(table) || VTX_DEFAULT_CHANNELS
  return {
    name: '',
    letter: '',
    isFactory: false,
    frequencies: new Array<number>(channels).fill(0),
  }
}

/** Removing a band or power level moves the ones after it up; keep the selection on the same entry. */
export function removeBand(draft: VtxDraft, index: number): VtxDraft {
  const table = { ...draft.table, bands: draft.table.bands.filter((_, i) => i !== index) }
  const removed = index + 1
  const band =
    draft.band === removed
      ? Math.min(1, table.bands.length)
      : draft.band > removed
        ? draft.band - 1
        : draft.band
  return { ...draft, band, table }
}

export function removePowerLevel(draft: VtxDraft, index: number): VtxDraft {
  const table = {
    ...draft.table,
    powerLevels: draft.table.powerLevels.filter((_, i) => i !== index),
  }
  const removed = index + 1
  const power =
    draft.power === removed
      ? Math.min(1, table.powerLevels.length)
      : draft.power > removed
        ? draft.power - 1
        : draft.power
  return { ...draft, power, table }
}

const isAscii = (text: string) => /^[\x21-\x7e]*$/.test(text)

export function validateVtx(draft: VtxDraft): string[] {
  const problems: string[] = []
  const { bands, powerLevels } = draft.table
  if (bands.length > VTX_MAX_BANDS) problems.push(`At most ${VTX_MAX_BANDS} bands.`)
  if (powerLevels.length > VTX_MAX_POWER_LEVELS)
    problems.push(`At most ${VTX_MAX_POWER_LEVELS} power levels.`)

  bands.forEach((band, i) => {
    const title = `Band ${i + 1}`
    if (band.name === '' || band.name.length > VTX_BAND_NAME_LENGTH || !isAscii(band.name))
      problems.push(
        `${title}: the name needs 1–${VTX_BAND_NAME_LENGTH} letters or digits, no spaces.`,
      )
    if (band.letter.length !== 1 || !isAscii(band.letter))
      problems.push(`${title}: the letter must be one character.`)
    else if (bands.findIndex((other) => other.letter === band.letter) !== i)
      problems.push(`${title}: letter ${band.letter} is used twice.`)
    if (
      band.frequencies.some(
        (f) => f !== 0 && (!Number.isInteger(f) || f < VTX_MIN_FREQUENCY || f > VTX_MAX_FREQUENCY),
      )
    )
      problems.push(
        `${title}: frequencies must be ${VTX_MIN_FREQUENCY}–${VTX_MAX_FREQUENCY} MHz, or 0 for "not available".`,
      )
  })
  powerLevels.forEach((level, i) => {
    const title = `Power level ${i + 1}`
    if (!Number.isInteger(level.value) || level.value < 0 || level.value > 0xffff)
      problems.push(`${title}: the value must be 0–65535.`)
    if (level.label === '' || level.label.length > VTX_POWER_LABEL_LENGTH || !isAscii(level.label))
      problems.push(`${title}: the label needs 1–${VTX_POWER_LABEL_LENGTH} characters, no spaces.`)
  })

  if (
    bands.length > 0 &&
    draft.band > 0 &&
    frequencyOf(draft.table, draft.band, draft.channel) === 0
  )
    problems.push('Pick a band and channel that exist in the table.')
  if (powerLevels.length > 0 && (draft.power < 1 || draft.power > powerLevels.length))
    problems.push('Pick a power level.')
  return problems
}

/** The firmware upper-cases names and labels; do the same so a saved draft equals what is read back. */
export function normalizeTable(table: VtxTable): VtxTable {
  return {
    bands: table.bands.map((band) => ({
      ...band,
      name: band.name.toUpperCase(),
      letter: band.letter.toUpperCase(),
      frequencies: [...band.frequencies],
    })),
    powerLevels: table.powerLevels.map((level) => ({ ...level, label: level.label.toUpperCase() })),
  }
}

export interface VtxWrites {
  config: SetVtxConfig
  /** Empty when the table didn't change: the table on the FC is then left alone. */
  bands: VtxBand[]
  powerLevels: VtxPowerLevel[]
}

/**
 * MSP_SET_VTX_CONFIG first (it sets the table's dimensions and clears it), then every band and power level.
 * Settings this tab doesn't show (pit mode, low power disarm, pit mode frequency) are written back unchanged.
 */
export function planVtxWrites(snapshot: VtxSnapshot, draft: VtxDraft): VtxWrites {
  const table = normalizeTable(draft.table)
  const tableChanged = JSON.stringify(table) !== JSON.stringify(normalizeTable(snapshot.table))
  const { pitMode, lowPowerDisarm, pitModeFrequency, frequency } = snapshot.config
  return {
    config: {
      band: draft.band,
      channel: draft.channel,
      frequency: draft.band > 0 ? frequencyOf(table, draft.band, draft.channel) : frequency,
      power: draft.power,
      pitMode,
      lowPowerDisarm,
      pitModeFrequency,
      bands: table.bands.length,
      channels: channelCount(table),
      powerLevels: table.powerLevels.length,
      clearTable: tableChanged,
    },
    bands: tableChanged ? table.bands : [],
    powerLevels: tableChanged ? table.powerLevels : [],
  }
}
