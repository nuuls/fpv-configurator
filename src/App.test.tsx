import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { useConnectionStore } from './stores/connection'

afterEach(async () => {
  await useConnectionStore.getState().disconnect()
})

describe('App', () => {
  it('shows the welcome screen while disconnected', () => {
    render(<App />)
    expect(screen.getByText('No flight controller connected')).toBeInTheDocument()
    // jsdom has no Web Serial, so real-hardware connect must be disabled.
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
  })

  it('connects to the mock FC, shows its identity and live telemetry, then disconnects', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Connect Mock FC' }))

    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeInTheDocument()
    expect(screen.getAllByText('BTFL 2026.6.2').length).toBeGreaterThan(0)
    expect(screen.getByText('MOCKF405')).toBeInTheDocument()
    expect(await screen.findByText(/^\d+\.\d\d V$/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText('No flight controller connected')).toBeInTheDocument()
  })
})
