import { describe, expect, it } from 'vitest'
import { countDifferences, parseDiff, tuningOnly } from './model'

/** `diff all defaults` as Betaflight 2026.6 prints it (CRLF line ends, blank line before every heading). */
const OUTPUT = [
  '',
  '# version',
  '# Betaflight / STM32F405 (S405) 2026.6.2 Jun 30 2026 / 12:00:00 (e0b7bb01b) MSP API: 1.48',
  '# config rev: 1a2b3c4',
  '',
  '# start the command batch',
  'batch start',
  '',
  '# reset configuration to default settings',
  'defaults nosave',
  '',
  'board_name SPEEDYBEEF405V4',
  'manufacturer_id SPBE',
  'mcu_id 0034002a3133510b33323534',
  'signature ',
  '',
  '# name: Whoop',
  '',
  '# feature',
  'feature -AIRMODE',
  '#feature -GPS',
  '#feature AIRMODE',
  'feature GPS',
  '',
  '# serial',
  '#serial UART2 0 115200 57600 0 115200',
  'serial UART2 64 115200 57600 0 115200',
  '',
  '# master',
  '#set dshot_bidir = OFF',
  'set dshot_bidir = ON',
  '#set small_angle = 25',
  'set small_angle = 180',
  '',
  'profile 0',
  '',
  'profile 1',
  '',
  '# profile 1',
  '#set dyn_idle_min_rpm = 0',
  'set dyn_idle_min_rpm = 35',
  '',
  '# restore original profile selection',
  'profile 0',
  '',
  'rateprofile 0',
  '',
  '# rateprofile 0',
  '#set roll_srate = 67',
  'set roll_srate = 80',
  '',
  '# restore original rateprofile selection',
  'rateprofile 0',
  '',
  'battery_profile 0',
  '',
  '# restore original battery_profile selection',
  'battery_profile 0',
  '',
  '# save configuration',
  'save',
  '# end the command batch',
  'batch end',
  '',
].join('\r\n')

describe('parseDiff', () => {
  const report = parseDiff(OUTPUT)

  it('reads the firmware and the board from the header', () => {
    expect(report.firmware).toBe('Betaflight / STM32F405 (S405) 2026.6.2 Jun 30 2026 / 12:00:00 (e0b7bb01b) MSP API: 1.48')
    expect(report.board).toBe('SPBE/SPEEDYBEEF405V4')
    expect(report.errors).toEqual([])
  })

  it('keeps the sections with differences and drops the restore commands', () => {
    expect(report.sections.map((s) => s.title)).toEqual(['name', 'feature', 'serial', 'master', 'profile 1', 'rateprofile 0'])
  })

  it('pairs a setting with its default', () => {
    expect(report.sections.find((s) => s.title === 'master')?.entries).toEqual([
      { kind: 'setting', name: 'dshot_bidir', value: 'ON', defaultValue: 'OFF' },
      { kind: 'setting', name: 'small_angle', value: '180', defaultValue: '25' },
    ])
    expect(report.sections.find((s) => s.title === 'profile 1')?.entries).toEqual([
      { kind: 'setting', name: 'dyn_idle_min_rpm', value: '35', defaultValue: '0' },
    ])
  })

  it('shows the craft name as a setting', () => {
    expect(report.sections[0]?.entries).toEqual([{ kind: 'setting', name: 'name', value: 'Whoop', defaultValue: '-' }])
  })

  it('keeps other commands as lines, defaults marked', () => {
    expect(report.sections.find((s) => s.title === 'feature')?.entries).toEqual([
      { kind: 'command', line: 'feature -AIRMODE', isDefault: false },
      { kind: 'command', line: 'feature -GPS', isDefault: true },
      { kind: 'command', line: 'feature AIRMODE', isDefault: true },
      { kind: 'command', line: 'feature GPS', isDefault: false },
    ])
  })

  it('counts what is set, not the default lines', () => {
    // name, 2 features, 1 serial, 2 master, 1 profile, 1 rateprofile
    expect(countDifferences(report)).toBe(8)
  })

  it('keeps the output for the clipboard with plain line feeds', () => {
    expect(report.text.startsWith('# version\n# Betaflight')).toBe(true)
    expect(report.text).not.toContain('\r')
  })
})

describe('tuningOnly', () => {
  const report = parseDiff(OUTPUT)
  const tuning = tuningOnly(report)

  it('keeps the PID and rate profiles and drops the setup sections', () => {
    expect(tuning.sections.map((s) => s.title)).toEqual(['master', 'profile 1', 'rateprofile 0'])
    expect(tuning.sections.find((s) => s.title === 'profile 1')).toEqual(
      report.sections.find((s) => s.title === 'profile 1'),
    )
  })

  it('keeps only the tuning settings of master', () => {
    expect(tuning.sections.find((s) => s.title === 'master')?.entries).toEqual([
      { kind: 'setting', name: 'dshot_bidir', value: 'ON', defaultValue: 'OFF' },
    ])
    expect(countDifferences(tuning)).toBe(3)
  })

  it('knows the filter, RC smoothing and motor settings, but not the rest of master', () => {
    const names = [
      'gyro_lpf1_static_hz',
      'dyn_notch_count',
      'rpm_filter_harmonics',
      'simplified_gyro_filter',
      'rc_smoothing_auto_factor',
      'motor_idle',
      'pid_process_denom',
      'deadband',
    ]
    const others = [
      'align_board_yaw',
      'serialrx_provider',
      'osd_vbat_pos',
      'vtx_power',
      'gyro_calib_duration',
      'motor_kv',
      'yaw_motors_reversed',
    ]
    const output = ['# master', ...[...names, ...others].map((name) => `set ${name} = 1`)].join(
      '\r\n',
    )
    expect(
      tuningOnly(parseDiff(output)).sections[0]?.entries.map((entry) =>
        entry.kind === 'setting' ? entry.name : entry.line,
      ),
    ).toEqual(names)
  })

  it('drops battery profiles and lines that are no settings', () => {
    const output =
      '# battery_profile 0\r\nset vbat_max_cell_voltage = 440\r\n\r\n# profile 0\r\n#set p_roll = 45\r\n'
    expect(tuningOnly(parseDiff(output)).sections).toEqual([])
  })

  it('leaves the text for the clipboard complete', () => {
    expect(tuning.text).toBe(report.text)
    expect(tuning.firmware).toBe(report.firmware)
  })
})

describe('parseDiff edge cases', () => {
  it('reports no sections for an FC at its defaults', () => {
    const report = parseDiff('# version\r\n# Betaflight / X\r\n\r\n# start the command batch\r\nbatch start\r\n\r\n# save configuration\r\nsave')
    expect(report.sections).toEqual([])
    expect(countDifferences(report)).toBe(0)
  })

  it('works without the defaults option', () => {
    const report = parseDiff('# master\r\nset small_angle = 180\r\n')
    expect(report.sections).toEqual([
      { title: 'master', entries: [{ kind: 'setting', name: 'small_angle', value: '180', defaultValue: null }] },
    ])
  })

  it('keeps a default whose setting never came as a line', () => {
    const report = parseDiff('# master\r\n#set a = 1\r\nset b = 2\r\n')
    expect(report.sections[0]?.entries).toEqual([
      { kind: 'command', line: 'set a = 1', isDefault: true },
      { kind: 'setting', name: 'b', value: '2', defaultValue: null },
    ])
  })

  it('collects what the CLI complains about', () => {
    expect(parseDiff('ERR_CMD_NA: diff all defaults\r\n').errors).toEqual(['ERR_CMD_NA: diff all defaults'])
    expect(parseDiff('###ERROR IN diff: PARSING FAILED###\r\n').errors).toEqual(['ERROR IN diff: PARSING FAILED'])
  })

  it('puts lines before the first heading under "other"', () => {
    expect(parseDiff('mixer QUADX\r\n').sections).toEqual([
      { title: 'other', entries: [{ kind: 'command', line: 'mixer QUADX', isDefault: false }] },
    ])
  })
})
