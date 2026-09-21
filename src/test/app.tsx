/**
 * Helpers for UI tests that drive the whole app against the mock FC. Put each tab's tests in its own
 * `src/pages/<Tab>.test.tsx` and start the file with `resetAppAfterEach()`.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, expect } from 'vitest'
import App from '@/App'
import { useConnectionStore } from '@/stores/connection'

const AFTER_REBOOT = { timeout: 3000 }

/** The connection store and the URL hash outlive a test; reset both. Call once at the top of a test file. */
export function resetAppAfterEach(): void {
  afterEach(async () => {
    await useConnectionStore.getState().disconnect()
    window.location.hash = ''
  })
}

/** Renders the app, connects the mock FC and opens the tab with this sidebar label. */
export async function openTab(name: string): Promise<UserEvent> {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Connect Mock FC' }))
  await user.click(await screen.findByRole('link', { name }))
  await screen.findByRole('heading', { name })
  return user
}

/** Clicks Save & Reboot and waits until the app has reconnected and the tab is showing again. */
export async function saveAndReboot(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Save & Reboot' }))
  await screen.findByText('Rebooting flight controller…')
  await waitFor(() => expect(screen.queryByText('Rebooting flight controller…')).toBeNull(), AFTER_REBOOT)
}

/** Clicks Save and waits until the tab has re-read the FC (nothing left to revert). */
export async function saveWithoutReboot(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Save' }))
  // "Save" (not "Saving…") and disabled = written, re-read from the FC, and nothing left to save
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
  expect(screen.queryByText('Rebooting flight controller…')).toBeNull()
}

/** Radix sliders are driven with the keyboard in jsdom. */
export async function nudge(user: UserEvent, thumb: HTMLElement, keys: string): Promise<void> {
  thumb.focus()
  await user.keyboard(keys)
}
