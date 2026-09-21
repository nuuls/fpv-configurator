import type { Unsubscribe } from '@/lib/transport/types'

/**
 * BLHeli 4-way interface: what the FC's serial port speaks after MSP_SET_PASSTHROUGH, until
 * cmd_InterfaceExit. Byte layout from Betaflight `src/main/io/serial_4way.c`:
 *
 *   host → FC: 0x2F cmd addrHi addrLo len params[len] crcHi crcLo        (len 0 = 256, never empty)
 *   FC → host: 0x2E cmd addrHi addrLo len params[len] ack crcHi crcLo
 *
 * CRC is CRC16/XMODEM over everything before it. Only the read-side commands are listed: this app
 * never writes to an ESC.
 */
export const FOURWAY_CMD = {
  INTERFACE_TEST_ALIVE: 0x30,
  PROTOCOL_GET_VERSION: 0x31,
  INTERFACE_GET_NAME: 0x32,
  INTERFACE_GET_VERSION: 0x33,
  INTERFACE_EXIT: 0x34,
  DEVICE_RESET: 0x35,
  DEVICE_INIT_FLASH: 0x37,
  DEVICE_READ: 0x3a,
} as const

export const FOURWAY_ACK = {
  OK: 0x00,
  INVALID_CMD: 0x02,
  INVALID_CRC: 0x03,
  VERIFY_ERROR: 0x04,
  INVALID_CHANNEL: 0x08,
  INVALID_PARAM: 0x09,
  GENERAL_ERROR: 0x0f,
} as const

/** Byte 3 of the cmd_DeviceInitFlash reply: which bootloader the FC found on the ESC. */
export const INTERFACE_MODE = {
  SILABS_C2: 0,
  SILABS_BLB: 1,
  ATMEL_BLB: 2,
  ATMEL_SK: 3,
  ARM_BLB: 4,
} as const

const ESCAPE_HOST = 0x2f
const ESCAPE_INTERFACE = 0x2e

export type FourWayDirection = 'request' | 'response'

export interface FourWayFrame {
  direction: FourWayDirection
  command: number
  address: number
  params: Uint8Array
  /** Responses only; 0 in requests. */
  ack: number
}

export function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

export function encodeFourWayFrame(frame: FourWayFrame): Uint8Array {
  const { params } = frame
  if (params.length < 1 || params.length > 256) throw new RangeError('4-way frames carry 1–256 parameter bytes')
  const isResponse = frame.direction === 'response'
  const out = new Uint8Array(5 + params.length + (isResponse ? 1 : 0) + 2)
  out[0] = isResponse ? ESCAPE_INTERFACE : ESCAPE_HOST
  out[1] = frame.command
  out[2] = (frame.address >> 8) & 0xff
  out[3] = frame.address & 0xff
  out[4] = params.length & 0xff // 256 → 0
  out.set(params, 5)
  if (isResponse) out[5 + params.length] = frame.ack
  const crc = crc16Xmodem(out.subarray(0, out.length - 2))
  out[out.length - 2] = crc >> 8
  out[out.length - 1] = crc & 0xff
  return out
}

/**
 * Streaming parser for one direction. Bytes before the escape byte are skipped; a frame with a bad
 * CRC is reported with `crcOk: false` (the FC answers those with ACK_I_INVALID_CRC, the host drops them).
 */
export class FourWayParser {
  private readonly escape: number
  private readonly trailer: number
  private readonly onFrame: (frame: FourWayFrame, crcOk: boolean) => void
  private buffer: number[] = []

  constructor(direction: FourWayDirection, onFrame: (frame: FourWayFrame, crcOk: boolean) => void) {
    this.escape = direction === 'response' ? ESCAPE_INTERFACE : ESCAPE_HOST
    this.trailer = direction === 'response' ? 3 : 2 // (ack +) crc
    this.onFrame = onFrame
  }

  reset(): void {
    this.buffer = []
  }

  push(chunk: Uint8Array): void {
    for (const byte of chunk) {
      if (this.buffer.length === 0 && byte !== this.escape) continue
      this.buffer.push(byte)
      this.tryEmit()
    }
  }

  private tryEmit(): void {
    const buffer = this.buffer
    const lengthByte = buffer[4]
    if (lengthByte === undefined) return
    const paramCount = lengthByte === 0 ? 256 : lengthByte
    const total = 5 + paramCount + this.trailer
    if (buffer.length < total) return

    const bytes = Uint8Array.from(buffer)
    this.buffer = []
    const crc = ((bytes[total - 2] ?? 0) << 8) | (bytes[total - 1] ?? 0)
    const isResponse = this.trailer === 3
    this.onFrame(
      {
        direction: isResponse ? 'response' : 'request',
        command: bytes[1] ?? 0,
        address: ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0),
        params: bytes.slice(5, 5 + paramCount),
        ack: isResponse ? (bytes[5 + paramCount] ?? 0) : 0,
      },
      crc === crc16Xmodem(bytes.subarray(0, total - 2)),
    )
  }
}

export class FourWayTimeoutError extends Error {
  override name = 'FourWayTimeoutError'
  constructor(command: number, timeoutMs: number) {
    super(`4-way command 0x${command.toString(16)}: no response within ${timeoutMs} ms`)
  }
}

/** The interface answered, but not with ACK_OK — e.g. GENERAL_ERROR when the ESC doesn't respond. */
export class FourWayAckError extends Error {
  override name = 'FourWayAckError'
  readonly ack: number
  constructor(command: number, ack: number) {
    super(`4-way command 0x${command.toString(16)} failed (ack 0x${ack.toString(16)})`)
    this.ack = ack
  }
}

/** The raw serial link while the FC is in passthrough mode, see `MspClient.exclusive`. */
export interface RawLink {
  write(data: Uint8Array): Promise<void>
  onData(listener: (chunk: Uint8Array) => void): Unsubscribe
}

interface Pending {
  command: number
  resolve: (frame: FourWayFrame) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** One request at a time over a raw link; callers await each request before sending the next. */
export class FourWayClient {
  private readonly link: RawLink
  private readonly timeoutMs: number
  private readonly parser: FourWayParser
  private readonly unsubscribe: Unsubscribe
  private pending: Pending | null = null

  /** The FC tries to reach an ESC bootloader three times before it answers, hence the generous default. */
  constructor(link: RawLink, timeoutMs = 3000) {
    this.link = link
    this.timeoutMs = timeoutMs
    this.parser = new FourWayParser('response', (frame, crcOk) => this.handleFrame(frame, crcOk))
    this.unsubscribe = link.onData((chunk) => this.parser.push(chunk))
  }

  /** Resolves with the response frame; rejects on timeout or when the ack isn't OK. */
  request(command: number, params: ArrayLike<number> = [0], address = 0): Promise<FourWayFrame> {
    if (this.pending) return Promise.reject(new Error('4-way request already in flight'))
    const bytes = encodeFourWayFrame({ direction: 'request', command, address, params: Uint8Array.from(params), ack: 0 })

    return new Promise<FourWayFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        this.parser.reset()
        reject(new FourWayTimeoutError(command, this.timeoutMs))
      }, this.timeoutMs)
      this.pending = { command, resolve, reject, timer }
      this.link.write(bytes).catch((error: unknown) => {
        this.settle()?.reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  dispose(): void {
    this.unsubscribe()
    this.settle()?.reject(new Error('4-way session closed'))
  }

  private handleFrame(frame: FourWayFrame, crcOk: boolean): void {
    if (!crcOk || !this.pending || this.pending.command !== frame.command) return // the timeout reports it
    const pending = this.settle()!
    if (frame.ack === FOURWAY_ACK.OK) pending.resolve(frame)
    else pending.reject(new FourWayAckError(frame.command, frame.ack))
  }

  private settle(): Pending | null {
    const pending = this.pending
    if (!pending) return null
    clearTimeout(pending.timer)
    this.pending = null
    return pending
  }
}
