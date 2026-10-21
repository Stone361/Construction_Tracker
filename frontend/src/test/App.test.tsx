import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('application routes', () => {
  it('renders the workspace at the home route', () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1, name: 'Construction Tracker' })).toBeInTheDocument()
    expect(screen.getByText('Map and project tools are coming soon.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument()
  })

  it('shows an unknown route and navigates back to the workspace', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/missing-page']}><App /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Return to workspace' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Construction Tracker' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument()
  })
})
