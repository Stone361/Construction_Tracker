import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { getHouseDetail } from '../services/houseDetail'

// Chrome E2E covers real Leaflet rendering, tile failures, zoom and resize.
vi.mock('../components/map/ConstructionMap', () => ({
  ConstructionMap: ({ decorative }: { decorative?: boolean }) => (
    <section aria-label={decorative ? 'Map backdrop of Austin, Texas' : 'Interactive map of Austin, Texas'} />
  ),
}))
vi.mock('../services/houseDetail', async importOriginal => {
  const original = await importOriginal<typeof import('../services/houseDetail')>()
  return { ...original, getHouseDetail: vi.fn() }
})

function renderRoute(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

describe('application routes', () => {
  it('renders the landing page with an explicit search boundary', () => {
    renderRoute()
    expect(screen.getByRole('heading', { level: 1, name: /A clearer view of/ })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'City or ZIP code' })).toHaveAccessibleDescription(/search is coming soon/)
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Map backdrop of Austin, Texas' })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Explore map' })).toHaveAttribute('href', '/map')
  })

  it('accepts input without pretending to search or navigating on Enter', async () => {
    const user = userEvent.setup()
    renderRoute()
    const input = screen.getByRole('searchbox', { name: 'City or ZIP code' })
    await user.type(input, 'Seattle 98101{Enter}')
    expect(input).toHaveValue('Seattle 98101')
    expect(screen.getByRole('status')).toHaveTextContent('Location search isn’t available yet.')
    expect(screen.getByRole('heading', { level: 1, name: /A clearer view of/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Interactive map of Austin, Texas' })).not.toBeInTheDocument()
  })

  it('navigates to the map and returns home', async () => {
    const user = userEvent.setup()
    renderRoute()
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Explore map' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Austin, Texas' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Interactive map of Austin, Texas' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Back to home' }))
    expect(screen.getByRole('searchbox', { name: 'City or ZIP code' })).toBeInTheDocument()
  })

  it('supports opening the map route directly', () => {
    renderRoute('/map')
    expect(screen.getByRole('heading', { level: 1, name: 'Austin, Texas' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('routes a direct house URL to the independent detail page', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue({
      id: 12, address: '12 Main St', permitNo: 'P-12', community: null,
      lat: null, lng: null, stage: null, sourceType: 'MANUAL', sourceUrl: null,
      sourceFetchedAt: null, createdAt: null, createdBusinessDate: null,
      createdBy: null, updatedAt: null, coverPhotoId: null, photos: [],
    })
    renderRoute('/houses/12')
    expect(await screen.findByRole('heading', { level: 1, name: '12 Main St' })).toBeInTheDocument()
    expect(getHouseDetail).toHaveBeenCalledWith(12, expect.any(AbortSignal),
      { user: 'frontend-demo', role: 'VIEWER', community: null })
  })

  it('shows an unknown route and returns to the landing page', async () => {
    const user = userEvent.setup()
    renderRoute('/missing-page')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Return to workspace' }))
    expect(screen.getByRole('heading', { level: 1, name: /A clearer view of/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument()
  })
})
