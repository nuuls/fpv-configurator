/** Acceptance checks from docs/tabs/esc.md, driven through the real UI against the mock FC. */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EscReportList } from '@/pages/Esc'
import { openTab, resetAppAfterEach } from '@/test/app'

resetAppAfterEach()

/** Reading waits more than a second for the ESCs to reach their bootloader, also with the mock's ESCs. */
const card = (number: number) => screen.findByRole('group', { name: `ESC ${number}` }, { timeout: 5000 })

/** The value next to a setting's label inside one ESC card. */
function setting(esc: HTMLElement, label: string): HTMLElement {
  const row = within(esc).getByText(label).parentElement
  if (!row) throw new Error(`no row for ${label}`)
  return row
}

describe('ESC tab', () => {
  it('reads nothing until asked to', async () => {
    await openTab('ESC')
    expect(screen.getByRole('button', { name: 'Read ESCs' })).toBeEnabled()
    expect(screen.getByText(/Plug in the flight battery first/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'ESC 1' })).toBeNull()
  })

  it('shows firmware, version, hardware and settings of all four ESCs', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))

    const first = await card(1)
    expect(within(first).getByText('Bluejay 0.21.0')).toBeInTheDocument()
    expect(within(first).getByText('Z-H-30 · EFM8BB21')).toBeInTheDocument()
    expect(setting(first, 'Motor direction')).toHaveTextContent('Normal')
    expect(setting(first, 'Motor timing')).toHaveTextContent('22.5°')

    expect(within(await card(3)).getByText('BLHeli_S 16.7')).toBeInTheDocument()
    expect(setting(await card(3), 'Startup power')).toHaveTextContent('0.50')

    const fourth = await card(4)
    expect(within(fourth).getByText('AM32 2.18')).toBeInTheDocument()
    expect(within(fourth).getByText('MOCK_ESC_F051')).toBeInTheDocument()
    expect(setting(fourth, 'Motor KV')).toHaveTextContent('2220')

    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled()
  })

  it('marks a setting that differs between ESCs of the same firmware, but not the motor direction', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))

    const second = await card(2)
    expect(setting(second, 'Motor direction')).toHaveTextContent(/^Motor directionReversed$/)
    expect(setting(second, 'PWM frequency')).toHaveTextContent(/24 kHz.*differs/)
    expect(within(await card(1)).queryByText('differs')).toBeNull()
    expect(within(second).getAllByText('differs')).toHaveLength(1)
  })

  it('leaves the flight controller talking MSP: another tab still loads afterwards', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
    await card(4)

    await user.click(screen.getByRole('link', { name: 'Orientation' }))
    expect(await screen.findByLabelText('Yaw')).toBeInTheDocument()
  })
})

describe('ESC cards', () => {
  it('shows an ESC that does not answer next to the ones that do', () => {
    render(
      <EscReportList
        reports={[
          { status: 'ok', firmware: 'AM32', version: '2.18', hardware: 'MOCK_ESC_F051', layoutRevision: 2, settings: [], note: null },
          { status: 'missing', description: 'No answer from this ESC. Check the battery and the motor signal wire.' },
          { status: 'unknown', description: 'ARM ESC that is not running AM32 — probably BLHeli_32 (signature 0x1F06). Not supported.' },
        ]}
      />,
    )
    expect(within(screen.getByRole('group', { name: 'ESC 2' })).getByText('Not responding')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'ESC 3' })).getByText(/BLHeli_32/)).toBeInTheDocument()
    expect(screen.queryByText(/No ESC answered/)).toBeNull()
  })

  it('asks for the battery when no ESC answered, and points to the Motors tab when there are no outputs', () => {
    const missing = { status: 'missing', description: 'No answer from this ESC.' } as const
    const { unmount } = render(<EscReportList reports={[missing, missing]} />)
    expect(screen.getByText(/No ESC answered. Plug in the flight battery/)).toBeInTheDocument()
    unmount()

    render(<EscReportList reports={[]} />)
    expect(screen.getByText(/no ESC outputs to read/)).toBeInTheDocument()
  })
})
