import { describe, expect, it } from 'vitest'
import { defaultMockEscs, mockAm32Esc, mockBluejayEsc, type MockEsc } from '@/lib/mock-fc/mockEscs'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { readFcInfo } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { encodeFrame, MspParser } from '@/lib/msp/codec'
import { MSP } from '@/lib/msp/codes'
import { Emitter, type Transport } from '@/lib/transport/types'
import { PassthroughStuckError, readEscs } from './io'

async function connect(escs?: MockEsc[]) {
  const fc = new MockFlightController({ escs })
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { fc, client: new MspClient(transport) }
}

describe('readEscs against the mock FC', () => {
  it('reads every ESC, reports progress and hands the link back to MSP', async () => {
    const { fc, client } = await connect()
    const progress: string[] = []
    const reports = await readEscs(client, (index, count) => progress.push(`${index + 1}/${count}`))

    expect(reports.map((report) => (report.status === 'ok' ? `${report.firmware} ${report.version}` : report.status))).toEqual([
      'Bluejay 0.21.0',
      'Bluejay 0.21.0',
      'BLHeli_S 16.7',
      'AM32 2.18',
    ])
    expect(progress).toEqual(['1/4', '2/4', '3/4', '4/4'])
    expect(fc.escPassthrough?.exited).toBe(true)
    expect((await readFcInfo(client)).variant).toBe('BTFL')
  })

  it('never sends a write, erase or verify command', async () => {
    const { fc, client } = await connect()
    await readEscs(client)
    expect(fc.escPassthrough?.refusedCommands).toEqual([])
  })

  it('makes MSP requests issued meanwhile wait instead of corrupting the passthrough', async () => {
    const { client } = await connect()
    const [reports, info] = await Promise.all([readEscs(client), readFcInfo(client)])
    expect(reports).toHaveLength(4)
    expect(info.variant).toBe('BTFL')
  })

  it('reports an ESC that does not answer and still reads the others', async () => {
    const { fc, client } = await connect([mockBluejayEsc(), { ...mockBluejayEsc(), powered: false }, mockAm32Esc()])
    const reports = await readEscs(client)
    expect(reports.map((report) => report.status)).toEqual(['ok', 'missing', 'ok'])
    expect(fc.escPassthrough?.exited).toBe(true)
  })

  it('reports every ESC as missing without a battery', async () => {
    const { client } = await connect(defaultMockEscs().map((esc) => ({ ...esc, powered: false })))
    expect((await readEscs(client)).map((report) => report.status)).toEqual(['missing', 'missing', 'missing', 'missing'])
  })

  it('describes ESCs it cannot read instead of failing', async () => {
    const blheli32: MockEsc = { ...mockAm32Esc(), bootByte: 0x64 }
    const { fc, client } = await connect([blheli32, { ...mockAm32Esc(), flash: { 0x7c00: mockAm32Esc().flash[0x7c00] ?? [] } }])
    const [unsupported, withoutFileName] = await readEscs(client)
    expect(unsupported).toMatchObject({ status: 'unknown', description: expect.stringContaining('BLHeli_32') })
    // The file name read failed (ack error) — the settings are still shown.
    expect(withoutFileName).toMatchObject({ status: 'ok', firmware: 'AM32', hardware: 'ARM, 32 k flash' })
    expect(fc.escPassthrough?.exited).toBe(true)
  })

  it('leaves the passthrough again when the FC has no ESC outputs', async () => {
    const { fc, client } = await connect([])
    expect(await readEscs(client)).toEqual([])
    expect(fc.escPassthrough?.exited).toBe(true)
    expect((await readFcInfo(client)).variant).toBe('BTFL')
  })

  it('says so when the FC does not come back from the passthrough', async () => {
    // An FC that acknowledges MSP_SET_PASSTHROUGH and then never answers a 4-way frame.
    const data = new Emitter<Uint8Array>()
    const parser = new MspParser((frame) => {
      if (frame.code !== MSP.SET_PASSTHROUGH) return
      data.emit(encodeFrame({ version: frame.version, direction: 'response', code: frame.code, payload: Uint8Array.of(0) }))
    })
    const transport: Transport = {
      label: 'stuck',
      open: async () => {},
      close: async () => {},
      write: async (bytes) => parser.push(bytes),
      onData: (listener) => data.on(listener),
      onClose: () => () => {},
    }
    await expect(readEscs(new MspClient(transport), undefined, 10)).rejects.toBeInstanceOf(PassthroughStuckError)
  })
})
