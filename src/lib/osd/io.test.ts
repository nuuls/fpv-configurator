import { describe, expect, it } from 'vitest'
import { defaultMockConfig, MockFlightController } from '@/lib/mock-fc/mockFc'
import { sendReboot } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { MockTransport } from '@/lib/transport/mock'
import { readOsdSnapshot, saveOsd } from './io'
import { decodePosition, otherVisibleElements, setElementCell, setElementShown, toDraft, VIDEO_SYSTEM } from './model'

async function connect(fc = new MockFlightController()) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { fc, transport, client: new MspClient(transport) }
}

describe('OSD against the mock FC', () => {
  it('reads the elements and the SD canvas', async () => {
    const { client } = await connect()
    const snapshot = await readOsdSnapshot(client)
    expect(snapshot.config).toMatchObject({ supported: true, deviceDetected: true, videoSystem: VIDEO_SYSTEM.AUTO })
    expect(snapshot.canvas).toEqual({ cols: 30, rows: 16 })
    expect(toDraft(snapshot).elements.filter((el) => el.shown)).toEqual([
      { index: 22, x: 1, y: 14, shown: true },
      { index: 21, x: 9, y: 10, shown: true },
    ])
    expect(otherVisibleElements(snapshot)).toEqual([2])
  })

  it('reads the HD canvas when the video system is HD', async () => {
    const config = defaultMockConfig()
    config.settings['vcd_video_system'] = 'HD'
    const { client } = await connect(new MockFlightController({ config }))
    expect((await readOsdSnapshot(client)).canvas).toEqual({ cols: 53, rows: 20 })
  })

  it('saves elements persistently and leaves the others alone', async () => {
    const { fc, transport, client } = await connect()
    const snapshot = await readOsdSnapshot(client)
    let draft = setElementShown(toDraft(snapshot), 6, true, snapshot.canvas)
    draft = setElementCell(draft, 21, { x: 8, y: 11 })
    await saveOsd(client, snapshot, draft)

    const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
    await sendReboot(client)
    await dropped
    const after = await readOsdSnapshot((await connect(fc)).client)
    expect(toDraft(after).elements.filter((el) => el.shown)).toEqual([
      { index: 22, x: 1, y: 14, shown: true },
      { index: 21, x: 8, y: 11, shown: true },
      { index: 6, x: 24, y: 1, shown: true },
    ])
    expect(otherVisibleElements(after)).toEqual([2])
    expect(fc.savedConfig.osd.timers).toEqual(defaultMockConfig().osd.timers)
  })

  it('hides other elements and fixes the timer source when asked to', async () => {
    const config = defaultMockConfig()
    config.osd.timers[1] = 0x0a00 // counts "on" time
    const { fc, client } = await connect(new MockFlightController({ config }))
    const snapshot = await readOsdSnapshot(client)
    await saveOsd(client, snapshot, { ...setElementShown(toDraft(snapshot), 6, true, snapshot.canvas), hideOthers: true })
    expect(decodePosition(fc.savedConfig.osd.positions[2] ?? 0)).toEqual({ x: 13, y: 6, profiles: 0, variant: 0 })
    expect(fc.savedConfig.osd.timers).toEqual([0x0a00, 0x0a01])
  })

  it('mock rejects unknown elements and the general settings', async () => {
    const { client } = await connect()
    await expect(client.request(MSP.SET_OSD_CONFIG, Uint8Array.of(200, 0, 0, 1))).rejects.toThrow()
    await expect(client.request(MSP.SET_OSD_CONFIG, Uint8Array.of(0xff, 3, 0, 20, 0, 0, 0, 0, 0, 0))).rejects.toThrow()
  })
})
