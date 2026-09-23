import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WelcomePage } from './Welcome'

describe('WelcomePage footer', () => {
  it('credits the author, links the source and the projects it builds on, and has a disclaimer', () => {
    render(<WelcomePage />)
    const footer = within(screen.getByRole('contentinfo'))
    expect(footer.getByText(/created and maintained by/i)).toBeInTheDocument()
    expect(footer.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/nuuls/fpv-configurator',
    )
    expect(footer.getByRole('link', { name: 'Betaflight' })).toHaveAttribute(
      'href',
      'https://github.com/betaflight/betaflight',
    )
    for (const link of footer.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\//)
      expect(link).toHaveAttribute('target', '_blank')
    }
    expect(footer.getByText(/disclaimer/i)).toHaveTextContent(
      /not affiliated.*without any warranty/i,
    )
  })
})
