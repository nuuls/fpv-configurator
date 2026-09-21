import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { useConnectionStore } from '@/stores/connection'

afterEach(async () => {
  await useConnectionStore.getState().disconnect()
  window.location.hash = ''
})

/** Acceptance checks from docs/tabs/ports.md, driven through the real UI against the mock FC. */
async function openPortsTab() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Connect Mock FC' }))
  await user.click(await screen.findByRole('link', { name: /Ports/ }))
  await screen.findByLabelText('Receiver type')
  return user
}

const option = (select: HTMLElement, name: RegExp) => within(select).getByRole('option', { name }) as HTMLOptionElement

describe('Ports tab', () => {
  it('shows what the FC has configured', async () => {
    await openPortsTab()
    expect(screen.getByLabelText('Receiver type')).toHaveValue('crsf')
    expect(screen.getByLabelText('Receiver port')).toHaveValue('52')
    expect(screen.getByLabelText('VTX type')).toHaveValue('none')
    expect(screen.getByText('UART3: ESC telemetry (not managed here)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save & Reboot' })).toBeDisabled()
  })

  it('never offers the USB port and blocks ports used by another device', async () => {
    const user = await openPortsTab()
    await user.selectOptions(screen.getByLabelText('VTX type'), 'msp')
    const vtxPort = screen.getByLabelText('VTX port')
    expect(within(vtxPort).queryByRole('option', { name: /USB/ })).toBeNull()
    expect(option(vtxPort, /UART2/)).toBeDisabled()
    expect(option(vtxPort, /UART2/).textContent).toBe('UART2 (used by Receiver)')
    expect(option(vtxPort, /UART3/).textContent).toBe('UART3 — ESC telemetry')
  })

  it('saves a digital VTX, reboots, reconnects by itself and shows it again', async () => {
    const user = await openPortsTab()
    await user.selectOptions(screen.getByLabelText('VTX type'), 'msp')
    expect(screen.getByText('Pick a port for the VTX.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('VTX port'), '51')
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save & Reboot' }))
    expect(await screen.findByText('Rebooting flight controller…')).toBeInTheDocument()

    expect(await screen.findByLabelText('VTX type', {}, { timeout: 3000 })).toHaveValue('msp')
    expect(screen.getByLabelText('VTX port')).toHaveValue('51')
    expect(screen.getByLabelText('Receiver port')).toHaveValue('52')
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
  })

  it('reverts edits', async () => {
    const user = await openPortsTab()
    await user.selectOptions(screen.getByLabelText('Receiver port'), '54')
    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(screen.getByLabelText('Receiver port')).toHaveValue('52')
    expect(screen.getByRole('button', { name: 'Revert' })).toBeDisabled()
  })

  it('asks before leaving the tab with unsaved edits', async () => {
    const user = await openPortsTab()
    await user.selectOptions(screen.getByLabelText('Receiver port'), '54')

    await user.click(screen.getByRole('link', { name: 'Setup' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Receiver port')).toHaveValue('54')

    await user.click(screen.getByRole('link', { name: 'Setup' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeInTheDocument()
  })

  it('asks before replacing a function it does not manage', async () => {
    const user = await openPortsTab()
    await user.selectOptions(screen.getByLabelText('GPS'), 'on')
    await user.selectOptions(screen.getByLabelText('GPS port'), '53')
    await user.click(screen.getByRole('button', { name: 'Save & Reboot' }))

    expect(await screen.findByText(/UART3 is used for ESC telemetry/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('GPS port')).toHaveValue('53') // edits kept, nothing saved
    expect(screen.queryByText('Rebooting flight controller…')).toBeNull()
  })
})
