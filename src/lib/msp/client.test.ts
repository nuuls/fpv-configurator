import { describe, expect, it } from 'vitest'
import { MockTransport } from '@/lib/transport/mock'
import { Emitter, type Transport } from '@/lib/transport/types'
import { readAttitude, readFcInfo } from './api'
import { MspClient, MspDisconnectedError, MspErrorResponse, MspTimeoutError } from './client'
import { encodeV1 } from './codec'
import { MSP } from './codes'

/** Transport double: records writes, lets the test inject incoming bytes. */
class FakeTransport implements Transport {
  readonly label = 'fake'
  readonly written: Uint8Array[] = []
  private readonly data = new Emitter<Uint8Array>()
  private readonly closed = new Emitter<void>()

  async open() {}
  async close() {
    this.closed.emit()
  }
  async write(data: Uint8Array) {
    this.written.push(data)
  }
  onData(listener: (chunk: Uint8Array) => void) {
    return this.data.on(listener)
  }
  onClose(listener: () => void) {
    return this.closed.on(listener)
  }
  receive(chunk: Uint8Array) {
    this.data.emit(chunk)
  }
}

/** Lets queued microtasks (the client's request queue) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function openMock() {
  const transport = new MockTransport(undefined, 0)
  await transport.open()
  return { transport, client: new MspClient(transport) }
}

describe('MspClient with the mock flight controller', () => {
  it('performs the identification handshake', async () => {
    const { client } = await openMock()
    const info = await readFcInfo(client)
    expect(info.variant).toBe('BTFL')
    expect(info.apiVersion).toEqual({ protocolVersion: 0, major: 1, minor: 48 })
    expect(info.version.versionString).toBe('2026.6.2')
    expect(info.board.boardName).toBe('MOCKF405')
  })

  it('resolves concurrent requests in call order', async () => {
    const { client } = await openMock()
    const [variant, attitude, version] = await Promise.all([
      client.request(MSP.FC_VARIANT),
      readAttitude(client),
      client.request(MSP.FC_VERSION),
    ])
    expect(variant).toHaveLength(4)
    expect(Math.abs(attitude.roll)).toBeLessThanOrEqual(25)
    expect(version.length).toBeGreaterThanOrEqual(3)
  })

  it('rejects with MspErrorResponse for unsupported commands', async () => {
    const { client } = await openMock()
    await expect(client.request(MSP.RAW_IMU)).rejects.toBeInstanceOf(MspErrorResponse)
  })

  it('rejects in-flight and later requests when the transport closes', async () => {
    const { transport, client } = await openMock()
    const inFlight = client.request(MSP.STATUS)
    await transport.close()
    await expect(inFlight).rejects.toBeInstanceOf(MspDisconnectedError)
    await expect(client.request(MSP.STATUS)).rejects.toBeInstanceOf(MspDisconnectedError)
  })
})

describe('MspClient request handling', () => {
  it('times out when the FC stays silent, then keeps working', async () => {
    const transport = new FakeTransport()
    const client = new MspClient(transport, { timeoutMs: 20 })

    await expect(client.request(MSP.STATUS)).rejects.toBeInstanceOf(MspTimeoutError)

    const next = client.request(MSP.API_VERSION)
    await flush()
    transport.receive(encodeV1(MSP.API_VERSION, Uint8Array.of(0, 1, 47), 'response'))
    await expect(next).resolves.toEqual(Uint8Array.of(0, 1, 47))
  })

  it('sends one request at a time', async () => {
    const transport = new FakeTransport()
    const client = new MspClient(transport)

    const first = client.request(MSP.FC_VARIANT)
    const second = client.request(MSP.FC_VERSION)
    await flush()
    expect(transport.written).toHaveLength(1)

    transport.receive(encodeV1(MSP.FC_VARIANT, Uint8Array.of(66, 84, 70, 76), 'response'))
    await first
    await flush()
    expect(transport.written).toHaveLength(2)

    transport.receive(encodeV1(MSP.FC_VERSION, Uint8Array.of(4, 6, 0), 'response'))
    await expect(second).resolves.toEqual(Uint8Array.of(4, 6, 0))
  })

  it('ignores responses that do not match the in-flight request', async () => {
    const transport = new FakeTransport()
    const client = new MspClient(transport)

    const request = client.request(MSP.ATTITUDE)
    await flush()
    transport.receive(encodeV1(MSP.ANALOG, Uint8Array.of(1), 'response'))
    transport.receive(encodeV1(MSP.ATTITUDE, Uint8Array.of(0, 0, 0, 0, 0, 0), 'response'))
    await expect(request).resolves.toHaveLength(6)
  })
})

describe('MspClient exclusive sessions', () => {
  it('gives the session the raw link and holds back requests until it ends', async () => {
    const transport = new FakeTransport()
    const client = new MspClient(transport)
    const raw: number[] = []
    let finish = () => {}

    const session = client.exclusive(async (link) => {
      link.onData((chunk) => raw.push(...chunk))
      await link.write(Uint8Array.of(0x2f, 1, 2))
      await new Promise<void>((resolve) => (finish = resolve))
      return 'done'
    })
    const queued = client.request(MSP.FC_VARIANT)
    await flush()
    expect(transport.written).toEqual([Uint8Array.of(0x2f, 1, 2)]) // the MSP request is still waiting

    // Bytes that would be a valid MSP response go to the session, not to the parser.
    transport.receive(encodeV1(MSP.FC_VARIANT, Uint8Array.of(1, 2, 3, 4), 'response'))
    expect(raw).toHaveLength(10)

    finish()
    await expect(session).resolves.toBe('done')
    await flush()
    expect(transport.written).toHaveLength(2)
    transport.receive(encodeV1(MSP.FC_VARIANT, Uint8Array.of(66, 84, 70, 76), 'response'))
    await expect(queued).resolves.toEqual(Uint8Array.of(66, 84, 70, 76))
  })

  it('can send MSP requests of its own, and hands the link back when the session throws', async () => {
    const transport = new FakeTransport()
    const client = new MspClient(transport)

    const session = client.exclusive(async (link) => {
      const reply = await link.request(MSP.SET_PASSTHROUGH)
      link.onData(() => {})
      throw new Error(`count ${reply[0]}`)
    })
    await flush()
    transport.receive(encodeV1(MSP.SET_PASSTHROUGH, Uint8Array.of(4), 'response'))
    await expect(session).rejects.toThrow('count 4')

    const next = client.request(MSP.API_VERSION)
    await flush()
    transport.receive(encodeV1(MSP.API_VERSION, Uint8Array.of(0, 1, 48), 'response'))
    await expect(next).resolves.toEqual(Uint8Array.of(0, 1, 48))
  })
})
