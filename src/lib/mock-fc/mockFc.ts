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
  CONFIGURATION_PROBLEM,
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
import {
  applyFilterSliders,
  copySharedCutoffs,
  defaultFilterConfig,
  defaultFilterSliders,
  isFilterConfigRejected,
} from '@/lib/filters/model'
import { decodeSetModeRange, encodeModeRanges, encodeRc, type ModeSlot } from '@/lib/modes/model'
import {
  decodeDshotCommand,
  decodeMotorOutputReordering,
  decodeSetMotor,
  decodeSetMotorConfig,
  DSHOT_ALL_MOTORS,
  DSHOT_CMD,
  encodeMixerConfig,
  encodeMotorConfig,
  encodeMotorOutputReordering,
  encodeMotorTelemetry,
  isDshot,
  MAX_MOTORS,
  MOTOR_STOP,
  type DshotCommandRequest,
} from '@/lib/motors/model'
import {
  decodeBoardAlignment,
  encodeBoardAlignment,
  type BoardAlignment,
} from '@/lib/orientation/model'
import {
  decodePosition,
  decodeSetOsdConfig,
  elementIndex,
  encodeOsdCanvas,
  encodeOsdConfig,
  encodePosition,
  FIRMWARE_ELEMENT_COUNT,
  VIDEO_SYSTEM,
  VIDEO_SYSTEM_NAMES,
  type Canvas,
} from '@/lib/osd/model'
import { PORT_FUNCTION } from '@/lib/ports/model'
import {
  decodeSetVtxConfig,
  decodeVtxBand,
  decodeVtxPowerLevel,
  encodeVtxBand,
  encodeVtxConfig,
  encodeVtxPowerLevel,
  VTX_MAX_BANDS,
  VTX_MAX_CHANNELS,
  VTX_MAX_POWER_LEVELS,
  type VtxBand,
  type VtxPowerLevel,
} from '@/lib/vtx/model'
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'
import { MockCliSession, renderDiff } from './mockCli'
import { defaultMockEscs, MockFourWayInterface, setMockEscReversed, type MockEsc } from './mockEscs'

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
  /** Raw MSP_FILTER_CONFIG payload; shares its lowpass cutoffs with `simplifiedTuning` (lib/filters/model.ts). */
  filterConfig: number[]
  /** Raw MSP_ADVANCED_CONFIG payload; byte 3 is the motor protocol. */
  advancedConfig: number[]
  motor: { poles: number; bidirDshot: boolean; mixerMode: number; propsOut: boolean }
  /** `motor_output_reordering`: the output each of the 8 motors drives. */
  motorOutputReordering: number[]
  /** Raw MSP_RC_TUNING payload (24 bytes), see lib/rates/model.ts for the offsets. */
  rcTuning: number[]
  /** Raw `item_pos` per OSD element and the two timer configs, see lib/osd/model.ts for the bits. */
  osd: { positions: number[]; timers: number[] }
  vtx: MockVtxConfig
  /** Raw MSP_ARMING_CONFIG payload: auto_disarm_delay, reserved, small_angle, gyro_cal_on_first_arm. */
  armingConfig: number[]
  /** Raw MSP_BEEPER_CONFIG payload: beeper_off_flags (u32), dshotBeaconTone, dshotBeaconOffFlags (u32). */
  beeperConfig: number[]
  /** `accZero.calibrationCompleted`: set by MSP_ACC_CALIBRATION, reported in MSP_BOARD_INFO. */
  accCalibrated: boolean
}

/** Like the firmware: fixed storage for 8 bands and 8 power levels, the counts say how much of it is in use. */
export interface MockVtxConfig {
  band: number
  channel: number
  power: number
  frequency: number
  lowPowerDisarm: number
  pitModeFrequency: number
  bandCount: number
  channelCount: number
  powerLevelCount: number
  bands: VtxBand[]
  powerLevels: VtxPowerLevel[]
}

const emptyVtxBand = (): VtxBand => ({
  name: '',
  letter: '',
  isFactory: false,
  frequencies: new Array<number>(VTX_MAX_CHANNELS).fill(0),
})
const emptyVtxPowerLevel = (): VtxPowerLevel => ({ value: 0, label: '' })

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
    features:
      FEATURE.RX_SERIAL | FEATURE.TELEMETRY | FEATURE.OSD | FEATURE.AIRMODE | FEATURE.ESC_SENSOR,
    settings: {
      serialrx_provider: 'CRSF',
      osd_displayport_device: 'AUTO',
      vcd_video_system: 'AUTO',
      rc_smoothing: 'ON',
      rc_smoothing_auto_factor: '30',
      rc_smoothing_auto_factor_throttle: '30',
      feedforward_smooth_factor: '65',
      dyn_idle_min_rpm: '0', // Betaflight default: dynamic idle off
      tpa_mode: 'D',
      tpa_rate: '65',
      tpa_breakpoint: '1350',
      // Changed in Betaflight Configurator — no tab of this app manages them (Betaflight defaults: 0, METRIC)
      crashflip_motor_percent: '50',
      osd_units: 'IMPERIAL',
      anti_gravity_gain: '80', // a profile setting at its default, for tests that change it
    },
    boardAlignment: { roll: 0, pitch: 0, yaw: 0 },
    blackbox: {
      supported: true,
      device: BLACKBOX_DEVICE.FLASH,
      sampleRate: 1,
      fieldsDisabledMask: 0,
    },
    // ARM on AUX1 high, plus FAILSAFE (a mode the app doesn't manage) on AUX4.
    modeSlots: Array.from({ length: MODE_SLOT_COUNT }, (_, i): ModeSlot => {
      if (i === 0) return { boxId: 0, auxChannel: 0, start: 1700, end: 2100 }
      if (i === 1) return { boxId: 27, auxChannel: 3, start: 1800, end: 2100 }
      return { boxId: 0, auxChannel: 0, start: 900, end: 900 }
    }),
    // Betaflight defaults: sliders on (RPY), everything at 1.0 including Dynamic D.
    simplifiedTuning: [
      2,
      100,
      100,
      100,
      100,
      100,
      100,
      100,
      100,
      ...new Array<number>(8).fill(0),
      ...defaultFilterSliders(),
    ],
    filterConfig: defaultFilterConfig(),
    // denom 1 · DSHOT300 · pwm rate 480 · idle 550 · ... · debug count 80
    advancedConfig: [1, 1, 0, 6, 0xe0, 0x01, 0x26, 0x02, 0, 0, 0, 0, 48, 125, 0, 0, 0, 1, 0, 80],
    motor: { poles: 14, bidirDshot: false, mixerMode: 3, propsOut: false },
    motorOutputReordering: Array.from({ length: MAX_MOTORS }, (_, i) => i),
    // Betaflight defaults: Actual rates, 70 / 670 / 0 on every axis, rate limit 1998, throttle mid 50
    rcTuning: [
      7, 0, 67, 67, 67, 0, 50, 0, 0, 0, 0, 7, 7, 0, 0, 100, 0xce, 0x07, 0xce, 0x07, 0xce, 0x07, 3,
      0,
    ],
    osd: defaultOsd(),
    // Betaflight defaults: F1 (5740 MHz), lowest power, and no VTX table yet
    vtx: {
      band: 4,
      channel: 1,
      power: 1,
      frequency: 5740,
      lowPowerDisarm: 0,
      pitModeFrequency: 0,
      bandCount: 0,
      channelCount: 0,
      powerLevelCount: 0,
      bands: Array.from({ length: VTX_MAX_BANDS }, emptyVtxBand),
      powerLevels: Array.from({ length: VTX_MAX_POWER_LEVELS }, emptyVtxPowerLevel),
    },
    // Betaflight defaults: disarm after 5 s, arm angle 25°
    armingConfig: [5, 0, 25, 0],
    // Betaflight defaults (DShot beacon tone 1, off for RX lost + RX set), but with the RX set beep muted
    beeperConfig: [0x00, 0x02, 0, 0, 1, 0x02, 0x02, 0, 0],
    accCalibrated: false,
  }
}

/**
 * Firmware defaults (everything off, piled up at `OSD_POS(21, 10)`) plus a minimal setup: Warnings, average cell
 * voltage, and Crosshairs — an element the app doesn't manage. Timers: on time and total armed time, alarm 10.
 */
function defaultOsd(): MockFcConfig['osd'] {
  const hidden = { profiles: 0, variant: 0 }
  const shown = { profiles: 0b111, variant: 0 }
  const positions = new Array<number>(FIRMWARE_ELEMENT_COUNT).fill(
    encodePosition({ x: 21, y: 10, ...hidden }),
  )
  positions[elementIndex('WARNINGS')] = encodePosition({ x: 9, y: 10, ...shown })
  positions[elementIndex('AVG_CELL_VOLTAGE')] = encodePosition({ x: 1, y: 14, ...shown })
  positions[elementIndex('CROSSHAIRS')] = encodePosition({ x: 13, y: 6, ...shown })
  return { positions, timers: [0x0a00, 0x0a01] }
}

/**
 * What the CLI's `defaults` would leave behind, i.e. what its `diff` compares with: `defaultMockConfig` minus the
 * setup — only the USB port speaks MSP, no modes, no telemetry, and the two settings changed outside this app at
 * their Betaflight defaults.
 */
export function firmwareDefaultConfig(): MockFcConfig {
  const config = defaultMockConfig()
  return {
    ...config,
    ports: config.ports.map(({ identifier }) =>
      port(identifier, identifier === 20 ? PORT_FUNCTION.MSP : 0),
    ),
    features: FEATURE.RX_SERIAL | FEATURE.OSD | FEATURE.AIRMODE,
    settings: { ...config.settings, crashflip_motor_percent: '0', osd_units: 'METRIC' },
    modeSlots: config.modeSlots.map(() => ({ boxId: 0, auxChannel: 0, start: 900, end: 900 })),
  }
}

/** The mock has one profile of each kind, but takes a switch to any the firmware would have. */
const CLI_PROFILE_SWITCH = /^(profile|rateprofile|battery_profile) [0-3]$/
const CLI_SET = /^set (\S+)\s*=\s*(.*)$/
const CLI_FEATURE = /^feature (-?)(\w+)$/

export interface MockFcOptions {
  /** Injectable clock so tests get deterministic telemetry. */
  now?: () => number
  config?: MockFcConfig
  /** Gyro sample rate, a property of the hardware: 8000 (default) or e.g. 3200 for a BMI270. */
  gyroSampleRateHz?: number
  /** The ESCs behind the motor outputs, reachable through MSP_SET_PASSTHROUGH. Default: `defaultMockEscs()`. */
  escs?: MockEsc[]
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
  private readonly gyroSampleRateHz: number
  private outbox: Uint8Array[] = []
  private saved: MockFcConfig
  private running: MockFcConfig
  // Runtime state that a reboot clears
  private motors: number[] = new Array<number>(8).fill(MOTOR_STOP)
  private armingDisabledByMsp = false
  private accCalibrations = 0
  /** Every MSP2_SEND_DSHOT_COMMAND that reached the ESCs (a DShot protocol was active). */
  private dshotCommands: DshotCommandRequest[] = []
  private flash = { usedBytes: 3_500_000, ready: true }
  private readonly escs: MockEsc[]
  /** Non-null from MSP_SET_PASSTHROUGH on; while it hasn't exited, the port speaks 4-way instead of MSP. */
  private fourWay: MockFourWayInterface | null = null
  /** The non-interactive CLI, from an STX until its ETX; the port doesn't speak MSP meanwhile. */
  private cli: MockCliSession | null = null

  constructor(options: MockFcOptions = {}) {
    this.now = options.now ?? Date.now
    this.gyroSampleRateHz = options.gyroSampleRateHz ?? 8000
    this.escs = options.escs ?? defaultMockEscs()
    this.saved = structuredClone(options.config ?? defaultMockConfig())
    this.running = structuredClone(this.saved)
    this.osdInit()
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

  /** How often MSP_ACC_CALIBRATION was received. */
  get accCalibrationCount(): number {
    return this.accCalibrations
  }

  get armingDisabled(): boolean {
    return this.armingDisabledByMsp
  }

  /** The ESCs on the motor outputs (live objects). For assertions in tests. */
  get connectedEscs(): readonly MockEsc[] {
    return this.escs
  }

  /** The DShot commands sent so far, oldest first. For assertions in tests. */
  get dshotCommandLog(): DshotCommandRequest[] {
    return this.dshotCommands.map((c) => ({ ...c, commands: [...c.commands] }))
  }

  /** The last ESC passthrough session (null before the first one). For assertions in tests. */
  get escPassthrough(): MockFourWayInterface | null {
    return this.fourWay
  }

  /** Feed bytes written by the host; returns the encoded response frames (possibly none). */
  receive(data: Uint8Array): Uint8Array[] {
    if (this.fourWay && !this.fourWay.exited) return this.fourWay.receive(data)
    if (this.cli && !this.cli.exited) return this.cli.receive(data)
    // The firmware looks for the STX on an idle port only. Hosts write whole MSP frames, so checking the first
    // byte of a write is as good as that.
    if (data[0] === 0x02) {
      this.cli = new MockCliSession((command) => this.runCliCommand(command))
      return [...this.cli.enter(), ...this.cli.receive(data.subarray(1))]
    }
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
          gyroSampleRateHz: this.gyroSampleRateHz,
          configurationProblems: this.running.accCalibrated
            ? 0
            : CONFIGURATION_PROBLEM.ACC_NEEDS_CALIBRATION,
        })
      case MSP.STATUS:
        return encodeStatus({
          // PID loop time: gyro rate / pid_process_denom
          cycleTimeUs: Math.round(
            (1e6 * (this.running.advancedConfig[1] ?? 1)) / this.gyroSampleRateHz,
          ),
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

      case MSP.ACC_CALIBRATION:
        // The firmware saves the whole config once the calibration is through (saveConfigAndNotify).
        this.accCalibrations++
        this.running.accCalibrated = true
        this.saved = structuredClone(this.running)
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

      case MSP.OSD_CONFIG:
        return encodeOsdConfig({
          supported: true,
          deviceDetected: true,
          videoSystem: this.videoSystem(),
          ...this.running.osd,
          profileCount: 3,
          selectedProfile: 1,
        })
      case MSP.SET_OSD_CONFIG: {
        // Elements and timers only; the general settings (addr -1) aren't simulated.
        const write = decodeSetOsdConfig(request)
        if (!write) return null
        const { positions, timers } = this.running.osd
        if ('timer' in write) {
          if (write.timer >= timers.length) return null
          timers[write.timer] = write.config
        } else {
          if (write.element >= positions.length) return null
          positions[write.element] = write.position
        }
        return EMPTY
      }
      case MSP.OSD_CANVAS:
        return encodeOsdCanvas(this.osdCanvas())

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
        return encodeRc([
          1500,
          1500,
          1500,
          1000,
          1000,
          Math.round(1500 + 500 * Math.sin(t * 0.8)),
          1500,
          1000,
        ])

      case MSP.SIMPLIFIED_TUNING:
        return Uint8Array.from(this.running.simplifiedTuning)
      case MSP.SET_SIMPLIFIED_TUNING:
        if (request.length !== this.running.simplifiedTuning.length) return null
        this.running.simplifiedTuning = applyFilterSliders(request)
        this.running.filterConfig = copySharedCutoffs(
          'toFilterConfig',
          this.running.filterConfig,
          this.running.simplifiedTuning,
        )
        return EMPTY
      case MSP.CALCULATE_SIMPLIFIED_PID:
        return calculatePids(request)

      case MSP.FILTER_CONFIG:
        return Uint8Array.from(this.running.filterConfig)
      case MSP.SET_FILTER_CONFIG:
        if (request.length !== this.running.filterConfig.length || isFilterConfigRejected(request))
          return null
        this.running.filterConfig = [...request]
        this.running.simplifiedTuning = copySharedCutoffs(
          'toSimplified',
          this.running.filterConfig,
          this.running.simplifiedTuning,
        )
        return EMPTY

      case MSP.RC_TUNING:
        return Uint8Array.from(this.running.rcTuning)
      case MSP.SET_RC_TUNING:
        if (request.length < 10) return null
        this.running.rcTuning = this.running.rcTuning.map((byte, i) => request[i] ?? byte)
        return EMPTY

      case MSP.ADVANCED_CONFIG:
        return Uint8Array.from(this.running.advancedConfig)
      case MSP.SET_ADVANCED_CONFIG:
        this.running.advancedConfig = this.running.advancedConfig.map(
          (byte, i) => request[i] ?? byte,
        )
        return EMPTY
      case MSP.MOTOR_CONFIG:
        return encodeMotorConfig({
          advancedConfig: [],
          motorCount: 4,
          maxThrottle: 2000,
          minCommand: 1000,
          ...this.running.motor,
          dynIdle: 0,
          outputOrder: [],
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
        // Only dyn_idle_min_rpm (byte 49) and TPA (bytes 57–60) are meaningful in the mock.
        const payload = new Uint8Array(61)
        const settings = this.running.settings
        payload[49] = Number(settings['dyn_idle_min_rpm'])
        payload[57] = ['PD', 'D', 'PDS'].indexOf(settings['tpa_mode'] ?? 'D')
        payload[58] = Number(settings['tpa_rate'])
        new DataView(payload.buffer).setUint16(59, Number(settings['tpa_breakpoint']), true)
        return payload
      }
      case MSP.SET_MOTOR:
        this.motors = decodeSetMotor(request).slice(0, 8)
        return EMPTY
      case MSP.SET_ARMING_DISABLED:
        this.armingDisabledByMsp = request[0] === 1
        return EMPTY
      case MSP.MOTOR_OUTPUT_REORDERING:
        return encodeMotorOutputReordering(this.running.motorOutputReordering)
      case MSP.SET_MOTOR_OUTPUT_REORDERING: {
        // Like the firmware: motors beyond the sent count go back to their own output.
        const sent = decodeMotorOutputReordering(request)
        this.running.motorOutputReordering = Array.from(
          { length: MAX_MOTORS },
          (_, i) => sent[i] ?? i,
        )
        return EMPTY
      }
      case MSP.SEND_DSHOT_COMMAND: {
        // `dshotCommandWrite` drops everything unless a DShot protocol is running; the reply is an ack either way.
        if (!isDshot(this.running.advancedConfig[3] ?? 0)) return EMPTY
        const command = decodeDshotCommand(request)
        this.dshotCommands.push(command)
        const escs =
          command.motorIndex === DSHOT_ALL_MOTORS
            ? this.escs
            : [this.escs[command.motorIndex]].filter((esc) => esc !== undefined)
        // Only the direction takes effect in the mock, and only once the ESC is told to store it.
        if (command.commands.includes(DSHOT_CMD.SAVE_SETTINGS))
          for (const esc of escs) {
            if (command.commands.includes(DSHOT_CMD.SPIN_DIRECTION_REVERSED))
              setMockEscReversed(esc, true)
            else if (command.commands.includes(DSHOT_CMD.SPIN_DIRECTION_NORMAL))
              setMockEscReversed(esc, false)
          }
        return EMPTY
      }
      case MSP.SET_PASSTHROUGH:
        // Only the BLHeli 4-way mode (no payload, or mode 0xFF). `esc4wayInit` disables the motor outputs; from
        // the reply on the port speaks 4-way until cmd_InterfaceExit (see `receive`).
        if (request.length > 0 && request[0] !== 0xff) return Uint8Array.of(0)
        this.motors = new Array<number>(8).fill(MOTOR_STOP)
        this.fourWay = new MockFourWayInterface(this.escs, this.now)
        return Uint8Array.of(this.escs.length)

      case MSP.VTX_CONFIG: {
        const vtx = this.running.vtx
        return encodeVtxConfig({
          deviceType: 0xff, // no VTX connected
          band: vtx.band,
          channel: vtx.channel,
          power: vtx.power,
          pitMode: false,
          frequency: vtx.frequency,
          deviceReady: false,
          lowPowerDisarm: vtx.lowPowerDisarm,
          pitModeFrequency: vtx.pitModeFrequency,
          tableAvailable: true,
          bands: vtx.bandCount,
          channels: vtx.channelCount,
          powerLevels: vtx.powerLevelCount,
        })
      }
      case MSP.SET_VTX_CONFIG:
        return this.setVtxConfig(request) ? EMPTY : null
      case MSP.VTXTABLE_BAND: {
        const index = request[0] ?? 0
        const band = this.running.vtx.bands[index - 1]
        if (!band) return null
        // Fixed-length, space-padded name like the firmware sends it
        return encodeVtxBand(index, {
          ...band,
          name: band.name.padEnd(8),
          frequencies: band.frequencies.slice(0, this.running.vtx.channelCount),
        })
      }
      case MSP.VTXTABLE_POWERLEVEL: {
        const index = request[0] ?? 0
        const level = this.running.vtx.powerLevels[index - 1]
        return level ? encodeVtxPowerLevel(index, { ...level, label: level.label.padEnd(3) }) : null
      }
      case MSP.SET_VTXTABLE_BAND: {
        const vtx = this.running.vtx
        const { index, band } = decodeVtxBand(request)
        if (index < 1 || index > vtx.bandCount) return null
        const frequencies = Array.from({ length: VTX_MAX_CHANNELS }, (_, i) =>
          i < vtx.channelCount ? (band.frequencies[i] ?? 0) : 0,
        )
        vtx.bands[index - 1] = {
          ...band,
          name: band.name.toUpperCase(),
          letter: band.letter.toUpperCase(),
          frequencies,
        }
        if (index === vtx.band) vtx.frequency = frequencies[vtx.channel - 1] ?? 0
        return EMPTY
      }
      case MSP.SET_VTXTABLE_POWERLEVEL: {
        const { index, level } = decodeVtxPowerLevel(request)
        if (index < 1 || index > this.running.vtx.powerLevelCount) return null
        this.running.vtx.powerLevels[index - 1] = { ...level, label: level.label.toUpperCase() }
        return EMPTY
      }

      case MSP.ARMING_CONFIG:
        return Uint8Array.from(this.running.armingConfig)
      case MSP.SET_ARMING_CONFIG:
        if (request.length < 2) return null
        this.running.armingConfig = [...request, ...this.running.armingConfig.slice(request.length)]
        return EMPTY
      case MSP.BEEPER_CONFIG:
        return Uint8Array.from(this.running.beeperConfig)
      case MSP.SET_BEEPER_CONFIG:
        if (request.length < 4) return null
        this.running.beeperConfig = [...request, ...this.running.beeperConfig.slice(request.length)]
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

  /** Output of a CLI command, null for the ones the mock doesn't have. */
  private runCliCommand(command: string): string | null {
    const diff = /^diff all( defaults)?$/.exec(command)
    if (diff) return renderDiff(this.running, firmwareDefaultConfig(), diff[1] !== undefined)
    // `set` changes the running config like the firmware's cliSet, for the variables the mock keeps by name.
    const set = CLI_SET.exec(command)
    if (set) {
      const [, name = '', value = ''] = set
      if (!(name in this.running.settings)) return '###ERROR IN set: INVALID NAME###\r\n'
      this.running.settings[name] = value
      return `${name} set to ${value}\r\n`
    }
    // `feature NAME` / `feature -NAME` like cliFeature, for the features the mock knows.
    const feature = CLI_FEATURE.exec(command)
    if (feature) {
      const [, off, name = ''] = feature
      const bit = (FEATURE as Record<string, number>)[name]
      if (bit === undefined) return '###ERROR IN feature: INVALID NAME###\r\n'
      this.running.features =
        (off ? this.running.features & ~bit : this.running.features | bit) >>> 0
      return `${off ? 'Disabled' : 'Enabled'} ${name}\r\n`
    }
    if (CLI_PROFILE_SWITCH.test(command)) return `${command}\r\n`
    return null
  }

  private serialRxProvider(): number {
    const name = this.running.settings['serialrx_provider']
    const entry = Object.entries(SERIALRX_PROVIDER_NAMES).find(([, n]) => n === name)
    return entry ? Number(entry[0]) : SERIALRX_CRSF
  }

  /** `vcd_video_system` as its enum value (AUTO, PAL, NTSC, HD). */
  private videoSystem(): number {
    const name = this.running.settings['vcd_video_system'] ?? ''
    return Math.max(
      0,
      VIDEO_SYSTEM_NAMES.findIndex((n) => n.toUpperCase() === name),
    )
  }

  /**
   * `osd_canvas_width/height`, which `osdInit` sets to the display's size: the HD default until goggles announce
   * something else; an MSP displayport has NTSC's 13 rows unless the video system is PAL; the MAX7456 sees a PAL
   * camera.
   */
  private osdCanvas(): Canvas {
    const videoSystem = this.videoSystem()
    if (videoSystem === VIDEO_SYSTEM.HD) return { cols: 53, rows: 20 }
    const msp = this.running.settings['osd_displayport_device'] === 'MSP'
    const ntsc = msp ? videoSystem !== VIDEO_SYSTEM.PAL : videoSystem === VIDEO_SYSTEM.NTSC
    return { cols: 30, rows: ntsc ? 13 : 16 }
  }

  /** Like the firmware's `osdInit`: at boot, elements outside the display move onto its last column / row. */
  private osdInit(): void {
    const { cols, rows } = this.osdCanvas()
    const { positions } = this.running.osd
    positions.forEach((raw, i) => {
      const position = decodePosition(raw)
      if (position.x < cols && position.y < rows) return
      positions[i] = encodePosition({
        ...position,
        x: Math.min(position.x, cols - 1),
        y: Math.min(position.y, rows - 1),
      })
    })
  }

  /** Like the firmware: selection first, then the table's dimensions and (optionally) a wipe of the table. */
  private setVtxConfig(request: Uint8Array): boolean {
    const vtx = this.running.vtx
    const next = decodeSetVtxConfig(request)
    const lookedUp = vtx.bands[next.band - 1]?.frequencies[next.channel - 1] ?? 0
    Object.assign(vtx, {
      band: next.band,
      channel: next.channel,
      frequency: next.band > 0 ? lookedUp : next.frequency,
      power: next.power,
      lowPowerDisarm: next.lowPowerDisarm,
      pitModeFrequency: next.pitModeFrequency,
    })
    if (
      next.bands > VTX_MAX_BANDS ||
      next.channels > VTX_MAX_CHANNELS ||
      next.powerLevels > VTX_MAX_POWER_LEVELS
    )
      return false
    vtx.bandCount = next.bands
    vtx.channelCount = next.channels
    vtx.powerLevelCount = next.powerLevels
    if (next.clearTable) {
      vtx.bands = Array.from({ length: VTX_MAX_BANDS }, emptyVtxBand)
      vtx.powerLevels = Array.from({ length: VTX_MAX_POWER_LEVELS }, emptyVtxPowerLevel)
    }
    return true
  }

  /** Like the firmware: unknown port identifiers fail the whole message. */
  private setSerialConfig(ports: SerialPortConfig[]): boolean {
    if (
      ports.some(
        (p) => !this.running.ports.some((existing) => existing.identifier === p.identifier),
      )
    )
      return false
    this.running.ports = this.running.ports.map(
      (existing) => ports.find((p) => p.identifier === existing.identifier) ?? existing,
    )
    return true
  }

  private reboot(): void {
    this.running = structuredClone(this.saved)
    this.osdInit()
    this.motors = new Array<number>(8).fill(MOTOR_STOP)
    this.armingDisabledByMsp = false
    this.fourWay = null
    this.cli = null
    this.parser.reset()
    this.outbox = []
    this.onReboot?.()
  }
}

/** Rough stand-in for the firmware's slider math; enough for the preview to react sensibly. */
function calculatePids(sliders: Uint8Array): Uint8Array {
  const [
    ,
    master = 100,
    pitchDGain = 100,
    iGain = 100,
    dGain = 100,
    piGain = 100,
    dMaxGain = 100,
    ffGain = 100,
  ] = sliders
  const pitchPiGain = sliders[8] ?? 100
  const scale = (base: number, ...percents: number[]) =>
    Math.min(250, Math.round(percents.reduce((value, percent) => (value * percent) / 100, base)))

  const w = new ByteWriter()
  for (const [axis, [p, i, d, dMax, f]] of BASE_PIDS.entries()) {
    // simplified_tuning.c: the two pitch sliders multiply the pitch axis only — PI gain P/I/F, the ratio D/D max
    const pitchPi = axis === 1 ? pitchPiGain : 100
    const pitchD = axis === 1 ? pitchDGain : 100
    const dTerm = scale(d, master, dGain, pitchD)
    w.u8(scale(p, master, piGain, pitchPi))
      .u8(scale(i, master, piGain, iGain, pitchPi))
      .u8(dTerm)
      .u8(dMaxGain === 0 ? dTerm : scale(dMax, master, dGain, pitchD))
      .u16(scale(f, master, ffGain, pitchPi))
  }
  return w.toBytes()
}
