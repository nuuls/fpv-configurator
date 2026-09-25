/** Acceptance checks from docs/tabs/esc.md, driven through the real UI against the mock FC. */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { readEscs } from '@/lib/esc/io'
import { toEscDraft, type EscDraft, type EscReport } from '@/lib/esc/model'
import {
  defaultMockEscs,
  mixedMockEscs,
  mockAm32Esc,
  mockBluejayEsc,
  type MockEsc,
} from '@/lib/mock-fc/mockEscs'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { EscReportList } from '@/pages/Esc'
import { nudge, openTab, resetAppAfterEach } from '@/test/app'

resetAppAfterEach()

/** Reading waits more than a second for the ESCs to reach their bootloader, also with the mock's ESCs. */
const escCard = (number: number) =>
  screen.findByRole('group', { name: `ESC ${number}` }, { timeout: 5000 })
const card = (number: number) => screen.getByRole('group', { name: `ESC ${number}` })
/** A setting shown as a slider with its recommended range. */
const slider = (within_: HTMLElement, label: string) =>
  within(within(within_).getByRole('group', { name: label })).getByRole('slider')

/** What a card's "Not on the default" notice lists, one line per setting. */
function offDefault(within_: HTMLElement): string[] {
  const notice = within(within_).queryByRole('group', { name: 'Not on the default' })
  if (!notice) return []
  return within(notice)
    .getAllByRole('listitem')
    .map((item) => item.textContent.replace(/Reset$/, '').trim())
}

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

  it('reads the demo ESCs: a Bluejay and an AM32, each with what can be changed and what is not on the default', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))

    const bluejay = await escCard(1)
    expect(screen.queryByRole('group', { name: 'All ESCs' })).toBeNull()
    expect(screen.getByText(/don't all run the same firmware/)).toBeInTheDocument()
    expect(within(bluejay).getByText('Bluejay 0.21.0')).toBeInTheDocument()
    expect(within(bluejay).getByText('Z-H-30 · EFM8BB21')).toBeInTheDocument()
    // The 48 kHz build: the warning sits in the PWM frequency row
    expect(setting(bluejay, 'PWM frequency')).toHaveTextContent(
      /^PWM frequency48 kHzFlight performance is greatly reduced with anything but 24 kHz/,
    )
    expect(
      within(setting(bluejay, 'PWM frequency')).getByRole('link', { name: 'ESC Configurator' }),
    ).toHaveAttribute('href', 'https://esc-configurator.com')
    expect(within(card(2)).getByText('AM32 2.21')).toBeInTheDocument()
    expect(within(card(2)).getByText('MOCK_ESC_F051')).toBeInTheDocument()

    // Bluejay: timing, both startup powers and the power rating can be changed
    expect(within(bluejay).getByLabelText('Motor timing')).toHaveDisplayValue('22.5° (medium high)')
    expect(slider(bluejay, 'Minimum startup power')).toHaveAttribute('aria-valuenow', '1025')
    expect(slider(bluejay, 'Maximum startup power')).toHaveAttribute('aria-valuenow', '1020')
    expect(within(bluejay).getByLabelText('Power rating')).toHaveDisplayValue('2S+')
    expect(within(bluejay).queryByLabelText('PWM frequency')).toBeNull()
    // AM32: only the motor settings
    const am32 = card(2)
    expect(within(am32).queryByText(/3D/)).toBeNull() // on its default: off
    expect(within(am32).getByLabelText('PWM type')).toHaveDisplayValue('Variable')
    expect(slider(am32, 'PWM frequency')).toHaveAttribute('aria-valuenow', '24')
    expect(within(am32).getByLabelText('Motor KV')).toHaveValue(2220)
    expect(within(am32).getByLabelText('Motor poles')).toHaveValue(14)
    expect(within(am32).getAllByRole('combobox')).toHaveLength(1)
    expect(within(am32).queryByText('Signal protocol')).toBeNull()

    // The rest only when it is not on the firmware's default — the demo ESCs have two such settings each
    expect(offDefault(bluejay)).toEqual([
      'Demag compensation: High (default Low)',
      'Temperature protection: 140 °C (default Off)',
    ])
    expect(offDefault(am32)).toEqual([
      'Stall protection: On (default Off)',
      'Current D: 100 (default 50)',
    ])
    expect(within(bluejay).queryByText('Beep strength')).toBeNull()
    // The motor direction is not shown at all
    expect(screen.queryByText(/Motor direction/)).toBeNull()

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled()
  })

  it('puts a setting back to its default, one at a time or all of them', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
    const bluejay = await escCard(1)

    await user.click(
      within(bluejay).getByRole('button', { name: 'Reset Demag compensation to default' }),
    )
    expect(offDefault(bluejay)).toEqual(['Temperature protection: 140 °C (default Off)'])
    expect(within(bluejay).queryByRole('button', { name: 'Reset all to defaults' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    await user.click(within(card(2)).getByRole('button', { name: 'Reset all to defaults' }))
    expect(within(card(2)).queryByRole('group', { name: 'Not on the default' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(offDefault(bluejay)).toHaveLength(2)
    expect(offDefault(card(2))).toHaveLength(2)
  })

  it(
    'writes changed settings to both ESCs after asking, and they are still there when the ESCs are read again',
    { timeout: 20_000 },
    async () => {
      const user = await openTab('ESC')
      await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
      await escCard(1)
      await user.selectOptions(within(card(1)).getByLabelText('Motor timing'), '15° (medium)')
      // 1020 → 1100: a page is ten steps of 4
      await nudge(user, slider(card(1), 'Maximum startup power'), '{PageUp}{PageUp}')
      expect(screen.getByText('Recommended (1050–1200)')).toBeInTheDocument()
      const kv = within(card(2)).getByLabelText('Motor KV')
      await user.clear(kv)
      await user.type(kv, '1940')
      await user.tab()
      await user.click(within(card(2)).getByRole('button', { name: 'Reset all to defaults' }))
      expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument()

      // Not without a yes
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByText(/ESC 1, 2 will be changed and restarted/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Save' }))
      await user.click(await screen.findByRole('button', { name: 'Write settings' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(), {
        timeout: 5000,
      })
      expect(screen.queryByText(/Saving failed/)).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Read again' }))
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled(),
        { timeout: 5000 },
      )
      await escCard(1)
      expect(within(card(1)).getByLabelText('Motor timing')).toHaveDisplayValue('15° (medium)')
      expect(slider(card(1), 'Maximum startup power')).toHaveAttribute('aria-valuenow', '1100')
      expect(within(card(2)).getByLabelText('Motor KV')).toHaveValue(1940)
      expect(within(card(2)).queryByRole('group', { name: 'Not on the default' })).toBeNull()
      // Untouched: what wasn't reset
      expect(offDefault(card(1))).toHaveLength(2)
    },
  )

  it('drops edits on Revert', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
    await escCard(1)
    const timing = within(card(1)).getByLabelText('Motor timing')
    await user.selectOptions(timing, '0° (low)')
    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(timing).toHaveDisplayValue('22.5° (medium high)')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('leaves the flight controller talking MSP: another tab still loads afterwards', async () => {
    const user = await openTab('ESC')
    await user.click(screen.getByRole('button', { name: 'Read ESCs' }))
    await escCard(1)

    await user.click(screen.getByRole('link', { name: 'Orientation' }))
    expect(await screen.findByLabelText('Yaw')).toBeInTheDocument()
  })
})

describe('ESCs that are alike', () => {
  it('shows all four as one, whatever their motor direction', async () => {
    render(<Editable reports={await readReports(defaultMockEscs())} />)

    const all = screen.getByRole('group', { name: 'All ESCs' })
    expect(within(all).getByText(/All 4 ESCs/)).toBeInTheDocument()
    expect(within(all).getByText('Bluejay 0.21.0')).toBeInTheDocument()
    expect(within(all).getByText('Z-H-30 · EFM8BB21')).toBeInTheDocument()
    expect(setting(all, 'PWM frequency')).toHaveTextContent(
      /^PWM frequency48 kHzFlight performance is greatly reduced with anything but 24 kHz/,
    )
    expect(within(all).getByLabelText('Motor timing')).toHaveDisplayValue('22.5° (medium high)')
    expect(slider(all, 'Minimum startup power')).toHaveAttribute('aria-valuenow', '1025')
    expect(slider(all, 'Maximum startup power')).toHaveAttribute('aria-valuenow', '1020')
    expect(within(all).getByText('Recommended (1025–1050)')).toBeInTheDocument()
    expect(within(all).getByText('Below the recommended 1050–1200')).toBeInTheDocument()
    expect(within(all).queryByLabelText('PWM frequency')).toBeNull()
    // On the firmware's defaults: nothing else to show
    expect(within(all).queryByRole('group', { name: 'Not on the default' })).toBeNull()
    expect(within(all).queryByText('Demag compensation')).toBeNull()
    expect(within(all).queryByText(/Motor direction/)).toBeNull()

    expect(screen.getAllByRole('group', { name: /ESC/ })).toHaveLength(1)
    expect(screen.queryByText('differs')).toBeNull()
  })

  it('puts a setting back to its default on all of them', async () => {
    const user = userEvent.setup()
    const escs = defaultMockEscs().map((esc) => patched(esc, 0x1a00, { 0x1b: 100 }))
    const reports = await readReports(escs)
    let latest = toEscDraft(reports)
    function Watched() {
      const [draft, setDraft] = useState(latest)
      const change = (next: EscDraft) => {
        latest = next
        setDraft(next)
      }
      return <EscReportList reports={reports} draft={draft} onChange={change} />
    }
    render(<Watched />)
    const all = screen.getByRole('group', { name: 'All ESCs' })
    expect(offDefault(all)).toEqual(['Beep strength: 100 (default 40)'])
    await user.click(within(all).getByRole('button', { name: 'Reset Beep strength to default' }))
    expect(latest.map((block) => block?.[0x1b])).toEqual([40, 40, 40, 40])
  })
})

describe('ESCs that are not alike', () => {
  it('shows firmware, version, hardware and settings of every ESC on its own card', async () => {
    render(<EscReportList reports={await readReports(mixedMockEscs())} />)
    expect(screen.queryByRole('group', { name: 'All ESCs' })).toBeNull()
    expect(screen.getByText(/don't all run the same firmware/)).toBeInTheDocument()

    // What can be changed is changed on the card; BLHeli_S is only shown.
    expect(within(card(1)).getByText('Bluejay 0.21.0')).toBeInTheDocument()
    expect(within(card(1)).getByText('Z-H-30 · EFM8BB21')).toBeInTheDocument()
    expect(within(card(1)).getByLabelText('Motor timing')).toHaveDisplayValue('22.5° (medium high)')

    expect(within(card(3)).getByText('BLHeli_S 16.7')).toBeInTheDocument()
    expect(setting(card(3), 'Startup power')).toHaveTextContent('0.50')
    expect(setting(card(3), 'Demag compensation')).toHaveTextContent('Low')
    expect(within(card(3)).queryByRole('combobox')).toBeNull()

    expect(within(card(4)).getByText('AM32 2.21')).toBeInTheDocument()
    expect(within(card(4)).getByText('MOCK_ESC_F051')).toBeInTheDocument()
    expect(within(card(4)).getByLabelText('Motor KV')).toHaveValue(2220)
    expect(screen.queryByText(/Motor direction/)).toBeNull()
  })

  it('offers the motor settings of AM32, and hides the PWM frequency when the PWM follows the RPM', async () => {
    const user = userEvent.setup()
    render(<Editable reports={await readReports([mockAm32Esc(), mockAm32Esc()])} />)
    const all = screen.getByRole('group', { name: 'All ESCs' })
    const pwmGroup = within(all).getByRole('group', { name: 'PWM frequency' })
    // Variable: the ESC goes up to twice the frequency, shown as a range and a bar on from the thumb
    expect(pwmGroup).toHaveTextContent('24–48 kHz')
    // 8–144 kHz track: from 24 kHz (11.8 %) to 48 kHz (29.4 %)
    const bar = within(pwmGroup).getByTestId('slider-reach')
    expect(parseFloat(bar.style.left)).toBeCloseTo(11.76, 1)
    expect(100 - parseFloat(bar.style.right)).toBeCloseTo(29.41, 1)

    await user.selectOptions(within(all).getByLabelText('PWM type'), 'Fixed')
    expect(pwmGroup).toHaveTextContent(/^24 kHz$/)
    expect(within(pwmGroup).queryByTestId('slider-reach')).toBeNull()

    await user.selectOptions(within(all).getByLabelText('PWM type'), 'By RPM')
    expect(within(all).queryByText('PWM frequency')).toBeNull()
    await user.selectOptions(within(all).getByLabelText('PWM type'), 'Variable')
    expect(slider(all, 'PWM frequency')).toHaveAttribute('aria-valuenow', '24')

    // A number is kept inside what the ESC takes
    const poles = within(all).getByLabelText('Motor poles')
    await user.clear(poles)
    await user.type(poles, '99')
    await user.tab()
    expect(poles).toHaveValue(36)
  })

  it("edits every ESC on its own card, marks what differs, and can use ESC 1's settings for all", async () => {
    const user = userEvent.setup()
    render(
      <Editable
        reports={await readReports([
          mockBluejayEsc(),
          patched(mockBluejayEsc(), 0x1a00, { 0x15: 2 }),
        ])}
      />,
    )
    expect(within(card(2)).getByLabelText('Motor timing')).toHaveDisplayValue('7.5° (medium low)')
    expect(within(card(2)).getByText('differs')).toBeInTheDocument()
    expect(within(card(1)).queryByText('differs')).toBeNull()
    expect(
      screen.getByText(/Not the same on the Bluejay ESCs \(1, 2\): Motor timing/),
    ).toBeInTheDocument()

    // A change goes to the ESC of its card only
    await user.selectOptions(within(card(1)).getByLabelText('Motor timing'), '7.5° (medium low)')
    expect(screen.queryByText('differs')).toBeNull()
    expect(screen.queryByText(/Not the same on the Bluejay ESCs/)).toBeNull()
    await user.selectOptions(within(card(1)).getByLabelText('Motor timing'), '30° (high)')
    expect(within(card(2)).getByLabelText('Motor timing')).toHaveDisplayValue('7.5° (medium low)')

    await user.click(screen.getByRole('button', { name: "Use ESC 1's for all" }))
    expect(within(card(2)).getByLabelText('Motor timing')).toHaveDisplayValue('30° (high)')
    expect(screen.queryByText(/Not the same on the Bluejay ESCs/)).toBeNull()
    expect(screen.queryByText('differs')).toBeNull()
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
    expect(
      within(screen.getAllByRole('alert')[0] ?? document.body).getByRole('link', {
        name: 'ESC Configurator',
      }),
    ).toHaveAttribute('href', 'https://esc-configurator.com')
    expect(within(card(1)).getByText('Bluejay 0.19')).toBeInTheDocument()
    expect(within(card(1)).getByText('Version not supported')).toBeInTheDocument()
    expect(within(card(3)).getByText('AM32 2.18')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('names the setting that differs, but not the motor direction', async () => {
    const escs = [
      mockBluejayEsc(),
      mockBluejayEsc({ reversed: true, pwmKhz: 24 }),
      mockBluejayEsc(),
      mockBluejayEsc(),
    ]
    render(<EscReportList reports={await readReports(escs)} />)
    expect(screen.getByText(/not set up alike \(PWM frequency\)/)).toBeInTheDocument()
    // The 24 kHz build is what it should be: nothing to say about it
    expect(within(card(2)).queryByText('PWM frequency')).toBeNull()
    expect(setting(card(1), 'PWM frequency')).toHaveTextContent(/48 kHz/)
    expect(screen.queryByText(/Motor direction/)).toBeNull()
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
