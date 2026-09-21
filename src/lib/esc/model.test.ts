import { describe, expect, it } from 'vitest'
import { mockAm32Esc, mockBlheliSEsc, mockBluejayEsc, type MockEsc } from '@/lib/mock-fc/mockEscs'
import { INTERFACE_MODE } from './fourway'
import {
  combineReports,
  decodeDeviceInfo,
  describeEsc,
  describeUnsupported,
  differingSettings,
  needsCodeProbe,
  readPlan,
  type EscRawRead,
  type EscReport,
} from './model'

/** What io.ts would have read from this mock ESC. */
function rawRead(esc: MockEsc, patch: Record<number, number> = {}): EscRawRead {
  const info = { signature: esc.signature, bootByte: esc.bootByte, interfaceMode: esc.interfaceMode }
  const plan = readPlan(info)
  if (!plan) throw new Error('no read plan for this mock ESC')
  const settings = Uint8Array.from(esc.flash[plan.settingsAddress] ?? [])
  for (const [offset, value] of Object.entries(patch)) settings[Number(offset)] = value
  const fileName = plan.fileNameAddress === null ? null : Uint8Array.from((esc.flash[plan.fileNameAddress] ?? []).slice(0, 16))
  return { info, plan, settings, fileName, codeProbe: null }
}

function settingsOf(report: EscReport): Record<string, string> {
  if (report.status !== 'ok') throw new Error(`expected a readable ESC, got ${report.status}`)
  return Object.fromEntries(report.settings.map((setting) => [setting.label, setting.value]))
}

describe('decodeDeviceInfo / readPlan', () => {
  it('reads signature (lo, hi), boot byte and interface mode', () => {
    expect(decodeDeviceInfo(Uint8Array.of(0xb2, 0xe8, 0x63, 1))).toEqual({ signature: 0xe8b2, bootByte: 0x63, interfaceMode: 1 })
  })

  it('knows where the SiLabs MCUs keep their settings', () => {
    const plan = (signature: number) => readPlan({ signature, bootByte: 0x63, interfaceMode: INTERFACE_MODE.SILABS_BLB })
    expect(plan(0xe8b1)).toMatchObject({ family: 'silabs', mcu: 'EFM8BB10', settingsAddress: 0x1a00, settingsLength: 0x70 })
    expect(plan(0xe8b2)).toMatchObject({ mcu: 'EFM8BB21', settingsAddress: 0x1a00 })
    expect(plan(0xe8b5)).toMatchObject({ mcu: 'EFM8BB51', settingsAddress: 0x3000 })
    expect(plan(0xf330)).toBeNull()
  })

  it('maps the AM32 flash size codes to the settings address, shifted for 128 k parts', () => {
    const plan = (signature: number, bootByte = 0x14) => readPlan({ signature, bootByte, interfaceMode: INTERFACE_MODE.ARM_BLB })
    expect(plan(0x1f06)).toMatchObject({ family: 'arm', settingsAddress: 0x7c00, fileNameAddress: 0x7be0, settingsLength: 48 })
    expect(plan(0x3506)).toMatchObject({ settingsAddress: 0xf800, fileNameAddress: 0xf7e0 })
    expect(plan(0x2b06)).toMatchObject({ settingsAddress: 0x7e00, fileNameAddress: 0x7df8 })
  })

  it('does not take a BLHeli_32 ESC (ARM, but not an AM32 signal pin) for AM32', () => {
    const info = { signature: 0x1f06, bootByte: 0x64, interfaceMode: INTERFACE_MODE.ARM_BLB }
    expect(readPlan(info)).toBeNull()
    expect(describeUnsupported(info)).toMatchObject({ status: 'unknown', description: expect.stringContaining('BLHeli_32') })
  })

  it('has no plan for Atmel ESCs', () => {
    const info = { signature: 0x9307, bootByte: 0x63, interfaceMode: INTERFACE_MODE.ATMEL_BLB }
    expect(readPlan(info)).toBeNull()
    expect(describeUnsupported(info)).toMatchObject({ status: 'unknown', description: expect.stringContaining('0x9307') })
  })
})

describe('describeEsc', () => {
  it('decodes Bluejay 0.21 (layout 208)', () => {
    const report = describeEsc(rawRead(mockBluejayEsc({ reversed: true })))
    expect(report).toMatchObject({ status: 'ok', firmware: 'Bluejay', version: '0.21.0', hardware: 'Z-H-30 · EFM8BB21', layoutRevision: 208, note: null })
    expect(settingsOf(report)).toEqual({
      'Motor direction': 'Reversed',
      'PWM frequency': '48 kHz',
      'Minimum startup power': '1025',
      'Maximum startup power': '1020',
      'Motor timing': '22.5° (medium high)',
      'Demag compensation': 'Low',
      'Rampup power': '9x',
      'Temperature protection': '140 °C',
      'Brake on stop': 'Off',
      'Braking strength': '255',
      'Power rating': '2S+',
      'Force EDT arm': 'Off',
      'Beep strength': '40',
      'Beacon strength': '80',
      'Beacon delay': '10 minutes',
    })
  })

  it('shows only what a Bluejay layout has, and takes the patch level from the name', () => {
    const esc = mockBluejayEsc()
    const name = [...'Bluejay (.1 RC2)'].map((char) => char.charCodeAt(0))
    const patch = Object.fromEntries(name.map((byte, i) => [0x60 + i, byte]))
    const report = describeEsc(rawRead(esc, { ...patch, 0x01: 20, 0x02: 203 }))
    expect(report).toMatchObject({ firmware: 'Bluejay', version: '0.20.1 RC2' })
    const settings = settingsOf(report)
    expect(settings).not.toHaveProperty('Braking strength') // 202 and 204+
    expect(settings).not.toHaveProperty('Power rating') // 206+
    expect(settings).not.toHaveProperty('Force EDT arm') // 207+
  })

  it('reads dynamic PWM of Bluejay 0.22 (layout 209) and the percent rampup of 0.9 (layout 200)', () => {
    expect(settingsOf(describeEsc(rawRead(mockBluejayEsc(), { 0x01: 22, 0x02: 209, 0x0a: 0 })))['PWM frequency']).toBe('Dynamic')
    const old = describeEsc(rawRead(mockBluejayEsc(), { 0x01: 9, 0x02: 200, 0x0a: 0xff }))
    expect(old).toMatchObject({ version: '0.9' })
    expect(settingsOf(old)).toMatchObject({ 'Rampup power': '10 %' })
    expect(settingsOf(old)).not.toHaveProperty('PWM frequency')
    expect(settingsOf(old)).not.toHaveProperty('Maximum startup power')
  })

  it('decodes BLHeli_S 16.7 (layout 33)', () => {
    const report = describeEsc(rawRead(mockBlheliSEsc()))
    expect(report).toMatchObject({ status: 'ok', firmware: 'BLHeli_S', version: '16.7', hardware: 'A-H-30 · EFM8BB10' })
    expect(settingsOf(report)).toEqual({
      'Motor direction': 'Normal',
      'Startup power': '0.50',
      'Motor timing': 'Medium',
      'Demag compensation': 'Low',
      'Temperature protection': '140 °C',
      'Low RPM power protection': 'On',
      'Brake on stop': 'Off',
      'Beep strength': '40',
      'Beacon strength': '80',
      'Beacon delay': '10 minutes',
    })
  })

  it('treats temperature protection as a switch in BLHeli_S layout 32', () => {
    expect(settingsOf(describeEsc(rawRead(mockBlheliSEsc(), { 0x02: 32, 0x23: 1 })))['Temperature protection']).toBe('On')
  })

  it('tells the BLHeli_S forks apart and does not show their settings', () => {
    const raw = rawRead(mockBlheliSEsc())
    expect(needsCodeProbe(raw.settings)).toBe(true)
    expect(needsCodeProbe(rawRead(mockBluejayEsc()).settings)).toBe(false)

    const code = new Uint8Array(0x80)
    code.set([0x4a, 0x45, 0x53, 0x43], 0x31) // "JESC"
    expect(describeEsc({ ...raw, codeProbe: code })).toMatchObject({ status: 'unknown', description: expect.stringContaining('JESC') })
    expect(describeEsc(rawRead(mockBlheliSEsc(), { 0x01: 9 }))).toMatchObject({ status: 'unknown', description: expect.stringContaining('BLHeli_M 16.9') })
  })

  it('decodes AM32 2.18 (eeprom version 2)', () => {
    const report = describeEsc(rawRead(mockAm32Esc()))
    expect(report).toMatchObject({ status: 'ok', firmware: 'AM32', version: '2.18', hardware: 'MOCK_ESC_F051', layoutRevision: 2 })
    expect(settingsOf(report)).toEqual({
      'Motor direction': 'Normal',
      'Bidirectional (3D) mode': 'Off',
      'Variable PWM frequency': 'On',
      'PWM frequency': '24 kHz',
      'Timing advance': '15°',
      'Startup power': '100',
      'Motor KV': '2220',
      'Motor poles': '14',
      'Complementary PWM': 'On',
      'Brake on stop': 'Off',
      'Stuck rotor protection': 'On',
      'Stall protection': 'On',
      'Sinusoidal startup': 'Off',
      'Signal protocol': 'DShot',
      'Temperature limit': 'Off',
      'Current limit': 'Off',
      'Low voltage cutoff': 'Off',
      'Cutoff voltage per cell': '3.00 V',
      'Beep volume': '5',
      '30 ms telemetry': 'Off',
    })
  })

  it('reads both AM32 timing formats, limits, and pads the minor version', () => {
    const settings = (patch: Record<number, number>) => settingsOf(describeEsc(rawRead(mockAm32Esc(), patch)))
    expect(settings({ 23: 2 })['Timing advance']).toBe('15°') // old format: steps of 7.5°
    expect(settings({ 23: 18 })['Timing advance']).toBe('7.5°') // new format: (18 - 10) × 0.9375°
    expect(settings({ 43: 90, 44: 40 })).toMatchObject({ 'Temperature limit': '90 °C', 'Current limit': '80 A' })
    expect(describeEsc(rawRead(mockAm32Esc(), { 3: 2, 4: 5 }))).toMatchObject({ version: '2.05' })
  })

  it('leaves out what an older AM32 eeprom version does not have, and falls back to the MCU without a file name', () => {
    const raw = rawRead(mockAm32Esc(), { 1: 0 })
    const report = describeEsc({ ...raw, fileName: null })
    expect(report).toMatchObject({ hardware: 'ARM, 32 k flash' })
    expect(settingsOf(report)).not.toHaveProperty('Signal protocol')
    expect(settingsOf(report)).not.toHaveProperty('Beep volume')
    expect(settingsOf(report)).toHaveProperty('Motor KV')
  })

  it('shows firmware and version but no settings for a layout it does not know', () => {
    const report = describeEsc(rawRead(mockBluejayEsc(), { 0x02: 215 }))
    expect(report).toMatchObject({ status: 'ok', firmware: 'Bluejay', settings: [], note: expect.stringContaining('215') })
  })

  it('reports erased settings as no firmware', () => {
    const raw = rawRead(mockBlheliSEsc())
    expect(describeEsc({ ...raw, settings: new Uint8Array(0x70).fill(0xff) })).toMatchObject({ status: 'unknown' })
  })
})

describe('differingSettings', () => {
  it('flags settings that differ from the first ESC with the same firmware, except the per-motor ones', () => {
    const reports = [
      describeEsc(rawRead(mockBluejayEsc())),
      describeEsc(rawRead(mockBluejayEsc({ reversed: true, pwmKhz: 24 }))),
      describeEsc(rawRead(mockBlheliSEsc())),
      { status: 'missing', description: '' } satisfies EscReport,
      describeEsc(rawRead(mockBlheliSEsc(), { 0x1f: 3 })),
    ]
    expect(differingSettings(reports).map((keys) => [...keys])).toEqual([[], ['pwmFrequency'], [], [], ['demag']])
  })
})

describe('combineReports', () => {
  const bluejay = (options?: Parameters<typeof mockBluejayEsc>[0], patch?: Record<number, number>) =>
    describeEsc(rawRead(mockBluejayEsc(options), patch))

  it('shows ESCs that are alike as one, with the motor direction per ESC', () => {
    const overview = combineReports([bluejay(), bluejay({ reversed: true }), bluejay({ reversed: true }), bluejay()])
    expect(overview).toMatchObject({ view: 'combined', count: 4, firmware: 'Bluejay', version: '0.21.0', hardware: 'Z-H-30 · EFM8BB21' })
    if (overview.view !== 'combined') return
    const values = Object.fromEntries(overview.settings.map((setting) => [setting.label, setting.values]))
    expect(values['Motor direction']).toEqual(['Normal', 'Reversed', 'Reversed', 'Normal'])
    expect(values['PWM frequency']).toEqual(['48 kHz'])
    expect(overview.settings.map((setting) => setting.key)).toEqual(
      (bluejay() as Extract<EscReport, { status: 'ok' }>).settings.map((setting) => setting.key),
    )
  })

  it('gives a per-motor setting once when it is the same everywhere', () => {
    const overview = combineReports([bluejay(), bluejay()])
    expect(overview.view === 'combined' && overview.settings.find((setting) => setting.key === 'direction')?.values).toEqual(['Normal'])
  })

  it('keeps the ESCs apart when a setting differs, and names it', () => {
    const overview = combineReports([bluejay(), bluejay({ pwmKhz: 24 }), bluejay(undefined, { 0x1f: 3 }), bluejay()])
    expect(overview).toEqual({
      view: 'separate',
      reason: 'The ESCs are not set up alike (PWM frequency, Demag compensation), so they are listed one by one.',
    })
  })

  it('counts a setting that only some ESCs show as differing', () => {
    // PWM frequency byte 0xFF: not a value Bluejay knows, the row is hidden for that ESC.
    const overview = combineReports([bluejay(), bluejay(undefined, { 0x0a: 0xff })])
    expect(overview).toMatchObject({ view: 'separate', reason: expect.stringContaining('PWM frequency') })
  })

  it('keeps the ESCs apart when firmware, version or hardware differ', () => {
    const am32 = describeEsc(rawRead(mockAm32Esc()))
    expect(combineReports([bluejay(), am32])).toMatchObject({ view: 'separate', reason: expect.stringContaining('same firmware') })
    expect(combineReports([bluejay(), bluejay(undefined, { 0x01: 20 })])).toMatchObject({ reason: expect.stringContaining('same firmware') })
    const otherBoard = describeEsc(rawRead({ ...mockBluejayEsc(), signature: 0xe8b1 }))
    expect(combineReports([bluejay(), otherBoard])).toMatchObject({ view: 'separate', reason: expect.stringContaining('same hardware') })
  })

  it('leaves it to the cards when an ESC was not read, and never combines a single ESC', () => {
    const missing: EscReport = { status: 'missing', description: '' }
    expect(combineReports([bluejay(), missing, bluejay()])).toEqual({ view: 'separate', reason: null })
    expect(combineReports([missing, missing])).toEqual({ view: 'separate', reason: null })
    expect(combineReports([bluejay()])).toEqual({ view: 'separate', reason: null })
    expect(combineReports([])).toEqual({ view: 'separate', reason: null })
  })
})
