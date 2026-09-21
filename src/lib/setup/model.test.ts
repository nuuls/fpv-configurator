import { describe, expect, it } from 'vitest'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { readFcInfo, readStatus, sendReboot } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { readSetupSnapshot, saveSetup } from './io'
import { encodeSetAdvancedConfig, formatLoopRate, pidLoopOptions, readSetup } from './model'

async function connect(fc: MockFlightController) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { transport, client: new MspClient(transport) }
}

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
    const snapshot = { advancedConfig: [1, 1, 0, 6, 0xe0, 0x01] }
    expect(readSetup(snapshot)).toEqual({ pidDenom: 1 })
    expect([...encodeSetAdvancedConfig(snapshot, { pidDenom: 2 })]).toEqual([1, 2, 0, 6, 0xe0, 0x01])
  })

  it('saves to the mock FC across a reboot', async () => {
    const fc = new MockFlightController()
    const { transport, client } = await connect(fc)
    expect((await readFcInfo(client)).board.gyroSampleRateHz).toBe(8000)

    const snapshot = await readSetupSnapshot(client)
    await saveSetup(client, snapshot, { pidDenom: 2 })
    const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
    await sendReboot(client)
    await dropped

    const after = (await connect(fc)).client
    expect(readSetup(await readSetupSnapshot(after))).toEqual({ pidDenom: 2 })
    expect((await readStatus(after)).cycleTimeUs).toBe(250)
    // everything but the denominator is untouched
    expect(fc.savedConfig.advancedConfig).toEqual(snapshot.advancedConfig.with(1, 2))
  })

  it('reports a 3.2 kHz gyro', async () => {
    const { client } = await connect(new MockFlightController({ gyroSampleRateHz: 3200 }))
    expect((await readFcInfo(client)).board.gyroSampleRateHz).toBe(3200)
  })
})
