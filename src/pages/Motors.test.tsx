/** Acceptance checks for the direction flip and motor swap of the Motors tab (docs/tabs/motors.md). */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DIRECTION_CHECK } from '@/lib/motors/model'
import { nudge, openTab, resetAppAfterEach, saveAndReboot } from '@/test/app'

resetAppAfterEach()

/** The flip stops, waits, sends, waits, spins for a while and stops again — in real time. */
const FLIP_MS = DIRECTION_CHECK.stopMs + DIRECTION_CHECK.settleMs + DIRECTION_CHECK.spinMs

describe('Motors tab — direction and swap', () => {
  it('flips a motor direction with one click once motor control is on, then spins it to show', async () => {
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
    expect(screen.queryByText('1010')).toBeNull() // every motor stopped first
    expect(flip()).toBeDisabled() // busy
    expect(
      await screen.findByText(
        /Motor 2 set to reversed — spinning it to check/,
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument()
    // the check spin shows on motor 2 (and the "all motors" readout), then everything stops again
    await waitFor(
      () => expect(screen.getAllByText(String(DIRECTION_CHECK.spinValue))).toHaveLength(2),
      { timeout: 2000 },
    )
    await waitFor(() => expect(screen.queryByText(String(DIRECTION_CHECK.spinValue))).toBeNull(), {
      timeout: FLIP_MS,
    })
    expect(flip()).toBeEnabled()
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeChecked()

    // the next click sends the opposite; switching the test off clears the note and locks the icon
    await user.click(flip())
    expect(
      await screen.findByText(/Motor 2 set to normal/, {}, { timeout: 2000 }),
    ).toBeInTheDocument()
    await user.click(screen.getByLabelText(/I have removed all propellers/))
    expect(screen.queryByText(/spinning it to check/)).toBeNull()
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
    expect(screen.getByRole('button', { name: 'Swap motor 2' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: /^Swap with motor/ })).toHaveLength(3)

    // Escape cancels, clicking the icon again cancels too
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/Click the motor to swap/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Swap motor 1' }))
    await user.click(screen.getByRole('button', { name: 'Cancel swapping motor 1' }))
    expect(screen.queryByText(/Click the motor to swap/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Swap motor 1' }))
    await user.click(screen.getByRole('button', { name: 'Swap with motor 3' }))
    expect(
      screen.getByText(
        'Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1 — Save & Reboot to apply.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Click the motor to swap/)).toBeNull()
    // an unsaved edit locks the motor test
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeDisabled()

    await saveAndReboot(user)
    expect(
      await screen.findByText('Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeEnabled()

    // swapping back restores the default and the hint goes away
    await user.click(screen.getByRole('button', { name: 'Swap motor 3' }))
    await user.click(screen.getByRole('button', { name: 'Swap with motor 1' }))
    expect(screen.queryByText(/drives ESC output/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeEnabled()
  })
})
