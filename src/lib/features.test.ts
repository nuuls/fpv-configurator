/** Model + I/O tests for the Blackbox, Orientation, Modes, PID tuning and Motors features, against the mock FC. */
import { describe, expect, it } from 'vitest'
import { eraseDataflash, readBlackboxSnapshot, saveBlackboxConfig } from '@/lib/blackbox/io'
import { BLACKBOX_DEVICE, formatBytes, sampleRateLabel } from '@/lib/blackbox/model'
import { defaultMockConfig, MockFlightController } from '@/lib/mock-fc/mockFc'
import { readModesSnapshot, saveModes } from '@/lib/modes/io'
import { isRangeActive, planModeWrites, readModes, validateModes, type ModesSnapshot } from '@/lib/modes/model'
import {
  readMotorsSnapshot,
  readMotorTelemetry,
  saveMotors,
  setArmingDisabled,
  setMotorOutputs,
  stopMotors,
} from '@/lib/motors/io'
import { dynIdleSegments, dynIdleZone, readMotors, spinsClockwise, validateMotors } from '@/lib/motors/model'
import { sendReboot, sendRebootToMassStorage } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { calibrateAccelerometer, readBoardAlignment, saveBoardAlignment } from '@/lib/orientation/io'
import { alignmentOptions, decodeBoardAlignment, encodeBoardAlignment } from '@/lib/orientation/model'
import { MockTransport } from '@/lib/transport/mock'
import { previewPids, readTuningSnapshot, saveTuning } from '@/lib/tuning/io'
import { buildSimplifiedTuning, hasHiddenTuning, readTuning, smoothingWrites, type TuningSnapshot } from '@/lib/tuning/model'

async function connect(fc = new MockFlightController()) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { fc, transport, client: new MspClient(transport) }
}

async function rebootAndReconnect(fc: MockFlightController, transport: MockTransport, client: MspClient) {
  const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
  await sendReboot(client)
  await dropped
  return (await connect(fc)).client
}

describe('blackbox', () => {
  it('formats rates and sizes', () => {
    expect(sampleRateLabel(1, 125)).toBe('1/2 (4 kHz)')
    expect(sampleRateLabel(4, 125)).toBe('1/16 (500 Hz)')
    expect(sampleRateLabel(2, 0)).toBe('1/4')
    expect(formatBytes(16_777_216)).toBe('16.0 MB')
  })

  it('reads config and storage, and saves persistently', async () => {
    const { fc, transport, client } = await connect()
    const snapshot = await readBlackboxSnapshot(client)
    expect(snapshot.config).toMatchObject({ supported: true, device: BLACKBOX_DEVICE.FLASH, sampleRate: 1 })
    expect(snapshot.flash).toMatchObject({ supported: true, ready: true, totalBytes: 16_777_216 })
    expect(snapshot.sdcard.supported).toBe(false)
    expect(snapshot.cycleTimeUs).toBe(125)

    await saveBlackboxConfig(client, { ...snapshot.config, device: BLACKBOX_DEVICE.NONE, sampleRate: 3 })
    const after = await readBlackboxSnapshot(await rebootAndReconnect(fc, transport, client))
    expect(after.config).toMatchObject({ device: BLACKBOX_DEVICE.NONE, sampleRate: 3 })
  })

  it('erases the flash and waits until it is ready again', async () => {
    const { client } = await connect()
    const summary = await eraseDataflash(client, 50)
    expect(summary).toMatchObject({ ready: true, usedBytes: 0 })
  })

  it('reboots into mass storage mode', async () => {
    const { client } = await connect()
    await expect(sendRebootToMassStorage(client)).resolves.toBeUndefined()
  })
})

describe('orientation', () => {
  it('normalises negative degrees and offers non-45° values the FC already has', () => {
    expect(decodeBoardAlignment(encodeBoardAlignment({ roll: -90, pitch: 0, yaw: 450 }))).toEqual({ roll: 270, pitch: 0, yaw: 90 })
    expect(alignmentOptions(90)).toHaveLength(8)
    expect(alignmentOptions(10)).toEqual([0, 10, 45, 90, 135, 180, 225, 270, 315])
  })

  it('saves persistently', async () => {
    const { fc, transport, client } = await connect()
    expect(await readBoardAlignment(client)).toEqual({ roll: 0, pitch: 0, yaw: 0 })
    await saveBoardAlignment(client, { roll: 180, pitch: 0, yaw: 45 })
    expect(await readBoardAlignment(await rebootAndReconnect(fc, transport, client))).toEqual({ roll: 180, pitch: 0, yaw: 45 })
  })

  it('calibrates the accelerometer', async () => {
    const { fc, client } = await connect()
    await calibrateAccelerometer(client, 0)
    expect(fc.accCalibrationCount).toBe(1)
  })
})

describe('modes', () => {
  const snapshot: ModesSnapshot = { slots: defaultMockConfig().modeSlots, boxIds: [0, 1, 13, 27, 35] }

  it('reads managed modes only', () => {
    expect(readModes(snapshot)).toEqual([
      { boxId: 0, ranges: [{ auxChannel: 0, start: 1700, end: 2100 }] },
      { boxId: 1, ranges: [] },
      { boxId: 35, ranges: [] },
      { boxId: 13, ranges: [] },
    ])
  })

  it('hides modes the firmware build does not offer', () => {
    expect(readModes({ ...snapshot, boxIds: [0, 1] }).map((m) => m.boxId)).toEqual([0, 1])
  })

  it('plans no writes when nothing changed', () => {
    expect(planModeWrites(snapshot, readModes(snapshot))).toEqual([])
  })

  it('adds ranges into free slots and never touches unmanaged ones', () => {
    const draft = readModes(snapshot).map((m) =>
      m.boxId === 1 ? { ...m, ranges: [{ auxChannel: 1, start: 1300, end: 1700 }] } : m,
    )
    expect(planModeWrites(snapshot, draft)).toEqual([
      { index: 2, slot: { boxId: 1, auxChannel: 1, start: 1300, end: 1700 } },
    ])
  })

  it('clears the slot of a removed range', () => {
    const draft = readModes(snapshot).map((m) => ({ ...m, ranges: [] }))
    const writes = planModeWrites(snapshot, draft)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ index: 0, slot: { start: 900, end: 900 } })
  })

  it('validates ranges and capacity', () => {
    const tooMany = readModes(snapshot).map((m) =>
      m.boxId === 1 ? { ...m, ranges: new Array(19).fill({ auxChannel: 0, start: 1000, end: 1100 }) } : m,
    )
    expect(validateModes(snapshot, tooMany)[0]).toMatch(/room for 19/)
    const inverted = readModes(snapshot).map((m) => ({ ...m, ranges: [{ auxChannel: 0, start: 1500, end: 1500 }] }))
    expect(validateModes(snapshot, inverted)).toHaveLength(1)
  })

  it('detects active ranges from live channels', () => {
    const range = { auxChannel: 1, start: 1300, end: 1700 }
    expect(isRangeActive(range, [1500, 1500, 1500, 1000, 1000, 1500])).toBe(true)
    expect(isRangeActive(range, [1500, 1500, 1500, 1000, 1000, 1800])).toBe(false)
    expect(isRangeActive(range, [])).toBe(false)
  })

  it('saves to the FC persistently, keeping the unmanaged FAILSAFE range', async () => {
    const { fc, transport, client } = await connect()
    const before = await readModesSnapshot(client)
    const draft = readModes(before).map((m) =>
      m.boxId === 35 ? { ...m, ranges: [{ auxChannel: 2, start: 1800, end: 2100 }] } : m,
    )
    await saveModes(client, before, draft)
    const after = await readModesSnapshot(await rebootAndReconnect(fc, transport, client))
    expect(readModes(after)).toEqual(draft)
    expect(after.slots[1]).toEqual(before.slots[1])
  })
})

describe('pid tuning', () => {
  const base: TuningSnapshot = { simplified: defaultMockConfig().simplifiedTuning, rcSmoothing: true, rcSmoothingAutoFactor: 30 }
  const withFf = (ff: number, patch: Partial<TuningSnapshot> = {}): TuningSnapshot => ({
    ...base,
    ...patch,
    simplified: base.simplified.map((v, i) => (i === 7 ? ff : v)),
  })

  it('detects the smoothing preset', () => {
    expect(readTuning(base).smoothing).toBe('custom') // Betaflight defaults: factor 30 with full feedforward
    expect(readTuning(withFf(50)).smoothing).toBe('strong')
    expect(readTuning(withFf(100, { rcSmoothingAutoFactor: 25 })).smoothing).toBe('light')
    expect(readTuning(withFf(100, { rcSmoothing: false })).smoothing).toBe('direct')
  })

  it('pins the hidden sliders when saving and leaves filter sliders alone', () => {
    const snapshot = withFf(100)
    snapshot.simplified[20] = 77 // a filter slider byte
    const payload = buildSimplifiedTuning(snapshot, { master: 120, damping: 90, pitch: 110, smoothing: 'strong' })
    expect([...payload.subarray(0, 9)]).toEqual([2, 120, 110, 100, 90, 100, 0, 50, 110]) // pitch → bytes 2 and 8
    expect(payload[20]).toBe(77)
    expect(payload).toHaveLength(snapshot.simplified.length)
  })

  it('keeps a custom feedforward gain unless a preset is picked', () => {
    expect(buildSimplifiedTuning(withFf(80), { master: 100, damping: 100, pitch: 100, smoothing: 'custom' })[7]).toBe(80)
  })

  it('flags default Betaflight tuning as having hidden values (Dynamic D is on)', () => {
    expect(hasHiddenTuning(base)).toBe(true)
    expect(hasHiddenTuning({ ...base, simplified: [...buildSimplifiedTuning(base, readTuning(base))] })).toBe(false)
  })

  it('reads Pitch gains from the pitch P/I/FF slider and flags a different pitch D slider as hidden', () => {
    const pinned = [...buildSimplifiedTuning(base, { ...readTuning(base), pitch: 120 })]
    expect(readTuning({ ...base, simplified: pinned }).pitch).toBe(120)
    expect(hasHiddenTuning({ ...base, simplified: pinned })).toBe(false)

    const split = pinned.map((v, i) => (i === 2 ? 90 : v)) // pitch D slider set on its own in Configurator
    expect(readTuning({ ...base, simplified: split }).pitch).toBe(120)
    expect(hasHiddenTuning({ ...base, simplified: split })).toBe(true)
  })

  it('only writes smoothing settings when the preset changes', () => {
    expect(smoothingWrites(withFf(50), { master: 100, damping: 100, pitch: 100, smoothing: 'strong' })).toEqual([])
    expect(smoothingWrites(base, { master: 100, damping: 100, pitch: 100, smoothing: 'custom' })).toEqual([])
    expect(smoothingWrites(base, { master: 100, damping: 100, pitch: 100, smoothing: 'direct' })[0]).toEqual({ name: 'rc_smoothing', value: 'OFF' })
  })

  it('previews and saves against the FC', async () => {
    const { fc, transport, client } = await connect()
    const snapshot = await readTuningSnapshot(client)
    const draft = { master: 120, damping: 100, pitch: 110, smoothing: 'light' as const }

    const pids = await previewPids(client, snapshot, draft)
    expect(pids).toHaveLength(3)
    expect(pids[0]).toMatchObject({ p: 54, d: 36, dMax: 36 }) // 45 × 1.2, Dynamic D off
    expect(pids[1]).toEqual({ p: 62, i: 111, d: 45, dMax: 45, f: 165 }) // pitch defaults 47/84/34/125 × 1.2 × 1.1
    expect(pids[2]).toMatchObject({ p: 54, f: 144 }) // yaw: master only

    expect(await saveTuning(client, snapshot, draft)).toBe(true) // smoothing changed → reboot
    const after = await readTuningSnapshot(await rebootAndReconnect(fc, transport, client))
    expect(readTuning(after)).toEqual(draft)
    expect(hasHiddenTuning(after)).toBe(false)
    expect(fc.savedConfig.settings).toMatchObject({ rc_smoothing_auto_factor: '25', rc_smoothing_auto_factor_throttle: '25' })
  })

  it('does not need a reboot for slider-only changes', async () => {
    const { client } = await connect()
    const snapshot = await readTuningSnapshot(client)
    expect(await saveTuning(client, snapshot, { ...readTuning(snapshot), damping: 110 })).toBe(false)
  })
})

describe('motors', () => {
  it('validates motor poles', () => {
    const draft = { protocol: 6, bidirDshot: false, poles: 14, propsOut: false, dynIdle: 20 }
    expect(validateMotors(draft)).toEqual([])
    expect(validateMotors({ ...draft, poles: 13 })).toHaveLength(1)
    expect(validateMotors({ ...draft, poles: 2 })).toHaveLength(1)
  })

  it('reads and saves persistently, changing only the protocol byte of the advanced config', async () => {
    const { fc, transport, client } = await connect()
    const snapshot = await readMotorsSnapshot(client)
    expect(readMotors(snapshot)).toEqual({ protocol: 6, bidirDshot: false, poles: 14, propsOut: false, dynIdle: 0 })
    expect(snapshot.motorCount).toBe(4)

    await saveMotors(client, snapshot, { protocol: 7, bidirDshot: true, poles: 12, propsOut: true, dynIdle: 0 })
    const after = await readMotorsSnapshot(await rebootAndReconnect(fc, transport, client))
    expect(readMotors(after)).toEqual({ protocol: 7, bidirDshot: true, poles: 12, propsOut: true, dynIdle: 0 })
    expect(after.advancedConfig.filter((_, i) => i !== 3)).toEqual(snapshot.advancedConfig.filter((_, i) => i !== 3))
  })

  it('never enables bidirectional DShot on a non-DShot protocol', async () => {
    const { client } = await connect()
    const snapshot = await readMotorsSnapshot(client)
    await saveMotors(client, snapshot, { protocol: 3, bidirDshot: true, poles: 14, propsOut: false, dynIdle: 0 })
    expect((await readMotorsSnapshot(client)).bidirDshot).toBe(false)
  })

  it('classifies dynamic idle for a 5" and builds contiguous track segments', () => {
    expect([12, 14, 15, 17, 18, 25, 26, 28, 29, 40].map((v) => dynIdleZone(v, 'five-inch'))).toEqual([
      'danger', 'danger', 'warning', 'warning', 'good', 'good', 'warning', 'warning', 'danger', 'danger',
    ])
    expect(dynIdleSegments('five-inch')).toEqual([
      { from: 12, to: 14, zone: 'danger' },
      { from: 15, to: 17, zone: 'warning' },
      { from: 18, to: 25, zone: 'good' },
      { from: 26, to: 28, zone: 'warning' },
      { from: 29, to: 40, zone: 'danger' },
    ])
  })

  it('accepts an untouched "off" idle from the FC but not an edited out-of-range one', async () => {
    const { client } = await connect()
    const snapshot = await readMotorsSnapshot(client)
    expect(snapshot.dynIdle).toBe(0)
    expect(validateMotors(readMotors(snapshot), snapshot)).toEqual([])
    expect(validateMotors({ ...readMotors(snapshot), dynIdle: 11 }, snapshot)).toHaveLength(1)
    expect(validateMotors({ ...readMotors(snapshot), dynIdle: 20 }, snapshot)).toEqual([])
  })

  it('saves dynamic idle persistently', async () => {
    const { fc, transport, client } = await connect()
    const snapshot = await readMotorsSnapshot(client)
    await saveMotors(client, snapshot, { ...readMotors(snapshot), dynIdle: 22 })
    expect((await readMotorsSnapshot(await rebootAndReconnect(fc, transport, client))).dynIdle).toBe(22)
  })

  it('reports RPM only with bidirectional DShot', async () => {
    const { fc, transport, client } = await connect()
    await setMotorOutputs(client, [1100, 1000, 1000, 1000])
    expect((await readMotorTelemetry(client)).map((m) => m.rpm)).toEqual([0, 0, 0, 0])

    const snapshot = await readMotorsSnapshot(client)
    await saveMotors(client, snapshot, { ...readMotors(snapshot), bidirDshot: true })
    const again = await rebootAndReconnect(fc, transport, client)
    await setMotorOutputs(again, [1100, 1000, 1000, 1000])
    const telemetry = await readMotorTelemetry(again)
    expect(telemetry.map((m) => m.rpm)).toEqual([4500, 0, 0, 0])
    expect(telemetry[0]?.invalidPercent).toBe(0)
  })

  it('knows the expected spin directions', () => {
    expect([1, 2, 3, 4].map((m) => spinsClockwise(m, false))).toEqual([true, false, false, true])
    expect([1, 2, 3, 4].map((m) => spinsClockwise(m, true))).toEqual([false, true, true, false])
  })

  it('drives and stops motors; a reboot always stops them', async () => {
    const { fc, transport, client } = await connect()
    await setArmingDisabled(client, true)
    await setMotorOutputs(client, [1100, 1000, 1000, 1000])
    expect(fc.armingDisabled).toBe(true)
    expect(fc.motorOutputs.slice(0, 4)).toEqual([1100, 1000, 1000, 1000])

    await stopMotors(client)
    expect(fc.motorOutputs.every((v) => v === 1000)).toBe(true)

    await setMotorOutputs(client, [1200, 1200, 1200, 1200])
    await rebootAndReconnect(fc, transport, client)
    expect(fc.motorOutputs.every((v) => v === 1000)).toBe(true)
    expect(fc.armingDisabled).toBe(false)
  })
})
