/** Acceptance checks for the direction and swap menus of the Motors tab (docs/tabs/motors.md). */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nudge, openTab, resetAppAfterEach, saveAndReboot } from '@/test/app'

resetAppAfterEach()

describe('Motors tab — direction and swap', () => {
  it('sets a motor direction once motor control is on, stopping the motors first', async () => {
    const user = await openTab('Motors')
    const direction = await screen.findByRole('button', { name: 'Motor 2 direction' })
    expect(direction).toBeDisabled()

    await user.click(screen.getByLabelText(/I have removed all propellers/))
    await nudge(
      user,
      within(screen.getByLabelText('Motor 1')).getByRole('slider'),
      '{ArrowRight}{ArrowRight}',
    )
    expect(screen.getAllByText('1010')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Motor 2 direction' }))
    expect(await screen.findByText('Motor 2 direction')).toBeInTheDocument() // the menu's label
    await user.click(screen.getByRole('menuitem', { name: 'Reversed' }))
    expect(
      await screen.findByText(/Motor 2 set to reversed and stored by its ESC/),
    ).toBeInTheDocument()
    expect(screen.queryByText('1010')).toBeNull() // every motor stopped
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeChecked()

    // switching the test off clears the note; the menu locks again
    await user.click(screen.getByLabelText(/I have removed all propellers/))
    expect(screen.queryByText(/stored by its ESC/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Motor 2 direction' })).toBeDisabled()
  })

  it('swaps two motors and applies it with Save & Reboot', async () => {
    const user = await openTab('Motors')
    await user.click(await screen.findByRole('button', { name: 'Swap motor 1' }))
    expect(await screen.findByText('Swap motor 1 with')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Motor 2',
      'Motor 3',
      'Motor 4',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Motor 3' }))
    expect(
      screen.getByText(
        'Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1 — Save & Reboot to apply.',
      ),
    ).toBeInTheDocument()
    // an unsaved edit locks the motor test
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeDisabled()

    await saveAndReboot(user)
    expect(
      await screen.findByText('Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/I have removed all propellers/)).toBeEnabled()

    // swapping back restores the default and the hint goes away
    const swap3 = screen.getByRole('button', { name: 'Swap motor 3' })
    // Nothing is focused after the remount; jsdom then reports the focus move as a window blur, which
    // closes a Radix menu at once (a browser only fires that when the window loses focus).
    swap3.focus()
    await user.click(swap3)
    await user.click(await screen.findByRole('menuitem', { name: 'Motor 1' }))
    expect(screen.queryByText(/drives ESC output/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeEnabled()
  })
})
