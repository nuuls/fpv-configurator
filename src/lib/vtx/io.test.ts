import { describe, expect, it } from 'vitest'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { sendReboot } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { MockTransport } from '@/lib/transport/mock'
import { readVtxSnapshot, saveVtx } from './io'
import { applyTable, encodeVtxBand, readVtx } from './model'
import { findPreset } from './presets'

async function connect(fc = new MockFlightController()) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { fc, transport, client: new MspClient(transport) }
}

async function rebootAndReconnect(
  fc: MockFlightController,
  transport: MockTransport,
  client: MspClient,
) {
  const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
  await sendReboot(client)
  await dropped
  return (await connect(fc)).client
}

function tableOf(presetId: string) {
  const preset = findPreset(presetId)
  if (!preset) throw new Error(`no preset ${presetId}`)
  return preset.table
}

describe('VTX I/O against the mock FC', () => {
  it('reads a fresh FC: Betaflight defaults and an empty table', async () => {
    const { client } = await connect()
    const snapshot = await readVtxSnapshot(client)
    expect(snapshot.config).toMatchObject({
      band: 4,
      channel: 1,
      power: 1,
      frequency: 5740,
      tableAvailable: true,
      bands: 0,
    })
    expect(snapshot.table).toEqual({ bands: [], powerLevels: [] })
  })

  it('saves a preset table persistently and reads it back unchanged', async () => {
    const { fc, transport, client } = await connect()
    const snapshot = await readVtxSnapshot(client)
    const table = tableOf('geprc-maten-5-8g-2-5w-vtx-pro') // 7 bands, 5 power levels
    await saveVtx(client, snapshot, {
      ...applyTable(readVtx(snapshot), table),
      band: 5,
      channel: 3,
      power: 2,
    })

    const after = await readVtxSnapshot(await rebootAndReconnect(fc, transport, client))
    expect(after.table).toEqual(table)
    expect(after.config).toMatchObject({
      band: 5,
      channel: 3,
      power: 2,
      frequency: 5732,
      bands: 7,
      channels: 8,
      powerLevels: 5,
    })
  })

  it('replaces a bigger table with a smaller one, and changes only the channel without touching the table', async () => {
    const { fc, client } = await connect()
    const fresh = await readVtxSnapshot(client)
    await saveVtx(
      client,
      fresh,
      applyTable(readVtx(fresh), tableOf('geprc-maten-5-8g-2-5w-vtx-pro')),
    )

    const big = await readVtxSnapshot(client)
    const small = tableOf('emax-nanohawk-1s') // 5 bands, 1 power level
    await saveVtx(client, big, applyTable(readVtx(big), small))
    const replaced = await readVtxSnapshot(client)
    expect(replaced.table).toEqual(small)

    await saveVtx(client, replaced, { ...readVtx(replaced), band: 1, channel: 8 })
    const after = await readVtxSnapshot(client)
    expect(after.table).toEqual(small)
    expect(after.config).toMatchObject({ band: 1, channel: 8, frequency: 5725 })
    expect(fc.savedConfig.vtx).toMatchObject({
      band: 1,
      channel: 8,
      bandCount: 5,
      powerLevelCount: 1,
    })
  })

  it('rejects table entries beyond the configured size, like the firmware', async () => {
    const { client } = await connect()
    const band = tableOf('emax-nanohawk-1s').bands[0]
    if (!band) throw new Error('preset without bands')
    await expect(client.request(MSP.SET_VTXTABLE_BAND, encodeVtxBand(1, band))).rejects.toThrow()
  })
})
