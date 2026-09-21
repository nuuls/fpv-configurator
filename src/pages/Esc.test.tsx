/** Acceptance checks from docs/tabs/esc.md, driven through the real UI against the mock FC. */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readEscs } from '@/lib/esc/io'
import type { EscReport } from '@/lib/esc/model'
import { mixedMockEscs, mockBluejayEsc, type MockEsc } from '@/lib/mock-fc/mockEscs'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { EscReportList } from '@/pages/Esc'
import { openTab, resetAppAfterEach } from '@/test/app'

resetAppAfterEach()

/** Reading waits more than a second for the ESCs to reach their bootloader, also with the mock's ESCs. */
const combinedCard = () => screen.findByRole('group', { name: 'All ESCs' }, { timeout: 5000 })
const card = (number: number) => screen.getByRole('group', { name: `ESC ${number}` })

/** The row of a setting (label and value) inside a card. */
function setting(esc: HTMLElement, label: string): HTMLElement {
  const row = within(esc).getByText(label).parentElement
  if (!row) throw new Error(`no row for ${label}`)
  return row
}

/** What the page gets from a quad with these ESCs, without the real waiting. */
async function readReports(escs: MockEsc[]): Promise<EscReport[]> {
  let clock = 0
  const transport = new MockTransport(new MockFlightController({ escs, now: () => clock }), 0)
  await transport.open()
  return readEscs(new MspClient(transport), undefined, {
    sleep: async (ms) => {
      clock += ms
    },
  })
}

describe('ESC tab', () => {
  it('reads nothing until asked to', async () => {
    await openTab('ESC')
    expect(screen.getByRole('button', { name: 'Read ESCs' })).toBeEnabled()
    expect(screen.getByText(/Plug in the flight battery first/)).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('reads all four ESCs and shows them as one, because they are set up alike', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))

    const all = await combinedCard()
    expect(within(all).getByText(/All 4 ESCs/)).toBeInTheDocument()
    expect(within(all).getByText('Bluejay 0.21.0')).toBeInTheDocument()
    expect(within(all).getByText('Z-H-30 · EFM8BB21')).toBeInTheDocument()
    expect(setting(all, 'Motor timing')).toHaveTextContent(/^Motor timing22.5° \(medium high\)$/)
    expect(setting(all, 'PWM frequency')).toHaveTextContent(/^PWM frequency48 kHz$/)
    // Set per motor on purpose: listed by ESC instead of keeping the ESCs apart.
    expect(setting(all, 'Motor direction')).toHaveTextContent('ESC 1 NormalESC 2 ReversedESC 3 ReversedESC 4 Normal')

    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.queryByText('differs')).toBeNull()
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled()
  })

  it('leaves the flight controller talking MSP: another tab still loads afterwards', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
    await combinedCard()

    await user.click(screen.getByRole('link', { name: 'Orientation' }))
    expect(await screen.findByLabelText('Yaw')).toBeInTheDocument()
  })
})

describe('ESCs that are not alike', () => {
  it('shows firmware, version, hardware and settings of every ESC on its own card', async () => {
    render(<EscReportList reports={await readReports(mixedMockEscs())} />)
    expect(screen.queryByRole('group', { name: 'All ESCs' })).toBeNull()
    expect(screen.getByText(/don't all run the same firmware/)).toBeInTheDocument()

    expect(within(card(1)).getByText('Bluejay 0.21.0')).toBeInTheDocument()
    expect(within(card(1)).getByText('Z-H-30 · EFM8BB21')).toBeInTheDocument()
    expect(setting(card(1), 'Motor direction')).toHaveTextContent('Normal')
    expect(setting(card(1), 'Motor timing')).toHaveTextContent('22.5°')

    expect(within(card(3)).getByText('BLHeli_S 16.7')).toBeInTheDocument()
    expect(setting(card(3), 'Startup power')).toHaveTextContent('0.50')

    expect(within(card(4)).getByText('AM32 2.18')).toBeInTheDocument()
    expect(within(card(4)).getByText('MOCK_ESC_F051')).toBeInTheDocument()
    expect(setting(card(4), 'Motor KV')).toHaveTextContent('2220')
  })

  it('names the setting that differs and marks it on the ESC, but not the motor direction', async () => {
    const escs = [mockBluejayEsc(), mockBluejayEsc({ reversed: true, pwmKhz: 24 }), mockBluejayEsc(), mockBluejayEsc()]
    render(<EscReportList reports={await readReports(escs)} />)
    expect(screen.getByText(/not set up alike \(PWM frequency\)/)).toBeInTheDocument()

    expect(setting(card(2), 'Motor direction')).toHaveTextContent(/^Motor directionReversed$/)
    expect(setting(card(2), 'PWM frequency')).toHaveTextContent(/24 kHz.*differs/)
    expect(screen.getAllByText('differs')).toHaveLength(1)
  })

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
    expect(within(card(2)).getByText('Not responding')).toBeInTheDocument()
    expect(within(card(3)).getByText(/BLHeli_32/)).toBeInTheDocument()
    expect(screen.queryByText(/No ESC answered/)).toBeNull()
    expect(screen.queryByText(/listed one by one/)).toBeNull()
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
