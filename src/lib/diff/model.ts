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

export function parseDiff(output: string): DiffReport {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const report: DiffReport = {
    firmware: null,
    board: null,
    sections: [],
    errors: [],
    text: lines.join('\n').trim(),
  }
  const boardInfo: Record<string, string> = {}
  let section: DiffSection | null = null
  let versionFollows = false
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
      const title = line.slice(2).trim()
      if (versionFollows) {
        report.firmware = title
        versionFollows = false
      } else if (title === 'version') {
        versionFollows = true
      } else if (title.startsWith(CRAFT_NAME)) {
        open('name').entries.push({ kind: 'setting', name: 'name', value: title.slice(CRAFT_NAME.length), defaultValue: '-' })
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
        else if (PROFILE_SWITCH.test(line)) open(line)
        else if (!RESTORE_COMMANDS.has(line)) add({ kind: 'command', line, isDefault: false })
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

/** Default lines explain a difference, they aren't one. */
export function countDifferences(report: DiffReport): number {
  let count = 0
  for (const section of report.sections) {
    for (const entry of section.entries) if (entry.kind === 'setting' || !entry.isDefault) count++
  }
  return count
}
