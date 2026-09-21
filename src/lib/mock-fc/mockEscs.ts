import {
  encodeFourWayFrame,
  FOURWAY_ACK,
  FOURWAY_CMD,
  FourWayParser,
  INTERFACE_MODE,
  type FourWayFrame,
} from '@/lib/esc/fourway'

/** A simulated ESC as the FC's 4-way interface sees it: a bootloader signature and readable flash regions. */
export interface MockEsc {
  signature: number
  bootByte: number
  interfaceMode: number
  /** Flash content by start address; reads must fall inside one region. */
  flash: Record<number, number[]>
  /** false = no answer on the signal wire (no battery, broken wire). */
  powered: boolean
  /**
   * How long the signal wire has to be high before the bootloader answers: a running ESC first has to notice
   * that the signal is gone, finish its startup beeps and jump into the bootloader. Default `MOCK_ESC_BOOT_MS`.
   */
  bootMs?: number
}

export const MOCK_ESC_BOOT_MS = 700

const ascii = (text: string, length: number, fill = 0x20) =>
  Array.from({ length }, (_, i) => (i < text.length ? text.charCodeAt(i) : fill))

function block(length: number, values: Record<number, number | number[]>): number[] {
  const bytes = new Array<number>(length).fill(0xff)
  for (const [offset, value] of Object.entries(values)) {
    const list = typeof value === 'number' ? [value] : value
    list.forEach((byte, i) => (bytes[Number(offset) + i] = byte))
  }
  return bytes
}

/** First 0x100 bytes of program code; BLHeli_S forks are recognised by a marker in here. */
const SILABS_CODE = new Array<number>(0x100).fill(0x02)

/** Bluejay 0.21.0 (settings layout 208) on a Z-H-30 EFM8BB21 board, built for 48 kHz unless told otherwise. */
export function mockBluejayEsc(options: { reversed?: boolean; pwmKhz?: number } = {}): MockEsc {
  return {
    signature: 0xe8b2,
    bootByte: 0x63, // "471c"
    interfaceMode: INTERFACE_MODE.SILABS_BLB,
    powered: true,
    flash: {
      0x0000: SILABS_CODE,
      0x1a00: block(0x70, {
        0x00: [0, 21, 208],
        0x04: 51, // minimum startup power
        0x07: 5, // maximum startup power
        0x09: 9, // rampup power
        0x0a: options.pwmKhz ?? 48,
        0x0b: options.reversed ? 2 : 1,
        0x10: 255, // braking strength
        0x15: 4, // timing
        0x1b: [40, 80, 4], // beep strength, beacon strength, beacon delay
        0x1f: 2, // demag
        0x23: 7, // temperature protection
        0x27: 0, // brake on stop
        0x29: [2, 0], // power rating, force EDT arm
        0x40: ascii('#Z_H_30#', 16),
        0x50: ascii('#BLHELI$EFM8B21#', 16),
        0x60: ascii('Bluejay', 16),
      }),
    },
  }
}

/** BLHeli_S 16.7 (settings layout 33) on an A-H-30 EFM8BB10 board with its default settings. */
export function mockBlheliSEsc(): MockEsc {
  return {
    signature: 0xe8b1,
    bootByte: 0x63,
    interfaceMode: INTERFACE_MODE.SILABS_BLB,
    powered: true,
    flash: {
      0x0000: SILABS_CODE,
      0x1a00: block(0x70, {
        0x00: [16, 7, 33],
        0x09: 9, // startup power
        0x0b: 1, // direction
        0x15: 3, // timing
        0x1b: [40, 80, 4],
        0x1f: 2,
        0x23: [7, 1], // temperature protection, low RPM power protection
        0x27: 0,
        0x40: ascii('#A_H_30#', 16),
        0x50: ascii('#BLHELI$EFM8B10#', 16),
        0x60: ascii('', 16),
      }),
    },
  }
}

/** AM32 2.18 (eeprom version 2) on an STM32F051 (32 k flash, signal on PB4). */
export function mockAm32Esc(): MockEsc {
  return {
    signature: 0x1f06,
    bootByte: 0x14,
    interfaceMode: INTERFACE_MODE.ARM_BLB,
    powered: true,
    flash: {
      [0x7c00 - 32]: block(32, { 0: ascii('MOCK_ESC_F051', 16, 0) }),
      0x7c00: block(48, {
        0: [1, 2, 13, 2, 18], // boot byte, eeprom version, bootloader version, firmware 2.18
        5: ascii('Mock AM32', 12, 0),
        17: [0, 0, 0, 1, 1, 1, 26, 24, 100, 55, 14, 0, 1, 5, 0], // direction … telemetry (offset 31)
        32: [128, 128, 128, 50], // servo settings
        36: [0, 50, 0, 0, 15, 10, 10, 141, 102, 6, 1, 0], // low voltage cutoff … protocol, auto advance
      }),
    },
  }
}

/** A 4-in-1 Bluejay ESC: four ESCs that are set up alike, motors 2 and 3 reversed. */
export function defaultMockEscs(): MockEsc[] {
  return [mockBluejayEsc(), mockBluejayEsc({ reversed: true }), mockBluejayEsc({ reversed: true }), mockBluejayEsc()]
}

/** Two Bluejay ESCs (the second reversed and built for 24 kHz), a BLHeli_S and an AM32: every supported firmware. */
export function mixedMockEscs(): MockEsc[] {
  return [mockBluejayEsc(), mockBluejayEsc({ reversed: true, pwmKhz: 24 }), mockBlheliSEsc(), mockAm32Esc()]
}

/**
 * The FC side of the BLHeli 4-way interface (Betaflight `serial_4way.c`), read-only: write, erase and verify
 * commands are refused and counted, so tests can prove the app never sends one.
 */
export class MockFourWayInterface {
  /** Set once cmd_InterfaceExit was answered: the port speaks MSP again. */
  exited = false
  /** Commands other than the ones listed in FOURWAY_CMD that reached the interface. */
  refusedCommands: number[] = []

  private readonly escs: MockEsc[]
  private readonly now: () => number
  /** Per ESC: since when its signal wire is high without a break (`esc4wayInit`, then every cmd_DeviceReset). */
  private readonly highSince: number[]
  private readonly parser: FourWayParser
  private selected: MockEsc | null = null
  private outbox: Uint8Array[] = []

  constructor(escs: MockEsc[], now: () => number = Date.now) {
    this.escs = escs
    this.now = now
    this.highSince = escs.map(() => now())
    this.parser = new FourWayParser('request', (frame, crcOk) => this.handleFrame(frame, crcOk))
  }

  receive(data: Uint8Array): Uint8Array[] {
    this.parser.push(data)
    const out = this.outbox
    this.outbox = []
    return out
  }

  private handleFrame(request: FourWayFrame, crcOk: boolean): void {
    let params: ArrayLike<number> = [0]
    let ack: number = crcOk ? FOURWAY_ACK.OK : FOURWAY_ACK.INVALID_CRC

    if (crcOk) {
      switch (request.command) {
        case FOURWAY_CMD.INTERFACE_TEST_ALIVE:
          break
        case FOURWAY_CMD.PROTOCOL_GET_VERSION:
          params = [108]
          break
        case FOURWAY_CMD.INTERFACE_GET_NAME:
          params = ascii('m4wFCIntf', 9)
          break
        case FOURWAY_CMD.INTERFACE_GET_VERSION:
          params = [200, 6]
          break
        case FOURWAY_CMD.INTERFACE_EXIT:
          this.exited = true
          break
        case FOURWAY_CMD.DEVICE_RESET: {
          const index = request.params[0] ?? 0
          if (index >= this.escs.length) ack = FOURWAY_ACK.INVALID_CHANNEL
          else this.highSince[index] = this.now() // its firmware starts again
          this.selected = null
          break
        }
        case FOURWAY_CMD.DEVICE_INIT_FLASH: {
          this.selected = null
          const index = request.params[0] ?? 0
          const esc = this.escs[index]
          const booted = esc && this.now() - (this.highSince[index] ?? 0) >= (esc.bootMs ?? MOCK_ESC_BOOT_MS)
          if (!esc) ack = FOURWAY_ACK.INVALID_CHANNEL
          else if (!esc.powered || !booted) ack = FOURWAY_ACK.GENERAL_ERROR
          else {
            this.selected = esc
            params = [esc.signature & 0xff, esc.signature >> 8, esc.bootByte, esc.interfaceMode]
          }
          break
        }
        case FOURWAY_CMD.DEVICE_READ: {
          const data = this.read(request.address, request.params[0] || 256)
          if (data) params = data
          else ack = FOURWAY_ACK.GENERAL_ERROR
          break
        }
        default:
          this.refusedCommands.push(request.command)
          ack = FOURWAY_ACK.INVALID_CMD
      }
    }

    this.outbox.push(
      encodeFourWayFrame({
        direction: 'response',
        command: request.command,
        address: request.address,
        params: Uint8Array.from(params),
        ack,
      }),
    )
  }

  private read(address: number, length: number): number[] | null {
    if (!this.selected) return null
    for (const [start, bytes] of Object.entries(this.selected.flash)) {
      const offset = address - Number(start)
      if (offset >= 0 && offset + length <= bytes.length) return bytes.slice(offset, offset + length)
    }
    return null
  }
}
