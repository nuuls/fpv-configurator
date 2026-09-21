import { describe, expect, it } from 'vitest'
import { defaultMockConfig, MockFlightController } from '@/lib/mock-fc/mockFc'
import { readFcInfo, readStatus, sendReboot } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { FEATURE } from '@/lib/msp/messages'
import { calibrateAccelerometer } from '@/lib/orientation/io'
import { MockTransport } from '@/lib/transport/mock'
import { readSetupSnapshot, saveSetup } from './io'
import {
  applyFix,
  BEEPER_OFF,
  encodeSetAdvancedConfig,
  encodeSetArmingConfig,
  encodeSetBeeperConfig,
  formatLoopRate,
  pidLoopOptions,
  preflightChecks,
  readSetup,
  withAirmode,
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
  beeperConfig: [0, 0, 0, 0, 1, 0x02, 0x02, 0, 0],
  features: FEATURE.AIRMODE | FEATURE.OSD,
  bidirDshot: true,
  hasAccelerometer: true,
  accCalibrated: true,
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
    expect([8000, 4000, 3200, 6664].map(formatLoopRate)).toEqual(['8 kHz', '4 kHz', '3.2 kHz', '6.7 kHz'])
  })

  it('patches only pid_process_denom into MSP_SET_ADVANCED_CONFIG', () => {
    const snapshot = allGood()
    expect(readSetup(snapshot).pidDenom).toBe(1)
    expect([...encodeSetAdvancedConfig(snapshot, { ...readSetup(snapshot), pidDenom: 2 })]).toEqual([1, 2, 0, 6, 0xe0, 0x01])
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
    expect(checks.map((check) => check.id)).toEqual(['bidirDshot', 'accCalibrated', 'armAngle', 'beeper', 'airmode'])
    expect(checks.every((check) => check.ok && !check.pending && check.fix === null)).toBe(true)
  })

  it('sends bidirectional DShot and the accelerometer to their own tabs', () => {
    const checks = preflightChecks({ ...allGood(), bidirDshot: false, accCalibrated: false }, readSetup(allGood()))
    expect(checks.filter((check) => !check.ok).map((check) => check.fix)).toEqual([
      { path: '/motors', tab: 'Motors' },
      { path: '/orientation', tab: 'Orientation' },
    ])
  })

  it('cannot fix a missing accelerometer', () => {
    const [, acc] = preflightChecks({ ...allGood(), hasAccelerometer: false, accCalibrated: false }, readSetup(allGood()))
    expect(acc).toMatchObject({ ok: false, detail: 'No accelerometer', fix: null })
  })

  it('wants an arm angle of exactly 180', () => {
    const snapshot = { ...allGood(), armingConfig: [5, 0, 25, 0] }
    expect(failing(snapshot)).toEqual(['armAngle'])
    expect(preflightChecks(snapshot, readSetup(snapshot))[2]).toMatchObject({ detail: '25°', fix: 'here' })
  })

  it('wants the beeper on for RX set and RX loss, whatever else is muted', () => {
    const beeper = (flags: number) => ({ ...allGood(), beeperConfig: [flags & 0xff, flags >> 8, 0, 0, 1, 0, 0, 0, 0] })
    expect(failing(beeper(1 << 3))).toEqual([]) // only "disarming" is muted
    expect(failing(beeper(BEEPER_OFF.RX_SET))).toEqual(['beeper'])
    const both = beeper(BEEPER_OFF.RX_SET | BEEPER_OFF.RX_LOST)
    expect(preflightChecks(both, readSetup(both))[3]?.detail).toBe('Off for RX set and RX loss')
    // the DShot beacon flags are not the beeper
    expect(failing({ ...allGood(), beeperConfig: [0, 0, 0, 0, 1, 0x02, 0x02, 0, 0] })).toEqual([])
  })

  it('reports a firmware without beeper config instead of offering a fix', () => {
    const snapshot = { ...allGood(), beeperConfig: null }
    expect(readSetup(snapshot).beeperOffFlags).toBeNull()
    expect(preflightChecks(snapshot, readSetup(snapshot))[3]).toMatchObject({ ok: false, fix: null, detail: 'No beeper support' })
    expect(applyFix(readSetup(snapshot), 'beeper')).toEqual(readSetup(snapshot))
  })

  it('wants the airmode feature', () => {
    expect(failing({ ...allGood(), features: FEATURE.OSD })).toEqual(['airmode'])
  })

  it('a fix passes the check, marked as pending until saved', () => {
    const snapshot = { ...allGood(), armingConfig: [5, 0, 25, 0], beeperConfig: [0x0a, 0x02, 0, 0, 1, 0, 0, 0, 0], features: 0 }
    let draft = readSetup(snapshot)
    for (const id of failing(snapshot)) draft = applyFix(draft, id)
    // 0x0a = disarming + RX loss muted: only the RX bits are cleared
    expect(draft).toEqual({ pidDenom: 1, armAngle: 180, beeperOffFlags: 1 << 3, airmode: true })
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

  it('patches only small_angle, beeper_off_flags and the airmode bit', () => {
    const snapshot = { ...allGood(), armingConfig: [5, 0, 25, 1] }
    expect([...encodeSetArmingConfig(snapshot, 180)]).toEqual([5, 0, 180, 1])
    expect([...encodeSetBeeperConfig([0x0a, 0x02, 0, 0, 3, 0x02, 0x02, 0, 0], 1 << 3)]).toEqual([0x08, 0, 0, 0, 3, 0x02, 0x02, 0, 0])
    expect(withAirmode(FEATURE.OSD, true)).toBe(FEATURE.OSD | FEATURE.AIRMODE)
    expect(withAirmode(0x80000000 | FEATURE.AIRMODE, false)).toBe(0x80000000)
  })

  it('reads the mock FC, fixes it and keeps the fixes across a reboot', async () => {
    const fc = new MockFlightController()
    const { transport, client } = await connect(fc)
    const snapshot = await readSetupSnapshot(client)
    // the mock: DShot telemetry off, never calibrated, arm angle 25, RX set beep muted, airmode on
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
    expect(fc.savedConfig.beeperConfig).toEqual(before.beeperConfig.with(1, 0))
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
