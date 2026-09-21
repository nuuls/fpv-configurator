import { describe, expect, it } from 'vitest'
import {
  applyTable,
  decodeSetVtxConfig,
  decodeVtxBand,
  decodeVtxConfig,
  decodeVtxPowerLevel,
  encodeSetVtxConfig,
  encodeVtxBand,
  encodeVtxConfig,
  encodeVtxPowerLevel,
  normalizeTable,
  planVtxWrites,
  readVtx,
  removeBand,
  removePowerLevel,
  validateVtx,
  type VtxConfig,
  type VtxSnapshot,
  type VtxTable,
} from './model'
import { findPreset, VTX_MANUFACTURERS, VTX_PRESETS } from './presets'

const CONFIG: VtxConfig = {
  deviceType: 3,
  band: 5,
  channel: 1,
  power: 2,
  pitMode: true,
  frequency: 5658,
  deviceReady: true,
  lowPowerDisarm: 2,
  pitModeFrequency: 5584,
  tableAvailable: true,
  bands: 5,
  channels: 8,
  powerLevels: 4,
}
const EMPTY_TABLE: VtxTable = { bands: [], powerLevels: [] }

function tableOf(presetId: string): VtxTable {
  const preset = findPreset(presetId)
  if (!preset) throw new Error(`no preset ${presetId}`)
  return structuredClone(preset.table)
}
const unify = () => tableOf('tbs-unify-pro32-hv')
const snapshotOf = (table: VtxTable, config: Partial<VtxConfig> = {}): VtxSnapshot => ({
  config: {
    ...CONFIG,
    bands: table.bands.length,
    powerLevels: table.powerLevels.length,
    ...config,
  },
  table,
})

describe('VTX payload codecs', () => {
  it('decodes MSP_VTX_CONFIG byte by byte', () => {
    // type, band, channel, power, pit, freq u16, ready, lowPowerDisarm, pitFreq u16, table, bands, channels, levels
    const payload = Uint8Array.of(4, 5, 3, 2, 0, 0x64, 0x16, 1, 1, 0, 0, 1, 6, 8, 5)
    expect(decodeVtxConfig(payload)).toEqual({
      deviceType: 4,
      band: 5,
      channel: 3,
      power: 2,
      pitMode: false,
      frequency: 5732,
      deviceReady: true,
      lowPowerDisarm: 1,
      pitModeFrequency: 0,
      tableAvailable: true,
      bands: 6,
      channels: 8,
      powerLevels: 5,
    })
    expect(decodeVtxConfig(encodeVtxConfig(CONFIG))).toEqual(CONFIG)
  })

  it('tolerates the short MSP_VTX_CONFIG of older firmware', () => {
    const config = decodeVtxConfig(encodeVtxConfig(CONFIG).subarray(0, 9))
    expect(config).toMatchObject({
      band: 5,
      lowPowerDisarm: 2,
      pitModeFrequency: 0,
      tableAvailable: false,
      bands: 0,
    })
  })

  it('encodes MSP_SET_VTX_CONFIG with the legacy combined field first', () => {
    const set = {
      band: 5,
      channel: 3,
      frequency: 5732,
      power: 2,
      pitMode: false,
      lowPowerDisarm: 1,
      pitModeFrequency: 0,
      bands: 5,
      channels: 8,
      powerLevels: 4,
      clearTable: true,
    }
    const payload = encodeSetVtxConfig(set)
    // (5-1)*8 + (3-1) = 34
    expect([...payload]).toEqual([34, 0, 2, 0, 1, 0, 0, 5, 3, 0x64, 0x16, 5, 8, 4, 1])
    expect(decodeSetVtxConfig(payload)).toEqual(set)
    // band 0: the frequency goes into the combined field
    expect([...encodeSetVtxConfig({ ...set, band: 0, frequency: 5800 }).subarray(0, 2)]).toEqual([
      0xa8, 0x16,
    ])
  })

  it('round-trips bands, trimming the padding the firmware adds', () => {
    const band = { name: 'RACEBAND', letter: 'R', isFactory: true, frequencies: [5658, 5695, 0] }
    const payload = encodeVtxBand(5, band)
    expect([...payload.subarray(0, 2)]).toEqual([5, 8])
    expect([...payload.subarray(10)]).toEqual([0x52, 1, 3, 0x1a, 0x16, 0x3f, 0x16, 0, 0])
    expect(decodeVtxBand(payload)).toEqual({ index: 5, band })
    expect(decodeVtxBand(encodeVtxBand(1, { ...band, name: 'A       ' })).band.name).toBe('A')
  })

  it('round-trips power levels', () => {
    const payload = encodeVtxPowerLevel(2, { value: 400, label: '25 ' })
    expect([...payload]).toEqual([2, 0x90, 0x01, 3, 0x32, 0x35, 0x20])
    expect(decodeVtxPowerLevel(payload)).toEqual({ index: 2, level: { value: 400, label: '25' } })
  })
})

describe('VTX draft logic', () => {
  it('keeps the selected band letter and channel when a preset with another band order is loaded', () => {
    const draft = readVtx(snapshotOf(unify())) // R1
    const eu = tableOf('speedybee-tx800-eu') // A B F R — and R1 doesn't exist there
    expect(applyTable({ ...draft, channel: 4 }, eu)).toMatchObject({ band: 4, channel: 4 })
    expect(applyTable(draft, eu)).toMatchObject({ band: 4, channel: 4, power: 2 }) // first channel that exists in R
  })

  it('selects by position on an FC without a table, and resets a power level that no longer exists', () => {
    const fresh = readVtx(snapshotOf(EMPTY_TABLE, { band: 4, channel: 1, power: 3 }))
    expect(applyTable(fresh, tableOf('emax-nanohawk-1s'))).toMatchObject({
      band: 4,
      channel: 1,
      power: 1,
    })
    expect(applyTable({ ...fresh, band: 0 }, unify()).band).toBe(0)
  })

  it('keeps the selection on the same entry when rows are removed', () => {
    const draft = readVtx(snapshotOf(unify()))
    expect(removeBand(draft, 0)).toMatchObject({ band: 4 })
    expect(removeBand(draft, 4)).toMatchObject({ band: 1 })
    expect(removeBand(draft, 0).table.bands).toHaveLength(4)
    expect(removePowerLevel(draft, 0).power).toBe(1)
    expect(removePowerLevel(draft, 3).power).toBe(2)
  })

  it('validates names, letters, frequencies, power levels and the selection', () => {
    const draft = readVtx(snapshotOf(unify()))
    expect(validateVtx(draft)).toEqual([])
    const withBand = (patch: object) => ({
      ...draft,
      table: {
        ...draft.table,
        bands: draft.table.bands.map((b, i) => (i === 0 ? { ...b, ...patch } : b)),
      },
    })
    expect(validateVtx(withBand({ name: '' }))[0]).toMatch(/Band 1: the name/)
    expect(validateVtx(withBand({ name: 'MY BAND' }))[0]).toMatch(/no spaces/)
    expect(validateVtx(withBand({ letter: 'R' }))[0]).toMatch(/letter R is used twice/)
    expect(validateVtx(withBand({ frequencies: [4999, 0, 0, 0, 0, 0, 0, 0] }))[0]).toMatch(
      /5000–5999/,
    )
    expect(
      validateVtx({
        ...draft,
        table: { ...draft.table, powerLevels: [{ value: 70000, label: '25' }] },
      })[0],
    ).toMatch(/0–65535/)
    expect(validateVtx({ ...draft, channel: 9 })).toEqual([
      'Pick a band and channel that exist in the table.',
    ])
    expect(validateVtx({ ...draft, power: 5 })).toEqual(['Pick a power level.'])
    // an FC without a table can't have a valid selection yet
    expect(validateVtx(readVtx(snapshotOf(EMPTY_TABLE)))).toEqual([])
  })

  it('leaves the table alone when only the channel or power changed, and keeps hidden settings', () => {
    const snapshot = snapshotOf(unify())
    expect(readVtx(snapshot).lowPowerDisarm).toBe(2)
    const writes = planVtxWrites(snapshot, {
      ...readVtx(snapshot),
      band: 4,
      channel: 2,
      power: 1,
      lowPowerDisarm: 1,
    })
    expect(writes.config).toEqual({
      band: 4,
      channel: 2,
      frequency: 5760,
      power: 1,
      pitMode: true,
      lowPowerDisarm: 1,
      pitModeFrequency: 5584,
      bands: 5,
      channels: 8,
      powerLevels: 4,
      clearTable: false,
    })
    expect(writes.bands).toEqual([])
    expect(writes.powerLevels).toEqual([])
  })

  it('rewrites the whole table when it changed', () => {
    const snapshot = snapshotOf(EMPTY_TABLE, { band: 4, channel: 1, power: 1, channels: 0 })
    const writes = planVtxWrites(snapshot, applyTable(readVtx(snapshot), unify()))
    expect(writes.config).toMatchObject({
      band: 4,
      channel: 1,
      frequency: 5740,
      bands: 5,
      channels: 8,
      clearTable: true,
    })
    expect(writes.bands.map((b) => b.letter).join('')).toBe('ABEFR')
    expect(writes.powerLevels.map((l) => l.value)).toEqual([14, 20, 26, 36])
  })
})

describe('VTX presets', () => {
  it('are all valid tables with unique ids, grouped by manufacturer', () => {
    expect(new Set(VTX_PRESETS.map((p) => p.id)).size).toBe(VTX_PRESETS.length)
    expect(VTX_MANUFACTURERS).toContain('TBS')
    for (const preset of VTX_PRESETS) {
      const { bands, powerLevels } = preset.table
      expect(
        validateVtx({ band: 0, channel: 0, power: 1, lowPowerDisarm: 0, table: preset.table }),
        preset.id,
      ).toEqual([])
      expect(bands.length, preset.id).toBeGreaterThan(0)
      expect(powerLevels.length, preset.id).toBeGreaterThan(0)
      expect(
        bands.every((band) => band.frequencies.length === 8),
        preset.id,
      ).toBe(true)
      // the firmware upper-cases names: a preset must already be what is read back after saving
      expect(normalizeTable(preset.table), preset.id).toEqual(preset.table)
    }
  })
})
