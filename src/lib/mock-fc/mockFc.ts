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
import {
  BLACKBOX_DEVICE,
  encodeBlackboxConfig,
  encodeDataflashSummary,
  encodeSdcardSummary,
  type BlackboxConfig,
} from '@/lib/blackbox/model'
import { decodeSetModeRange, encodeModeRanges, encodeRc, type ModeSlot } from '@/lib/modes/model'
import {
  decodeSetMotor,
  decodeSetMotorConfig,
  encodeMixerConfig,
  encodeMotorConfig,
  encodeMotorTelemetry,
  MOTOR_STOP,
} from '@/lib/motors/model'
import { decodeBoardAlignment, encodeBoardAlignment, type BoardAlignment } from '@/lib/orientation/model'
import { PORT_FUNCTION } from '@/lib/ports/model'
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'

const EMPTY = new Uint8Array(0)

/** Long enough for the MSP_REBOOT response to reach the host first. */
const REBOOT_DELAY_MS = 20
const FLASH_ERASE_MS = 300
const MODE_SLOT_COUNT = 20

/** Permanent box ids this "firmware build" offers: ARM, ANGLE, HORIZON, BEEPER, BLACKBOX, FAILSAFE, AIRMODE, TURTLE. */
const BOX_IDS = [0, 1, 2, 13, 26, 27, 28, 35]

/** Betaflight default PIDs (P, I, D, Dmax, F) that the simplified-tuning sliders scale. */
const BASE_PIDS = [
  [45, 80, 30, 40, 120],
  [47, 84, 34, 46, 125],
  [45, 80, 0, 0, 120],
] as const

/** The part of the FC's state that lives in EEPROM. */
export interface MockFcConfig {
  ports: SerialPortConfig[]
  features: number
  /** CLI variables by name, values as the CLI prints them (e.g. `serialrx_provider: 'CRSF'`). */
  settings: Record<string, string>
  boardAlignment: BoardAlignment
  blackbox: BlackboxConfig
  modeSlots: ModeSlot[]
  /** Raw MSP_SIMPLIFIED_TUNING payload: 9 PID sliders, 8 reserved bytes, then the filter sliders. */
  simplifiedTuning: number[]
  /** Raw MSP_ADVANCED_CONFIG payload; byte 3 is the motor protocol. */
  advancedConfig: number[]
  motor: { poles: number; bidirDshot: boolean; mixerMode: number; propsOut: boolean }
  /** Raw MSP_RC_TUNING payload (24 bytes), see lib/rates/model.ts for the offsets. */
  rcTuning: number[]
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
      rc_smoothing: 'ON',
      rc_smoothing_auto_factor: '30',
      rc_smoothing_auto_factor_throttle: '30',
      feedforward_smooth_factor: '65',
      dyn_idle_min_rpm: '0', // Betaflight default: dynamic idle off
    },
    boardAlignment: { roll: 0, pitch: 0, yaw: 0 },
    blackbox: { supported: true, device: BLACKBOX_DEVICE.FLASH, sampleRate: 1, fieldsDisabledMask: 0 },
    // ARM on AUX1 high, plus FAILSAFE (a mode the app doesn't manage) on AUX4.
    modeSlots: Array.from({ length: MODE_SLOT_COUNT }, (_, i): ModeSlot => {
      if (i === 0) return { boxId: 0, auxChannel: 0, start: 1700, end: 2100 }
      if (i === 1) return { boxId: 27, auxChannel: 3, start: 1800, end: 2100 }
      return { boxId: 0, auxChannel: 0, start: 900, end: 900 }
    }),
    // Betaflight defaults: sliders on (RPY), everything at 1.0 including Dynamic D.
    simplifiedTuning: [2, 100, 100, 100, 100, 100, 100, 100, 100, ...new Array<number>(8 + 14).fill(0)],
    // denom 1 · DSHOT300 · pwm rate 480 · idle 550 · ... · debug count 80
    advancedConfig: [1, 1, 0, 6, 0xe0, 0x01, 0x26, 0x02, 0, 0, 0, 0, 48, 125, 0, 0, 0, 1, 0, 80],
    motor: { poles: 14, bidirDshot: false, mixerMode: 3, propsOut: false },
    // Betaflight defaults: Actual rates, 70 / 670 / 0 on every axis, rate limit 1998, throttle mid 50
    rcTuning: [7, 0, 67, 67, 67, 0, 50, 0, 0, 0, 0, 7, 7, 0, 0, 100, 0xce, 0x07, 0xce, 0x07, 0xce, 0x07, 3, 0],
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
  // Runtime state that a reboot clears
  private motors: number[] = new Array<number>(8).fill(MOTOR_STOP)
  private armingDisabledByMsp = false
  private flash = { usedBytes: 3_500_000, ready: true }

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

  /** What the ESCs are being told right now (1000 = stopped). */
  get motorOutputs(): number[] {
    return [...this.motors]
  }

  get armingDisabled(): boolean {
    return this.armingDisabledByMsp
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
          yaw: Math.round((360 + 50 * Math.sin(t * 0.4)) % 360), // sways across the 0/360 wrap
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
        // Only the fields the app decodes are meaningful in the mock.
        const payload = new Uint8Array(44)
        payload[0] = this.serialRxProvider()
        payload[30] = Number(this.running.settings['rc_smoothing_auto_factor'])
        payload[31] = this.running.settings['rc_smoothing'] === 'OFF' ? 0 : 1
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
      case MSP.BOARD_ALIGNMENT_CONFIG:
        return encodeBoardAlignment(this.running.boardAlignment)
      case MSP.SET_BOARD_ALIGNMENT_CONFIG:
        this.running.boardAlignment = decodeBoardAlignment(request)
        return EMPTY

      case MSP.BLACKBOX_CONFIG:
        return encodeBlackboxConfig(this.running.blackbox)
      case MSP.SET_BLACKBOX_CONFIG: {
        const r = new ByteReader(request)
        const device = r.u8()
        r.skip(4)
        this.running.blackbox = { ...this.running.blackbox, device, sampleRate: r.u8() }
        return EMPTY
      }
      case MSP.DATAFLASH_SUMMARY:
        return encodeDataflashSummary({ supported: true, totalBytes: 16_777_216, ...this.flash })
      case MSP.DATAFLASH_ERASE:
        this.flash = { usedBytes: 0, ready: false }
        setTimeout(() => (this.flash.ready = true), FLASH_ERASE_MS)
        return EMPTY
      case MSP.SDCARD_SUMMARY:
        return encodeSdcardSummary({ supported: false, state: 0, freeKb: 0, totalKb: 0 })

      case MSP.MODE_RANGES:
        return encodeModeRanges(this.running.modeSlots)
      case MSP.SET_MODE_RANGE: {
        const { index, slot } = decodeSetModeRange(request)
        if (index >= MODE_SLOT_COUNT || !BOX_IDS.includes(slot.boxId)) return null
        this.running.modeSlots[index] = slot
        return EMPTY
      }
      case MSP.BOXIDS:
        return Uint8Array.from(BOX_IDS)
      case MSP.RC:
        // Sticks centred, throttle low; AUX1 low (disarmed), AUX2 sweeping so ranges visibly toggle.
        return encodeRc([1500, 1500, 1500, 1000, 1000, Math.round(1500 + 500 * Math.sin(t * 0.8)), 1500, 1000])

      case MSP.SIMPLIFIED_TUNING:
        return Uint8Array.from(this.running.simplifiedTuning)
      case MSP.SET_SIMPLIFIED_TUNING:
        if (request.length !== this.running.simplifiedTuning.length) return null
        this.running.simplifiedTuning = [...request]
        return EMPTY
      case MSP.CALCULATE_SIMPLIFIED_PID:
        return calculatePids(request)

      case MSP.RC_TUNING:
        return Uint8Array.from(this.running.rcTuning)
      case MSP.SET_RC_TUNING:
        if (request.length < 10) return null
        this.running.rcTuning = this.running.rcTuning.map((byte, i) => request[i] ?? byte)
        return EMPTY

      case MSP.ADVANCED_CONFIG:
        return Uint8Array.from(this.running.advancedConfig)
      case MSP.SET_ADVANCED_CONFIG:
        this.running.advancedConfig = this.running.advancedConfig.map((byte, i) => request[i] ?? byte)
        return EMPTY
      case MSP.MOTOR_CONFIG:
        return encodeMotorConfig({
          advancedConfig: [],
          motorCount: 4,
          maxThrottle: 2000,
          minCommand: 1000,
          ...this.running.motor,
          dynIdle: 0,
        })
      case MSP.SET_MOTOR_CONFIG:
        this.running.motor = { ...this.running.motor, ...decodeSetMotorConfig(request) }
        return EMPTY
      case MSP.MIXER_CONFIG:
        return encodeMixerConfig(this.running.motor.mixerMode, this.running.motor.propsOut)
      case MSP.SET_MIXER_CONFIG:
        this.running.motor.propsOut = request[1] === 1
        return EMPTY
      case MSP.MOTOR:
        return encodeRc(this.motors)
      case MSP.MOTOR_TELEMETRY: {
        // RPM is only reported with bidirectional DShot; roughly 30 rpm per throttle step above idle.
        const bidir = this.running.motor.bidirDshot
        return encodeMotorTelemetry(
          this.motors.slice(0, 4).map((output) => ({
            rpm: bidir && output > MOTOR_STOP ? 1500 + (output - MOTOR_STOP) * 30 : 0,
            invalidPercent: bidir ? 0 : 100,
          })),
        )
      }
      case MSP.PID_ADVANCED: {
        // Only dyn_idle_min_rpm (byte 49) is meaningful in the mock.
        const payload = new Uint8Array(61)
        payload[49] = Number(this.running.settings['dyn_idle_min_rpm'])
        return payload
      }
      case MSP.SET_MOTOR:
        this.motors = decodeSetMotor(request).slice(0, 8)
        return EMPTY
      case MSP.SET_ARMING_DISABLED:
        this.armingDisabledByMsp = request[0] === 1
        return EMPTY

      case MSP.EEPROM_WRITE:
        this.saved = structuredClone(this.running)
        return EMPTY
      case MSP.REBOOT: {
        // The real FC answers first and resets a moment later. Mode 2 = mass storage (+ "ready" byte).
        const mode = request[0] ?? 0
        setTimeout(() => this.reboot(), REBOOT_DELAY_MS)
        return mode === 2 ? Uint8Array.of(mode, 1) : Uint8Array.of(mode)
      }

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
    this.motors = new Array<number>(8).fill(MOTOR_STOP)
    this.armingDisabledByMsp = false
    this.parser.reset()
    this.outbox = []
    this.onReboot?.()
  }
}

/** Rough stand-in for the firmware's slider math; enough for the preview to react sensibly. */
function calculatePids(sliders: Uint8Array): Uint8Array {
  const [, master = 100, , iGain = 100, dGain = 100, piGain = 100, dMaxGain = 100, ffGain = 100] = sliders
  const scale = (base: number, ...percents: number[]) =>
    Math.min(250, Math.round(percents.reduce((value, percent) => (value * percent) / 100, base)))

  const w = new ByteWriter()
  for (const [p, i, d, dMax, f] of BASE_PIDS) {
    const dTerm = scale(d, master, dGain)
    w.u8(scale(p, master, piGain))
      .u8(scale(i, master, piGain, iGain))
      .u8(dTerm)
      .u8(dMaxGain === 0 ? dTerm : scale(dMax, master, dGain))
      .u16(scale(f, master, ffGain))
  }
  return w.toBytes()
}
