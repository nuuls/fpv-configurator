/**
 * MSP (MultiWii Serial Protocol) framing — pure functions, no I/O.
 *
 * v1:  '$' 'M' dir  size:u8  code:u8  payload  checksum        (XOR of size, code, payload)
 *      Jumbo frames: size == 255, followed by realSize:u16 (included in the checksum).
 * v2:  '$' 'X' dir  flag:u8  code:u16  size:u16  payload  crc  (crc8_dvb_s2 of flag..payload)
 *
 * dir: '<' request (to FC), '>' response (from FC), '!' error response (from FC).
 * All multi-byte values are little-endian.
 */

export type MspVersion = 1 | 2
export type MspDirection = 'request' | 'response' | 'error'

export interface MspFrame {
  version: MspVersion
  direction: MspDirection
  code: number
  payload: Uint8Array
}

const CH_DOLLAR = 0x24 // '$'
const CH_M = 0x4d // 'M'
const CH_X = 0x58 // 'X'

const DIRECTION_TO_BYTE: Record<MspDirection, number> = {
  request: 0x3c, // '<'
  response: 0x3e, // '>'
  error: 0x21, // '!'
}

const BYTE_TO_DIRECTION: Record<number, MspDirection> = {
  0x3c: 'request',
  0x3e: 'response',
  0x21: 'error',
}

const V1_JUMBO_SIZE = 255
const V1_MAX_CODE = 254
const MAX_PAYLOAD_SIZE = 0xffff

const EMPTY = new Uint8Array(0)

/** CRC-8/DVB-S2 (poly 0xD5), as used by MSP v2. Feed one byte at a time. */
export function crc8DvbS2(crc: number, byte: number): number {
  crc ^= byte
  for (let i = 0; i < 8; i++) {
    crc = crc & 0x80 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff
  }
  return crc
}

export function crc8DvbS2Of(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) crc = crc8DvbS2(crc, byte)
  return crc
}

export function encodeV1(
  code: number,
  payload: Uint8Array = EMPTY,
  direction: MspDirection = 'request',
): Uint8Array {
  if (code < 0 || code > V1_MAX_CODE) throw new RangeError(`MSP v1 code out of range: ${code}`)
  if (payload.length > MAX_PAYLOAD_SIZE) throw new RangeError('MSP payload too large')

  const jumbo = payload.length >= V1_JUMBO_SIZE
  const out = new Uint8Array(3 + 2 + (jumbo ? 2 : 0) + payload.length + 1)
  let i = 0
  out[i++] = CH_DOLLAR
  out[i++] = CH_M
  out[i++] = DIRECTION_TO_BYTE[direction]
  const checksumStart = i
  out[i++] = jumbo ? V1_JUMBO_SIZE : payload.length
  out[i++] = code
  if (jumbo) {
    out[i++] = payload.length & 0xff
    out[i++] = payload.length >> 8
  }
  out.set(payload, i)
  i += payload.length

  let checksum = 0
  for (let j = checksumStart; j < i; j++) checksum ^= out[j]!
  out[i] = checksum
  return out
}

export function encodeV2(
  code: number,
  payload: Uint8Array = EMPTY,
  direction: MspDirection = 'request',
): Uint8Array {
  if (code < 0 || code > 0xffff) throw new RangeError(`MSP v2 code out of range: ${code}`)
  if (payload.length > MAX_PAYLOAD_SIZE) throw new RangeError('MSP payload too large')

  const out = new Uint8Array(3 + 5 + payload.length + 1)
  out[0] = CH_DOLLAR
  out[1] = CH_X
  out[2] = DIRECTION_TO_BYTE[direction]
  out[3] = 0 // flag
  out[4] = code & 0xff
  out[5] = code >> 8
  out[6] = payload.length & 0xff
  out[7] = payload.length >> 8
  out.set(payload, 8)
  out[out.length - 1] = crc8DvbS2Of(out.subarray(3, out.length - 1))
  return out
}

export function encodeFrame(frame: MspFrame): Uint8Array {
  return frame.version === 1
    ? encodeV1(frame.code, frame.payload, frame.direction)
    : encodeV2(frame.code, frame.payload, frame.direction)
}

/** Encodes a request, using v1 where the code fits (like Betaflight Configurator) and v2 otherwise. */
export function encodeRequest(code: number, payload: Uint8Array = EMPTY): Uint8Array {
  return code <= V1_MAX_CODE ? encodeV1(code, payload) : encodeV2(code, payload)
}

type ParserState =
  | 'idle'
  | 'proto'
  | 'direction'
  | 'v1-size'
  | 'v1-code'
  | 'v1-jumbo-size-lo'
  | 'v1-jumbo-size-hi'
  | 'v2-flag'
  | 'v2-code-lo'
  | 'v2-code-hi'
  | 'v2-size-lo'
  | 'v2-size-hi'
  | 'payload'
  | 'checksum'

export type MspParseError = 'checksum-mismatch'

/**
 * Streaming MSP parser. Feed it arbitrary chunks from the wire; it emits complete frames.
 * Garbage between frames is skipped; a frame with a bad checksum is dropped and reported via `onError`.
 */
export class MspParser {
  private readonly onFrame: (frame: MspFrame) => void
  private readonly onError: ((error: MspParseError) => void) | undefined

  private state: ParserState = 'idle'
  private version: MspVersion = 1
  private direction: MspDirection = 'response'
  private code = 0
  private size = 0
  private payload: Uint8Array = EMPTY
  private offset = 0
  private checksum = 0

  constructor(onFrame: (frame: MspFrame) => void, onError?: (error: MspParseError) => void) {
    this.onFrame = onFrame
    this.onError = onError
  }

  push(chunk: Uint8Array): void {
    for (const byte of chunk) this.pushByte(byte)
  }

  reset(): void {
    this.state = 'idle'
  }

  private pushByte(byte: number): void {
    switch (this.state) {
      case 'idle':
        if (byte === CH_DOLLAR) this.state = 'proto'
        break

      case 'proto':
        if (byte === CH_M) {
          this.version = 1
          this.state = 'direction'
        } else if (byte === CH_X) {
          this.version = 2
          this.state = 'direction'
        } else {
          this.resync(byte)
        }
        break

      case 'direction': {
        const direction = BYTE_TO_DIRECTION[byte]
        if (direction === undefined) {
          this.resync(byte)
          break
        }
        this.direction = direction
        this.checksum = 0
        this.state = this.version === 1 ? 'v1-size' : 'v2-flag'
        break
      }

      case 'v1-size':
        this.size = byte
        this.checksum ^= byte
        this.state = 'v1-code'
        break

      case 'v1-code':
        this.code = byte
        this.checksum ^= byte
        if (this.size === V1_JUMBO_SIZE) this.state = 'v1-jumbo-size-lo'
        else this.beginPayload()
        break

      case 'v1-jumbo-size-lo':
        this.size = byte
        this.checksum ^= byte
        this.state = 'v1-jumbo-size-hi'
        break

      case 'v1-jumbo-size-hi':
        this.size |= byte << 8
        this.checksum ^= byte
        this.beginPayload()
        break

      case 'v2-flag':
        this.checksum = crc8DvbS2(this.checksum, byte)
        this.state = 'v2-code-lo'
        break

      case 'v2-code-lo':
        this.code = byte
        this.checksum = crc8DvbS2(this.checksum, byte)
        this.state = 'v2-code-hi'
        break

      case 'v2-code-hi':
        this.code |= byte << 8
        this.checksum = crc8DvbS2(this.checksum, byte)
        this.state = 'v2-size-lo'
        break

      case 'v2-size-lo':
        this.size = byte
        this.checksum = crc8DvbS2(this.checksum, byte)
        this.state = 'v2-size-hi'
        break

      case 'v2-size-hi':
        this.size |= byte << 8
        this.checksum = crc8DvbS2(this.checksum, byte)
        this.beginPayload()
        break

      case 'payload':
        this.payload[this.offset++] = byte
        this.checksum = this.version === 1 ? this.checksum ^ byte : crc8DvbS2(this.checksum, byte)
        if (this.offset === this.size) this.state = 'checksum'
        break

      case 'checksum':
        this.state = 'idle'
        if (byte === this.checksum) {
          this.onFrame({
            version: this.version,
            direction: this.direction,
            code: this.code,
            payload: this.payload,
          })
        } else {
          this.onError?.('checksum-mismatch')
        }
        break
    }
  }

  private beginPayload(): void {
    this.payload = new Uint8Array(this.size)
    this.offset = 0
    this.state = this.size === 0 ? 'checksum' : 'payload'
  }

  /** Header didn't match: drop it, but let this byte start a new frame if it is a '$'. */
  private resync(byte: number): void {
    this.state = byte === CH_DOLLAR ? 'proto' : 'idle'
  }
}
