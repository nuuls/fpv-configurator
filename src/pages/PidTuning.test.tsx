/** Acceptance checks for the TPA card of the PID Tuning tab (docs/tabs/pid-tuning.md). */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nudge, openTab, resetAppAfterEach, saveWithoutReboot } from '@/test/app'

resetAppAfterEach()

describe('PID Tuning tab: TPA', () => {
  it('shows the Betaflight defaults and saves changes without a reboot', async () => {
    const user = await openTab('PID Tuning')
    const mode = (name: string) =>
      within(screen.getByRole('group', { name: 'TPA mode' })).getByRole('button', { name })

    expect(await screen.findByText('65 %')).toBeInTheDocument()
    expect(screen.getByText('1350 µs')).toBeInTheDocument()
    expect(mode('D only')).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByText(
        'D is lowered gradually above 35 % throttle, down to 35 % of normal at full throttle.',
      ),
    ).toBeInTheDocument()

    await user.click(mode('P and D'))
    await nudge(
      user,
      within(screen.getByLabelText('TPA rate')).getByRole('slider'),
      '{ArrowLeft}{ArrowLeft}',
    )
    await nudge(
      user,
      within(screen.getByLabelText('TPA breakpoint')).getByRole('slider'),
      '{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}',
    )
    expect(
      screen.getByText(
        'P and D are lowered gradually above 40 % throttle, down to 45 % of normal at full throttle.',
      ),
    ).toBeInTheDocument()

    await saveWithoutReboot(user)
    expect(screen.getByText('55 %')).toBeInTheDocument()
    expect(screen.getByText('1400 µs')).toBeInTheDocument()
    expect(mode('P and D')).toHaveAttribute('aria-pressed', 'true')
  })
})
