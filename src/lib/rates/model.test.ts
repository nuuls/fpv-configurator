import { describe, expect, it } from 'vitest'
import { defaultMockConfig, MockFlightController } from '@/lib/mock-fc/mockFc'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { readRatesSnapshot, saveRates } from './io'
import {
  applySync,
  buildRcTuning,
  curveSeries,
  defaultRates,
  detectSync,
  editAxis,
  fieldName,
  niceMax,
  rateAt,
  rateLimits,
  RATES_TYPE,
  RATES_TYPES,
  readRates,
  validateRates,
  type AxisRates,
} from './model'

const snapshot = { raw: defaultMockConfig().rcTuning }
const DEFAULT: AxisRates = { rcRate: 70, rate: 670, expo: 0 }

describe('rates payload', () => {
  it('reads Betaflight defaults in user units', () => {
    expect(readRates(snapshot)).toEqual({ type: 3, axes: [DEFAULT, DEFAULT, DEFAULT] })
    expect(rateLimits(snapshot)).toEqual([1998, 1998, 1998])
  })

  it('writes each axis to its own bytes and leaves throttle settings alone', () => {
    const payload = buildRcTuning(snapshot, {
      type: 3,
      axes: [
        { rcRate: 100, rate: 800, expo: 10 },
        { rcRate: 110, rate: 810, expo: 20 },
        { rcRate: 120, rate: 820, expo: 30 },
      ],
    })
    // roll: center@0 expo@1 max@2 · pitch: max@3 center@12 expo@13 · yaw: max@4 expo@10 center@11
    expect([payload[0], payload[1], payload[2]]).toEqual([10, 10, 80])
    expect([payload[12], payload[13], payload[3]]).toEqual([11, 20, 81])
    expect([payload[11], payload[10], payload[4]]).toEqual([12, 30, 82])
    expect(payload[6]).toBe(50) // throttle mid untouched
    expect(payload).toHaveLength(snapshot.raw.length)
    expect(readRates({ raw: [...payload] }).axes[1]).toEqual({ rcRate: 110, rate: 810, expo: 20 })
  })

  it('validates ranges', () => {
    expect(validateRates(readRates(snapshot))).toEqual([])
    expect(validateRates({ type: 3, axes: [{ ...DEFAULT, rate: 2500 }, DEFAULT, DEFAULT] })[0]).toMatch(/Roll max rate/)
    expect(validateRates({ type: 3, axes: [DEFAULT, DEFAULT, { ...DEFAULT, expo: 120 }] })[0]).toMatch(/Yaw expo/)
  })
})

describe('axis sync', () => {
  const different: AxisRates = { rcRate: 50, rate: 500, expo: 20 }

  it('detects the most linked mode the values allow', () => {
    expect(detectSync([DEFAULT, DEFAULT, DEFAULT])).toBe('all')
    expect(detectSync([DEFAULT, DEFAULT, different])).toBe('roll-pitch')
    expect(detectSync([DEFAULT, different, DEFAULT])).toBe('off')
  })

  it('an edit reaches the axes that follow', () => {
    const axes = [DEFAULT, DEFAULT, different]
    expect(editAxis(axes, 'all', 0, 'rate', 900).map((a) => a.rate)).toEqual([900, 900, 900])
    expect(editAxis(axes, 'roll-pitch', 0, 'rate', 900).map((a) => a.rate)).toEqual([900, 900, 500])
    expect(editAxis(axes, 'off', 0, 'rate', 900).map((a) => a.rate)).toEqual([900, 670, 500])
    expect(editAxis(axes, 'roll-pitch', 2, 'expo', 40)[2]).toEqual({ ...different, expo: 40 })
  })

  it('switching sync on copies roll to the followers', () => {
    expect(applySync([DEFAULT, different, different], 'all')).toEqual([DEFAULT, DEFAULT, DEFAULT])
    expect(applySync([DEFAULT, different, different], 'off')).toEqual([DEFAULT, different, different])
  })
})

const actual = (rates: AxisRates, stick: number, limit?: number) => rateAt(RATES_TYPE.ACTUAL, rates, stick, limit)

describe('Actual rates curve', () => {
  it('matches the firmware formula at the landmarks', () => {
    expect(actual(DEFAULT, 0)).toBe(0)
    expect(actual(DEFAULT, 1)).toBe(670)
    expect(actual(DEFAULT, 0.5)).toBeCloseTo(0.5 * 70 + 600 * 0.25, 6) // no expo: quadratic blend
    // expo 1.0 → stick^6 on the part above center sensitivity
    expect(actual({ rcRate: 100, rate: 1000, expo: 100 }, 0.5)).toBeCloseTo(50 + 900 * 0.5 ** 6, 6)
  })

  it('is linear when max is not above center sensitivity, and respects the rate limit', () => {
    expect(actual({ rcRate: 500, rate: 300, expo: 50 }, 0.5)).toBe(250)
    expect(actual({ rcRate: 200, rate: 2000, expo: 0 }, 1, 1200)).toBe(1200)
  })

  it('draws one curve per distinct setting, coloured by its first axis', () => {
    expect(curveSeries({ type: 3, axes: [DEFAULT, DEFAULT, DEFAULT] }, [1998, 1998, 1998]).map((s) => s.label)).toEqual(['Roll · Pitch · Yaw'])
    const split = curveSeries({ type: 3, axes: [DEFAULT, DEFAULT, { ...DEFAULT, rate: 500 }] }, [1998, 1998, 1998])
    expect(split.map((s) => [s.label, s.axis])).toEqual([['Roll · Pitch', 0], ['Yaw', 2]])
  })

  it('picks a tidy axis maximum', () => {
    expect([670, 1000, 1001, 5000].map(niceMax)).toEqual([800, 1000, 1200, 2000])
  })
})

describe('other rate types', () => {
  const start = (type: number): AxisRates => {
    const rates = defaultRates(type)?.axes[0]
    if (!rates) throw new Error(`no defaults for type ${type}`)
    return rates
  }

  it("starts every type from Betaflight Configurator's defaults, on all three axes", () => {
    expect(start(RATES_TYPE.BETAFLIGHT)).toEqual({ rcRate: 100, rate: 70, expo: 0 }) // 1.00 / 0.70 / 0.00
    expect(start(RATES_TYPE.RACEFLIGHT)).toEqual({ rcRate: 370, rate: 80, expo: 50 }) // 370°/s / 80 / 50
    expect(start(RATES_TYPE.KISS)).toEqual({ rcRate: 100, rate: 70, expo: 0 })
    expect(start(RATES_TYPE.ACTUAL)).toEqual(DEFAULT)
    expect(start(RATES_TYPE.QUICK)).toEqual({ rcRate: 100, rate: 670, expo: 0 }) // 1.00 / 670°/s / 0.00
    expect(defaultRates(RATES_TYPE.KISS)?.axes).toHaveLength(3)
    expect(defaultRates(9)).toBeNull()
    for (const type of Object.keys(RATES_TYPES)) expect(validateRates(defaultRates(Number(type)) ?? { type: 9, axes: [] })).toEqual([])
  })

  it('names the three numbers per type', () => {
    const labels = (type: number) => Object.values(RATES_TYPES[type]?.fields ?? {}).map((f) => `${f.label}${f.unit && ` (${f.unit})`}`)
    expect(labels(RATES_TYPE.BETAFLIGHT)).toEqual(['RC rate', 'Super rate', 'RC expo'])
    expect(labels(RATES_TYPE.RACEFLIGHT)).toEqual(['Rate (°/s)', 'Acro+', 'Expo'])
    expect(labels(RATES_TYPE.KISS)).toEqual(['RC rate', 'Rate', 'RC curve'])
    expect(labels(RATES_TYPE.ACTUAL)).toEqual(['Center sensitivity (°/s)', 'Max rate (°/s)', 'Expo'])
    expect(labels(RATES_TYPE.QUICK)).toEqual(['RC rate', 'Max rate (°/s)', 'Expo'])
    const kiss = RATES_TYPES[RATES_TYPE.KISS]?.fields
    expect(kiss && [fieldName(kiss.rcRate, 0), fieldName(kiss.rate, 2)]).toEqual(['Roll RC rate', 'Yaw rate'])
  })

  it('stores °/s fields / 10 and everything else as the plain byte, depending on the type', () => {
    const bytes = (type: number, rates: AxisRates) => {
      const payload = buildRcTuning(snapshot, { type, axes: [rates, rates, rates] })
      expect(readRates({ raw: [...payload] })).toEqual({ type, axes: [rates, rates, rates] })
      return [payload[22], payload[0], payload[2], payload[1]]
    }
    expect(bytes(RATES_TYPE.BETAFLIGHT, { rcRate: 120, rate: 75, expo: 20 })).toEqual([0, 120, 75, 20])
    expect(bytes(RATES_TYPE.RACEFLIGHT, { rcRate: 370, rate: 80, expo: 50 })).toEqual([1, 37, 80, 50])
    expect(bytes(RATES_TYPE.KISS, { rcRate: 100, rate: 70, expo: 10 })).toEqual([2, 100, 70, 10])
    expect(bytes(RATES_TYPE.QUICK, { rcRate: 100, rate: 670, expo: 0 })).toEqual([4, 100, 67, 0])
  })

  it('keeps the bytes of a rate type it does not know', () => {
    const raw = [...snapshot.raw]
    raw[22] = 9
    const draft = readRates({ raw })
    expect(draft.axes[0]).toEqual({ rcRate: 7, rate: 67, expo: 0 })
    expect([...buildRcTuning({ raw }, draft)]).toEqual(raw)
    expect(validateRates(draft)).toEqual([])
    expect(rateAt(9, DEFAULT, 1)).toBe(0)
  })

  it('validates against the limits of the type (ratesSettingLimits)', () => {
    const invalid = (type: number, rates: Partial<AxisRates>) => validateRates({ type, axes: [{ ...start(type), ...rates }] })[0]
    expect(invalid(RATES_TYPE.BETAFLIGHT, { rcRate: 256 })).toBe('Roll RC rate must be between 0.01 and 2.55.')
    expect(invalid(RATES_TYPE.BETAFLIGHT, { rate: 101 })).toBe('Roll super rate must be between 0.00 and 1.00.')
    expect(invalid(RATES_TYPE.RACEFLIGHT, { rcRate: 2010 })).toBe('Roll rate must be between 10°/s and 2000°/s.')
    expect(invalid(RATES_TYPE.RACEFLIGHT, { rate: 256 })).toBe('Roll acro+ must be between 0 and 255.')
    expect(invalid(RATES_TYPE.RACEFLIGHT, { rate: 255, expo: 100 })).toBeUndefined()
    expect(invalid(RATES_TYPE.KISS, { rate: 100 })).toBe('Roll rate must be between 0.00 and 0.99.')
    expect(invalid(RATES_TYPE.QUICK, { rcRate: 0 })).toBe('Roll RC rate must be between 0.01 and 2.55.')
  })

  it('Betaflight rates: 200°/s × RC rate, divided by (1 − stick × super rate); RC rate above 2.0 grows faster', () => {
    const rates = start(RATES_TYPE.BETAFLIGHT)
    expect(rateAt(RATES_TYPE.BETAFLIGHT, rates, 1)).toBeCloseTo(200 / 0.3, 6) // the classic 667°/s
    expect(rateAt(RATES_TYPE.BETAFLIGHT, rates, 0.5)).toBeCloseTo(100 / 0.65, 6)
    expect(rateAt(RATES_TYPE.BETAFLIGHT, { rcRate: 100, rate: 0, expo: 50 }, 0.5)).toBeCloseTo(200 * (0.5 ** 4 * 0.5 + 0.25), 6)
    expect(rateAt(RATES_TYPE.BETAFLIGHT, { rcRate: 210, rate: 0, expo: 0 }, 0.1)).toBeCloseTo(20 * (2.1 + 14.54 * 0.1), 6)
    expect(rateAt(RATES_TYPE.BETAFLIGHT, { rcRate: 100, rate: 100, expo: 0 }, 1)).toBe(1998) // 1 / 0.01, then the setpoint limit
  })

  it('Raceflight rates: rate × (1 + stick × Acro+ %), cubic expo', () => {
    const rates = start(RATES_TYPE.RACEFLIGHT)
    expect(rateAt(RATES_TYPE.RACEFLIGHT, rates, 1)).toBeCloseTo(370 * 1.8, 6)
    expect(rateAt(RATES_TYPE.RACEFLIGHT, rates, 0.5)).toBeCloseTo(370 * (1 + 0.5 * (0.25 - 1)) * 0.5 * 1.4, 6)
  })

  it('KISS rates: 2000°/s × RC rate / 10, divided by (1 − stick × rate)', () => {
    const rates = start(RATES_TYPE.KISS)
    expect(rateAt(RATES_TYPE.KISS, rates, 1)).toBeCloseTo(200 / 0.3, 6)
    expect(rateAt(RATES_TYPE.KISS, { rcRate: 100, rate: 70, expo: 30 }, 0.5)).toBeCloseTo((2000 * 0.1 * (0.125 * 0.3 + 0.5 * 0.7)) / 0.65, 6)
  })

  it('Quick rates: RC rate × 200°/s around the center, reaching max rate at full stick', () => {
    const rates = start(RATES_TYPE.QUICK)
    expect(rateAt(RATES_TYPE.QUICK, rates, 1)).toBeCloseTo(670, 6)
    expect(rateAt(RATES_TYPE.QUICK, rates, 0.5)).toBeCloseTo(100 / (1 - 0.5 * (470 / 670)), 6)
    expect(rateAt(RATES_TYPE.QUICK, { rcRate: 100, rate: 670, expo: 100 }, 0.5)).toBeCloseTo(100 / (1 - 0.125 * (470 / 670)), 6)
    expect(rateAt(RATES_TYPE.QUICK, { rcRate: 200, rate: 100, expo: 0 }, 1)).toBeCloseTo(400, 6) // max rate below the center rate: linear
    expect(rateAt(RATES_TYPE.QUICK, { rcRate: 0, rate: 670, expo: 0 }, 1)).toBe(0) // half-typed value, no NaN
  })
})

describe('rates I/O', () => {
  it('saves without needing a reboot and survives one', async () => {
    const fc = new MockFlightController()
    const transport = new MockTransport(fc, 0)
    await transport.open()
    const client = new MspClient(transport)

    const before = await readRatesSnapshot(client)
    const draft = { type: 3, axes: [{ rcRate: 90, rate: 720, expo: 15 }, { rcRate: 90, rate: 720, expo: 15 }, { rcRate: 80, rate: 600, expo: 0 }] }
    await saveRates(client, before, draft)
    expect(readRates(await readRatesSnapshot(client))).toEqual(draft)
    expect(readRates({ raw: fc.savedConfig.rcTuning })).toEqual(draft)

    const quick = { type: 4, axes: [{ rcRate: 120, rate: 800, expo: 25 }, { rcRate: 120, rate: 800, expo: 25 }, { rcRate: 90, rate: 500, expo: 0 }] }
    await saveRates(client, await readRatesSnapshot(client), quick)
    expect(readRates({ raw: fc.savedConfig.rcTuning })).toEqual(quick)
  })
})
