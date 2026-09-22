import { describe, expect, it } from 'vitest'
import { mockAm32Esc, mockBlheliSEsc, mockBluejayEsc, type MockEsc } from '@/lib/mock-fc/mockEscs'
import { INTERFACE_MODE } from './fourway'
import {
  alignGroup,
  changedEscs,
  combineReports,
  decodeDeviceInfo,
  describeEsc,
  describeUnsupported,
  differingSettings,
  draftRaw,
  editableGroups,
  needsCodeProbe,
  numberToRaw,
  rawToNumber,
  readPlan,
  recommendedZone,
  setDraftRaw,
  toEscDraft,
  unevenSettings,
  withBlock,
  type EscControl,
  type EscRawRead,
  type EscReport,
  type ReadableEsc,
} from './model'

/** What io.ts would have read from this mock ESC. */
function rawRead(esc: MockEsc, patch: Record<number, number> = {}): EscRawRead {
  const info = {
    signature: esc.signature,
    bootByte: esc.bootByte,
    interfaceMode: esc.interfaceMode,
  }
  const plan = readPlan(info)
  if (!plan) throw new Error('no read plan for this mock ESC')
  const settings = Uint8Array.from(esc.flash[plan.settingsAddress] ?? [])
  for (const [offset, value] of Object.entries(patch)) settings[Number(offset)] = value
  const fileName =
    plan.fileNameAddress === null
      ? null
      : Uint8Array.from((esc.flash[plan.fileNameAddress] ?? []).slice(0, 16))
  return { info, plan, settings, fileName, codeProbe: null }
}

function settingsOf(report: EscReport): Record<string, string> {
  if (report.status !== 'ok') throw new Error(`expected a readable ESC, got ${report.status}`)
  return Object.fromEntries(report.settings.map((setting) => [setting.label, setting.value]))
}

describe('decodeDeviceInfo / readPlan', () => {
  it('reads signature (lo, hi), boot byte and interface mode', () => {
    expect(decodeDeviceInfo(Uint8Array.of(0xb2, 0xe8, 0x63, 1))).toEqual({
      signature: 0xe8b2,
      bootByte: 0x63,
      interfaceMode: 1,
    })
  })

  it('knows where the SiLabs MCUs keep their settings', () => {
    const plan = (signature: number) =>
      readPlan({ signature, bootByte: 0x63, interfaceMode: INTERFACE_MODE.SILABS_BLB })
    expect(plan(0xe8b1)).toMatchObject({
      family: 'silabs',
      mcu: 'EFM8BB10',
      settingsAddress: 0x1a00,
      settingsLength: 0xff,
      erasePage: 13,
      writable: true,
    })
    expect(plan(0xe8b2)).toMatchObject({ mcu: 'EFM8BB21', settingsAddress: 0x1a00 })
    expect(plan(0xe8b5)).toMatchObject({ mcu: 'EFM8BB51', settingsAddress: 0x3000, erasePage: 24 })
    expect(plan(0xf330)).toBeNull()
  })

  it('maps the AM32 flash size codes to the settings address, shifted for 128 k parts', () => {
    const plan = (signature: number, bootByte = 0x14) =>
      readPlan({ signature, bootByte, interfaceMode: INTERFACE_MODE.ARM_BLB })
    expect(plan(0x1f06)).toMatchObject({
      family: 'arm',
      settingsAddress: 0x7c00,
      fileNameAddress: 0x7be0,
      settingsLength: 0xb8,
      erasePage: null,
      writable: true,
    })
    expect(plan(0x3506)).toMatchObject({ settingsAddress: 0xf800, fileNameAddress: 0xf7e0 })
    // 128 k parts: newer bootloaders have their own flash map, so they are only read
    expect(plan(0x2b06)).toMatchObject({
      settingsAddress: 0x7e00,
      fileNameAddress: 0x7df8,
      writable: false,
    })
  })

  it('does not take a BLHeli_32 ESC (ARM, but not an AM32 signal pin) for AM32', () => {
    const info = { signature: 0x1f06, bootByte: 0x64, interfaceMode: INTERFACE_MODE.ARM_BLB }
    expect(readPlan(info)).toBeNull()
    expect(describeUnsupported(info)).toMatchObject({
      status: 'unknown',
      description: expect.stringContaining('BLHeli_32'),
    })
  })

  it('has no plan for Atmel ESCs', () => {
    const info = { signature: 0x9307, bootByte: 0x63, interfaceMode: INTERFACE_MODE.ATMEL_BLB }
    expect(readPlan(info)).toBeNull()
    expect(describeUnsupported(info)).toMatchObject({
      status: 'unknown',
      description: expect.stringContaining('0x9307'),
    })
  })
})

describe('describeEsc', () => {
  it('decodes Bluejay 0.21 (layout 208)', () => {
    const report = describeEsc(rawRead(mockBluejayEsc({ reversed: true })))
    expect(report).toMatchObject({
      status: 'ok',
      firmware: 'Bluejay',
      version: '0.21.0',
      hardware: 'Z-H-30 · EFM8BB21',
      layoutRevision: 208,
      note: null,
      editable: true,
    })
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

  it('only takes Bluejay 0.21: older ones have to be updated, and the patch level comes from the name', () => {
    const name = [...'Bluejay (.1 RC2)'].map((char) => char.charCodeAt(0))
    const patch = Object.fromEntries(name.map((byte, i) => [0x60 + i, byte]))
    const old = describeEsc(rawRead(mockBluejayEsc(), { ...patch, 0x01: 20, 0x02: 207 }))
    expect(old).toMatchObject({
      status: 'unsupported',
      firmware: 'Bluejay',
      version: '0.20.1 RC2',
      hardware: 'Z-H-30 · EFM8BB21',
    })
    expect(old).toMatchObject({ description: expect.stringMatching(/too old.*Update the ESCs/) })
    expect(describeEsc(rawRead(mockBluejayEsc(), patch))).toMatchObject({
      status: 'ok',
      version: '0.21.1 RC2',
    })

    const newer = describeEsc(rawRead(mockBluejayEsc(), { 0x01: 22, 0x02: 209 }))
    expect(newer).toMatchObject({
      status: 'unsupported',
      version: '0.22.0',
      description: expect.stringContaining('newer'),
    })
  })

  it('warns about a Bluejay that is not the 24 kHz build', () => {
    expect(describeEsc(rawRead(mockBluejayEsc()))).toMatchObject({
      warnings: [expect.stringMatching(/48 kHz build.*greatly reduced/)],
    })
    expect(describeEsc(rawRead(mockBluejayEsc({ pwmKhz: 96 })))).toMatchObject({
      warnings: [expect.stringContaining('96 kHz')],
    })
    expect(describeEsc(rawRead(mockBluejayEsc({ pwmKhz: 24 })))).toMatchObject({ warnings: [] })
  })

  it('decodes BLHeli_S 16.7 (layout 33)', () => {
    const report = describeEsc(rawRead(mockBlheliSEsc()))
    expect(report).toMatchObject({
      status: 'ok',
      firmware: 'BLHeli_S',
      version: '16.7',
      hardware: 'A-H-30 · EFM8BB10',
      editable: false,
      warnings: [],
    })
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
    expect(
      settingsOf(describeEsc(rawRead(mockBlheliSEsc(), { 0x02: 32, 0x23: 1 })))[
        'Temperature protection'
      ],
    ).toBe('On')
  })

  it('tells the BLHeli_S forks apart and does not show their settings', () => {
    const raw = rawRead(mockBlheliSEsc())
    expect(needsCodeProbe(raw.settings)).toBe(true)
    expect(needsCodeProbe(rawRead(mockBluejayEsc()).settings)).toBe(false)

    const code = new Uint8Array(0x80)
    code.set([0x4a, 0x45, 0x53, 0x43], 0x31) // "JESC"
    expect(describeEsc({ ...raw, codeProbe: code })).toMatchObject({
      status: 'unknown',
      description: expect.stringContaining('JESC'),
    })
    expect(describeEsc(rawRead(mockBlheliSEsc(), { 0x01: 9 }))).toMatchObject({
      status: 'unknown',
      description: expect.stringContaining('BLHeli_M 16.9'),
    })
  })

  it('decodes AM32 2.21 (eeprom version 4) with every setting of the AM32 configurator', () => {
    const report = describeEsc(rawRead(mockAm32Esc()))
    expect(report).toMatchObject({
      status: 'ok',
      firmware: 'AM32',
      version: '2.21',
      hardware: 'MOCK_ESC_F051',
      layoutRevision: 4,
      editable: true,
    })
    expect(settingsOf(report)).toEqual({
      'Motor direction': 'Normal',
      'Bidirectional (3D) mode': 'Off',
      'Signal protocol': 'DShot',
      'Disable stick calibration': 'Off',
      'PWM type': 'Variable',
      'PWM frequency': '24 kHz',
      'Auto timing advance': 'Off',
      'Timing advance': '15°',
      'Startup power': '100 %',
      'Motor KV': '2220',
      'Motor poles': '14',
      'Complementary PWM': 'On',
      'Stuck rotor protection': 'On',
      'Stall protection': 'On',
      'Use hall sensors': 'Off',
      '30 ms telemetry': 'Off',
      'Beep volume': '5',
      'Ramp rate': '16 % duty cycle per ms',
      'Minimum duty cycle': '0.5 %',
      'Low voltage cutoff': 'Off',
      'Cutoff voltage per cell': '3.00 V',
      'Absolute cutoff voltage': '5 V',
      'Temperature limit': 'Off',
      'Current limit': 'Off',
      'Current P': '100',
      'Current I': '0',
      'Current D': '100',
      'Sinusoidal startup': 'Off',
      'Sine mode range': '15 % throttle',
      'Sine mode power': '6',
      'Brake on stop': 'Off',
      'Car type reverse braking': 'Off',
      'Brake strength': '10',
      'Running brake level': '10',
      'Active brake power': '0 % duty cycle',
      'Servo low threshold': '1006 µs',
      'Servo high threshold': '2006 µs',
      'Servo neutral': '1502 µs',
      'Servo dead band': '50',
    })
  })

  it('reads both AM32 timing formats and the limits', () => {
    const settings = (patch: Record<number, number>) =>
      settingsOf(describeEsc(rawRead(mockAm32Esc(), patch)))
    expect(settings({ 23: 2 })['Timing advance']).toBe('15°') // old format: steps of 7.5°
    expect(settings({ 23: 18 })['Timing advance']).toBe('7.5°') // new format: (18 - 10) × 0.9375°
    expect(settings({ 43: 90, 44: 40 })).toMatchObject({
      'Temperature limit': '90 °C',
      'Current limit': '80 A',
    })
  })

  it('only takes AM32 2.21, and pads the minor version', () => {
    const old = describeEsc(rawRead(mockAm32Esc(), { 3: 2, 4: 5 }))
    expect(old).toMatchObject({
      status: 'unsupported',
      firmware: 'AM32',
      version: '2.05',
      hardware: 'MOCK_ESC_F051',
    })
    expect(old).toMatchObject({ description: expect.stringContaining('only works with AM32 2.21') })
    expect(describeEsc(rawRead(mockAm32Esc(), { 4: 22 }))).toMatchObject({
      status: 'unsupported',
      version: '2.22',
    })
  })

  it('falls back to the MCU without an AM32 file name, and only reads ESCs with 128 k flash', () => {
    const raw = rawRead(mockAm32Esc())
    expect(describeEsc({ ...raw, fileName: null })).toMatchObject({
      hardware: 'ARM, 32 k flash',
      editable: true,
    })
    expect(describeEsc({ ...raw, plan: { ...raw.plan, writable: false } })).toMatchObject({
      status: 'ok',
      editable: false,
    })
  })

  it('shows firmware and version but no settings for a layout it does not know', () => {
    const report = describeEsc(rawRead(mockBluejayEsc(), { 0x02: 215 }))
    expect(report).toMatchObject({
      status: 'ok',
      firmware: 'Bluejay',
      settings: [],
      note: expect.stringContaining('215'),
      editable: false,
      warnings: [],
    })
  })

  it('reports erased settings as no firmware', () => {
    const raw = rawRead(mockBlheliSEsc())
    expect(describeEsc({ ...raw, settings: new Uint8Array(0x70).fill(0xff) })).toMatchObject({
      status: 'unknown',
    })
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
    expect(differingSettings(reports).map((keys) => [...keys])).toEqual([
      [],
      ['pwmFrequency'],
      [],
      [],
      ['demag'],
    ])
  })
})

describe('combineReports', () => {
  const bluejay = (
    options?: Parameters<typeof mockBluejayEsc>[0],
    patch?: Record<number, number>,
  ) => describeEsc(rawRead(mockBluejayEsc(options), patch))

  it('shows ESCs that are alike as one, with the motor direction per ESC', () => {
    const overview = combineReports([
      bluejay(),
      bluejay({ reversed: true }),
      bluejay({ reversed: true }),
      bluejay(),
    ])
    expect(overview).toMatchObject({
      view: 'combined',
      count: 4,
      firmware: 'Bluejay',
      version: '0.21.0',
      hardware: 'Z-H-30 · EFM8BB21',
    })
    expect(overview).toMatchObject({ warnings: [expect.stringContaining('48 kHz')] })
    if (overview.view !== 'combined') return
    const values = Object.fromEntries(
      overview.settings.map((setting) => [setting.label, setting.values]),
    )
    expect(values['Motor direction']).toEqual(['Normal', 'Reversed', 'Reversed', 'Normal'])
    expect(values['PWM frequency']).toEqual(['48 kHz'])
    expect(overview.settings.map((setting) => setting.key)).toEqual(
      (bluejay() as Extract<EscReport, { status: 'ok' }>).settings.map((setting) => setting.key),
    )
  })

  it('gives a per-motor setting once when it is the same everywhere', () => {
    const overview = combineReports([bluejay(), bluejay()])
    expect(
      overview.view === 'combined' &&
        overview.settings.find((setting) => setting.key === 'direction')?.values,
    ).toEqual(['Normal'])
  })

  it('keeps the ESCs apart when a setting differs, and names it', () => {
    const overview = combineReports([
      bluejay(),
      bluejay({ pwmKhz: 24 }),
      bluejay(undefined, { 0x1f: 3 }),
      bluejay(),
    ])
    expect(overview).toEqual({
      view: 'separate',
      reason:
        'The ESCs are not set up alike (PWM frequency, Demag compensation), so they are listed one by one.',
    })
  })

  it('counts a setting that only some ESCs show as differing', () => {
    // PWM frequency byte 0xFF: not a value Bluejay knows, the row is hidden for that ESC.
    const overview = combineReports([bluejay(), bluejay(undefined, { 0x0a: 0xff })])
    expect(overview).toMatchObject({
      view: 'separate',
      reason: expect.stringContaining('PWM frequency'),
    })
  })

  it('keeps the ESCs apart when firmware, version or hardware differ', () => {
    const am32 = describeEsc(rawRead(mockAm32Esc()))
    expect(combineReports([bluejay(), am32])).toMatchObject({
      view: 'separate',
      reason: expect.stringContaining('same firmware'),
    })
    // A version this app doesn't take has no settings to compare: its card says so.
    expect(combineReports([bluejay(), bluejay(undefined, { 0x01: 20 })])).toEqual({
      view: 'separate',
      reason: null,
    })
    const otherBoard = describeEsc(rawRead({ ...mockBluejayEsc(), signature: 0xe8b1 }))
    expect(combineReports([bluejay(), otherBoard])).toMatchObject({
      view: 'separate',
      reason: expect.stringContaining('same hardware'),
    })
  })

  it('leaves it to the cards when an ESC was not read, and never combines a single ESC', () => {
    const missing: EscReport = { status: 'missing', description: '' }
    expect(combineReports([bluejay(), missing, bluejay()])).toEqual({
      view: 'separate',
      reason: null,
    })
    expect(combineReports([missing, missing])).toEqual({ view: 'separate', reason: null })
    expect(combineReports([bluejay()])).toEqual({ view: 'separate', reason: null })
    expect(combineReports([])).toEqual({ view: 'separate', reason: null })
  })
})

describe('editing', () => {
  const read = (escs: MockEsc[]) => escs.map((esc) => describeEsc(rawRead(esc)))
  const mixed = () =>
    read([mockBluejayEsc(), mockBluejayEsc({ reversed: true }), mockBlheliSEsc(), mockAm32Esc()])
  const numberControl = (reports: EscReport[], firmware: string, key: string) => {
    const control = editableGroups(reports)
      .find((group) => group.firmware === firmware)
      ?.settings.find((def) => def.key === key)?.control
    if (control?.kind !== 'number') throw new Error(`${key} is not a number`)
    return control satisfies EscControl
  }

  it('groups the ESCs by firmware and lists what can be changed: little on Bluejay, everything on AM32, nothing on BLHeli_S', () => {
    const groups = editableGroups(mixed())
    expect(groups.map((group) => [group.firmware, group.version, group.escs])).toEqual([
      ['Bluejay', '0.21.0', [0, 1]],
      ['AM32', '2.21', [3]],
    ])
    expect(groups[0]?.settings.map((def) => def.key)).toEqual([
      'startupPowerMin',
      'startupPowerMax',
      'timing',
    ])
    expect(groups[1]?.settings).toHaveLength(39)
    expect(groups[1]?.settings.filter((def) => def.perMotor).map((def) => def.key)).toEqual([
      'direction',
    ])
  })

  it('keeps a block per editable ESC and patches single bytes into it', () => {
    const reports = mixed()
    const draft = toEscDraft(reports)
    expect(draft.map((block) => block?.length ?? null)).toEqual([0xff, 0xff, null, 0xb8])
    expect(changedEscs(reports, draft)).toEqual([])

    const [bluejay] = editableGroups(reports)
    const timing = bluejay?.settings.find((def) => def.key === 'timing')
    if (!bluejay || !timing) throw new Error('no Bluejay timing')
    const next = setDraftRaw(draft, bluejay.escs, timing, 2)
    expect([draftRaw(next, 0, timing), draftRaw(next, 1, timing)]).toEqual([2, 2])
    expect(changedEscs(reports, next)).toEqual([0, 1])
    expect(next[0]).toEqual(draft[0]?.with(0x15, 2))
    expect(next[3]).toBe(draft[3])
    expect(changedEscs(reports, setDraftRaw(next, bluejay.escs, timing, 4))).toEqual([])
  })

  it('converts numbers the way ESC Configurator and the AM32 configurator show them', () => {
    const reports = mixed()
    const min = numberControl(reports, 'Bluejay', 'startupPowerMin')
    expect([rawToNumber(min, 21), rawToNumber(min, 51)]).toEqual([1010, 1025])
    expect([
      numberToRaw(min, 1025),
      numberToRaw(min, 1125),
      numberToRaw(min, 5000),
      numberToRaw(min, 0),
    ]).toEqual([51, 255, 255, 0])
    const max = numberControl(reports, 'Bluejay', 'startupPowerMax')
    expect([min.recommended, max.recommended]).toEqual([
      { min: 1025, max: 1050 },
      { min: 1050, max: 1200 },
    ])
    expect([
      rawToNumber(max, 5),
      numberToRaw(max, 1300),
      numberToRaw(max, 9999),
      numberToRaw(max, 1),
    ]).toEqual([1020, 75, 75, 1])

    const kv = numberControl(reports, 'AM32', 'motorKv')
    expect([rawToNumber(kv, 55), numberToRaw(kv, 1950), numberToRaw(kv, 1960)]).toEqual([
      2220, 48, 49,
    ])
    const cell = numberControl(reports, 'AM32', 'lowVoltageThreshold')
    expect([rawToNumber(cell, 50), numberToRaw(cell, 3.3), numberToRaw(cell, 9)]).toEqual([
      3, 80, 100,
    ])
    const ramp = numberControl(reports, 'AM32', 'maxRamp')
    expect([rawToNumber(ramp, 160), numberToRaw(ramp, 0.1), numberToRaw(ramp, 0)]).toEqual([
      16, 1, 1,
    ])
  })

  it('rates a number against its recommended range, ends included', () => {
    const range = { min: 1025, max: 1050 }
    expect([1020, 1025, 1040, 1050, 1055].map((v) => recommendedZone(range, v))).toEqual([
      'low',
      'good',
      'good',
      'good',
      'high',
    ])
  })

  it('greys out AM32 settings that another one makes meaningless', () => {
    const [group] = editableGroups(read([mockAm32Esc()]))
    const enabled = (key: string, values: Record<string, number>) =>
      group?.settings.find((def) => def.key === key)?.enabled?.((other) => values[other] ?? 0)
    expect([enabled('timing', { autoAdvance: 1 }), enabled('timing', { autoAdvance: 0 })]).toEqual([
      false,
      true,
    ])
    expect([
      enabled('pwmFrequency', { variablePwm: 2 }),
      enabled('pwmFrequency', { variablePwm: 1 }),
    ]).toEqual([false, true])
    expect([
      enabled('lowVoltageThreshold', { lowVoltageCutoff: 1 }),
      enabled('absoluteVoltageCutoff', { lowVoltageCutoff: 1 }),
    ]).toEqual([true, false])
    expect([
      enabled('activeBrakePower', { brakeOnStop: 2 }),
      enabled('brakeStrength', { brakeOnStop: 1, rcCarReversing: 1 }),
    ]).toEqual([true, false])
  })

  it('finds shared settings that are not the same on all ESCs of a group and can level them', () => {
    const reports = [
      describeEsc(rawRead(mockBluejayEsc())),
      describeEsc(rawRead(mockBluejayEsc({ reversed: true }), { 0x15: 2, 0x07: 9 })),
    ]
    const [group] = editableGroups(reports)
    if (!group) throw new Error('no group')
    const draft = toEscDraft(reports)
    expect(unevenSettings(draft, group)).toEqual(['Maximum startup power', 'Motor timing'])

    const level = alignGroup(draft, group)
    expect(unevenSettings(level, group)).toEqual([])
    expect(changedEscs(reports, level)).toEqual([1])
    expect(level[1]).toEqual(draft[1]?.with(0x15, 4).with(0x07, 5)) // the direction (0x0b) stays reversed
  })

  it('describes an ESC again from the block that was written to it', () => {
    const esc = describeEsc(rawRead(mockBluejayEsc())) as ReadableEsc
    const after = withBlock(esc, esc.block.with(0x15, 1))
    expect(settingsOf(after)['Motor timing']).toBe('0° (low)')
    expect(after).toMatchObject({
      firmware: 'Bluejay',
      version: '0.21.0',
      editable: true,
      warnings: esc.warnings,
    })
  })
})
