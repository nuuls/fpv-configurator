import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Header } from './Header'

describe('Header', () => {
  it('offers the source code without a connection (AGPL §13)', () => {
    render(<Header navOpen={false} onToggleNav={() => {}} />)
    const link = screen.getByRole('link', { name: 'Source' })
    expect(link).toHaveAttribute('href', 'https://github.com/nuuls/fpv-configurator')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('warns that the app is an alpha version', () => {
    render(<Header navOpen={false} onToggleNav={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/alpha.*not properly tested yet/i)
  })
})
