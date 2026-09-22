import { describe, expect, it } from 'vitest'
import {
  canReset,
  changeKey,
  cliErrors,
  countDifferences,
  externalOnly,
  parseDiff,
  parseFlag,
  resetCommands,
  resetLine,
  tuningOnly,
} from './model'

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
    expect(report.firmware).toBe(
      'Betaflight / STM32F405 (S405) 2026.6.2 Jun 30 2026 / 12:00:00 (e0b7bb01b) MSP API: 1.48',
    )
    expect(report.board).toBe('SPBE/SPEEDYBEEF405V4')
    expect(report.errors).toEqual([])
  })

  it('keeps the sections with differences and drops the restore commands', () => {
    expect(report.sections.map((s) => s.title)).toEqual([
      'name',
      'feature',
      'serial',
      'master',
      'profile 1',
      'rateprofile 0',
    ])
  })

  it('keeps the lines that restore the profile selection', () => {
    expect(report.restore).toEqual(['profile 0', 'rateprofile 0', 'battery_profile 0'])
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
    expect(report.sections[0]?.entries).toEqual([
      { kind: 'setting', name: 'name', value: 'Whoop', defaultValue: '-' },
    ])
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

describe('externalOnly', () => {
  const names = (report: ReturnType<typeof parseDiff>, title: string) =>
    report.sections
      .find((s) => s.title === title)
      ?.entries.map((entry) => (entry.kind === 'setting' ? entry.name : entry.line))

  it('drops what the tabs write and keeps the craft name and the rest', () => {
    const external = externalOnly(parseDiff(OUTPUT))
    // dshot_bidir (Motors), small_angle (Setup), dyn_idle_min_rpm (Motors), roll_srate (Rates), AIRMODE (Setup),
    // GPS and serial (Ports) are managed
    expect(external.sections.map((s) => s.title)).toEqual(['name'])
    expect(external.text).toBe(parseDiff(OUTPUT).text)
  })

  it('knows every setting a tab writes, in master and in the profiles', () => {
    const managed = [
      'pid_process_denom',
      'serialrx_provider',
      'align_board_yaw',
      'rc_smoothing_auto_factor',
      'feedforward_smooth_factor',
      'gyro_lpf2_static_hz',
      'dyn_notch_count',
      'rpm_filter_min_hz',
      'dterm_lpf1_dyn_max_hz',
      'simplified_master_multiplier',
      'simplified_gyro_filter_multiplier',
      'p_roll',
      'd_max_pitch',
      'f_yaw',
      'rates_type',
      'yaw_srate',
      'pitch_rc_rate',
      'motor_pwm_protocol',
      'yaw_motors_reversed',
      'osd_warnings_pos',
      'osd_crosshairs_pos',
      'osd_tim2',
      'vtx_band',
      'blackbox_sample_rate',
    ]
    const others = [
      'name',
      'crashflip_motor_percent',
      'osd_units',
      'osd_tim1',
      'osd_warn_batt_warning',
      'gyro_lpf1_type',
      'dyn_notch_q',
      'anti_gravity_gain',
      'tpa_rate',
      'thr_expo',
      'rate_limit_roll',
      'vtx_pit_mode_freq',
      'blackbox_disable_pids',
      'feedforward_boost',
      'vbat_warning_cell_voltage',
    ]
    const output = ['# master', ...[...managed, ...others].map((name) => `set ${name} = 1`)].join(
      '\r\n',
    )
    expect(names(externalOnly(parseDiff(output)), 'master')).toEqual(others)
  })

  it('keeps only the commands no tab writes, without their default lines', () => {
    const output = [
      '# feature',
      'feature -AIRMODE',
      '#feature LED_STRIP',
      'feature LED_STRIP',
      '#feature -GPS',
      'feature GPS',
      '',
      '# beeper',
      'beeper -RX_SET',
      'beeper -GYRO_CALIBRATED',
      '',
      '# beacon',
      'beacon RX_LOST',
      '',
      '# serial',
      '#serial UART2 0 115200 57600 0 115200',
      'serial UART2 64 115200 57600 0 115200',
      '',
      '# aux',
      'aux 0 0 0 1700 2100 0 0',
      '',
      '# vtxtable',
      'vtxtable bands 5',
      '',
      '# map',
      'map TAER1234',
      '',
      '# led',
      '#led 0 0,0::C:2',
      'led 0 0,0::CW:2',
      '',
      '# resource',
      'resource MOTOR 1 A01',
    ].join('\r\n')
    const external = externalOnly(parseDiff(output))
    // features don't count, whichever they are
    expect(external.sections.map((s) => [s.title, ...(names(external, s.title) ?? [])])).toEqual([
      ['beeper', 'beeper -GYRO_CALIBRATED'],
      ['map', 'map TAER1234'],
      ['led', 'led 0 0,0::CW:2'],
      ['resource', 'resource MOTOR 1 A01'],
    ])
    expect(countDifferences(external)).toBe(4)
  })

  it('does not count calibrations', () => {
    const calibrations = [
      'acc_calibration',
      'mag_calibration',
      'acc_trim_roll',
      'gyro_offset_yaw',
      'vbat_scale',
      'vbat_divider',
      'ibata_scale',
      'ibata_offset',
      'ibatv_offset',
    ]
    const output = [
      '# master',
      ...calibrations.map((name) => `set ${name} = 1`),
      'set osd_units = IMPERIAL',
    ].join('\r\n')
    expect(names(externalOnly(parseDiff(output)), 'master')).toEqual(['osd_units'])
  })
})

describe('resetCommands', () => {
  const output = [
    '# name: Whoop',
    '',
    '# feature',
    'feature -TELEMETRY',
    '#feature TELEMETRY',
    '#feature -LED_STRIP',
    'feature LED_STRIP',
    '',
    '# resource',
    'resource MOTOR 1 A01',
    '',
    '# master',
    '#set osd_units = METRIC',
    'set osd_units = IMPERIAL',
    'set vbat_scale = 108',
    '',
    'profile 2',
    '',
    '# profile 2',
    '#set anti_gravity_gain = 80',
    'set anti_gravity_gain = 100',
    '',
    '# restore original profile selection',
    'profile 1',
    '',
    'rateprofile 0',
    '',
    '# rateprofile 0',
    '#set tpa_rate = 65',
    'set tpa_rate = 50',
    '',
    '# restore original rateprofile selection',
    'rateprofile 0',
    '',
    'battery_profile 1',
    '',
    '# battery_profile 1',
    '#set vbat_max_cell_voltage = 430',
    'set vbat_max_cell_voltage = 440',
  ].join('\r\n')
  const report = parseDiff(output)
  const section = (title: string) => report.sections.find((s) => s.title === title)!
  const keys = (...titles: string[]) =>
    new Set(
      titles.flatMap((title) => section(title).entries.map((e) => changeKey(section(title), e))),
    )

  it('undoes a flag command with the opposite flag', () => {
    expect(parseFlag('feature -TELEMETRY')).toEqual({
      command: 'feature',
      flag: '-TELEMETRY',
      opposite: 'TELEMETRY',
    })
    expect(parseFlag('beeper GYRO_CALIBRATED')).toEqual({
      command: 'beeper',
      flag: 'GYRO_CALIBRATED',
      opposite: '-GYRO_CALIBRATED',
    })
    expect(parseFlag('serial UART2 64 115200 57600 0 115200')).toBeNull()
    expect(resetLine({ kind: 'command', line: 'beacon RX_LOST', isDefault: false })).toBe(
      'beacon -RX_LOST',
    )
    expect(resetLine({ kind: 'command', line: 'feature TELEMETRY', isDefault: true })).toBeNull()
    expect(resetLine({ kind: 'command', line: 'map TAER1234', isDefault: false })).toBeNull()
    expect(
      resetLine({ kind: 'setting', name: 'osd_units', value: 'IMPERIAL', defaultValue: 'METRIC' }),
    ).toBe('set osd_units = METRIC')
    expect(
      resetLine({ kind: 'setting', name: 'vbat_scale', value: '108', defaultValue: null }),
    ).toBeNull()
  })

  it('can reset a setting with a known default and a flag, in master or in a profile the diff restores', () => {
    const resettable = report.sections.flatMap((s) =>
      s.entries.filter((e) => canReset(report, s, e)).map((e) => changeKey(s, e)),
    )
    // vbat_scale came without a default, the craft name isn't a `set`, resources stay, and there is no
    // battery_profile restore line
    expect(resettable).toEqual([
      'feature: feature -TELEMETRY',
      'feature: feature LED_STRIP',
      'master: osd_units',
      'profile 2: anti_gravity_gain',
      'rateprofile 0: tpa_rate',
    ])
  })

  it('writes the lines in the order of the diff, switching profiles like the diff does and back at the end', () => {
    expect(
      resetCommands(
        report,
        keys(
          'feature',
          'resource',
          'master',
          'profile 2',
          'rateprofile 0',
          'battery_profile 1',
          'name',
        ),
      ),
    ).toEqual([
      'feature TELEMETRY',
      'feature -LED_STRIP',
      'set osd_units = METRIC',
      'profile 2',
      'set anti_gravity_gain = 80',
      'rateprofile 0',
      'set tpa_rate = 65',
      'profile 1',
      'rateprofile 0',
    ])
    expect(resetCommands(report, keys('rateprofile 0'))).toEqual([
      'rateprofile 0',
      'set tpa_rate = 65',
      'rateprofile 0',
    ])
    expect(resetCommands(report, new Set())).toEqual([])
  })
})

describe('parseDiff edge cases', () => {
  it('reports no sections for an FC at its defaults', () => {
    const report = parseDiff(
      '# version\r\n# Betaflight / X\r\n\r\n# start the command batch\r\nbatch start\r\n\r\n# save configuration\r\nsave',
    )
    expect(report.sections).toEqual([])
    expect(countDifferences(report)).toBe(0)
  })

  it('works without the defaults option', () => {
    const report = parseDiff('# master\r\nset small_angle = 180\r\n')
    expect(report.sections).toEqual([
      {
        title: 'master',
        entries: [{ kind: 'setting', name: 'small_angle', value: '180', defaultValue: null }],
      },
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
    expect(parseDiff('ERR_CMD_NA: diff all defaults\r\n').errors).toEqual([
      'ERR_CMD_NA: diff all defaults',
    ])
    expect(parseDiff('###ERROR IN diff: PARSING FAILED###\r\n').errors).toEqual([
      'ERROR IN diff: PARSING FAILED',
    ])
    expect(
      cliErrors(
        'osd_units set to METRIC\r\n###ERROR IN set: INVALID NAME###\r\nERR_CMD_NA: foo\r\n',
      ),
    ).toEqual(['ERROR IN set: INVALID NAME', 'ERR_CMD_NA: foo'])
    expect(cliErrors('')).toEqual([])
  })

  it('takes a restore line only right after its heading', () => {
    const report = parseDiff(
      '# restore original profile selection\r\n\r\n# master\r\nprofile 1\r\nset a = 1\r\n',
    )
    expect(report.restore).toEqual([])
    expect(report.sections.map((s) => s.title)).toEqual(['profile 1'])
  })

  it('puts lines before the first heading under "other"', () => {
    expect(parseDiff('mixer QUADX\r\n').sections).toEqual([
      { title: 'other', entries: [{ kind: 'command', line: 'mixer QUADX', isDefault: false }] },
    ])
  })
})
