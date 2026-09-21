/** Acceptance checks for the rate types of the Rates tab (docs/tabs/rates.md); the Actual-only checks are in tabs.test.tsx. */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openTab, resetAppAfterEach, saveWithoutReboot } from '@/test/app'

resetAppAfterEach()

const columns = () => within(screen.getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent).filter(Boolean)

describe('Rates tab: rate types', () => {
  it('offers every Betaflight rate type', async () => {
    await openTab('Rates')
    const options = within(await screen.findByLabelText('Rate type')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Betaflight', 'Raceflight', 'KISS', 'Actual', 'Quick'])
    expect(columns()).toEqual(['Center sensitivity (°/s)', 'Max rate (°/s)', 'Expo'])
  })

  it('relabels the table and starts from the defaults of the chosen type', async () => {
    const user = await openTab('Rates')
    const type = await screen.findByLabelText('Rate type')

    await user.selectOptions(type, 'Betaflight')
    expect(columns()).toEqual(['RC rate', 'Super rate', 'RC expo'])
    expect(screen.getByLabelText('Roll RC rate')).toHaveValue(1)
    expect(screen.getByLabelText('Yaw super rate')).toHaveValue(0.7)
    expect(screen.getByLabelText('Pitch RC expo')).toHaveValue(0)
    expect(screen.getByText('max 667°/s')).toBeInTheDocument()

    await user.selectOptions(type, 'Raceflight')
    expect(columns()).toEqual(['Rate (°/s)', 'Acro+', 'Expo'])
    expect(screen.getByLabelText('Roll rate')).toHaveValue(370)
    expect(screen.getByLabelText('Roll acro+')).toHaveValue(80)
    expect(screen.getByLabelText('Roll expo')).toHaveValue(50)
    expect(screen.getByText('max 666°/s')).toBeInTheDocument()

    await user.selectOptions(type, 'KISS')
    expect(columns()).toEqual(['RC rate', 'Rate', 'RC curve'])
    expect(screen.getByLabelText('Roll rate')).toHaveValue(0.7)

    await user.selectOptions(type, 'Quick')
    expect(columns()).toEqual(['RC rate', 'Max rate (°/s)', 'Expo'])
    expect(screen.getByLabelText('Roll RC rate')).toHaveValue(1)
    expect(screen.getByLabelText('Roll max rate')).toHaveValue(670)
    expect(screen.getByText('max 670°/s')).toBeInTheDocument()
  })

  it('resets edited values and the sync mode on every switch, also back to the type on the FC', async () => {
    const user = await openTab('Rates')
    const type = await screen.findByLabelText('Rate type')
    await user.selectOptions(screen.getByLabelText('Axes'), 'off')
    const rollMax = screen.getByLabelText('Roll max rate')
    await user.clear(rollMax)
    await user.type(rollMax, '900')

    await user.selectOptions(type, 'Quick')
    expect(screen.getByLabelText('Axes')).toHaveValue('all')
    expect(screen.getByLabelText('Roll max rate')).toHaveValue(670)
    await user.selectOptions(type, 'Actual')
    expect(screen.getByLabelText('Roll max rate')).toHaveValue(670)
    expect(screen.getByLabelText('Roll center sensitivity')).toHaveValue(70)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled() // stock values again: nothing to save
  })

  it('saves another rate type and shows it again after the reload', async () => {
    const user = await openTab('Rates')
    await user.selectOptions(await screen.findByLabelText('Rate type'), 'Betaflight')
    const superRate = screen.getByLabelText('Roll super rate')
    await user.clear(superRate)
    await user.type(superRate, '0.75')
    expect(screen.getByLabelText('Yaw super rate')).toHaveValue(0.75)

    await saveWithoutReboot(user)
    expect(screen.getByLabelText('Rate type')).toHaveValue('0')
    expect(screen.getByLabelText('Roll super rate')).toHaveValue(0.75)
    expect(screen.getByLabelText('Roll RC rate')).toHaveValue(1)
    expect(screen.getByText('max 800°/s')).toBeInTheDocument()
  })

  it('checks values against the limits of the type', async () => {
    const user = await openTab('Rates')
    await user.selectOptions(await screen.findByLabelText('Rate type'), 'KISS')
    const rate = screen.getByLabelText('Roll rate')
    await user.clear(rate)
    await user.type(rate, '1')
    expect(screen.getByText(/Roll rate must be between 0.00 and 0.99/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
