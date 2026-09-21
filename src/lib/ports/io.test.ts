import { describe, expect, it } from 'vitest'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { sendReboot, writeSetting } from '@/lib/msp/api'
import { MspClient, MspErrorResponse } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { MockTransport } from '@/lib/transport/mock'
import { applyPortsPlan, readPortsSnapshot } from './io'
import { planWrites, PORT_FUNCTION, readAssignments } from './model'

async function connect(fc: MockFlightController) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { transport, client: new MspClient(transport) }
}

const closed = (transport: MockTransport) => new Promise<void>((resolve) => transport.onClose(resolve))

describe('ports I/O against the mock FC', () => {
  it('reads the snapshot', async () => {
    const { client } = await connect(new MockFlightController())
    const snapshot = await readPortsSnapshot(client)
    expect(snapshot.ports.map((p) => p.identifier)).toEqual([20, 51, 52, 53, 54, 55, 56])
    expect(snapshot.serialRxProvider).toBe(9)
    expect(readAssignments(snapshot).receiver).toEqual({ type: 'crsf', port: 52 })
  })

  it('applies a plan, which survives a reboot', async () => {
    const fc = new MockFlightController()
    const { client, transport } = await connect(fc)
    const snapshot = await readPortsSnapshot(client)

    await applyPortsPlan(client, planWrites(snapshot, { ...readAssignments(snapshot), vtx: { type: 'msp', port: 51 } }))
    const dropped = closed(transport)
    await sendReboot(client)
    await dropped

    const after = await readPortsSnapshot((await connect(fc)).client)
    expect(readAssignments(after).vtx).toEqual({ type: 'msp', port: 51 })
    expect(fc.savedConfig.settings).toMatchObject({ osd_displayport_device: 'MSP', vcd_video_system: 'HD' })
    // untouched: USB keeps MSP, UART3 keeps ESC telemetry
    expect(after.ports[0]?.functionMask).toBe(PORT_FUNCTION.MSP)
    expect(after.ports[3]?.functionMask).toBe(PORT_FUNCTION.ESC_SENSOR)
  })

  it('loses writes that were not saved to EEPROM before the reboot', async () => {
    const fc = new MockFlightController()
    const { client, transport } = await connect(fc)
    await writeSetting(client, 'serialrx_provider', 'SBUS')
    expect((await readPortsSnapshot(client)).serialRxProvider).toBe(2)

    const dropped = closed(transport)
    await sendReboot(client)
    await dropped
    expect((await readPortsSnapshot((await connect(fc)).client)).serialRxProvider).toBe(9)
  })

  it('mirrors Betaflight 2026.6: CLI_SETTING reads and unknown names are refused', async () => {
    const { client } = await connect(new MockFlightController())
    const read = Uint8Array.from('serialrx_provider', (c) => c.charCodeAt(0))
    await expect(client.request(MSP.CLI_SETTING, read)).rejects.toBeInstanceOf(MspErrorResponse)
    await expect(writeSetting(client, 'no_such_setting', '1')).rejects.toBeInstanceOf(MspErrorResponse)
  })
})
