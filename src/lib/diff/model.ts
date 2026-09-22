/**
 * The output of the CLI's `diff all defaults` (Betaflight 2026.6 `printConfig` in `src/main/cli/cli.c`):
 *
 *   # <heading>            a section, printed only when something in it differs ("# " = hash + space)
 *   #set name = value      the default of the line that follows ("#" without a space, `defaults` option only)
 *   set name = value       the current value
 *   #serial … / serial …   the same for the other commands (feature, serial, aux, vtxtable, …)
 *   profile 1              switches to a PID / rate / battery profile; its `# profile 1` heading may be missing
 *
 * around which it prints what a restore needs (`batch start`, `defaults nosave`, `save`, …).
 */

/** A CLI variable that isn't at its default. */
export interface SettingChange {
  kind: 'setting'
  name: string
  value: string
  /** null when the FC didn't print it. */
  defaultValue: string | null
}

/**
 * Any other command line. The defaults of these don't pair up reliably — a feature that was switched off prints
 * `feature -GPS` and, further down, `#feature GPS` — so they are kept as lines of their own.
 */
export interface CommandChange {
  kind: 'command'
  line: string
  /** A `#…` line: what the default was, not what is set now. */
  isDefault: boolean
}

export type DiffEntry = SettingChange | CommandChange

export interface DiffSection {
  /** As the CLI names it: `feature`, `master`, `profile 0`, … */
  title: string
  entries: DiffEntry[]
}

export interface DiffReport {
  /** `Betaflight / STM32F405 (S405) 2026.6.2 …` */
  firmware: string | null
  /** `manufacturer_id/board_name`, as far as the FC knows them. */
  board: string | null
  /** Only sections with differences. */
  sections: DiffSection[]
  /** What the CLI complained about (`###ERROR IN …###`, `ERR_CMD_NA: …`). */
  errors: string[]
  /**
   * `profile 1`, `rateprofile 0`, …: the lines under "# restore original … selection" that put the FC's profile
   * selection back after `diff all` switched through every profile. The same lines end a reset script.
   */
  restore: string[]
  /** The output itself with plain line feeds, for the clipboard. */
  text: string
}

/** Printed so that the output can be pasted into another FC; says nothing about this one. */
const RESTORE_COMMANDS = new Set(['batch start', 'batch end', 'defaults nosave', 'save'])
const PROFILE_SWITCH = /^(profile|rateprofile|battery_profile) \d+$/
const BOARD_INFO = /^(board_name|manufacturer_id|mcu_id|signature)(?: (.*))?$/
const SET = /^set (\S+) = (.*)$/
/** `printCraftName` prints a comment instead of a command; "-" stands for no name. */
const CRAFT_NAME = 'name: '
const RESTORE_HEADING = 'restore original '

/** Lines the CLI prints to report a failed command. */
export function cliErrors(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('###') || line.startsWith('ERR_'))
    .map((line) => line.replace(/^#+|#+$/g, '').trim())
}

export function parseDiff(output: string): DiffReport {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const report: DiffReport = {
    firmware: null,
    board: null,
    sections: [],
    errors: [],
    restore: [],
    text: lines.join('\n').trim(),
  }
  const boardInfo: Record<string, string> = {}
  let section: DiffSection | null = null
  let versionFollows = false
  let restoreFollows = false
  let pendingDefault: { name: string; value: string } | null = null

  const open = (title: string): DiffSection => {
    if (section?.title !== title) {
      section = { title, entries: [] }
      report.sections.push(section)
    }
    return section
  }
  const add = (entry: DiffEntry) => (section ?? open('other')).entries.push(entry)
  /** A `#set` that wasn't followed by its `set`. */
  const flushDefault = () => {
    if (pendingDefault) add({ kind: 'command', line: `set ${pendingDefault.name} = ${pendingDefault.value}`, isDefault: true })
    pendingDefault = null
  }

  for (const line of lines) {
    if (line === '') continue

    if (line.startsWith('###') || line.startsWith('ERR_')) {
      report.errors.push(line.replace(/^#+|#+$/g, '').trim())
    } else if (line === '#' || line.startsWith('# ')) {
      flushDefault()
      restoreFollows = false
      const title = line.slice(2).trim()
      if (versionFollows) {
        report.firmware = title
        versionFollows = false
      } else if (title === 'version') {
        versionFollows = true
      } else if (title.startsWith(CRAFT_NAME)) {
        open('name').entries.push({
          kind: 'setting',
          name: 'name',
          value: title.slice(CRAFT_NAME.length),
          defaultValue: '-',
        })
      } else if (title.startsWith(RESTORE_HEADING)) {
        restoreFollows = true
      } else if (!title.startsWith('config rev:')) {
        open(title)
      }
    } else if (line.startsWith('#')) {
      flushDefault()
      const text = line.slice(1).trim()
      const set = SET.exec(text)
      if (set) pendingDefault = { name: set[1] ?? '', value: set[2] ?? '' }
      else add({ kind: 'command', line: text, isDefault: true })
    } else {
      const set = SET.exec(line)
      if (set) {
        const name = set[1] ?? ''
        const known: { name: string; value: string } | null = pendingDefault
        const defaultValue = known?.name === name ? known.value : null
        if (defaultValue !== null) pendingDefault = null
        flushDefault()
        add({ kind: 'setting', name, value: set[2] ?? '', defaultValue })
      } else {
        flushDefault()
        const info = BOARD_INFO.exec(line)
        if (info) boardInfo[info[1] ?? ''] = info[2] ?? ''
        else if (PROFILE_SWITCH.test(line)) {
          if (restoreFollows) report.restore.push(line)
          else open(line)
          restoreFollows = false
        } else if (!RESTORE_COMMANDS.has(line)) add({ kind: 'command', line, isDefault: false })
      }
    }
  }
  flushDefault()

  report.board = [boardInfo.manufacturer_id, boardInfo.board_name].filter(Boolean).join('/') || null
  report.sections = report.sections.filter((s) => s.entries.length > 0)
  return report
}

/** PID and rate profiles hold nothing but the tune. `battery_profile` doesn't. */
const TUNING_SECTION = /^(profile|rateprofile) \d+$/
/**
 * The `master` settings that shape how the quad flies (names from the firmware's `cli/settings.c`): gyro filters,
 * RC smoothing and deadband, the RPM limiter, and what the PID loop and the RPM filter run on. `dshot_idle_value`
 * is the older name of `motor_idle`.
 */
const TUNING_SETTING_PREFIXES = ['gyro_lpf', 'gyro_notch', 'dyn_notch_', 'rpm_filter_', 'rpm_limit', 'simplified_', 'rc_smoothing']
const TUNING_SETTINGS = new Set([
  'gyro_hardware_lpf',
  'pid_process_denom',
  'motor_pwm_protocol',
  'dshot_bidir',
  'motor_poles',
  'motor_idle',
  'dshot_idle_value',
  'mixer_type',
  'deadband',
  'yaw_deadband',
])

function isTuningEntry(section: DiffSection, entry: DiffEntry): boolean {
  if (entry.kind !== 'setting') return false
  if (TUNING_SECTION.test(section.title)) return true
  return section.title === 'master' && (TUNING_SETTINGS.has(entry.name) || TUNING_SETTING_PREFIXES.some((prefix) => entry.name.startsWith(prefix)))
}

/**
 * The report without the setup (features, serial ports, modes, VTX table, resources, OSD, …): PID and rate
 * profiles plus the tuning settings of `master`. `text` stays the complete output.
 */
export function tuningOnly(report: DiffReport): DiffReport {
  const sections = report.sections
    .map((section) => ({ ...section, entries: section.entries.filter((entry) => isTuningEntry(section, entry)) }))
    .filter((section) => section.entries.length > 0)
  return { ...report, sections }
}

// ---- Changed outside this app (Setup tab) ----

/**
 * The CLI variables the tabs of this app write — the "Betaflight setting / MSP" columns of docs/tabs/*.md. A
 * difference in any other variable was made elsewhere, in Betaflight Configurator or the CLI.
 */
const MANAGED_SETTINGS = new Set([
  // Setup
  'pid_process_denom',
  'small_angle',
  // Ports
  'serialrx_provider',
  'osd_displayport_device',
  'vcd_video_system',
  // Orientation
  'align_board_roll',
  'align_board_pitch',
  'align_board_yaw',
  // PID Tuning
  'rc_smoothing',
  'rc_smoothing_auto_factor',
  'rc_smoothing_auto_factor_throttle',
  'feedforward_smooth_factor',
  // Filters
  'gyro_lpf1_static_hz',
  'gyro_lpf1_dyn_min_hz',
  'gyro_lpf1_dyn_max_hz',
  'gyro_lpf2_static_hz',
  'gyro_lpf2_type',
  'gyro_notch1_hz',
  'gyro_notch1_cutoff',
  'gyro_notch2_hz',
  'gyro_notch2_cutoff',
  'dyn_notch_count',
  'dyn_notch_min_hz',
  'rpm_filter_harmonics',
  'rpm_filter_min_hz',
  'dterm_lpf1_static_hz',
  'dterm_lpf1_dyn_min_hz',
  'dterm_lpf1_dyn_max_hz',
  'dterm_lpf2_static_hz',
  'dterm_notch_hz',
  'dterm_notch_cutoff',
  // Rates
  'rates_type',
  // Motors
  'motor_pwm_protocol',
  'motor_poles',
  'dshot_bidir',
  'yaw_motors_reversed',
  'dyn_idle_min_rpm',
  // OSD
  'osd_tim2',
  // Analog VTX
  'vtx_band',
  'vtx_channel',
  'vtx_power',
  'vtx_low_power_disarm',
  'vtx_freq',
  // Blackbox
  'blackbox_device',
  'blackbox_sample_rate',
])
/**
 * Families: the PID Tuning and Filters sliders (`simplified_*`; the firmware derives the PIDs from them), the
 * rates matrix, and every OSD element position (hiding "other elements" writes any of them).
 */
const MANAGED_SETTING_PATTERNS = [
  /^simplified_/,
  /^(p|i|d|d_min|d_max|f)_(roll|pitch|yaw)$/,
  /^(roll|pitch|yaw)_(rc_rate|expo|srate)$/,
  /^osd_\w+_pos$/,
]
/** Commands other than `set` that a tab writes; `feature`, `beeper` and `beacon` only for the names given. */
const MANAGED_COMMANDS = new Set(['serial', 'aux', 'vtxtable'])
const MANAGED_FEATURES = new Set(['AIRMODE', 'RX_SERIAL', 'GPS'])
const MANAGED_BEEPS = new Set(['RX_SET', 'RX_LOST'])

function isManaged(entry: DiffEntry): boolean {
  if (entry.kind === 'setting') return MANAGED_SETTINGS.has(entry.name) || MANAGED_SETTING_PATTERNS.some((p) => p.test(entry.name))
  const flag = parseFlag(entry.line)
  if (flag) return (flag.command === 'feature' ? MANAGED_FEATURES : MANAGED_BEEPS).has(flag.flag.replace(/^-/, ''))
  return MANAGED_COMMANDS.has(entry.line.split(' ')[0] ?? '')
}

/**
 * The report without what a tab of this app manages: what was changed in Betaflight Configurator or the CLI.
 * Default lines of other commands are dropped too (they don't pair up), so every entry is one change.
 */
export function externalOnly(report: DiffReport): DiffReport {
  const sections = report.sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => !isManaged(entry) && (entry.kind === 'setting' || !entry.isDefault)),
    }))
    .filter((section) => section.entries.length > 0)
  return { ...report, sections }
}

/** Identifies a change across the report; CLI variable names are unique, sections make it explicit. */
export function changeKey(section: DiffSection, entry: DiffEntry): string {
  return `${section.title}: ${entry.kind === 'setting' ? entry.name : entry.line}`
}

/** `feature TELEMETRY` ↔ `feature -TELEMETRY`, `beeper -GYRO_CALIBRATED` ↔ `beeper GYRO_CALIBRATED`. */
export function parseFlag(line: string): { command: string; flag: string; opposite: string } | null {
  const match = /^(feature|beeper|beacon) (-?)(\w+)$/.exec(line)
  if (!match) return null
  const [, command = '', off, name = ''] = match
  return { command, flag: `${off}${name}`, opposite: `${off ? '' : '-'}${name}` }
}

/**
 * The CLI line that puts a difference back to its default, or null when there is none: the FC printed no
 * default, or the command isn't a `set` or a flag (`resource`, `led`, `map`, … stay as they are).
 */
export function resetLine(entry: DiffEntry): string | null {
  if (entry.kind === 'setting') return entry.defaultValue === null ? null : `set ${entry.name} = ${entry.defaultValue}`
  const flag = entry.isDefault ? null : parseFlag(entry.line)
  return flag && `${flag.command} ${flag.opposite}`
}

/**
 * Whether the app can put the change back: there is a reset line, it isn't the craft name (a comment in the diff),
 * and a profile setting's profile can be switched to — and back, so the restore line for that kind must be there.
 */
export function canReset(report: DiffReport, section: DiffSection, entry: DiffEntry): boolean {
  if (resetLine(entry) === null || section.title === 'name') return false
  const kind = PROFILE_SWITCH.exec(section.title)?.[1]
  return kind === undefined || report.restore.some((line) => line.startsWith(`${kind} `))
}

/**
 * CLI lines that reset the changes with these keys, the way the diff itself is laid out: switch to the profile,
 * `set name = default`, and at the end the FC's own restore lines for the profiles switched to.
 */
export function resetCommands(report: DiffReport, keys: ReadonlySet<string>): string[] {
  const lines: string[] = []
  const switched = new Set<string>()
  for (const section of report.sections) {
    const resets = section.entries.flatMap((entry) => {
      const line = canReset(report, section, entry) && keys.has(changeKey(section, entry)) ? resetLine(entry) : null
      return line === null ? [] : [line]
    })
    if (resets.length === 0) continue
    const kind = PROFILE_SWITCH.exec(section.title)?.[1]
    if (kind !== undefined) {
      lines.push(section.title)
      switched.add(kind)
    }
    lines.push(...resets)
  }
  for (const line of report.restore) if (switched.has(line.split(' ')[0] ?? '')) lines.push(line)
  return lines
}

/** Default lines explain a difference, they aren't one. */
export function countDifferences(report: DiffReport): number {
  let count = 0
  for (const section of report.sections) {
    for (const entry of section.entries) if (entry.kind === 'setting' || !entry.isDefault) count++
  }
  return count
}
