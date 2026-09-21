/** Acceptance checks for the Diff Checker tab (docs/tabs/diff.md). */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openTab, resetAppAfterEach, saveAndReboot } from '@/test/app'

resetAppAfterEach()

const rows = (section: string) =>
  within(screen.getByRole('group', { name: section }))
    .getAllByRole('row')
    .map((row) => within(row).queryAllByRole('cell').map((cell) => cell.textContent))
    .filter((cells) => cells.length > 0) // the header row has none

describe('Diff Checker tab', () => {
  it("lists the mock FC's setup by CLI section, defaults marked", async () => {
    await openTab('Diff Checker')
    expect(await screen.findByText(/^6 differences · MOCK\/MOCKF405 · Betaflight \/ /)).toBeInTheDocument()

    expect(rows('feature')).toEqual([
      ['feature -TELEMETRYdefault'],
      ['feature -ESC_SENSORdefault'],
      ['feature TELEMETRY'],
      ['feature ESC_SENSOR'],
    ])
    expect(rows('serial')).toEqual([
      ['serial UART2 0 115200 57600 0 115200default'],
      ['serial UART2 64 115200 57600 0 115200'],
      ['serial UART3 0 115200 57600 0 115200default'],
      ['serial UART3 1024 115200 57600 0 115200'],
    ])
    expect(rows('aux')).toContainEqual(['aux 0 0 0 1700 2100 0 0'])
    expect(screen.queryByRole('group', { name: 'master' })).toBeNull()
  })

  it('shows a setting changed on another tab with its default, and reads again on demand', async () => {
    const user = await openTab('Orientation')
    await user.selectOptions(await screen.findByLabelText('Yaw'), '90°')
    await saveAndReboot(user)

    await user.click(screen.getByRole('link', { name: 'Diff Checker' }))
    expect(await screen.findByText(/^7 differences/)).toBeInTheDocument()
    expect(rows('master')).toEqual([['align_board_yaw', '90', '0']])

    await user.click(screen.getByRole('button', { name: 'Read again' }))
    expect(await screen.findByText(/^7 differences/)).toBeInTheDocument()
  })

  it('copies the raw diff', async () => {
    const user = await openTab('Diff Checker')
    await user.click(await screen.findByRole('button', { name: 'Copy as text' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    const text = await navigator.clipboard.readText()
    expect(text.startsWith('# version\n# Betaflight / ')).toBe(true)
    expect(text).toContain('\n#serial UART2 0 115200 57600 0 115200\nserial UART2 64 115200 57600 0 115200\n')
  })

  it('leaves the FC talking MSP: other tabs still load afterwards', async () => {
    const user = await openTab('Diff Checker')
    await screen.findByText(/^6 differences/)
    await user.click(screen.getByRole('link', { name: 'Orientation' }))
    expect(await screen.findByLabelText('Yaw')).toBeInTheDocument()
  })
})
