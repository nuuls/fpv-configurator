/** Acceptance checks for the Setup, Blackbox, Orientation, Modes, PID Tuning and Motors tabs (docs/tabs/*.md). */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nudge, openTab, resetAppAfterEach, saveAndReboot, saveWithoutReboot } from '@/test/app'

resetAppAfterEach()

describe('sidebar', () => {
  it('mirrors the scope in docs/SPEC.md', async () => {
    await openTab('Setup')
    const tabs = within(screen.getByRole('navigation', { name: 'Tabs' })).getAllByRole('link')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Setup', 'Ports', 'Orientation', 'PID Tuning', 'Filters', 'Rates', 'Modes', 'Motors', 'OSD', 'Analog VTX', 'Blackbox',
    ])
  })
})

describe('Setup tab', () => {
  it('saves the PID loop frequency across a reboot', async () => {
    const user = await openTab('Setup')
    const group = await screen.findByRole('group', { name: 'PID loop frequency' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['4 kHz', '8 kHz'])
    expect(within(group).getByRole('button', { name: '8 kHz' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeDisabled()

    await user.click(within(group).getByRole('button', { name: '4 kHz' }))
    await saveAndReboot(user)
    const after = await screen.findByRole('group', { name: 'PID loop frequency' })
    expect(within(after).getByRole('button', { name: '4 kHz' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('250 µs')).toBeInTheDocument()
  })
})

describe('Blackbox tab', () => {
  it('shows storage, saves the logging rate across a reboot', async () => {
    const user = await openTab('Blackbox')
    expect(await screen.findByText(/Onboard flash: 3\.3 MB of 16\.0 MB used/)).toBeInTheDocument()
    expect(screen.getByLabelText('Log to')).toHaveValue('1')
    expect(within(screen.getByLabelText('Log to')).queryByRole('option', { name: /SD card|Serial/ })).toBeNull()

    await user.selectOptions(screen.getByLabelText('Logging rate'), '1/8 (1 kHz)')
    await saveAndReboot(user)
    expect(await screen.findByLabelText('Logging rate')).toHaveValue('3')
  })

  it('erases the flash after confirmation', async () => {
    const user = await openTab('Blackbox')
    await user.click(await screen.findByRole('button', { name: 'Erase storage' }))
    await user.click(await screen.findByRole('button', { name: 'Erase' }))
    expect(await screen.findByText(/Onboard flash: 0 kB of/, {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('restarts as a USB drive and explains how to get back', async () => {
    const user = await openTab('Blackbox')
    await user.click(await screen.findByRole('button', { name: 'Activate mass storage' }))
    await user.click(await screen.findByRole('button', { name: 'Restart as USB drive' }))
    expect(await screen.findByText(/restarted as a USB drive/)).toBeInTheDocument()
  })
})

describe('Orientation tab', () => {
  it('offers 45° steps and saves across a reboot', async () => {
    const user = await openTab('Orientation')
    const yaw = await screen.findByLabelText('Yaw')
    expect(within(yaw).getAllByRole('option').map((o) => o.textContent)).toEqual(
      ['0°', '45°', '90°', '135°', '180°', '225°', '270°', '315°'],
    )
    await user.selectOptions(yaw, '90')
    await user.selectOptions(screen.getByLabelText('Roll'), '180')
    expect(screen.getByRole('img', { name: /yaw 90°, roll 180°/ })).toBeInTheDocument()

    await saveAndReboot(user)
    expect(await screen.findByLabelText('Yaw')).toHaveValue('90')
    expect(screen.getByLabelText('Roll')).toHaveValue('180')
  })

  it('calibrates the accelerometer, but not with an unsaved rotation', async () => {
    const user = await openTab('Orientation')
    const yaw = await screen.findByLabelText('Yaw')
    const calibrate = screen.getByRole('button', { name: 'Calibrate accelerometer' })

    await user.selectOptions(yaw, '90')
    expect(calibrate).toBeDisabled()
    expect(screen.getByText('Save the board rotation first.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revert' }))

    await user.click(calibrate)
    expect(await screen.findByText('Keep the quad still…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calibrating…' })).toBeDisabled()
    expect(await screen.findByText('Calibration finished and saved.', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calibrate accelerometer' })).toBeEnabled()
  })
})

describe('Modes tab', () => {
  it('shows only the four supported modes and mentions the ones it leaves alone', async () => {
    await openTab('Modes')
    expect(await screen.findByText('Arm')).toBeInTheDocument()
    for (const label of ['Angle', 'Turtle mode', 'Beeper']) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText(/Horizon|Failsafe|Air ?mode/i)).toBeNull()
    expect(screen.getByText(/1 other mode range is set up/)).toBeInTheDocument()
    expect(screen.getByText('1700 – 2100')).toBeInTheDocument()
  })

  it('adds and edits a range, and saves without rebooting', async () => {
    const user = await openTab('Modes')
    await user.click(await screen.findByRole('button', { name: 'Add Angle range' }))
    await user.selectOptions(screen.getByLabelText('Angle range 1 channel'), 'AUX 2')
    const [start] = within(screen.getByLabelText('Angle range 1')).getAllByRole('slider')
    await nudge(user, start!, '{ArrowLeft}{ArrowLeft}')
    expect(screen.getByText('1650 – 2100')).toBeInTheDocument()

    await saveWithoutReboot(user)
    expect(screen.getByLabelText('Angle range 1 channel')).toHaveValue('1')
    expect(screen.getByText('1650 – 2100')).toBeInTheDocument()
  })

  it('removes a range', async () => {
    const user = await openTab('Modes')
    await user.click(await screen.findByRole('button', { name: 'Remove Arm range 1' }))
    expect(screen.queryByText('1700 – 2100')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})

describe('PID Tuning tab', () => {
  it('shows two sliders, a live PID preview and warns about hidden tuning', async () => {
    const user = await openTab('PID Tuning')
    expect(await screen.findAllByRole('slider')).toHaveLength(2)
    expect(screen.getByText(/Saving resets those/)).toBeInTheDocument()
    expect(await screen.findAllByRole('cell', { name: '45' })).toHaveLength(2) // roll + yaw P at 1.0

    await nudge(user, within(screen.getByLabelText('Master multiplier')).getByRole('slider'), '{ArrowRight}{ArrowRight}')
    expect(screen.getByText('1.10')).toBeInTheDocument()
    expect(await screen.findAllByRole('cell', { name: '50' })).toHaveLength(2) // 45 × 1.1
  })

  it('saves sliders without a reboot and a smoothing preset with one', async () => {
    const user = await openTab('PID Tuning')
    await nudge(user, within(await screen.findByLabelText('Damping')).getByRole('slider'), '{ArrowLeft}')
    await saveWithoutReboot(user)
    expect(screen.getByText('0.95')).toBeInTheDocument()
    expect(screen.queryByText(/Saving resets those/)).toBeNull() // hidden values are now pinned

    await user.click(screen.getByRole('button', { name: /^Light smoothing/ }))
    await saveAndReboot(user)
    expect(await screen.findByRole('button', { name: /^Light smoothing/, pressed: true })).toBeInTheDocument()
  })
})

describe('Rates tab', () => {
  it('shows Actual rates with all axes synced, and one shared curve', async () => {
    await openTab('Rates')
    expect(await screen.findByLabelText('Rate type')).toHaveValue('3')
    expect(screen.getByLabelText('Axes')).toHaveValue('all')
    expect(screen.getByLabelText('Roll max rate')).toHaveValue(670)
    expect(screen.getByLabelText('Roll expo')).toHaveValue(0)
    expect(screen.getByLabelText('Pitch max rate')).toBeDisabled()
    expect(screen.getByLabelText('Yaw max rate')).toBeDisabled()
    expect(within(screen.getByRole('list', { name: 'Legend' })).getByText('Roll · Pitch · Yaw')).toBeInTheDocument()
    expect(screen.getByText('max 670°/s')).toBeInTheDocument()
  })

  it('syncs edits across axes according to the sync mode and updates the curve', async () => {
    const user = await openTab('Rates')
    const rollMax = await screen.findByLabelText('Roll max rate')
    await user.clear(rollMax)
    await user.type(rollMax, '800')
    expect(screen.getByLabelText('Pitch max rate')).toHaveValue(800)
    expect(screen.getByLabelText('Yaw max rate')).toHaveValue(800)
    expect(screen.getByText('max 800°/s')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Axes'), 'roll-pitch')
    const yawMax = screen.getByLabelText('Yaw max rate')
    expect(yawMax).toBeEnabled()
    await user.clear(yawMax)
    await user.type(yawMax, '500')
    expect(screen.getByLabelText('Pitch max rate')).toHaveValue(800)
    const legend = within(screen.getByRole('list', { name: 'Legend' }))
    expect(legend.getByText('Roll · Pitch')).toBeInTheDocument()
    expect(legend.getByText('Yaw')).toBeInTheDocument()

    await saveWithoutReboot(user)
    expect(screen.getByLabelText('Yaw max rate')).toHaveValue(500)
    expect(screen.getByLabelText('Axes')).toHaveValue('roll-pitch')
  })

  it('lets a field be cleared and retyped, keeping the last value if it is left empty', async () => {
    const user = await openTab('Rates')
    const rollMax = await screen.findByLabelText('Roll max rate')
    await user.clear(rollMax)
    expect(rollMax).toHaveValue(null) // no 0 sneaking in
    expect(screen.getByLabelText('Pitch max rate')).toHaveValue(670)
    await user.type(rollMax, '5')
    expect(rollMax).toHaveValue(5)
    expect(screen.getByLabelText('Pitch max rate')).toHaveValue(5)

    await user.clear(rollMax)
    await user.tab()
    expect(rollMax).toHaveValue(5)
  })

  it('refuses out-of-range values', async () => {
    const user = await openTab('Rates')
    const expo = await screen.findByLabelText('Roll expo')
    await user.clear(expo)
    await user.type(expo, '1.5')
    expect(screen.getByText(/Roll expo must be between 0.00 and 1.00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('Motors tab', () => {
  it('warns while bidirectional DShot is off and offers props out first', async () => {
    const user = await openTab('Motors')
    expect(await screen.findByText(/Bidirectional DShot is off/)).toBeInTheDocument()
    expect(within(screen.getByLabelText('Prop direction')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Props out (default)',
      'Props in',
    ])
    await user.click(screen.getByLabelText('Bidirectional DShot'))
    expect(screen.queryByText(/Bidirectional DShot is off/)).toBeNull()
  })

  it('saves ESC settings across a reboot', async () => {
    const user = await openTab('Motors')
    expect(await screen.findByLabelText('ESC protocol')).toHaveValue('6')
    await user.selectOptions(screen.getByLabelText('ESC protocol'), 'DSHOT600')
    await user.click(screen.getByLabelText('Bidirectional DShot'))
    await user.selectOptions(screen.getByLabelText('Prop direction'), 'out')

    await saveAndReboot(user)
    expect(await screen.findByLabelText('ESC protocol')).toHaveValue('7')
    expect(screen.getByLabelText('Bidirectional DShot')).toBeChecked()
    expect(screen.getByLabelText('Prop direction')).toHaveValue('out')
  })

  it('rates dynamic idle against the 5" zones and saves it', async () => {
    const user = await openTab('Motors')
    const idle = () => within(screen.getByRole('group', { name: 'Dynamic idle' })).getByRole('slider')
    expect(await screen.findByText(/Off — drag the slider/)).toBeInTheDocument()
    expect(idle()).toHaveAttribute('data-disabled') // needs bidirectional DShot first

    await user.click(screen.getByLabelText('Bidirectional DShot'))
    await nudge(user, idle(), '{ArrowRight}') // 12 → 13
    expect(screen.getByText(/Too low: motors can stall/)).toBeInTheDocument()
    await nudge(user, idle(), '{ArrowRight}{ArrowRight}{ArrowRight}') // 16
    expect(screen.getByText(/A bit low for a 5"/)).toBeInTheDocument()
    await nudge(user, idle(), '{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}') // 20
    expect(screen.getByText('Good for a 5"')).toBeInTheDocument()
    expect(screen.getByText('20 (2000 rpm)')).toBeInTheDocument()

    await saveAndReboot(user)
    expect(await screen.findByText('20 (2000 rpm)')).toBeInTheDocument()
  })

  it('shows the quad from above with spin directions and live RPM once bidirectional DShot is on', async () => {
    const user = await openTab('Motors')
    expect(await screen.findByText('RPM readout needs bidirectional DShot.')).toBeInTheDocument()
    // props in on the mock: motors 1 and 4 turn clockwise, 2 and 3 counter-clockwise
    expect(screen.getAllByRole('img', { name: /spins clockwise/ }).map((ring) => ring.getAttribute('aria-label'))).toEqual([
      'Motor 4 spins clockwise',
      'Motor 1 spins clockwise',
    ])
    expect(screen.getAllByRole('img', { name: /spins counter-clockwise/ })).toHaveLength(2)
    expect(screen.queryByText(/rpm$/)).toBeNull()

    await user.click(screen.getByLabelText('Bidirectional DShot'))
    await saveAndReboot(user)
    await user.click(await screen.findByLabelText(/I have removed all propellers/))
    await nudge(user, within(screen.getByLabelText('Motor 1')).getByRole('slider'), '{ArrowUp}{ArrowUp}')
    expect(await screen.findByText('1800 rpm')).toBeInTheDocument() // mock: 1500 + 10 × 30
    expect(screen.getAllByText('0 rpm')).toHaveLength(3)
  })

  it('keeps motor control locked until props are confirmed off, and while there are unsaved edits', async () => {
    const user = await openTab('Motors')
    const motor1 = within(await screen.findByLabelText('Motor 1')).getByRole('slider')
    expect(motor1).toHaveAttribute('data-disabled')

    await user.click(screen.getByLabelText(/I have removed all propellers/))
    expect(within(screen.getByLabelText('Motor 1')).getByRole('slider')).not.toHaveAttribute('data-disabled')
    await nudge(user, within(screen.getByLabelText('Motor 1')).getByRole('slider'), '{ArrowRight}{ArrowRight}')
    expect(screen.getAllByText('1010')).toHaveLength(2) // motor 1 and the "all motors" readout

    await user.selectOptions(screen.getByLabelText('Prop direction'), 'out') // unsaved edit → locks the test
    expect(screen.getByLabelText(/I have removed all propellers/)).not.toBeChecked()
    expect(within(screen.getByLabelText('Motor 1')).getByRole('slider')).toHaveAttribute('data-disabled')
    expect(screen.queryByText('1010')).toBeNull()
  })
})
