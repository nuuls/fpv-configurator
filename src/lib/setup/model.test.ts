import { describe, expect, it } from 'vitest'
import { externalOnly, parseDiff } from '@/lib/diff/model'
import { defaultMockConfig, MockFlightController } from '@/lib/mock-fc/mockFc'
import { readFcInfo, readStatus, sendReboot } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { FEATURE } from '@/lib/msp/messages'
import { calibrateAccelerometer } from '@/lib/orientation/io'
import { MockTransport } from '@/lib/transport/mock'
import type { Transport } from '@/lib/transport/types'
import { readSetupSnapshot, saveSetup } from './io'
import {
  applyFix,
  BEEPER_OFF,
  encodeSetAdvancedConfig,
  encodeSetArmingConfig,
  encodeSetBeeperConfig,
  externalChanges,
  formatLoopRate,
  pidLoopOptions,
  preflightChecks,
  readSetup,
  resetScript,
  withAirmode,
  withAllResets,
  withReset,
  type SetupSnapshot,
} from './model'

async function connect(fc: MockFlightController) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { transport, client: new MspClient(transport) }
}

/** Everything the checklist asks for; tests break one thing at a time. */
const allGood = (): SetupSnapshot => ({
  advancedConfig: [1, 1, 0, 6, 0xe0, 0x01],
  armingConfig: [5, 0, 180, 0],
  beeperConfig: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  features: FEATURE.AIRMODE | FEATURE.OSD,
  bidirDshot: true,
  hasAccelerometer: true,
  accCalibrated: true,
  external: null,
  externalError: null,
})

describe('PID loop frequency', () => {
  it('offers 4 and 8 kHz on an 8 kHz gyro', () => {
    expect(pidLoopOptions(8000, 1)).toEqual([
      { denom: 2, hz: 4000 },
      { denom: 1, hz: 8000 },
    ])
  })

  it('offers only 3.2 kHz when that is all the gyro does', () => {
    expect(pidLoopOptions(3200, 1)).toEqual([{ denom: 1, hz: 3200 }])
  })

  it('keeps an unusual value from the FC selectable', () => {
    expect(pidLoopOptions(8000, 4).map((o) => o.hz)).toEqual([2000, 4000, 8000])
    expect(pidLoopOptions(3200, 2).map((o) => o.hz)).toEqual([1600, 3200])
  })

  it('offers nothing when the firmware does not report the gyro rate', () => {
    expect(pidLoopOptions(0, 1)).toEqual([])
  })

  it('formats rates', () => {
    expect([8000, 4000, 3200, 6664].map(formatLoopRate)).toEqual([
      '8 kHz',
      '4 kHz',
      '3.2 kHz',
      '6.7 kHz',
    ])
  })

  it('patches only pid_process_denom into MSP_SET_ADVANCED_CONFIG', () => {
    const snapshot = allGood()
    expect(readSetup(snapshot).pidDenom).toBe(1)
    expect([...encodeSetAdvancedConfig(snapshot, { ...readSetup(snapshot), pidDenom: 2 })]).toEqual(
      [1, 2, 0, 6, 0xe0, 0x01],
    )
  })

  it('saves to the mock FC across a reboot', async () => {
    const fc = new MockFlightController()
    const { transport, client } = await connect(fc)
    expect((await readFcInfo(client)).board.gyroSampleRateHz).toBe(8000)

    const snapshot = await readSetupSnapshot(client)
    await saveSetup(client, snapshot, { ...readSetup(snapshot), pidDenom: 2 })
    const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
    await sendReboot(client)
    await dropped

    const after = (await connect(fc)).client
    expect(readSetup(await readSetupSnapshot(after)).pidDenom).toBe(2)
    expect((await readStatus(after)).cycleTimeUs).toBe(250)
    // everything but the denominator is untouched
    expect(fc.savedConfig.advancedConfig).toEqual(snapshot.advancedConfig.with(1, 2))
  })

  it('reports a 3.2 kHz gyro', async () => {
    const { client } = await connect(new MockFlightController({ gyroSampleRateHz: 3200 }))
    expect((await readFcInfo(client)).board.gyroSampleRateHz).toBe(3200)
  })
})

describe('pre-flight checklist', () => {
  const failing = (snapshot: SetupSnapshot, draft = readSetup(snapshot)) =>
    preflightChecks(snapshot, draft)
      .filter((check) => !check.ok)
      .map((check) => check.id)

  it('passes when everything is set', () => {
    const checks = preflightChecks(allGood(), readSetup(allGood()))
    expect(checks.map((check) => check.id)).toEqual([
      'bidirDshot',
      'accCalibrated',
      'armAngle',
      'beeper',
      'airmode',
    ])
    expect(checks.every((check) => check.ok && !check.pending && check.fix === null)).toBe(true)
  })

  it('words a failing check as what is wrong', () => {
    const labels = (snapshot: SetupSnapshot) =>
      preflightChecks(snapshot, readSetup(snapshot)).map((check) => check.label)
    expect(labels(allGood())).toEqual([
      'Bidirectional DShot is enabled',
      'Accelerometer is calibrated',
      'Arm angle is 180°',
      'Beeper and DShot beacon sound on RX set and RX loss',
      'Airmode is on',
    ])
    expect(
      labels({
        ...allGood(),
        armingConfig: [5, 0, 25, 0],
        beeperConfig: [0, 2, 0, 0, 1, 0, 0, 0, 0],
        features: FEATURE.OSD,
        bidirDshot: false,
        accCalibrated: false,
      }),
    ).toEqual([
      'Bidirectional DShot is not enabled',
      'Accelerometer is not calibrated',
      'Arm angle is not 180°',
      'Beeper or DShot beacon is silent on RX set or RX loss',
      'Airmode is off',
    ])
  })

  it('sends bidirectional DShot and the accelerometer to their own tabs', () => {
    const checks = preflightChecks(
      { ...allGood(), bidirDshot: false, accCalibrated: false },
      readSetup(allGood()),
    )
    expect(checks.filter((check) => !check.ok).map((check) => check.fix)).toEqual([
      { path: '/motors', tab: 'Motors' },
      { path: '/orientation', tab: 'Orientation' },
    ])
  })

  it('cannot fix a missing accelerometer', () => {
    const [, acc] = preflightChecks(
      { ...allGood(), hasAccelerometer: false, accCalibrated: false },
      readSetup(allGood()),
    )
    expect(acc).toMatchObject({ ok: false, detail: 'No accelerometer', fix: null })
  })

  it('wants an arm angle of exactly 180', () => {
    const snapshot = { ...allGood(), armingConfig: [5, 0, 25, 0] }
    expect(failing(snapshot)).toEqual(['armAngle'])
    expect(preflightChecks(snapshot, readSetup(snapshot))[2]).toMatchObject({
      detail: '25°',
      fix: 'here',
    })
  })

  it('wants the beeper on for RX set and RX loss, whatever else is muted', () => {
    const beeper = (flags: number) => ({
      ...allGood(),
      beeperConfig: [flags & 0xff, flags >> 8, 0, 0, 1, 0, 0, 0, 0],
    })
    expect(failing(beeper(1 << 3))).toEqual([]) // only "disarming" is muted
    expect(failing(beeper(BEEPER_OFF.RX_SET))).toEqual(['beeper'])
    const both = beeper(BEEPER_OFF.RX_SET | BEEPER_OFF.RX_LOST)
    expect(preflightChecks(both, readSetup(both))[3]?.detail).toBe(
      'Beeper off for RX set and RX loss',
    )
  })

  it('wants the DShot beacon on for RX set and RX loss too', () => {
    // Betaflight default: beeper on, beacon off for both
    const beaconOff = { ...allGood(), beeperConfig: [0, 0, 0, 0, 1, 0x02, 0x02, 0, 0] }
    expect(failing(beaconOff)).toEqual(['beeper'])
    expect(preflightChecks(beaconOff, readSetup(beaconOff))[3]).toMatchObject({
      detail: 'DShot beacon off for RX set and RX loss',
      fix: 'here',
    })
    const mixed = { ...allGood(), beeperConfig: [0, 0x02, 0, 0, 1, 0x02, 0, 0, 0] }
    expect(preflightChecks(mixed, readSetup(mixed))[3]?.detail).toBe(
      'Beeper off for RX set · DShot beacon off for RX loss',
    )
    expect(applyFix(readSetup(beaconOff), 'beeper')).toMatchObject({
      beeperOffFlags: 0,
      dshotBeaconOffFlags: 0,
    })
  })

  it('judges a beeper config that ends before the DShot beacon by the beeper alone', () => {
    const short = { ...allGood(), beeperConfig: [0, 0x02, 0, 0] }
    expect(readSetup(short).dshotBeaconOffFlags).toBeNull()
    const fixed = applyFix(readSetup(short), 'beeper')
    expect(fixed).toMatchObject({ beeperOffFlags: 0, dshotBeaconOffFlags: null })
    expect(failing(short, fixed)).toEqual([])
    expect([...encodeSetBeeperConfig(short.beeperConfig, fixed)]).toEqual([0, 0, 0, 0])
  })

  it('reports a firmware without beeper config instead of offering a fix', () => {
    const snapshot = { ...allGood(), beeperConfig: null }
    expect(readSetup(snapshot).beeperOffFlags).toBeNull()
    expect(preflightChecks(snapshot, readSetup(snapshot))[3]).toMatchObject({
      ok: false,
      fix: null,
      detail: 'No beeper support',
    })
    expect(applyFix(readSetup(snapshot), 'beeper')).toEqual(readSetup(snapshot))
  })

  it('wants the airmode feature', () => {
    expect(failing({ ...allGood(), features: FEATURE.OSD })).toEqual(['airmode'])
  })

  it('a fix passes the check, marked as pending until saved', () => {
    const snapshot = {
      ...allGood(),
      armingConfig: [5, 0, 25, 0],
      beeperConfig: [0x0a, 0x02, 0, 0, 1, 0x02, 0x02, 0, 1],
      features: 0,
    }
    let draft = readSetup(snapshot)
    for (const id of failing(snapshot)) draft = applyFix(draft, id)
    // 0x0a = disarming + RX loss muted: only the RX bits are cleared, in the beeper and in the DShot beacon flags
    expect(draft).toEqual({
      pidDenom: 1,
      armAngle: 180,
      beeperOffFlags: 1 << 3,
      dshotBeaconOffFlags: 1 << 24,
      airmode: true,
      resets: [],
    })
    expect(preflightChecks(snapshot, draft).map((check) => [check.ok, check.pending])).toEqual([
      [true, false],
      [true, false],
      [true, true],
      [true, true],
      [true, true],
    ])
  })

  it('fixes that belong to another tab leave the draft alone', () => {
    const draft = readSetup(allGood())
    expect(applyFix(draft, 'bidirDshot')).toBe(draft)
    expect(applyFix(draft, 'accCalibrated')).toBe(draft)
  })

  it('patches only small_angle, the beeper and DShot beacon off-flags and the airmode bit', () => {
    const snapshot = { ...allGood(), armingConfig: [5, 0, 25, 1] }
    expect([...encodeSetArmingConfig(snapshot, 180)]).toEqual([5, 0, 180, 1])
    const beeper = { ...readSetup(allGood()), beeperOffFlags: 1 << 3, dshotBeaconOffFlags: 1 << 24 }
    expect([...encodeSetBeeperConfig([0x0a, 0x02, 0, 0, 3, 0x02, 0x02, 0, 1], beeper)]).toEqual([
      0x08, 0, 0, 0, 3, 0, 0, 0, 1,
    ])
    expect(withAirmode(FEATURE.OSD, true)).toBe(FEATURE.OSD | FEATURE.AIRMODE)
    expect(withAirmode(0x80000000 | FEATURE.AIRMODE, false)).toBe(0x80000000)
  })

  it('reads the mock FC, fixes it and keeps the fixes across a reboot', async () => {
    const fc = new MockFlightController()
    const { transport, client } = await connect(fc)
    const snapshot = await readSetupSnapshot(client)
    // the mock: DShot telemetry off, never calibrated, arm angle 25, RX set beep muted and DShot beacon off, airmode on
    expect(failing(snapshot)).toEqual(['bidirDshot', 'accCalibrated', 'armAngle', 'beeper'])

    let draft = readSetup(snapshot)
    for (const id of failing(snapshot)) draft = applyFix(draft, id)
    await saveSetup(client, snapshot, draft)
    await calibrateAccelerometer(client, 0)
    const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
    await sendReboot(client)
    await dropped

    expect(failing(await readSetupSnapshot((await connect(fc)).client))).toEqual(['bidirDshot'])
    const before = defaultMockConfig()
    expect(fc.savedConfig.armingConfig).toEqual(before.armingConfig.with(2, 180))
    expect(before.beeperConfig).toEqual([0x00, 0x02, 0, 0, 1, 0x02, 0x02, 0, 0])
    expect(fc.savedConfig.beeperConfig).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0])
    expect(fc.savedConfig.features).toBe(before.features)
    expect(fc.savedConfig.advancedConfig).toEqual(before.advancedConfig)
  })

  it('writes the airmode feature and nothing else', async () => {
    const config = defaultMockConfig()
    config.features &= ~FEATURE.AIRMODE
    const fc = new MockFlightController({ config })
    const { client } = await connect(fc)
    const snapshot = await readSetupSnapshot(client)
    await saveSetup(client, snapshot, applyFix(readSetup(snapshot), 'airmode'))
    expect(fc.savedConfig).toEqual({ ...config, features: config.features | FEATURE.AIRMODE })
  })
})

describe('changed outside this app', () => {
  /** What the CLI prints for a quad set up in Betaflight Configurator: a tuning change, a setup change, a LED. */
  const DIFF = [
    '# name: Whoop',
    '',
    '# feature',
    '#feature -LED_STRIP',
    'feature LED_STRIP',
    '',
    '# led',
    'led 0 0,0::C:2',
    '',
    '# master',
    '#set small_angle = 25',
    'set small_angle = 180',
    '#set crashflip_motor_percent = 0',
    'set crashflip_motor_percent = 50',
    '',
    'profile 1',
    '',
    '# profile 1',
    '#set anti_gravity_gain = 80',
    'set anti_gravity_gain = 100',
    '#set simplified_d_gain = 100',
    'set simplified_d_gain = 120',
    '',
    '# restore original profile selection',
    'profile 0',
    '',
    'rateprofile 0',
    '',
    '# rateprofile 0',
    '#set throttle_limit_percent = 100',
    'set throttle_limit_percent = 80',
    '',
    '# restore original rateprofile selection',
    'rateprofile 0',
  ].join('\r\n')
  const withDiff = (): SetupSnapshot => ({ ...allGood(), external: externalOnly(parseDiff(DIFF)) })

  it('lists what no tab manages, resettable where the CLI can put the default back', () => {
    const snapshot = withDiff()
    expect(externalChanges(snapshot, readSetup(snapshot))).toEqual([
      {
        section: 'name',
        key: null,
        label: 'name',
        name: 'name',
        value: 'Whoop',
        defaultValue: '-',
        reset: false,
      },
      {
        section: 'led',
        key: null,
        label: 'led 0 0,0::C:2',
        name: 'led 0 0,0::C:2',
        value: null,
        defaultValue: null,
        reset: false,
      },
      {
        section: 'master',
        key: 'master: crashflip_motor_percent',
        label: 'crashflip_motor_percent',
        name: 'crashflip_motor_percent',
        value: '50',
        defaultValue: '0',
        reset: false,
      },
      {
        section: 'profile 1',
        key: 'profile 1: anti_gravity_gain',
        label: 'anti_gravity_gain',
        name: 'anti_gravity_gain',
        value: '100',
        defaultValue: '80',
        reset: false,
      },
      {
        section: 'rateprofile 0',
        key: 'rateprofile 0: throttle_limit_percent',
        label: 'throttle_limit_percent',
        name: 'throttle_limit_percent',
        value: '80',
        defaultValue: '100',
        reset: false,
      },
    ])
  })

  it('lists nothing without a diff', () => {
    expect(externalChanges(allGood(), readSetup(allGood()))).toEqual([])
    expect(resetScript(allGood(), readSetup(allGood()))).toEqual([])
  })

  it('marks resets in the draft and turns them into CLI lines, profile switches restored', () => {
    const snapshot = withDiff()
    let draft = withReset(readSetup(snapshot), 'profile 1: anti_gravity_gain', true)
    expect(externalChanges(snapshot, draft).map((change) => change.reset)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ])
    expect(resetScript(snapshot, draft)).toEqual([
      'profile 1',
      'set anti_gravity_gain = 80',
      'profile 0',
    ])

    draft = withAllResets(snapshot, draft)
    expect(draft.resets).toEqual([
      'master: crashflip_motor_percent',
      'profile 1: anti_gravity_gain',
      'rateprofile 0: throttle_limit_percent',
    ])
    expect(resetScript(snapshot, draft)).toEqual([
      'set crashflip_motor_percent = 0',
      'profile 1',
      'set anti_gravity_gain = 80',
      'rateprofile 0',
      'set throttle_limit_percent = 100',
      'profile 0',
      'rateprofile 0',
    ])

    draft = withReset(draft, 'profile 1: anti_gravity_gain', false)
    expect(draft.resets).toEqual([
      'master: crashflip_motor_percent',
      'rateprofile 0: throttle_limit_percent',
    ])
    expect(withReset(draft, 'master: crashflip_motor_percent', true).resets).toEqual(draft.resets)
  })

  it('reads the mock FC: two settings changed in Betaflight Configurator; its features and the app-managed setup do not count', async () => {
    const { client } = await connect(new MockFlightController())
    const snapshot = await readSetupSnapshot(client)
    expect(snapshot.externalError).toBeNull()
    expect(
      externalChanges(snapshot, readSetup(snapshot)).map((change) => [
        change.name,
        change.defaultValue,
        change.value,
      ]),
    ).toEqual([
      ['crashflip_motor_percent', '0', '50'],
      ['osd_units', 'METRIC', 'IMPERIAL'],
    ])
  })

  it('resets one setting on the mock FC and leaves the others, across a reboot', async () => {
    const fc = new MockFlightController()
    const { transport, client } = await connect(fc)
    const snapshot = await readSetupSnapshot(client)
    await saveSetup(client, snapshot, withReset(readSetup(snapshot), 'master: osd_units', true))
    const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
    await sendReboot(client)
    await dropped

    const after = await readSetupSnapshot((await connect(fc)).client)
    expect(externalChanges(after, readSetup(after)).map((change) => change.label)).toEqual([
      'crashflip_motor_percent',
    ])
    const before = defaultMockConfig()
    expect(fc.savedConfig).toEqual({
      ...before,
      settings: { ...before.settings, osd_units: 'METRIC' },
    })
  })

  it('resets a profile setting through the profile switch, and everything with Reset all', async () => {
    const config = defaultMockConfig()
    config.settings.anti_gravity_gain = '100'
    const fc = new MockFlightController({ config })
    const { client } = await connect(fc)
    const snapshot = await readSetupSnapshot(client)
    const draft = withAllResets(snapshot, readSetup(snapshot))
    expect(resetScript(snapshot, draft)).toEqual([
      'set crashflip_motor_percent = 0',
      'set osd_units = METRIC',
      'profile 0',
      'set anti_gravity_gain = 80',
      'profile 0',
    ])
    await saveSetup(client, snapshot, draft)
    expect(fc.savedConfig.settings).toEqual({
      ...config.settings,
      crashflip_motor_percent: '0',
      osd_units: 'METRIC',
      anti_gravity_gain: '80',
    })
    expect(fc.savedConfig.features).toBe(config.features)
    // the link is back to MSP
    expect((await readFcInfo(client)).variant).toBe('BTFL')
  })

  it('goes on without the CLI (the FC ignores the STX while armed) and says so', async () => {
    const inner = new MockTransport(new MockFlightController(), 0)
    // An armed FC doesn't answer the STX; MSP keeps working.
    const armed: Transport = {
      label: inner.label,
      open: () => inner.open(),
      close: () => inner.close(),
      write: (data) => (data[0] === 0x02 ? Promise.resolve() : inner.write(data)),
      onData: (listener) => inner.onData(listener),
      onClose: (listener) => inner.onClose(listener),
    }
    await armed.open()
    const snapshot = await readSetupSnapshot(new MspClient(armed))
    expect(snapshot.external).toBeNull()
    expect(snapshot.externalError).toContain('did not start its command line')
    expect(preflightChecks(snapshot, readSetup(snapshot))).toHaveLength(5)
    expect(externalChanges(snapshot, readSetup(snapshot))).toEqual([])
  })
})
