import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nudge, openTab, resetAppAfterEach, saveWithoutReboot } from '@/test/app'

resetAppAfterEach()

/** Waits for the tab to have read the FC. */
const slider = async (label: string) => within(await screen.findByLabelText(label)).getByRole('slider')

const notchCount = (label: string) =>
  within(screen.getByRole('group', { name: 'Dynamic notch count' })).getByRole('button', { name: label })

// Acceptance list: docs/tabs/filters.md
describe('Filters tab', () => {
  it('shows stock Betaflight filters and warns about what saving changes', async () => {
    await openTab('Filters')
    expect(await screen.findAllByRole('slider')).toHaveLength(4)
    expect(screen.getByText('1.0 · 500 Hz')).toBeInTheDocument()
    expect(screen.getByText('1.00 · 75–150 Hz + 150 Hz')).toBeInTheDocument()
    expect(await slider('RPM filter min frequency')).toHaveAttribute('aria-valuenow', '100')
    expect(notchCount('3')).toHaveAttribute('aria-pressed', 'true')
    expect(await slider('Dynamic notch min frequency')).toHaveAttribute('aria-valuenow', '100')

    expect(screen.getByText(/Saving changes them: gyro lowpass 1 is turned off\./)).toBeInTheDocument()
    expect(screen.getByText(/Bidirectional DShot is off/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves sliders and the notch count without a reboot', async () => {
    const user = await openTab('Filters')
    await nudge(user, await slider('Gyro lowpass 2'), '{ArrowRight}{ArrowRight}')
    expect(screen.getByText('1.2 · 600 Hz')).toBeInTheDocument()
    await nudge(user, await slider('D-term filtering'), '{ArrowLeft}')
    await user.click(notchCount('1'))
    await nudge(user, await slider('RPM filter min frequency'), '{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(screen.getByText('Min 80 Hz')).toBeInTheDocument()
    await saveWithoutReboot(user)

    expect(screen.getByText('1.2 · 600 Hz')).toBeInTheDocument()
    expect(screen.getByText('0.95 · 71–142 Hz + 142 Hz')).toBeInTheDocument()
    expect(notchCount('1')).toHaveAttribute('aria-pressed', 'true')
    expect(notchCount('3')).toHaveAttribute('aria-pressed', 'false')
    expect(await slider('RPM filter min frequency')).toHaveAttribute('aria-valuenow', '80')
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

  it('keeps the frequency sliders inside the firmware range and disables the notch frequency while the notch is off', async () => {
    const user = await openTab('Filters')
    await nudge(user, await slider('Dynamic notch min frequency'), '{End}{ArrowRight}')
    expect(screen.getByText('250 Hz', { selector: 'span.font-mono' })).toBeInTheDocument()
    await nudge(user, await slider('RPM filter min frequency'), '{Home}{ArrowLeft}')
    expect(screen.getByText('Min 30 Hz')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    await user.click(notchCount('Off'))
    expect(await slider('Dynamic notch min frequency')).toHaveAttribute('data-disabled')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
