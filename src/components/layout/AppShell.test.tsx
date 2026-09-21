import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '@/App'
import { resetAppAfterEach } from '@/test/app'

resetAppAfterEach()

describe('sidebar drawer (small screens)', () => {
  it('opens with the header button and closes again with it, with Escape and by picking a tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'Toggle navigation' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', screen.getByRole('navigation', { name: 'Tabs' }).id)

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: 'Connect Mock FC' }))
    await user.click(toggle)
    await user.click(await screen.findByRole('link', { name: 'Ports' }))
    await screen.findByRole('heading', { name: 'Ports' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
