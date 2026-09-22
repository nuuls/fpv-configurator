import { FEATURE, type SerialPortConfig } from '@/lib/msp/messages'
import type { MockFcConfig } from './mockFc'

const STX = 0x02
const ETX = 0x03
/** The real FC flushes its 64 byte write buffer as it fills up; the host sees the output in pieces. */
const CHUNK_SIZE = 64

/**
 * The non-interactive CLI of Betaflight 2026.6 (`cliEnter(port, false)`): entered with STX, which is echoed;
 * command lines are neither echoed nor followed by a prompt; ETX is echoed and hands the port back to MSP.
 */
export class MockCliSession {
  exited = false
  private readonly run: (command: string) => string | null
  private line = ''

  /** `run` returns a command's output, or null if there is no such command. */
  constructor(run: (command: string) => string | null) {
    this.run = run
  }

  /** The echo of the STX that started the session. */
  enter(): Uint8Array[] {
    return [Uint8Array.of(STX)]
  }

  receive(data: Uint8Array): Uint8Array[] {
    let output = ''
    for (const byte of data) {
      if (byte === ETX) {
        this.exited = true
        output += String.fromCharCode(ETX)
        break
      }
      const char = String.fromCharCode(byte)
      if (char === '\n' || char === '\r') {
        const command = this.line.split('#')[0]?.trim() ?? ''
        this.line = ''
        if (command) output += this.run(command) ?? `ERR_CMD_NA: ${command}\r\n`
      } else if (byte >= 32 && byte <= 126) {
        this.line += char
      }
    }
    const bytes = new TextEncoder().encode(output)
    const chunks: Uint8Array[] = []
    for (let start = 0; start < bytes.length; start += CHUNK_SIZE)
      chunks.push(bytes.slice(start, start + CHUNK_SIZE))
    return chunks
  }
}

/** Betaflight's `baudRates` table; the port config stores indexes into it. */
const BAUD_RATES = [
  0, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 400000, 460800, 500000, 921600, 1000000,
  1500000, 2000000, 2470000,
]

/** CLI variables of `MockFcConfig.settings` that live in a PID profile. */
const PROFILE_SETTINGS = new Set([
  'feedforward_smooth_factor',
  'dyn_idle_min_rpm',
  'anti_gravity_gain',
  'tpa_mode',
  'tpa_rate',
  'tpa_breakpoint',
])

function serialLine(port: SerialPortConfig): string {
  const name = port.identifier === 20 ? 'VCP' : `UART${port.identifier - 50}`
  const baud = (index: number) => BAUD_RATES[index] ?? 0
  return `serial ${name} ${port.functionMask} ${baud(port.mspBaud)} ${baud(port.gpsBaud)} ${baud(port.telemetryBaud)} ${baud(port.blackboxBaud)}`
}

/** The part of the config that the CLI shows as `set name = value`, master and profile variables alike. */
function cliSettings(config: MockFcConfig): Record<string, string> {
  return {
    align_board_roll: String(config.boardAlignment.roll),
    align_board_pitch: String(config.boardAlignment.pitch),
    align_board_yaw: String(config.boardAlignment.yaw),
    dshot_bidir: config.motor.bidirDshot ? 'ON' : 'OFF',
    motor_poles: String(config.motor.poles),
    yaw_motors_reversed: config.motor.propsOut ? 'ON' : 'OFF',
    small_angle: String(config.armingConfig[2] ?? 25),
    ...config.settings,
  }
}

/**
 * `diff all [defaults]` like `printConfig` in the firmware's `cli.c`, for the parts of the mock's config that
 * have a CLI representation: features, serial ports, modes and `cliSettings`. One profile of each kind.
 */
export function renderDiff(
  current: MockFcConfig,
  defaults: MockFcConfig,
  showDefaults: boolean,
): string {
  const out: string[] = []
  const section = (title: string, lines: string[]) => {
    if (lines.length > 0) out.push('', `# ${title}`, ...lines)
  }
  /** One line that differs: the default as a comment, then the line. */
  const changed = (line: string, defaultLine: string | null) =>
    showDefaults && defaultLine !== null ? [`#${defaultLine}`, line] : [line]

  out.push(
    '',
    '# version',
    '# Betaflight / STM32F405 (S405) 2026.6.2 Jun 30 2026 / 12:00:00 (e0b7bb01b) MSP API: 1.48',
  )
  out.push('', '# start the command batch', 'batch start')
  out.push('', '# reset configuration to default settings', 'defaults nosave')
  out.push(
    '',
    'board_name MOCKF405',
    'manufacturer_id MOCK',
    'mcu_id 0034002a3133510b33323534',
    'signature ',
  )

  // Like `printFeature`: what got switched off first, then what is on — the default of each where it differs.
  const features = Object.entries(FEATURE)
  const isOn = (config: MockFcConfig, bit: number) => (config.features & bit) !== 0
  section('feature', [
    ...features.flatMap(([name, bit]) => {
      if (isOn(current, bit) === isOn(defaults, bit)) return []
      return isOn(current, bit) ? (showDefaults ? [`#feature -${name}`] : []) : [`feature -${name}`]
    }),
    ...features.flatMap(([name, bit]) => {
      if (isOn(current, bit) === isOn(defaults, bit)) return []
      return isOn(current, bit) ? [`feature ${name}`] : showDefaults ? [`#feature ${name}`] : []
    }),
  ])

  section(
    'serial',
    current.ports.flatMap((port, i) => {
      const defaultPort = defaults.ports[i]
      const defaultLine = defaultPort ? serialLine(defaultPort) : null
      return serialLine(port) === defaultLine ? [] : changed(serialLine(port), defaultLine)
    }),
  )

  section(
    'aux',
    current.modeSlots.flatMap((slot, i) => {
      const line = (s: typeof slot) => `aux ${i} ${s.boxId} ${s.auxChannel} ${s.start} ${s.end} 0 0`
      const defaultSlot = defaults.modeSlots[i]
      const defaultLine = defaultSlot ? line(defaultSlot) : null
      return line(slot) === defaultLine ? [] : changed(line(slot), defaultLine)
    }),
  )

  const defaultSettings = cliSettings(defaults)
  const settings = (inProfile: boolean) =>
    Object.entries(cliSettings(current)).flatMap(([name, value]) => {
      if (PROFILE_SETTINGS.has(name) !== inProfile) return []
      const defaultValue = defaultSettings[name]
      return value === defaultValue
        ? []
        : changed(
            `set ${name} = ${value}`,
            defaultValue === undefined ? null : `set ${name} = ${defaultValue}`,
          )
    })
  section('master', settings(false))

  out.push('', 'profile 0')
  section('profile 0', settings(true))
  out.push('', '# restore original profile selection', 'profile 0')
  out.push('', 'rateprofile 0')
  out.push('', '# restore original rateprofile selection', 'rateprofile 0')
  out.push('', 'battery_profile 0')
  out.push('', '# restore original battery_profile selection', 'battery_profile 0')
  out.push('', '# save configuration', 'save', '# end the command batch', 'batch end', '')
  return out.join('\r\n')
}
