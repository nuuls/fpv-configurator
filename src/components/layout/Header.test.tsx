import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Header } from './Header'

describe('Header', () => {
  it('offers the source code without a connection (AGPL §13)', () => {
    render(<Header />)
    const link = screen.getByRole('link', { name: 'Source' })
    expect(link).toHaveAttribute('href', 'https://github.com/nuuls/fpv-configurator')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
