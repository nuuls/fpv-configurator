import { describe, expect, it } from 'vitest'
import { Emitter } from '@/lib/transport/types'
import {
  crc16Xmodem,
  encodeFourWayFrame,
  FOURWAY_ACK,
  FOURWAY_CMD,
  FourWayAckError,
  FourWayClient,
  FourWayParser,
  FourWayTimeoutError,
  type FourWayFrame,
  type RawLink,
} from './fourway'

const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0))

describe('crc16Xmodem', () => {
  it('matches the CRC16/XMODEM check value', () => {
    expect(crc16Xmodem(text('123456789'))).toBe(0x31c3)
  })
})

describe('4-way frames', () => {
  it('encodes a request: escape, command, address, length, params, CRC (big endian)', () => {
    const bytes = encodeFourWayFrame({
      direction: 'request',
      command: FOURWAY_CMD.DEVICE_READ,
      address: 0x1a00,
      params: Uint8Array.of(0x70),
      ack: 0,
    })
    expect([...bytes.subarray(0, 6)]).toEqual([0x2f, 0x3a, 0x1a, 0x00, 1, 0x70])
    const crc = crc16Xmodem(bytes.subarray(0, 6))
    expect([...bytes.subarray(6)]).toEqual([crc >> 8, crc & 0xff])
  })

  it('puts the ack between the params and the CRC of a response', () => {
    const bytes = encodeFourWayFrame({
      direction: 'response',
      command: FOURWAY_CMD.DEVICE_INIT_FLASH,
      address: 0,
      params: Uint8Array.of(0xb2, 0xe8, 0x63, 1),
      ack: FOURWAY_ACK.OK,
    })
    expect([...bytes.subarray(0, 10)]).toEqual([0x2e, 0x37, 0, 0, 4, 0xb2, 0xe8, 0x63, 1, 0])
    expect(bytes).toHaveLength(12)
  })

  it('writes 256 parameter bytes as length 0 and refuses empty frames', () => {
    const frame: FourWayFrame = {
      direction: 'response',
      command: 0x3a,
      address: 0,
      params: new Uint8Array(256),
      ack: 0,
    }
    expect(encodeFourWayFrame(frame)[4]).toBe(0)
    expect(() => encodeFourWayFrame({ ...frame, params: new Uint8Array(0) })).toThrow(RangeError)
  })

  it('parses frames split across chunks, skips noise and handles 256 byte reads', () => {
    const frames: Array<[FourWayFrame, boolean]> = []
    const parser = new FourWayParser('response', (frame, crcOk) => frames.push([frame, crcOk]))
    const small = encodeFourWayFrame({
      direction: 'response',
      command: 0x37,
      address: 0x1234,
      params: Uint8Array.of(1, 2, 3),
      ack: 0x0f,
    })
    const big = encodeFourWayFrame({
      direction: 'response',
      command: 0x3a,
      address: 0,
      params: new Uint8Array(256).fill(7),
      ack: 0,
    })

    parser.push(Uint8Array.of(0x00, 0x55)) // line noise before the escape byte
    parser.push(small.subarray(0, 4))
    parser.push(small.subarray(4))
    parser.push(big)

    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual([
      {
        direction: 'response',
        command: 0x37,
        address: 0x1234,
        params: Uint8Array.of(1, 2, 3),
        ack: 0x0f,
      },
      true,
    ])
    expect(frames[1]?.[0].params).toHaveLength(256)
  })

  it('flags a corrupted frame', () => {
    const results: boolean[] = []
    const parser = new FourWayParser('request', (_, crcOk) => results.push(crcOk))
    const bytes = encodeFourWayFrame({
      direction: 'request',
      command: 0x30,
      address: 0,
      params: Uint8Array.of(0),
      ack: 0,
    })
    bytes[5] = 0xaa
    parser.push(bytes)
    expect(results).toEqual([false])
  })
})

/** A link whose other end is scripted by the test. */
function fakeLink() {
  const data = new Emitter<Uint8Array>()
  const written: Uint8Array[] = []
  const link: RawLink = {
    write: async (bytes) => void written.push(bytes),
    onData: (listener) => data.on(listener),
  }
  const respond = (command: number, params: number[], ack: number) =>
    data.emit(
      encodeFourWayFrame({
        direction: 'response',
        command,
        address: 0,
        params: Uint8Array.from(params),
        ack,
      }),
    )
  return { link, written, respond }
}

describe('FourWayClient', () => {
  it('resolves with the response to its request', async () => {
    const { link, written, respond } = fakeLink()
    const client = new FourWayClient(link)
    const pending = client.request(FOURWAY_CMD.DEVICE_INIT_FLASH, [2])
    expect([...(written[0] ?? [])].slice(0, 6)).toEqual([0x2f, 0x37, 0, 0, 1, 2])
    respond(FOURWAY_CMD.DEVICE_INIT_FLASH, [0xb2, 0xe8, 0x63, 1], FOURWAY_ACK.OK)
    expect([...(await pending).params]).toEqual([0xb2, 0xe8, 0x63, 1])
  })

  it('rejects with the ack when the interface reports an error', async () => {
    const { link, respond } = fakeLink()
    const pending = new FourWayClient(link).request(FOURWAY_CMD.DEVICE_INIT_FLASH, [0])
    respond(FOURWAY_CMD.DEVICE_INIT_FLASH, [0], FOURWAY_ACK.GENERAL_ERROR)
    await expect(pending).rejects.toBeInstanceOf(FourWayAckError)
    await expect(pending).rejects.toMatchObject({ ack: FOURWAY_ACK.GENERAL_ERROR })
  })

  it('times out when nothing answers, and ignores answers to other commands', async () => {
    const { link, respond } = fakeLink()
    const pending = new FourWayClient(link, 20).request(FOURWAY_CMD.INTERFACE_EXIT)
    respond(FOURWAY_CMD.DEVICE_READ, [0], FOURWAY_ACK.OK)
    await expect(pending).rejects.toBeInstanceOf(FourWayTimeoutError)
  })
})
