/** Acceptance checks from docs/tabs/vtx.md, driven through the real UI against the mock FC. */
import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { openTab, resetAppAfterEach, saveWithoutReboot } from '@/test/app'

resetAppAfterEach()

async function loadPreset(user: UserEvent, manufacturer: string, model: RegExp) {
  await user.selectOptions(await screen.findByLabelText('Manufacturer'), manufacturer)
  const select = screen.getByLabelText('VTX')
  await user.selectOptions(select, within(select).getByRole('option', { name: model }))
  await user.click(screen.getByRole('button', { name: 'Load preset' }))
}

describe('Analog VTX tab', () => {
  it('shows a fresh FC: empty table, nothing to pick, nothing to save', async () => {
    await openTab('Analog VTX')
    expect(await screen.findByText(/The VTX table is empty/)).toBeInTheDocument()
    expect(screen.getByText(/No VTX detected/)).toBeInTheDocument()
    expect(screen.getByLabelText('Band')).toBeDisabled()
    expect(screen.getByLabelText('Power')).toBeDisabled()
    expect(screen.getByLabelText('VTX')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load preset' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('offers the VTXs of the chosen manufacturer and loads a preset into the table', async () => {
    const user = await openTab('Analog VTX')
    await user.selectOptions(await screen.findByLabelText('Manufacturer'), 'Rush')
    expect(
      within(screen.getByLabelText('VTX'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Tank Ultimate Plus / Mini / II (SmartAudio 2.1)',
      'Tiny Tank (SmartAudio 2.1)',
      'Tank Racing (SmartAudio 2.1)',
      'Tank Solo (SmartAudio 2.1)',
    ])

    await loadPreset(user, 'TBS', /Unify Pro32 HV/)
    expect(screen.getByText(/Loaded TBS Unify Pro32 HV.*SmartAudio 2\.1/)).toBeInTheDocument()
    expect(screen.getByLabelText('Band 5 name')).toHaveValue('RACEBAND')
    expect(screen.getByLabelText('Band 5 channel 1')).toHaveValue(5658)
    expect(screen.getByLabelText('Power level 4 label')).toHaveValue('1W+')
    expect(screen.getByLabelText('Power level 4 value')).toHaveValue(36)
    // the FC's selection (band 4, channel 1) now means something
    expect(screen.getByLabelText('Band')).toHaveDisplayValue('FATSHARK (F)')
    expect(screen.getByLabelText('Channel')).toHaveDisplayValue('F1 — 5740 MHz')
    expect(screen.getByLabelText('Power')).toHaveDisplayValue('25')
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
  })

  it('saves preset, manual edits and the selection without a reboot, and shows them again', async () => {
    const user = await openTab('Analog VTX')
    await loadPreset(user, 'TBS', /Unify Pro32 HV/)

    const frequency = screen.getByLabelText('Band 5 channel 8')
    await user.clear(frequency)
    await user.type(frequency, '5900')
    await user.click(screen.getByRole('button', { name: 'Remove power level 4' }))
    await user.selectOptions(screen.getByLabelText('Band'), 'RACEBAND (R)')
    await user.selectOptions(screen.getByLabelText('Channel'), 'R8 — 5900 MHz')
    await user.selectOptions(screen.getByLabelText('Power'), '400')
    await saveWithoutReboot(user)

    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
    await user.click(screen.getByRole('link', { name: 'Setup' }))
    await user.click(await screen.findByRole('link', { name: 'Analog VTX' }))
    expect(await screen.findByLabelText('Band 5 channel 8')).toHaveValue(5900)
    expect(screen.getByLabelText('Channel')).toHaveDisplayValue('R8 — 5900 MHz')
    expect(screen.getByLabelText('Power')).toHaveDisplayValue('400')
    expect(screen.queryByLabelText('Power level 4 label')).toBeNull()
  })

  it('offers the three low power disarm options and saves the choice, even with an empty table', async () => {
    const user = await openTab('Analog VTX')
    const select = await screen.findByLabelText('Low power disarm')
    expect(select).toHaveDisplayValue('Off')
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Off', 'On', 'On until first arm'])

    await user.selectOptions(select, 'On until first arm')
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
    await saveWithoutReboot(user)

    await user.click(screen.getByRole('link', { name: 'Setup' }))
    await user.click(await screen.findByRole('link', { name: 'Analog VTX' }))
    expect(await screen.findByLabelText('Low power disarm')).toHaveDisplayValue(
      'On until first arm',
    )
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
  })

  it('builds a table by hand, blocks saving while it is invalid, and reverts', async () => {
    const user = await openTab('Analog VTX')
    await user.click(await screen.findByRole('button', { name: 'Add band' }))
    expect(screen.getByText(/Band 1: the name needs/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.type(screen.getByLabelText('Band 1 name'), 'myband')
    await user.type(screen.getByLabelText('Band 1 letter'), 'm')
    expect(screen.getByLabelText('Band 1 name')).toHaveValue('MYBAND')
    const channel = screen.getByLabelText('Band 1 channel 1')
    await user.clear(channel)
    await user.type(channel, '4000')
    expect(screen.getByText(/Band 1: frequencies must be 5000–5999 MHz/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(screen.queryByLabelText('Band 1 name')).toBeNull()
    expect(screen.getByRole('button', { name: 'Revert' })).toBeDisabled()
  })

  it('disables channels a regional table leaves out', async () => {
    const user = await openTab('Analog VTX')
    await loadPreset(user, 'SpeedyBee', /TX800 \(EU\)/)
    expect(screen.getByLabelText('Band')).toHaveDisplayValue('RACEBAND (R)') // band 4 of this table
    const option = within(screen.getByLabelText('Channel')).getByRole('option', {
      name: 'R1 — not available',
    })
    expect(option).toBeDisabled()
    expect(screen.getByLabelText('Channel')).toHaveDisplayValue('R4 — 5769 MHz')
  })
})
