/** Acceptance checks for the Diff Checker tab (docs/tabs/diff.md). */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openTab, resetAppAfterEach, saveAndReboot } from '@/test/app'

resetAppAfterEach()

const lines =(section: string) =>
  within(screen.getByRole('group', { name: section }))
    .getAllByRole('listitem')
    .map((line) => line.textContent)

describe('Diff Checker tab', () => {
  it("hides the mock FC's setup: features, serial ports and modes are no tuning", async () => {
    await openTab('Diff Checker')
    expect(await screen.findByText(/^0 tuning differences · 6 other hidden · MOCK\/MOCKF405 · Betaflight \/ /)).toBeInTheDocument()
    expect(screen.getByText(/^No tuning differences/)).toBeInTheDocument()
    expect(screen.queryAllByRole('group')).toEqual([])
  })

  it('shows a tuning setting changed on another tab with its default, and reads again on demand', async () => {
    const user = await openTab('Motors')
    await user.click(await screen.findByLabelText('Bidirectional DShot'))
    await user.selectOptions(screen.getByLabelText('Prop direction'), 'out')
    await saveAndReboot(user)

    await user.click(screen.getByRole('link', { name: 'Diff Checker' }))
    // yaw_motors_reversed is setup, not tuning
    expect(await screen.findByText(/^1 tuning difference · 7 other hidden/)).toBeInTheDocument()
    expect(lines('master')).toEqual(['set dshot_bidir = OFF → ON'])
    const master = within(screen.getByRole('group', { name: 'master' }))
    expect(master.getByText('OFF').tagName).toBe('DEL') // the default, red
    expect(master.getByText('ON').tagName).toBe('INS') // what is set, green
    expect(master.getByText('1 difference')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'feature' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Read again' }))
    expect(await screen.findByText(/^1 tuning difference/)).toBeInTheDocument()
  })

  it('shows the hidden setup differences while "Show hidden differences" is on', async () => {
    const user = await openTab('Diff Checker')
    await screen.findByText(/^0 tuning differences · 6 other hidden/)
    const toggle = screen.getByRole('switch', { name: 'Show hidden differences' })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)
    expect(screen.getByText(/^0 tuning differences · 6 other shown/)).toBeInTheDocument()
    expect(screen.queryByText(/^No tuning differences/)).toBeNull()
    expect(lines('serial')).toContain('serial UART2 64 115200 57600 0 115200')
    const shown = screen.getAllByRole('group').flatMap((group) => within(group).getAllByRole('listitem'))
    expect(shown.length).toBeGreaterThanOrEqual(6)

    // stays on for the next read
    await user.click(screen.getByRole('button', { name: 'Read again' }))
    expect(await screen.findByText(/^0 tuning differences · 6 other shown/)).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByText(/^0 tuning differences · 6 other hidden/)).toBeInTheDocument()
    expect(screen.queryAllByRole('group')).toEqual([])
  })

  it('copies the complete diff, setup included', async () => {
    const user = await openTab('Diff Checker')
    await user.click(await screen.findByRole('button', { name: 'Copy full diff' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    const text = await navigator.clipboard.readText()
    expect(text.startsWith('# version\n# Betaflight / ')).toBe(true)
    expect(text).toContain('\n#serial UART2 0 115200 57600 0 115200\nserial UART2 64 115200 57600 0 115200\n')
  })

  it('leaves the FC talking MSP: other tabs still load afterwards', async () => {
    const user = await openTab('Diff Checker')
    await screen.findByText(/^0 tuning differences/)
    await user.click(screen.getByRole('link', { name: 'Orientation' }))
    expect(await screen.findByLabelText('Yaw')).toBeInTheDocument()
  })
})
