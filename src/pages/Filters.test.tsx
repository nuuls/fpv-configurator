import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nudge, openTab, resetAppAfterEach, saveWithoutReboot } from '@/test/app'

resetAppAfterEach()

/** Waits for the tab to have read the FC. */
const slider = async (label: string) => within(await screen.findByLabelText(label)).getByRole('slider')

// Acceptance list: docs/tabs/filters.md
describe('Filters tab', () => {
  it('shows stock Betaflight filters and warns about what saving changes', async () => {
    await openTab('Filters')
    expect(await screen.findAllByRole('slider')).toHaveLength(2)
    expect(screen.getByText('1.0 · 500 Hz')).toBeInTheDocument()
    expect(screen.getByText('1.00 · 75–150 Hz + 150 Hz')).toBeInTheDocument()
    expect(screen.getByLabelText('RPM filter min frequency')).toHaveValue(100)
    expect(screen.getByLabelText('Dynamic notch count')).toHaveValue('3')
    expect(screen.getByLabelText('Dynamic notch min frequency')).toHaveValue(100)

    expect(screen.getByText(/Saving changes them: gyro lowpass 1 is turned off\./)).toBeInTheDocument()
    expect(screen.getByText(/Bidirectional DShot is off/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves sliders and numbers without a reboot', async () => {
    const user = await openTab('Filters')
    await nudge(user, await slider('Gyro lowpass 2'), '{ArrowRight}{ArrowRight}')
    expect(screen.getByText('1.2 · 600 Hz')).toBeInTheDocument()
    await nudge(user, await slider('D-term filtering'), '{ArrowLeft}')
    await user.selectOptions(screen.getByLabelText('Dynamic notch count'), '1')
    await user.clear(screen.getByLabelText('RPM filter min frequency'))
    await user.type(screen.getByLabelText('RPM filter min frequency'), '80')
    await saveWithoutReboot(user)

    expect(screen.getByText('1.2 · 600 Hz')).toBeInTheDocument()
    expect(screen.getByText('0.95 · 71–142 Hz + 142 Hz')).toBeInTheDocument()
    expect(screen.getByLabelText('Dynamic notch count')).toHaveValue('1')
    expect(screen.getByLabelText('RPM filter min frequency')).toHaveValue(80)
    expect(screen.queryByText(/Saving changes them/)).toBeNull() // the filter stack is now pinned

    // still there after leaving the tab and coming back
    await user.click(screen.getByRole('link', { name: 'Setup' }))
    await user.click(await screen.findByRole('link', { name: 'Filters' }))
    expect(await screen.findByText('1.2 · 600 Hz')).toBeInTheDocument()
  })

  it('switches gyro lowpass 2 off at the left end', async () => {
    const user = await openTab('Filters')
    await nudge(user, await slider('Gyro lowpass 2'), '{Home}')
    expect(screen.getByText('Off', { selector: 'span' })).toBeInTheDocument()
    await saveWithoutReboot(user)
    expect(screen.getByText('Off', { selector: 'span' })).toBeInTheDocument()
  })

  it('blocks saving an out-of-range frequency and disables the notch frequency while the notch is off', async () => {
    const user = await openTab('Filters')
    await user.clear(await screen.findByLabelText('Dynamic notch min frequency'))
    await user.type(screen.getByLabelText('Dynamic notch min frequency'), '300')
    expect(screen.getByText(/Dynamic notch min frequency must be 20–250 Hz/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Dynamic notch count'), '0')
    expect(screen.getByLabelText('Dynamic notch min frequency')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
