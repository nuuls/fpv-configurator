import { encodeFrame, MspParser, type MspFrame } from '@/lib/msp/codec'
import { MSP } from '@/lib/msp/codes'
import {
  decodeCliSetting,
  decodeFeatureMask,
  decodeSerialConfig,
  encodeAnalog,
  encodeApiVersion,
  encodeAttitude,
  encodeBoardInfo,
  encodeFcVariant,
  encodeFcVersion,
  encodeFeatureMask,
  encodeSerialConfig,
  encodeStatus,
  FEATURE,
  SERIALRX_CRSF,
  SERIALRX_PROVIDER_NAMES,
  type SerialPortConfig,
} from '@/lib/msp/messages'
import { PORT_FUNCTION } from '@/lib/ports/model'

const EMPTY = new Uint8Array(0)

/** Long enough for the MSP_REBOOT response to reach the host first. */
const REBOOT_DELAY_MS = 20

/** The part of the FC's state that lives in EEPROM. */
export interface MockFcConfig {
  ports: SerialPortConfig[]
  features: number
  /** CLI variables by name, values as the CLI prints them (e.g. `serialrx_provider: 'CRSF'`). */
  settings: Record<string, string>
}

const port = (identifier: number, functionMask = 0): SerialPortConfig => ({
  identifier,
  functionMask,
  mspBaud: 5,
  gpsBaud: 4,
  telemetryBaud: 0,
  blackboxBaud: 5,
})

/** A typical freshly-set-up 5": USB, ELRS on UART2, ESC telemetry on UART3, four free UARTs. */
export function defaultMockConfig(): MockFcConfig {
  return {
    ports: [
      port(20, PORT_FUNCTION.MSP),
      port(51),
      port(52, PORT_FUNCTION.RX_SERIAL),
      port(53, PORT_FUNCTION.ESC_SENSOR),
      port(54),
      port(55),
      port(56),
    ],
    features: FEATURE.RX_SERIAL | FEATURE.TELEMETRY | FEATURE.OSD | FEATURE.AIRMODE | FEATURE.ESC_SENSOR,
    settings: {
      serialrx_provider: 'CRSF',
      osd_displayport_device: 'AUTO',
      vcd_video_system: 'AUTO',
    },
  }
}

export interface MockFcOptions {
  /** Injectable clock so tests get deterministic telemetry. */
  now?: () => number
  config?: MockFcConfig
}

/**
 * Simulated Betaflight 2026.6 flight controller. Speaks real MSP bytes (it shares the codec with
 * the client), so the whole stack above the transport is exercised without hardware.
 *
 * Like the real thing it has a running config and a saved one: writes change the running config,
 * MSP_EEPROM_WRITE saves it, and a reboot throws away whatever wasn't saved.
 *
 * To support a new message: add a case to `respond()` using the encoder from `messages.ts`.
 */
export class MockFlightController {
  /** Called when the FC reboots; the transport uses it to drop the connection. */
  onReboot: (() => void) | null = null

  private readonly parser: MspParser
  private readonly now: () => number
  private outbox: Uint8Array[] = []
  private saved: MockFcConfig
  private running: MockFcConfig

  constructor(options: MockFcOptions = {}) {
    this.now = options.now ?? Date.now
    this.saved = structuredClone(options.config ?? defaultMockConfig())
    this.running = structuredClone(this.saved)
    this.parser = new MspParser((frame) => this.handleFrame(frame))
  }

  /** The config that would survive a power cycle. For assertions in tests. */
  get savedConfig(): MockFcConfig {
    return structuredClone(this.saved)
  }

  /** Feed bytes written by the host; returns the encoded response frames (possibly none). */
  receive(data: Uint8Array): Uint8Array[] {
    this.parser.push(data)
    const out = this.outbox
    this.outbox = []
    return out
  }

  private handleFrame(frame: MspFrame): void {
    if (frame.direction !== 'request') return
    let payload: Uint8Array | null
    try {
      payload = this.respond(frame.code, frame.payload)
    } catch {
      payload = null // malformed request payload
    }
    this.outbox.push(
      encodeFrame({
        version: frame.version,
        direction: payload ? 'response' : 'error',
        code: frame.code,
        payload: payload ?? EMPTY,
      }),
    )
  }

  /** Returns the response payload, or null for unsupported/invalid commands (→ MSP error frame). */
  private respond(code: number, request: Uint8Array): Uint8Array | null {
    const t = this.now() / 1000

    switch (code) {
      case MSP.API_VERSION:
        return encodeApiVersion({ protocolVersion: 0, major: 1, minor: 48 })
      case MSP.FC_VARIANT:
        return encodeFcVariant('BTFL')
      case MSP.FC_VERSION:
        return encodeFcVersion({ major: 26, minor: 6, patch: 2, versionString: '2026.6.2' })
      case MSP.BOARD_INFO:
        return encodeBoardInfo({
          identifier: 'S405',
          hardwareRevision: 0,
          targetName: 'STM32F405',
          boardName: 'MOCKF405',
          manufacturerId: 'MOCK',
        })
      case MSP.STATUS:
        return encodeStatus({
          cycleTimeUs: 125,
          i2cErrors: 0,
          sensors: 0b100001, // gyro + acc
          modeFlags: 0,
          pidProfile: 0,
          cpuLoad: Math.round(12 + 3 * Math.sin(t)),
        })
      case MSP.ATTITUDE:
        return encodeAttitude({
          roll: 25 * Math.sin(t * 0.9),
          pitch: 12 * Math.sin(t * 0.6 + 1),
          yaw: Math.round((t * 10) % 360),
        })
      case MSP.ANALOG:
        return encodeAnalog({
          voltage: 16.2 + 0.15 * Math.sin(t * 0.3),
          mAhDrawn: Math.round(t) % 1500,
          rssi: 1023,
          amperage: 1.2 + 0.4 * Math.sin(t * 1.7),
        })

      case MSP.FEATURE_CONFIG:
        return encodeFeatureMask(this.running.features)
      case MSP.SET_FEATURE_CONFIG:
        this.running.features = decodeFeatureMask(request)
        return EMPTY
      case MSP.RX_CONFIG: {
        // Only the first byte (serialrx_provider) is meaningful in the mock.
        const payload = new Uint8Array(35)
        payload[0] = this.serialRxProvider()
        return payload
      }
      case MSP.COMMON_SERIAL_CONFIG:
        return encodeSerialConfig(this.running.ports)
      case MSP.COMMON_SET_SERIAL_CONFIG:
        return this.setSerialConfig(decodeSerialConfig(request)) ? EMPTY : null
      case MSP.CLI_SETTING: {
        // Betaflight 2026.6: "name = value" sets and echoes; a bare "name" (read) always errors.
        const setting = decodeCliSetting(request)
        if (!setting || !(setting.name in this.running.settings)) return null
        this.running.settings[setting.name] = setting.value
        return request
      }
      case MSP.EEPROM_WRITE:
        this.saved = structuredClone(this.running)
        return EMPTY
      case MSP.REBOOT:
        // The real FC answers first and resets a moment later.
        setTimeout(() => this.reboot(), REBOOT_DELAY_MS)
        return Uint8Array.of(request[0] ?? 0)

      default:
        return null
    }
  }

  private serialRxProvider(): number {
    const name = this.running.settings['serialrx_provider']
    const entry = Object.entries(SERIALRX_PROVIDER_NAMES).find(([, n]) => n === name)
    return entry ? Number(entry[0]) : SERIALRX_CRSF
  }

  /** Like the firmware: unknown port identifiers fail the whole message. */
  private setSerialConfig(ports: SerialPortConfig[]): boolean {
    if (ports.some((p) => !this.running.ports.some((existing) => existing.identifier === p.identifier))) return false
    this.running.ports = this.running.ports.map(
      (existing) => ports.find((p) => p.identifier === existing.identifier) ?? existing,
    )
    return true
  }

  private reboot(): void {
    this.running = structuredClone(this.saved)
    this.parser.reset()
    this.outbox = []
    this.onReboot?.()
  }
}
