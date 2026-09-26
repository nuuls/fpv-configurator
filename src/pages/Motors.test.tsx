/** Acceptance checks for the direction flip and motor swap of the Motors tab (docs/tabs/motors.md). */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DIRECTION_CHECK, SWAP_RESTART_MS } from '@/lib/motors/model'
import { nudge, openTab, resetAppAfterEach, saveAndReboot } from '@/test/app'

resetAppAfterEach()

/** The flip stops, waits, sends, waits and restores — in real time. */
const FLIP_MS = DIRECTION_CHECK.stopMs + DIRECTION_CHECK.settleMs

describe('Motors tab — direction and swap', () => {
  it('flips a motor direction with one click while the motor turns, and keeps it turning', async () => {
    const user = await openTab('Motors')
    const flip = () => screen.getByRole('button', { name: 'Flip direction of motor 2' })
    await screen.findByRole('button', { name: 'Flip direction of motor 2' })
    expect(flip()).toBeDisabled()

    await user.click(screen.getByLabelText(/I have removed all propellers/))
    await nudge(
      user,
      within(screen.getByLabelText('Motor 1')).getByRole('slider'),
      '{ArrowRight}{ArrowRight}',
    )
    expect(screen.getAllByText('1010')).toHaveLength(2)

    await user.click(flip())
    expect(flip()).toBeDisabled() // busy: the FC is told to stop, the sliders keep their values
    expect(screen.getAllByText('1010')).toHaveLength(2)
    expect(within(screen.getByLabelText('Motor 1')).getByRole('slider')).toHaveAttribute(
      'data-disabled',
    )
    expect(
      await screen.findByText(
        /Motor 2 set to reversed\. Still the wrong way\?/,
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(flip()).toBeEnabled(), { timeout: FLIP_MS + 1000 })
    expect(screen.getAllByText('1010')).toHaveLength(2) // motor 1 turns again
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeChecked()

    // the next click sends the opposite; switching the test off clears the note and locks the icon
    await user.click(flip())
    expect(
      await screen.findByText(/Motor 2 set to normal/, {}, { timeout: 2000 }),
    ).toBeInTheDocument()
    await user.click(screen.getByLabelText(/I have removed all propellers/))
    expect(screen.queryByText(/Still the wrong way/)).toBeNull()
    expect(flip()).toBeDisabled()
  }, 15000)

  it('swaps two motors by clicking the icon and then the other motor, applied with Save & Reboot', async () => {
    const user = await openTab('Motors')
    await user.click(await screen.findByRole('button', { name: 'Swap motor 1' }))
    expect(
      screen.getByText('Click the motor to swap with motor 1. Esc cancels.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel swapping motor 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // the other motors are targets: their disc and their swap icon alike
    expect(screen.getAllByRole('button', { name: 'Swap with motor 2' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Swap with motor/ })).toHaveLength(6)

    // Escape cancels, clicking the icon again cancels too
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/Click the motor to swap/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Swap motor 1' }))
    await user.click(screen.getByRole('button', { name: 'Cancel swapping motor 1' }))
    expect(screen.queryByText(/Click the motor to swap/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Swap motor 1' }))
    await user.click(screen.getAllByRole('button', { name: 'Swap with motor 3' })[0]!) // the icon
    expect(
      screen.getByText(
        'Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1 — used here already; Save & Reboot to apply it on the flight controller.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Click the motor to swap/)).toBeNull()
    // a pending order is used on this side already, so the motor test stays available
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeEnabled()

    await saveAndReboot(user)
    expect(
      await screen.findByText('Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeEnabled()

    // swapping back restores the default and the hint goes away
    await user.click(screen.getByRole('button', { name: 'Swap motor 3' }))
    await user.click(screen.getAllByRole('button', { name: 'Swap with motor 1' })[1]!) // the disc
    expect(screen.queryByText(/drives ESC output/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeEnabled()
  })

  it('keeps testing through a pending order: the swapped motor takes its slider and RPM along', async () => {
    const user = await openTab('Motors')
    await user.click(await screen.findByLabelText('Bidirectional DShot'))
    await saveAndReboot(user)
    await user.click(await screen.findByLabelText(/I have removed all propellers/))
    const slider = (motor: number) =>
      within(screen.getByLabelText(`Motor ${motor}`)).getByRole('slider')
    await nudge(user, slider(1), '{ArrowUp}{ArrowUp}')
    expect(await screen.findByText('1800 rpm')).toBeInTheDocument() // mock: 1500 + 10 × 30, FC motor 1

    // swap 1 ↔ 3 while it turns: the test stays on, and what was motor 1 is now motor 3 — same FC output
    await user.click(screen.getByRole('button', { name: 'Swap motor 1' }))
    await user.click(screen.getAllByRole('button', { name: 'Swap with motor 3' })[1]!) // the disc
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeChecked()
    expect(slider(3)).toHaveAttribute('aria-valuenow', '1010')
    expect(slider(1)).toHaveAttribute('aria-valuenow', '1000')
    const disc = (motor: number) => screen.getByTitle(new RegExp(`^Motor ${motor} ·`))
    expect(within(disc(3)).getByText('1800 rpm')).toBeInTheDocument()
    expect(within(disc(1)).getByText('0 rpm')).toBeInTheDocument()
    // the cue that it happened: the motors stop for a moment and come back — the same FC motor as before
    expect(slider(3)).toHaveAttribute('data-disabled')
    await waitFor(() => expect(screen.getAllByText('0 rpm')).toHaveLength(4))
    await waitFor(() => expect(within(disc(3)).getByText('1800 rpm')).toBeInTheDocument(), {
      timeout: SWAP_RESTART_MS + 1500,
    })
    await waitFor(() => expect(slider(3)).not.toHaveAttribute('data-disabled'))
    expect(within(disc(1)).getByText('0 rpm')).toBeInTheDocument()
    expect(screen.getAllByText('0 rpm')).toHaveLength(3)

    // moving the new motor 3 drives the FC's motor 1 (output 1), which the mock reports as its RPM
    await nudge(user, slider(3), '{ArrowUp}')
    expect(await within(disc(3)).findByText('1950 rpm')).toBeInTheDocument()

    // saved: the FC uses the order itself, nothing is translated any more
    await user.click(screen.getByLabelText(/I have removed all propellers/))
    await saveAndReboot(user)
    expect(
      await screen.findByText('Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1'),
    ).toBeInTheDocument()
    await user.click(screen.getByLabelText(/I have removed all propellers/))
    await nudge(user, slider(3), '{ArrowUp}')
    expect(await within(disc(3)).findByText('1650 rpm')).toBeInTheDocument()
  })
})

describe('Motors tab — motor idle', () => {
  it('rates motor idle against the 5" zones and saves it', async () => {
    const user = await openTab('Motors')
    const group = () => within(screen.getByRole('group', { name: 'Motor idle' }))
    const idle = () => group().getByRole('slider')
    expect(await screen.findByText('5.5 %')).toBeInTheDocument() // mock FC: Betaflight default
    expect(group().getByText('Good for a 5"')).toBeInTheDocument()

    await nudge(user, idle(), '{Home}') // 2.0 %
    expect(group().getByText('Too low: motors can desync or stall')).toBeInTheDocument()
    await nudge(user, idle(), '{PageUp}') // 3.0 %
    expect(group().getByText('A bit low for a 5" (4–8 % recommended)')).toBeInTheDocument()
    await nudge(user, idle(), '{End}') // 12.0 %
    expect(group().getByText(/Too high: the quad floats/)).toBeInTheDocument()
    await nudge(user, idle(), '{PageDown}{PageDown}') // 10.0 %
    expect(group().getByText('A bit high for a 5" (4–8 % recommended)')).toBeInTheDocument()
    await nudge(user, idle(), '{PageDown}{PageDown}{PageDown}{ArrowRight}') // 7.1 %
    expect(group().getByText('Good for a 5"')).toBeInTheDocument()
    expect(screen.getByText('7.1 %')).toBeInTheDocument()

    await saveAndReboot(user)
    expect(await screen.findByText('7.1 %')).toBeInTheDocument()
  })

  it('explains that motor idle only caps dynamic idle until take-off once dynamic idle is on', async () => {
    const user = await openTab('Motors')
    const group = () => within(screen.getByRole('group', { name: 'Motor idle' }))
    expect(await screen.findByText(/How fast the motors spin at zero throttle/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('Bidirectional DShot'))
    expect(group().getByText(/How fast the motors spin/)).toBeInTheDocument() // dynamic idle still 0
    const dynIdle = within(screen.getByRole('group', { name: 'Dynamic idle' })).getByRole('slider')
    await nudge(user, dynIdle, '{ArrowRight}')
    expect(group().getByText(/Dynamic idle is on: this is the most it may add/)).toBeInTheDocument()
    await nudge(user, group().getByRole('slider'), '{End}')
    expect(group().getByText(/Too high: motors spin hard on the ground/)).toBeInTheDocument()
  })
})
