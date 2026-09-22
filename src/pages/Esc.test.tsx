/** Acceptance checks from docs/tabs/esc.md, driven through the real UI against the mock FC. */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { readEscs } from '@/lib/esc/io'
import { toEscDraft, type EscReport } from '@/lib/esc/model'
import { mixedMockEscs, mockAm32Esc, mockBluejayEsc, type MockEsc } from '@/lib/mock-fc/mockEscs'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { EscReportList } from '@/pages/Esc'
import { nudge, openTab, resetAppAfterEach } from '@/test/app'

resetAppAfterEach()

/** Reading waits more than a second for the ESCs to reach their bootloader, also with the mock's ESCs. */
const combinedCard = () => screen.findByRole('group', { name: 'All ESCs' }, { timeout: 5000 })
const card = (number: number) => screen.getByRole('group', { name: `ESC ${number}` })
/** A setting shown as a slider with its recommended range. */
const slider = (within_: HTMLElement, label: string) =>
  within(within(within_).getByRole('group', { name: label })).getByRole('slider')

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

/** The list with a draft that takes edits, like the page keeps one — without a connection to save through. */
function Editable({ reports }: { reports: EscReport[] }) {
  const [draft, setDraft] = useState(() => toEscDraft(reports))
  return <EscReportList reports={reports} draft={draft} onChange={setDraft} />
}

/** A mock ESC with bytes of its settings block changed. */
function patched(esc: MockEsc, address: number, patch: Record<number, number>): MockEsc {
  const block = esc.flash[address]
  for (const [offset, value] of Object.entries(patch)) if (block) block[Number(offset)] = value
  return esc
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
    expect(setting(all, 'PWM frequency')).toHaveTextContent(/^PWM frequency48 kHz$/)
    expect(
      within(all).getByText(/48 kHz build. Flight performance is greatly reduced/),
    ).toBeInTheDocument()
    // What can be changed on Bluejay: the timing and both startup powers
    expect(within(all).getByLabelText('Motor timing')).toHaveDisplayValue('22.5° (medium high)')
    expect(slider(all, 'Minimum startup power')).toHaveAttribute('aria-valuenow', '1025')
    expect(slider(all, 'Maximum startup power')).toHaveAttribute('aria-valuenow', '1020')
    expect(within(all).getByText('Recommended (1025–1050)')).toBeInTheDocument()
    expect(within(all).getByText('Below the recommended 1050–1200')).toBeInTheDocument()
    expect(within(all).queryByLabelText('PWM frequency')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    // Set per motor on purpose: listed by ESC instead of keeping the ESCs apart.
    expect(setting(all, 'Motor direction')).toHaveTextContent(
      'ESC 1 NormalESC 2 ReversedESC 3 ReversedESC 4 Normal',
    )

    expect(screen.getAllByRole('group', { name: /ESC|settings/ })).toHaveLength(1)
    expect(screen.queryByText('differs')).toBeNull()
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled()
  })

  it(
    'writes changed settings to all ESCs after asking, and they are still there when the ESCs are read again',
    { timeout: 20_000 },
    async () => {
      const user = await openTab('ESC')
      await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
      await user.selectOptions(
        within(await combinedCard()).getByLabelText('Motor timing'),
        '15° (medium)',
      )
      // 1020 → 1100: a page is ten steps of 4
      await nudge(user, slider(document.body, 'Maximum startup power'), '{PageUp}{PageUp}')
      expect(screen.getByText('Recommended (1050–1200)')).toBeInTheDocument()
      expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument()

      // Not without a yes
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(
        await screen.findByText(/ESC 1, 2, 3, 4 will be changed and restarted/),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Save' }))
      await user.click(await screen.findByRole('button', { name: 'Write settings' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(), {
        timeout: 5000,
      })
      expect(screen.queryByText(/Saving failed/)).toBeNull()
      expect(screen.getByLabelText('Motor timing')).toHaveDisplayValue('15° (medium)')

      await user.click(screen.getByRole('button', { name: 'Read again' }))
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled(),
        { timeout: 5000 },
      )
      const all = await combinedCard()
      expect(within(all).getByLabelText('Motor timing')).toHaveDisplayValue('15° (medium)')
      expect(slider(all, 'Maximum startup power')).toHaveAttribute('aria-valuenow', '1100')
      // Untouched: the direction of each motor
      expect(setting(all, 'Motor direction')).toHaveTextContent(
        'ESC 1 NormalESC 2 ReversedESC 3 ReversedESC 4 Normal',
      )
    },
  )

  it('drops edits on Revert', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
    const timing = within(await combinedCard()).getByLabelText('Motor timing')
    await user.selectOptions(timing, '0° (low)')
    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(timing).toHaveDisplayValue('22.5° (medium high)')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
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

    expect(within(card(4)).getByText('AM32 2.21')).toBeInTheDocument()
    expect(within(card(4)).getByText('MOCK_ESC_F051')).toBeInTheDocument()
    expect(setting(card(4), 'Motor KV')).toHaveTextContent('2220')

    // One editor per firmware that can be changed; BLHeli_S is only shown.
    expect(
      within(screen.getByRole('group', { name: 'Bluejay settings' })).getByText(
        'ESC 1, 2 — set up alike',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'AM32 settings' })).getByLabelText('Motor KV'),
    ).toHaveValue(2220)
    expect(screen.queryByRole('group', { name: 'BLHeli_S settings' })).toBeNull()
  })

  it('offers every setting of the AM32 configurator, the motor direction per ESC', async () => {
    const user = userEvent.setup()
    render(
      <Editable
        reports={await readReports([mockAm32Esc(), patched(mockAm32Esc(), 0x7c00, { 17: 1 })])}
      />,
    )
    const all = screen.getByRole('group', { name: 'All ESCs' })
    for (const section of [
      'Essentials',
      'Motor',
      'Extended settings',
      'Limits',
      'Current control',
      'Sinusoidal startup',
      'Brake',
      'Servo input',
    ]) {
      expect(within(all).getByRole('heading', { name: section })).toBeInTheDocument()
    }
    expect(within(all).getByLabelText('Signal protocol')).toHaveDisplayValue('DShot')
    expect(within(all).getByLabelText('ESC 1')).toHaveDisplayValue('Normal')
    expect(within(all).getByLabelText('ESC 2')).toHaveDisplayValue('Reversed')
    await user.selectOptions(within(all).getByLabelText('ESC 1'), 'Reversed')
    expect(within(all).getByLabelText('ESC 2')).toHaveDisplayValue('Reversed')

    // Auto timing takes the timing advance out of your hands
    expect(within(all).getByLabelText('Timing advance')).toBeEnabled()
    await user.click(within(all).getByLabelText('Auto timing advance'))
    expect(within(all).getByLabelText('Timing advance')).toBeDisabled()

    // A number is kept inside what the ESC takes
    const poles = within(all).getByLabelText('Motor poles')
    await user.clear(poles)
    await user.type(poles, '99')
    await user.tab()
    expect(poles).toHaveValue(36)
  })

  it("shows ESC 1's values when editable settings differ, and can use them for all", async () => {
    const user = userEvent.setup()
    render(
      <Editable
        reports={await readReports([
          mockBluejayEsc(),
          patched(mockBluejayEsc(), 0x1a00, { 0x15: 2 }),
        ])}
      />,
    )
    expect(setting(card(2), 'Motor timing')).toHaveTextContent(/7.5°.*differs/)
    const editor = screen.getByRole('group', { name: 'Bluejay settings' })
    expect(within(editor).getByText(/Not the same on these ESCs: Motor timing/)).toBeInTheDocument()
    expect(within(editor).getByLabelText('Motor timing')).toHaveDisplayValue('22.5° (medium high)')

    await user.click(within(editor).getByRole('button', { name: 'Use them for all' }))
    expect(within(editor).queryByText(/Not the same on these ESCs/)).toBeNull()
  })

  it('tells to update ESCs whose firmware version it does not work with, and offers nothing to change on them', async () => {
    const old = () => patched(mockBluejayEsc(), 0x1a00, { 0x01: 19, 0x02: 206 })
    render(
      <EscReportList
        reports={await readReports([old(), old(), patched(mockAm32Esc(), 0x7c00, { 4: 18 })])}
      />,
    )
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      expect.stringMatching(
        /Bluejay 0.19 is too old: this app only works with Bluejay 0.21. Update the ESCs/,
      ),
      expect.stringMatching(/AM32 2.18 is not supported: this app only works with AM32 2.21/),
    ])
    expect(within(card(1)).getByText('Bluejay 0.19')).toBeInTheDocument()
    expect(within(card(1)).getByText('Version not supported')).toBeInTheDocument()
    expect(within(card(3)).getByText('AM32 2.18')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('names the setting that differs and marks it on the ESC, but not the motor direction', async () => {
    const escs = [
      mockBluejayEsc(),
      mockBluejayEsc({ reversed: true, pwmKhz: 24 }),
      mockBluejayEsc(),
      mockBluejayEsc(),
    ]
    render(<EscReportList reports={await readReports(escs)} />)
    expect(screen.getByText(/not set up alike \(PWM frequency\)/)).toBeInTheDocument()

    expect(setting(card(2), 'Motor direction')).toHaveTextContent(/^Motor directionReversed$/)
    expect(setting(card(2), 'PWM frequency')).toHaveTextContent(/24 kHz.*differs/)
    expect(screen.getAllByText('differs')).toHaveLength(1)
  })

  it('shows an ESC that does not answer next to the ones that do', async () => {
    render(
      <EscReportList
        reports={[
          ...(await readReports([mockAm32Esc()])),
          {
            status: 'missing',
            description: 'No answer from this ESC. Check the battery and the motor signal wire.',
          },
          {
            status: 'unknown',
            description:
              'ARM ESC that is not running AM32 — probably BLHeli_32 (signature 0x1F06). Not supported.',
          },
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
