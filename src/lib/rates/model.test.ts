import { describe, expect, it } from 'vitest'
import { defaultMockConfig, MockFlightController } from '@/lib/mock-fc/mockFc'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { readRatesSnapshot, saveRates } from './io'
import {
  actualRate,
  applySync,
  buildRcTuning,
  curveSeries,
  detectSync,
  editAxis,
  niceMax,
  rateLimits,
  readRates,
  validateRates,
  type AxisRates,
} from './model'

const snapshot = { raw: defaultMockConfig().rcTuning }
const DEFAULT: AxisRates = { center: 70, max: 670, expo: 0 }

describe('rates payload', () => {
  it('reads Betaflight defaults in user units', () => {
    expect(readRates(snapshot)).toEqual({ type: 3, axes: [DEFAULT, DEFAULT, DEFAULT] })
    expect(rateLimits(snapshot)).toEqual([1998, 1998, 1998])
  })

  it('writes each axis to its own bytes and leaves throttle settings alone', () => {
    const payload = buildRcTuning(snapshot, {
      type: 3,
      axes: [
        { center: 100, max: 800, expo: 10 },
        { center: 110, max: 810, expo: 20 },
        { center: 120, max: 820, expo: 30 },
      ],
    })
    // roll: center@0 expo@1 max@2 · pitch: max@3 center@12 expo@13 · yaw: max@4 expo@10 center@11
    expect([payload[0], payload[1], payload[2]]).toEqual([10, 10, 80])
    expect([payload[12], payload[13], payload[3]]).toEqual([11, 20, 81])
    expect([payload[11], payload[10], payload[4]]).toEqual([12, 30, 82])
    expect(payload[6]).toBe(50) // throttle mid untouched
    expect(payload).toHaveLength(snapshot.raw.length)
    expect(readRates({ raw: [...payload] }).axes[1]).toEqual({ center: 110, max: 810, expo: 20 })
  })

  it('validates ranges', () => {
    expect(validateRates(readRates(snapshot))).toEqual([])
    expect(validateRates({ type: 3, axes: [{ ...DEFAULT, max: 2500 }, DEFAULT, DEFAULT] })[0]).toMatch(/Roll max rate/)
    expect(validateRates({ type: 3, axes: [DEFAULT, DEFAULT, { ...DEFAULT, expo: 120 }] })[0]).toMatch(/Yaw expo/)
  })
})

describe('axis sync', () => {
  const different: AxisRates = { center: 50, max: 500, expo: 20 }

  it('detects the most linked mode the values allow', () => {
    expect(detectSync([DEFAULT, DEFAULT, DEFAULT])).toBe('all')
    expect(detectSync([DEFAULT, DEFAULT, different])).toBe('roll-pitch')
    expect(detectSync([DEFAULT, different, DEFAULT])).toBe('off')
  })

  it('an edit reaches the axes that follow', () => {
    const axes = [DEFAULT, DEFAULT, different]
    expect(editAxis(axes, 'all', 0, 'max', 900).map((a) => a.max)).toEqual([900, 900, 900])
    expect(editAxis(axes, 'roll-pitch', 0, 'max', 900).map((a) => a.max)).toEqual([900, 900, 500])
    expect(editAxis(axes, 'off', 0, 'max', 900).map((a) => a.max)).toEqual([900, 670, 500])
    expect(editAxis(axes, 'roll-pitch', 2, 'expo', 40)[2]).toEqual({ ...different, expo: 40 })
  })

  it('switching sync on copies roll to the followers', () => {
    expect(applySync([DEFAULT, different, different], 'all')).toEqual([DEFAULT, DEFAULT, DEFAULT])
    expect(applySync([DEFAULT, different, different], 'off')).toEqual([DEFAULT, different, different])
  })
})

describe('Actual rates curve', () => {
  it('matches the firmware formula at the landmarks', () => {
    expect(actualRate(DEFAULT, 0)).toBe(0)
    expect(actualRate(DEFAULT, 1)).toBe(670)
    expect(actualRate(DEFAULT, 0.5)).toBeCloseTo(0.5 * 70 + 600 * 0.25, 6) // no expo: quadratic blend
    // expo 1.0 → stick^6 on the part above center sensitivity
    expect(actualRate({ center: 100, max: 1000, expo: 100 }, 0.5)).toBeCloseTo(50 + 900 * 0.5 ** 6, 6)
  })

  it('is linear when max is not above center sensitivity, and respects the rate limit', () => {
    expect(actualRate({ center: 500, max: 300, expo: 50 }, 0.5)).toBe(250)
    expect(actualRate({ center: 200, max: 2000, expo: 0 }, 1, 1200)).toBe(1200)
  })

  it('draws one curve per distinct setting, coloured by its first axis', () => {
    expect(curveSeries([DEFAULT, DEFAULT, DEFAULT], [1998, 1998, 1998]).map((s) => s.label)).toEqual(['Roll · Pitch · Yaw'])
    const split = curveSeries([DEFAULT, DEFAULT, { ...DEFAULT, max: 500 }], [1998, 1998, 1998])
    expect(split.map((s) => [s.label, s.axis])).toEqual([['Roll · Pitch', 0], ['Yaw', 2]])
  })

  it('picks a tidy axis maximum', () => {
    expect([670, 1000, 1001, 5000].map(niceMax)).toEqual([800, 1000, 1200, 2000])
  })
})

describe('rates I/O', () => {
  it('saves without needing a reboot and survives one', async () => {
    const fc = new MockFlightController()
    const transport = new MockTransport(fc, 0)
    await transport.open()
    const client = new MspClient(transport)

    const before = await readRatesSnapshot(client)
    const draft = { type: 3, axes: [{ center: 90, max: 720, expo: 15 }, { center: 90, max: 720, expo: 15 }, { center: 80, max: 600, expo: 0 }] }
    await saveRates(client, before, draft)
    expect(readRates(await readRatesSnapshot(client))).toEqual(draft)
    expect(readRates({ raw: fc.savedConfig.rcTuning })).toEqual(draft)
  })
})
