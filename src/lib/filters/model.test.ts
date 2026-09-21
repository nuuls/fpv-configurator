import { describe, expect, it } from 'vitest'
import { defaultMockConfig, MockFlightController } from '@/lib/mock-fc/mockFc'
import { MspClient } from '@/lib/msp/client'
import { readTuningSnapshot, saveTuning } from '@/lib/tuning/io'
import { readTuning } from '@/lib/tuning/model'
import { MockTransport } from '@/lib/transport/mock'
import { readFiltersSnapshot, saveFilters } from './io'
import {
  applyFilterSliders,
  buildFilterConfig,
  buildFilterSliders,
  copySharedCutoffs,
  defaultFilterConfig,
  dtermCutoffs,
  dtermSliderBounds,
  FILTER_CONFIG_LENGTH,
  gyroLpf2Hz,
  isFilterConfigRejected,
  pinnedChanges,
  readFilters,
  SIMPLIFIED_TUNING_LENGTH,
  validateFilters,
  type FiltersDraft,
  type FiltersSnapshot,
} from './model'

const stock = (): FiltersSnapshot => ({
  filterConfig: defaultMockConfig().filterConfig,
  simplified: defaultMockConfig().simplifiedTuning,
  bidirDshot: true,
})
const STOCK_DRAFT: FiltersDraft = { gyroLpf2: 100, dterm: 100, rpmMinHz: 100, dynNotchCount: 3, dynNotchMinHz: 100 }

const u16 = (bytes: ArrayLike<number>, offset: number) => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
const withU16 = (bytes: number[], offset: number, value: number) =>
  bytes.map((byte, i) => (i === offset ? value & 0xff : i === offset + 1 ? value >> 8 : byte))

/** The snapshot the FC reports after `draft` was saved. */
function saved(snapshot: FiltersSnapshot, draft: FiltersDraft): FiltersSnapshot {
  return {
    ...snapshot,
    filterConfig: [...buildFilterConfig(snapshot, draft)],
    simplified: applyFilterSliders(buildFilterSliders(snapshot, draft)),
  }
}

describe('filter payloads', () => {
  it('has the firmware message lengths', () => {
    expect(stock().filterConfig).toHaveLength(FILTER_CONFIG_LENGTH)
    expect(stock().simplified).toHaveLength(SIMPLIFIED_TUNING_LENGTH)
  })

  it('reads stock Betaflight filters', () => {
    expect(readFilters(stock())).toEqual(STOCK_DRAFT)
  })

  it('scales cutoffs like the firmware (integer division)', () => {
    expect(gyroLpf2Hz(100)).toBe(500)
    expect(gyroLpf2Hz(0)).toBe(0)
    expect(gyroLpf2Hz(200)).toBe(1000)
    expect(dtermCutoffs(85)).toEqual({ lpf1MinHz: 63, lpf1MaxHz: 127, lpf2Hz: 127 }) // 63.75 and 127.5 floored
  })

  it('writes the draft into MSP_SET_FILTER_CONFIG and switches the other filters off', () => {
    const snapshot = stock()
    snapshot.filterConfig = withU16(withU16(snapshot.filterConfig, 5, 400), 9, 260) // gyro notch 1 + D-term notch
    snapshot.filterConfig[25] = 2 // gyro lowpass 2: PT2
    const payload = buildFilterConfig(snapshot, { gyroLpf2: 120, dterm: 90, rpmMinHz: 80, dynNotchCount: 1, dynNotchMinHz: 150 })

    expect(payload).toHaveLength(FILTER_CONFIG_LENGTH)
    expect(u16(payload, 22)).toBe(600) // gyro_lpf2_static_hz
    expect(payload[25]).toBe(0) // PT1
    expect([payload[0], u16(payload, 20), u16(payload, 29), u16(payload, 31)]).toEqual([0, 0, 0, 0]) // gyro lowpass 1
    expect([u16(payload, 5), u16(payload, 9), u16(payload, 13)]).toEqual([0, 0, 0]) // notches
    expect([u16(payload, 1), u16(payload, 33), u16(payload, 35), u16(payload, 26)]).toEqual([67, 67, 135, 135]) // D-term
    expect([payload[44], payload[48], u16(payload, 41)]).toEqual([80, 1, 150])
    // untouched: yaw lowpass, dyn notch Q + max, RPM harmonics, fade, Q, weights
    expect([u16(payload, 3), u16(payload, 39), u16(payload, 45), payload[43]]).toEqual([100, 300, 600, 3])
    expect([u16(payload, 49), u16(payload, 51), payload[53]]).toEqual([50, 500, 100])
  })

  it('writes the sliders into MSP_SET_SIMPLIFIED_TUNING and leaves the PID sliders alone', () => {
    const snapshot = stock()
    snapshot.simplified[4] = 135 // damping
    const payload = buildFilterSliders(snapshot, { ...STOCK_DRAFT, gyroLpf2: 150, dterm: 110 })
    expect(payload).toHaveLength(SIMPLIFIED_TUNING_LENGTH)
    expect([...payload.subarray(0, 17)]).toEqual(snapshot.simplified.slice(0, 17))
    expect([payload[17], payload[18], u16(payload, 19), u16(payload, 21), u16(payload, 23), u16(payload, 25)]).toEqual([
      1, 110, 82, 165, 82, 165,
    ])
    expect([payload[35], payload[36], u16(payload, 37), u16(payload, 39), u16(payload, 41), u16(payload, 43)]).toEqual([
      1, 150, 0, 750, 0, 0,
    ])
  })

  it('switches gyro lowpass 2 off at 0 and keeps a valid multiplier', () => {
    const off = saved(stock(), { ...STOCK_DRAFT, gyroLpf2: 0 })
    expect(u16(off.filterConfig, 22)).toBe(0)
    expect(off.simplified[36]).toBe(100)
    expect(readFilters(off).gyroLpf2).toBe(0)
    // and back on: the firmware only rescales filters that aren't disabled, so the cutoff is sent too
    expect(u16(saved(off, { ...STOCK_DRAFT, gyroLpf2: 80 }).filterConfig, 22)).toBe(400)
  })

  it('tolerates a shorter payload from older firmware', () => {
    const short: FiltersSnapshot = { filterConfig: stock().filterConfig.slice(0, 47), simplified: [], bidirDshot: false }
    expect(readFilters(short)).toEqual({ ...STOCK_DRAFT, dynNotchCount: 0 })
    expect(buildFilterConfig(short, STOCK_DRAFT)).toHaveLength(47)
    expect(buildFilterSliders(short, STOCK_DRAFT)).toHaveLength(0)
  })
})

describe('pinned filter settings', () => {
  it('lists what saving changes on a stock quad, and nothing after the save', () => {
    expect(pinnedChanges(stock())).toEqual(['gyro lowpass 1 is turned off'])
    expect(pinnedChanges(saved(stock(), STOCK_DRAFT))).toEqual([])
    expect(pinnedChanges(saved(stock(), { ...STOCK_DRAFT, gyroLpf2: 0, dterm: 85 }))).toEqual([])
  })

  it('reads hand-set cutoffs as the nearest slider position and says they will move', () => {
    const snapshot = stock()
    snapshot.simplified[17] = 0 // D-term slider off
    snapshot.simplified[35] = 0 // gyro slider off
    snapshot.filterConfig = withU16(withU16(snapshot.filterConfig, 22, 330), 33, 90) // lowpass 2 · D-term lowpass 1 min
    snapshot.filterConfig[43] = 0 // RPM filter off

    expect(readFilters(snapshot)).toMatchObject({ gyroLpf2: 70, dterm: 120 })
    expect(pinnedChanges(snapshot)).toEqual([
      'gyro lowpass 1 is turned off',
      'gyro lowpass 2 is set to 350 Hz by the slider',
      'the D-term lowpass filters are set to 90–180 Hz and 180 Hz by the slider',
      'the RPM filter is turned on',
    ])
    expect(buildFilterConfig(snapshot, readFilters(snapshot))[43]).toBe(3)
    expect(pinnedChanges(saved(snapshot, readFilters(snapshot)))).toEqual([])
  })

  it('widens the D-term slider for a value outside 0.5–1.5', () => {
    expect(dtermSliderBounds(100)).toEqual({ min: 50, max: 150 })
    expect(dtermSliderBounds(180)).toEqual({ min: 50, max: 180 })
  })
})

describe('validateFilters', () => {
  it('checks the firmware ranges', () => {
    expect(validateFilters(STOCK_DRAFT)).toEqual([])
    expect(validateFilters({ ...STOCK_DRAFT, rpmMinHz: 20 })[0]).toMatch(/RPM filter min frequency must be 30–200/)
    expect(validateFilters({ ...STOCK_DRAFT, dynNotchMinHz: 300 })[0]).toMatch(/Dynamic notch min frequency must be 20–250/)
    expect(validateFilters({ ...STOCK_DRAFT, dynNotchCount: 0, dynNotchMinHz: 300 })).toEqual([]) // notch off
    expect(validateFilters({ ...STOCK_DRAFT, dynNotchCount: 8 })[0]).toMatch(/count/)
  })
})

describe('firmware behaviour used by the mock FC', () => {
  it('rescales enabled filters when a slider is on, and leaves disabled ones off', () => {
    const simplified = stock().simplified
    simplified[36] = 50 // gyro multiplier
    simplified[39] = 0 // lowpass 2 disabled (u16 at 39)
    simplified[40] = 0
    const applied = applyFilterSliders(simplified)
    expect([u16(applied, 37), u16(applied, 39), u16(applied, 41), u16(applied, 43)]).toEqual([125, 0, 125, 250])
  })

  it('keeps the cutoffs of both messages in step', () => {
    const simplified = applyFilterSliders(stock().simplified.map((byte, i) => (i === 18 ? 120 : byte)))
    const filterConfig = copySharedCutoffs('toFilterConfig', defaultFilterConfig(), simplified)
    expect([u16(filterConfig, 1), u16(filterConfig, 33), u16(filterConfig, 35), u16(filterConfig, 26)]).toEqual([90, 90, 180, 180])
    expect(copySharedCutoffs('toSimplified', defaultFilterConfig(), simplified)).toEqual(stock().simplified.map((b, i) => (i === 18 ? 120 : b)))
  })

  it('rejects what msp.c rejects', () => {
    expect(isFilterConfigRejected(defaultFilterConfig())).toBe(false)
    expect(isFilterConfigRejected(defaultFilterConfig().map((byte, i) => (i === 48 ? 8 : byte)))).toBe(true) // notch count
    expect(isFilterConfigRejected(withU16(defaultFilterConfig(), 51, 100))).toBe(true) // rpm_filter_q < 250
  })
})

describe('filters against the mock FC', () => {
  async function connect() {
    const transport = new MockTransport(new MockFlightController(), 0)
    await transport.open()
    return new MspClient(transport)
  }

  it('saves, and what is read back needs no further pinning', async () => {
    const client = await connect()
    const before = await readFiltersSnapshot(client)
    expect(before.bidirDshot).toBe(false)
    const draft: FiltersDraft = { gyroLpf2: 130, dterm: 85, rpmMinHz: 90, dynNotchCount: 1, dynNotchMinHz: 120 }
    await saveFilters(client, before, draft)

    const after = await readFiltersSnapshot(client)
    expect(readFilters(after)).toEqual(draft)
    expect(pinnedChanges(after)).toEqual([])
    expect(u16(after.simplified, 39)).toBe(650)
  })

  it('does not disturb the PID Tuning tab, nor the other way round', async () => {
    const client = await connect()
    const tuning = await readTuningSnapshot(client)
    await saveTuning(client, tuning, { ...readTuning(tuning), damping: 120 })
    await saveFilters(client, await readFiltersSnapshot(client), { ...STOCK_DRAFT, dterm: 90 })
    expect(readTuning(await readTuningSnapshot(client)).damping).toBe(120)

    const again = await readTuningSnapshot(client)
    await saveTuning(client, again, { ...readTuning(again), master: 110 })
    expect(readFilters(await readFiltersSnapshot(client)).dterm).toBe(90)
  })
})
