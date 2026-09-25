/** Acceptance checks from docs/tabs/osd.md, driven through the real UI against the mock FC. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openTab, resetAppAfterEach, saveAndReboot, saveWithoutReboot } from '@/test/app'

resetAppAfterEach()

const preview = () => screen.getByRole('group', { name: /OSD preview/ })

describe('OSD tab', () => {
  it('lists the 13 elements and previews the ones the FC shows', async () => {
    await openTab('OSD')
    const switches = await screen.findAllByRole('switch')
    expect(switches).toHaveLength(13)
    expect(switches.filter((s) => s.getAttribute('aria-checked') === 'true')).toHaveLength(2)
    expect(screen.getByLabelText('Warnings')).toBeChecked()
    expect(screen.getByLabelText('Battery average cell voltage')).toBeChecked()
    expect(screen.getByLabelText('Warnings X')).toHaveValue(9)
    expect(screen.getByLabelText('Warnings Y')).toHaveValue(10)
    expect(screen.queryByLabelText('Current draw X')).toBeNull()

    expect(preview()).toHaveAccessibleName('OSD preview, 30 by 16 characters')
    expect(within(preview()).getAllByRole('button')).toHaveLength(2)
    expect(
      within(preview()).getByRole('button', { name: 'Warnings, column 9, row 10' }),
    ).toHaveTextContent('LOW BATTERY')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('places a newly shown element on a free spot and saves it without a reboot', async () => {
    const user = await openTab('OSD')
    await user.click(await screen.findByLabelText('Timer 2 (armed time)'))
    expect(screen.getByLabelText('Timer 2 (armed time) X')).toHaveValue(24)
    expect(screen.getByLabelText('Timer 2 (armed time) Y')).toHaveValue(1)
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()

    await saveWithoutReboot(user)
    expect(screen.getByLabelText('Timer 2 (armed time)')).toBeChecked()
    expect(
      within(preview()).getByRole('button', { name: 'Timer 2 (armed time), column 24, row 1' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
  })

  it('moves the focused preview element with the arrow keys, and reverts', async () => {
    const user = await openTab('OSD')
    const warnings = await screen.findByRole('button', { name: 'Warnings, column 9, row 10' })
    warnings.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowUp}')
    expect(screen.getByLabelText('Warnings X')).toHaveValue(11)
    expect(screen.getByLabelText('Warnings Y')).toHaveValue(9)

    // the whole sample stays on the 30-column screen: "LOW BATTERY" is 11 wide
    await user.keyboard('{ArrowRight>20/}')
    expect(screen.getByLabelText('Warnings X')).toHaveValue(19)

    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(screen.getByLabelText('Warnings X')).toHaveValue(9)
    expect(screen.getByLabelText('Warnings Y')).toHaveValue(10)
  })

  it('shows the units the FC uses and saves another choice without a reboot', async () => {
    const user = await openTab('OSD')
    const units = await screen.findByLabelText('Units')
    expect(units).toHaveDisplayValue('Metric (m, km/h)')
    await user.click(screen.getByLabelText('Altitude'))
    const altitude = () => within(preview()).getByRole('button', { name: /^Altitude,/ })
    expect(altitude()).toHaveTextContent('12.3m')

    await user.selectOptions(units, 'Imperial (ft, mph)')
    expect(altitude()).toHaveTextContent('40.4ft')
    await saveWithoutReboot(user)
    expect(screen.getByLabelText('Units')).toHaveDisplayValue('Imperial (ft, mph)')
    expect(altitude()).toHaveTextContent('40.4ft')
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
  })

  it('blocks saving a position outside the screen', async () => {
    const user = await openTab('OSD')
    const x = await screen.findByLabelText('Warnings X')
    await user.clear(x)
    await user.type(x, '30')
    expect(screen.getByText('Warnings: X must be between 0 and 29.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('offers to hide elements it does not manage', async () => {
    const user = await openTab('OSD')
    expect(
      await screen.findByText(/1 other element is switched on .* \(Crosshairs\)/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide other elements' }))
    expect(screen.getByText('Will be switched off when you save.')).toBeInTheDocument()

    await saveWithoutReboot(user)
    await waitFor(() => expect(screen.queryByText(/other element/)).toBeNull())
  })

  it('lists the GPS elements only once a GPS is set up in the Ports tab', async () => {
    const user = await openTab('OSD')
    expect(
      await screen.findByText(/GPS elements .* once a GPS is set up in the Ports tab/),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('GPS satellites')).toBeNull()

    await user.click(screen.getByRole('link', { name: 'Ports' }))
    await user.selectOptions(await screen.findByLabelText('GPS'), 'on')
    await user.selectOptions(screen.getByLabelText('GPS port'), '54')
    await saveAndReboot(user)

    await user.click(screen.getByRole('link', { name: 'OSD' }))
    await user.click(await screen.findByLabelText('GPS satellites'))
    expect(screen.getAllByRole('switch')).toHaveLength(21)
    expect(screen.queryByText(/once a GPS is set up/)).toBeNull()
    expect(screen.getByLabelText('GPS satellites X')).toHaveValue(1)
    expect(screen.getByLabelText('GPS satellites Y')).toHaveValue(2)

    await saveWithoutReboot(user)
    expect(screen.getByLabelText('GPS satellites')).toBeChecked()
    expect(
      within(preview()).getByRole('button', { name: 'GPS satellites, column 1, row 2' }),
    ).toHaveTextContent('SAT14')
  })

  it('shows the HD canvas once a digital VTX is set up', async () => {
    const user = await openTab('Ports')
    await user.selectOptions(await screen.findByLabelText('VTX type'), 'msp')
    await user.selectOptions(screen.getByLabelText('VTX port'), '51')
    await saveAndReboot(user)

    await user.click(screen.getByRole('link', { name: 'OSD' }))
    expect(
      await screen.findByRole('group', { name: 'OSD preview, 53 by 20 characters' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/HD video/)).toBeInTheDocument()
  })
})
