import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HouseDetailPage } from '../pages/HouseDetailPage'
import { getHouseDetail } from '../services/houseDetail'
import type { HouseDetail } from '../services/houseDetail'
import type { MapSnapshot } from '../services/mapNavigation'
import { ApiError } from '../services/apiClient'

vi.mock('../services/houseDetail', async importOriginal => {
  const original = await importOriginal<typeof import('../services/houseDetail')>()
  return { ...original, getHouseDetail: vi.fn() }
})

const house: HouseDetail = {
  id: 12, permitNo: 'P-12', address: '12 Main St', community: 'Austin Council District 8',
  lat: 30.2672, lng: -97.7431, stage: 'FOUNDATION', sourceType: 'PUBLIC_DATA',
  sourceUrl: 'https://example.org/permit/12', sourceFetchedAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-02T01:00:00Z', createdBusinessDate: '2026-01-01',
  createdBy: 'importer', updatedAt: '2026-01-03T02:00:00Z', coverPhotoId: null, photos: [],
}

function MapProbe() {
  const location = useLocation()
  const snapshot = (location.state as { mapSnapshot?: MapSnapshot } | null)?.mapSnapshot
  return <div>Map restored: {snapshot?.stage ?? 'all'} · {snapshot?.selectedHouseId ?? 'none'}</div>
}

function renderDetail(path = '/houses/12', state?: unknown) {
  return render(<MemoryRouter initialEntries={[{ pathname: path, state }]}>
    <Routes>
      <Route path="houses/:id" element={<HouseDetailPage />} />
      <Route path="map" element={<MapProbe />} />
    </Routes>
  </MemoryRouter>)
}

beforeEach(() => vi.mocked(getHouseDetail).mockReset())
afterEach(() => vi.clearAllMocks())

describe('house detail page', () => {
  it('loads the independent detail on a direct route and requests again after remount', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue(house)
    const first = renderDetail()
    expect(screen.getByRole('status')).toHaveTextContent('Loading house details')
    expect(await screen.findByRole('heading', { name: '12 Main St' })).toBeInTheDocument()
    expect(screen.getByText('P-12')).toBeInTheDocument()
    expect(screen.getByText('Austin Council District 8')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://example.org/permit/12' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Current cover' })).toBeInTheDocument()
    expect(screen.getByText(/No cover selected/)).toBeInTheDocument()
    expect(screen.getByText('No site photos yet.')).toBeInTheDocument()
    first.unmount()
    renderDetail()
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(getHouseDetail).toHaveBeenCalledTimes(2)
  })

  it('rejects an invalid ID without making an API request', () => {
    renderDetail('/houses/not-a-number')
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid house ID')
    expect(getHouseDetail).not.toHaveBeenCalled()
  })

  it('returns to the map with its view, filter and selected house snapshot', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue(house)
    const snapshot: MapSnapshot = { view: { center: [30.3, -97.7], zoom: 14 },
      stage: 'FOUNDATION', selectedHouseId: 12 }
    renderDetail('/houses/12', { mapSnapshot: snapshot })
    await screen.findByRole('heading', { name: '12 Main St' })
    await userEvent.click(screen.getByRole('link', { name: 'Back to map' }))
    expect(screen.getByText('Map restored: FOUNDATION · 12')).toBeInTheDocument()
  })

  it('shows 404, 401 and network failures as errors and retries a failed request', async () => {
    vi.mocked(getHouseDetail)
      .mockRejectedValueOnce(new ApiError('Missing', 404))
      .mockRejectedValueOnce(new ApiError('The demo identity is invalid (HTTP 401).', 401))
      .mockRejectedValueOnce(new ApiError('Could not reach the backend.'))
      .mockResolvedValueOnce(house)
    const first = renderDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 404')
    first.unmount()
    const second = renderDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('401')
    second.unmount()
    renderDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the backend')
    await userEvent.click(screen.getByRole('button', { name: 'Retry details' }))
    expect(await screen.findByRole('heading', { name: '12 Main St' })).toBeInTheDocument()
  })

  it('ignores an older response after switching to another house and aborts it', async () => {
    let resolveOld!: (value: HouseDetail) => void
    vi.mocked(getHouseDetail)
      .mockReturnValueOnce(new Promise(done => { resolveOld = done }))
      .mockResolvedValueOnce({ ...house, id: 13, address: '13 Main St' })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/houses/12']}>
      <Routes>
        <Route path="houses/:id" element={<><HouseDetailPage /><RouteSwitcher /></>} />
      </Routes>
    </MemoryRouter>)
    await user.click(screen.getByRole('link', { name: 'Next house' }))
    expect(await screen.findByRole('heading', { name: '13 Main St' })).toBeInTheDocument()
    resolveOld(house)
    await waitFor(() => expect(screen.getByRole('heading', { name: '13 Main St' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: '12 Main St' })).not.toBeInTheDocument()
    expect(vi.mocked(getHouseDetail).mock.calls[0]?.[1]?.aborted).toBe(true)
  })

  it('clears an open photo preview when switching to another house', async () => {
    vi.mocked(getHouseDetail)
      .mockResolvedValueOnce({ ...house, coverPhotoId: 8, photos: [{ id: 8, stage: 'LAND_CLEARING',
        takenAt: '2026-01-01T04:00:00Z', uploadedAt: '2026-01-03T07:00:00Z',
        businessDate: '2025-12-31', url: '/api/houses/12/photos/8/file' }] })
      .mockResolvedValueOnce({ ...house, id: 13, address: '13 Main St', photos: [] })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/houses/12']}>
      <Routes><Route path="houses/:id" element={<><HouseDetailPage /><RouteSwitcher /></>} /></Routes>
    </MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Preview photo 1' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Cover photo #8 selected/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Next house' }))
    expect(await screen.findByRole('heading', { name: '13 Main St' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('No site photos yet.')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })
})

function RouteSwitcher() {
  return <Link to="/houses/13">Next house</Link>
}
