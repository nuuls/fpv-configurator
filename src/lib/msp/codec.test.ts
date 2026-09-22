import { describe, expect, it } from 'vitest'
import {
  crc8DvbS2Of,
  encodeFrame,
  encodeRequest,
  encodeV1,
  encodeV2,
  MspParser,
  type MspFrame,
  type MspParseError,
} from './codec'

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0))

function parse(...chunks: Uint8Array[]) {
  const frames: MspFrame[] = []
  const errors: MspParseError[] = []
  const parser = new MspParser(
    (frame) => frames.push(frame),
    (error) => errors.push(error),
  )
  for (const chunk of chunks) parser.push(chunk)
  return { frames, errors }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]))
}

describe('crc8DvbS2', () => {
  it('matches the CRC-8/DVB-S2 check value', () => {
    expect(crc8DvbS2Of(ascii('123456789'))).toBe(0xbc)
  })
})

describe('encode', () => {
  it('encodes a v1 request without payload', () => {
    // MSP_API_VERSION: $M< size=0 code=1 checksum=0^1
    expect(encodeV1(1)).toEqual(Uint8Array.from([0x24, 0x4d, 0x3c, 0x00, 0x01, 0x01]))
  })

  it('encodes a v1 request with payload', () => {
    const frame = encodeV1(200, Uint8Array.from([0xdc, 0x05]))
    expect([...frame]).toEqual([
      0x24,
      0x4d,
      0x3c,
      0x02,
      0xc8,
      0xdc,
      0x05,
      0x02 ^ 0xc8 ^ 0xdc ^ 0x05,
    ])
  })

  it('encodes a v2 request (reference frame from the MSPv2 spec)', () => {
    expect([...encodeV2(100)]).toEqual([0x24, 0x58, 0x3c, 0x00, 0x64, 0x00, 0x00, 0x00, 0x8f])
  })

  it('picks v1 for codes <= 254 and v2 above', () => {
    expect(encodeRequest(254)[1]).toBe(0x4d)
    expect(encodeRequest(0x3000)[1]).toBe(0x58)
  })

  it('rejects out-of-range codes', () => {
    expect(() => encodeV1(255)).toThrow(RangeError)
    expect(() => encodeV2(0x10000)).toThrow(RangeError)
  })
})

describe('MspParser', () => {
  const payload = Uint8Array.from([1, 2, 3, 250, 255])

  it.each([1, 2] as const)('round-trips v%i frames in every direction', (version) => {
    for (const direction of ['request', 'response', 'error'] as const) {
      const frame: MspFrame = { version, direction, code: 108, payload }
      expect(parse(encodeFrame(frame)).frames).toEqual([frame])
    }
  })

  it('round-trips an empty payload', () => {
    expect(parse(encodeV1(1)).frames[0]?.payload).toHaveLength(0)
    expect(parse(encodeV2(1)).frames[0]?.payload).toHaveLength(0)
  })

  it('round-trips v2 16-bit codes', () => {
    expect(parse(encodeV2(0x3004, payload)).frames[0]?.code).toBe(0x3004)
  })

  it('round-trips v1 jumbo frames (payload >= 255 bytes)', () => {
    const big = Uint8Array.from({ length: 700 }, (_, i) => i & 0xff)
    const encoded = encodeV1(71, big, 'response')
    expect(encoded[3]).toBe(255)
    const { frames, errors } = parse(encoded)
    expect(errors).toEqual([])
    expect(frames[0]?.payload).toEqual(big)
  })

  it('handles frames split across chunks, one byte at a time', () => {
    const encoded = encodeV2(108, payload, 'response')
    const { frames } = parse(...[...encoded].map((byte) => Uint8Array.of(byte)))
    expect(frames).toHaveLength(1)
    expect(frames[0]?.payload).toEqual(payload)
  })

  it('handles back-to-back frames in one chunk', () => {
    const chunk = concat(
      encodeV1(1, payload, 'response'),
      encodeV2(2, payload, 'response'),
      encodeV1(3),
    )
    expect(parse(chunk).frames.map((f) => f.code)).toEqual([1, 2, 3])
  })

  it('skips garbage between frames', () => {
    const chunk = concat(
      ascii('boot log $ noise\r\n$$'),
      encodeV1(1, payload, 'response'),
      ascii('#'),
    )
    const { frames, errors } = parse(chunk)
    expect(frames.map((f) => f.code)).toEqual([1])
    expect(errors).toEqual([])
  })

  it('drops a frame with a bad checksum and recovers on the next one', () => {
    const corrupt = encodeV1(1, payload, 'response')
    corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 0xff
    const { frames, errors } = parse(concat(corrupt, encodeV1(2, payload, 'response')))
    expect(errors).toEqual(['checksum-mismatch'])
    expect(frames.map((f) => f.code)).toEqual([2])
  })

  it('reset() abandons a partial frame', () => {
    const frames: MspFrame[] = []
    const parser = new MspParser((frame) => frames.push(frame))
    parser.push(encodeV1(1, payload).subarray(0, 6))
    parser.reset()
    parser.push(encodeV1(2))
    expect(frames.map((f) => f.code)).toEqual([2])
  })
})
