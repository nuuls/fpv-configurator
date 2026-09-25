/** Acceptance checks for the pre-flight checklist on the Setup tab (docs/tabs/setup.md). */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openTab, resetAppAfterEach, saveAndReboot } from '@/test/app'

resetAppAfterEach()

const row = (name: string | RegExp) =>
  within(screen.getByRole('list', { name: 'Pre-flight checklist' })).getByRole('listitem', { name })

describe('Setup tab: pre-flight checklist', () => {
  it('lists what the mock FC still needs', async () => {
    await openTab('Setup')
    expect(await screen.findByText('4 of 5 settings need attention.')).toBeInTheDocument()
    expect(
      within(row('Bidirectional DShot is not enabled')).getByRole('link', { name: 'Open Motors' }),
    ).toBeInTheDocument()
    expect(
      within(row('Accelerometer is not calibrated')).getByRole('link', {
        name: 'Open Orientation',
      }),
    ).toBeInTheDocument()
    expect(row('Arm angle is not 180°')).toHaveTextContent('25°')
    expect(row('Beeper or DShot beacon is silent on RX set or RX loss')).toHaveTextContent(
      'Beeper off for RX set · DShot beacon off for RX set and RX loss',
    )
    expect(row('Airmode is on')).toHaveTextContent('On')
    expect(within(row('Airmode is on')).queryByRole('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeDisabled()
  })

  it('fixes arm angle and beeper with Save & Reboot; Revert takes a fix back', async () => {
    const user = await openTab('Setup')
    await screen.findByText('4 of 5 settings need attention.')

    await user.click(within(row(/Arm angle/)).getByRole('button', { name: 'Fix' }))
    expect(row(/Arm angle/)).toHaveTextContent('180° · not saved yet')
    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(row(/Arm angle/)).toHaveTextContent('25°')

    await user.click(within(row(/Arm angle/)).getByRole('button', { name: 'Fix' }))
    await user.click(within(row(/Beeper/)).getByRole('button', { name: 'Fix' }))
    expect(screen.getByText('2 of 5 settings need attention.')).toBeInTheDocument()
    await saveAndReboot(user)

    expect(await screen.findByText('2 of 5 settings need attention.')).toBeInTheDocument()
    expect(row(/Arm angle/)).toHaveTextContent('180°')
    expect(row(/Arm angle/)).not.toHaveTextContent('not saved yet')
    expect(within(row(/Beeper/)).queryByRole('button')).toBeNull()
    expect(row(/Beeper/)).toHaveTextContent(/On$/)
  })

  it('sees an accelerometer calibrated on the Orientation tab', async () => {
    const user = await openTab('Setup')
    await screen.findByText('4 of 5 settings need attention.')
    await user.click(within(row('Accelerometer is not calibrated')).getByRole('link'))
    await user.click(await screen.findByRole('button', { name: 'Calibrate accelerometer' }))
    expect(
      await screen.findByText('Calibration finished and saved.', {}, { timeout: 3000 }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Setup' }))
    expect(await screen.findByText('3 of 5 settings need attention.')).toBeInTheDocument()
    expect(row('Accelerometer is calibrated')).toHaveTextContent('Calibrated')
  })
})

const externalList = () => screen.getByRole('list', { name: 'Changed outside this app' })
const externalRow = (name: string) => within(externalList()).getByRole('listitem', { name })

describe('Setup tab: changed outside this app', () => {
  it("lists the settings changed in Betaflight Configurator, default → value; the mock's features do not count", async () => {
    await openTab('Setup')
    expect(await screen.findByText('1 change made outside this app.')).toBeInTheDocument()
    expect(externalRow('crashflip_motor_percent')).toHaveTextContent('master')
    expect(externalRow('crashflip_motor_percent')).toHaveTextContent('0 → 50')
    expect(within(externalRow('crashflip_motor_percent')).getByText('0').tagName).toBe('DEL') // the default, red
    expect(within(externalRow('crashflip_motor_percent')).getByText('50').tagName).toBe('INS') // what is set, green
    expect(within(externalList()).queryByRole('listitem', { name: /feature/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeDisabled()
  })

  it('resets a setting with Save & Reboot; Keep and Revert take resets back', async () => {
    const user = await openTab('Setup')
    await screen.findByText('1 change made outside this app.')
    const crashflip = () => externalRow('crashflip_motor_percent')

    await user.click(within(crashflip()).getByRole('button', { name: 'Reset' }))
    expect(
      screen.getByText('1 change made outside this app. 1 to reset once saved.'),
    ).toBeInTheDocument()
    expect(crashflip()).toHaveTextContent('50 → 0 · not saved yet')
    expect(within(crashflip()).getByText('0').tagName).toBe('INS') // what it will be
    await user.click(within(crashflip()).getByRole('button', { name: 'Keep' }))
    expect(crashflip()).toHaveTextContent('0 → 50')
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(
      screen.getByText('1 change made outside this app. 1 to reset once saved.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(screen.getByText('1 change made outside this app.')).toBeInTheDocument()

    await user.click(within(crashflip()).getByRole('button', { name: 'Reset' }))
    await saveAndReboot(user)
    expect(await screen.findByText('Nothing was changed outside this app.')).toBeInTheDocument()

    // the Diff Checker sees the same FC
    await user.click(screen.getByRole('link', { name: 'Diff Checker' }))
    expect(await screen.findByText(/^0 tuning differences · 6 other hidden/)).toBeInTheDocument()
  })
})
