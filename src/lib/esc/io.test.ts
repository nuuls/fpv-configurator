import { describe, expect, it } from 'vitest'
import { defaultMockEscs, mixedMockEscs, mockAm32Esc, mockBluejayEsc, type MockEsc } from '@/lib/mock-fc/mockEscs'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { readFcInfo } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { encodeFrame, MspParser } from '@/lib/msp/codec'
import { MSP } from '@/lib/msp/codes'
import { Emitter, type Transport } from '@/lib/transport/types'
import { PassthroughStuckError, readEscs } from './io'

/** Waiting only moves the mock FC's clock, so the ESCs "boot" without the tests taking seconds. */
async function connect(escs?: MockEsc[]) {
  let clock = 0
  const sleeps: number[] = []
  const fc = new MockFlightController({ escs, now: () => clock })
  const transport = new MockTransport(fc, 0)
  await transport.open()
  const sleep = async (ms: number) => {
    sleeps.push(ms)
    clock += ms
  }
  return { fc, client: new MspClient(transport), options: { sleep }, sleeps }
}

describe('readEscs against the mock FC', () => {
  it('reads every ESC, reports progress and hands the link back to MSP', async () => {
    const { fc, client, options } = await connect(mixedMockEscs())
    const progress: string[] = []
    const reports = await readEscs(client, (index, count) => progress.push(`${index + 1}/${count}`), options)

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
    const { fc, client, options } = await connect()
    await readEscs(client, undefined, options)
    expect(fc.escPassthrough?.refusedCommands).toEqual([])
  })

  it('makes MSP requests issued meanwhile wait instead of corrupting the passthrough', async () => {
    const { client, options } = await connect()
    const [reports, info] = await Promise.all([readEscs(client, undefined, options), readFcInfo(client)])
    expect(reports).toHaveLength(4)
    expect(info.variant).toBe('BTFL')
  })

  it('reports an ESC that does not answer and still reads the others', async () => {
    const { fc, client, options } = await connect([mockBluejayEsc(), { ...mockBluejayEsc(), powered: false }, mockAm32Esc()])
    const reports = await readEscs(client, undefined, options)
    expect(reports.map((report) => report.status)).toEqual(['ok', 'missing', 'ok'])
    expect(fc.escPassthrough?.exited).toBe(true)
  })

  it('reports every ESC as missing without a battery', async () => {
    const { client, options } = await connect(defaultMockEscs().map((esc) => ({ ...esc, powered: false })))
    expect((await readEscs(client, undefined, options)).map((report) => report.status)).toEqual(['missing', 'missing', 'missing', 'missing'])
  })

  it('gives the ESCs time to reach their bootloader before it asks for them', async () => {
    const { client, options, sleeps } = await connect()
    const reports = await readEscs(client, undefined, options)
    expect(reports.map((report) => report.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    // One wait after the passthrough started; ESCs that are ready answer the first cmd_DeviceInitFlash.
    expect(sleeps).toEqual([1200])
  })

  it('keeps asking an ESC that takes longer to boot (startup tune), with pauses in between', async () => {
    const { client, options, sleeps } = await connect([{ ...mockBluejayEsc(), bootMs: 1800 }, mockBluejayEsc()])
    const reports = await readEscs(client, undefined, options)
    expect(reports.map((report) => report.status)).toEqual(['ok', 'ok'])
    expect(sleeps).toEqual([1200, 250, 250, 250])
  })

  it('gives up on an ESC that never reaches its bootloader', async () => {
    const { fc, client, options } = await connect([{ ...mockBluejayEsc(), bootMs: 60_000 }, mockBluejayEsc()])
    const reports = await readEscs(client, undefined, options)
    expect(reports.map((report) => report.status)).toEqual(['missing', 'ok'])
    expect(fc.escPassthrough?.exited).toBe(true)
  })

  it('describes ESCs it cannot read instead of failing', async () => {
    const blheli32: MockEsc = { ...mockAm32Esc(), bootByte: 0x64 }
    const { fc, client, options } = await connect([blheli32, { ...mockAm32Esc(), flash: { 0x7c00: mockAm32Esc().flash[0x7c00] ?? [] } }])
    const [unsupported, withoutFileName] = await readEscs(client, undefined, options)
    expect(unsupported).toMatchObject({ status: 'unknown', description: expect.stringContaining('BLHeli_32') })
    // The file name read failed (ack error) — the settings are still shown.
    expect(withoutFileName).toMatchObject({ status: 'ok', firmware: 'AM32', hardware: 'ARM, 32 k flash' })
    expect(fc.escPassthrough?.exited).toBe(true)
  })

  it('leaves the passthrough again when the FC has no ESC outputs', async () => {
    const { fc, client, options, sleeps } = await connect([])
    expect(await readEscs(client, undefined, options)).toEqual([])
    expect(sleeps).toEqual([])
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
    await expect(readEscs(new MspClient(transport), undefined, { timeoutMs: 10 })).rejects.toBeInstanceOf(PassthroughStuckError)
  })
})
