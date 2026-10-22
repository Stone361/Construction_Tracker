import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HouseDetailPage } from '../pages/HouseDetailPage'
import { getHouseDetail } from '../services/houseDetail'
import type { HouseDetail } from '../services/houseDetail'
import type { MapSnapshot } from '../services/mapNavigation'
import { ApiError } from '../services/apiClient'
import { DemoIdentityProvider } from '../app/DemoIdentityProvider'
import { identityStorageKey, identityStorageVersion, useDemoIdentity } from '../app/DemoIdentityContext'

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

function IdentityControls() {
  const { selectRole, selectSiteManager } = useDemoIdentity()
  return <>
    <button type="button" onClick={() => selectRole('ADMIN')}>Use Admin</button>
    <button type="button" onClick={() => selectRole('VIEWER')}>Use Viewer</button>
    <button type="button" onClick={() => selectSiteManager('Austin Council District 8')}>Manage own community</button>
    <button type="button" onClick={() => selectSiteManager('Austin Council District 5')}>Manage other community</button>
    <button type="button" onClick={() => selectSiteManager('austin council district 8')}>Manage lowercase community</button>
  </>
}

function renderDetailWithIdentity() {
  return render(<DemoIdentityProvider><MemoryRouter initialEntries={['/houses/12']}>
    <IdentityControls /><Routes><Route path="houses/:id" element={<HouseDetailPage />} /></Routes>
  </MemoryRouter></DemoIdentityProvider>)
}

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(getHouseDetail).mockReset()
})
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('house detail page', () => {
  it.each([{ status: 201, stale: false }, { status: 200, stale: false }, { status: 200, stale: true }] as const)(
    'shows HTTP $status outcome and reconciles photo history (stale: $stale)', async ({ status, stale }) => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    URL.createObjectURL = vi.fn(() => 'blob:local-preview')
    URL.revokeObjectURL = vi.fn()
    const uploaded = { id: 91, stage: 'FOUNDATION' as const, locationStatus: 'SUSPECT' as const,
      takenAt: '2026-01-01T00:00:00Z', uploadedAt: '2026-10-21T00:00:00Z',
      businessDate: '2025-12-31', url: null }
    const initialHouse = status === 200 && !stale ? { ...house, photos: [uploaded] } : house
    vi.mocked(getHouseDetail).mockResolvedValueOnce(initialHouse)
      .mockResolvedValueOnce({ ...house, address: '12 Main St (refreshed)', photos: [uploaded] })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 91, houseId: 12,
      locationStatus: 'SUSPECT', stage: 'FOUNDATION' }), { status,
      headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryAllByRole('button', { name: /^Preview photo \d+$/ })).toHaveLength(status === 200 && !stale ? 1 : 0)
    await user.upload(screen.getByLabelText('Choose photo file'),
      new File(['image'], status === 200 ? 'renamed-site.png' : 'site.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Confirm upload' }))
    expect(await screen.findByRole('alertdialog', { name: status === 201
      ? 'Photo uploaded successfully' : 'Photo already exists' })).toHaveTextContent(status === 201
      ? 'GPS status: SUSPECT' : 'No new photo was created')
    expect(getHouseDetail).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Back to upload' }))
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    await screen.findByRole('heading', { name: '12 Main St (refreshed)' })
    await screen.findByRole('button', { name: 'Preview photo 1' })
    expect(screen.queryAllByRole('button', { name: /^Preview photo \d+$/ })).toHaveLength(1)
    expect(screen.getByText('SUSPECT')).toBeInTheDocument()
    expect(getHouseDetail).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the upload area available while the successful photo history refresh is pending', async () => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    URL.createObjectURL = vi.fn(() => 'blob:local-preview')
    URL.revokeObjectURL = vi.fn()
    let finishRefresh!: (value: HouseDetail) => void
    vi.mocked(getHouseDetail).mockResolvedValueOnce(house)
      .mockReturnValueOnce(new Promise(resolve => { finishRefresh = resolve }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 91, houseId: 12,
      locationStatus: 'VERIFIED' }), { status: 201, headers: { 'Content-Type': 'application/json' } })))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await screen.findByRole('heading', { name: '12 Main St' })
    await user.upload(screen.getByLabelText('Choose photo file'), new File(['image'], 'site.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Confirm upload' }))
    expect(await screen.findByRole('alertdialog', { name: 'Photo uploaded successfully' })).toBeInTheDocument()
    expect(getHouseDetail).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Back to upload' }))
    expect(getHouseDetail).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { name: '12 Main St' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    expect(screen.queryByText('Loading house details…')).not.toBeInTheDocument()
    await act(async () => finishRefresh({ ...house, photos: [{ id: 91, stage: 'FOUNDATION',
      takenAt: null, uploadedAt: null, businessDate: null, url: null }] }))
    expect(screen.getAllByRole('button', { name: /^Preview photo \d+$/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
  })

  it('does not apply a previous identity upload result after switching to Viewer', async () => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    URL.createObjectURL = vi.fn(() => 'blob:local-preview')
    URL.revokeObjectURL = vi.fn()
    vi.mocked(getHouseDetail).mockResolvedValue(house)
    let finish!: (value: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await screen.findByRole('button', { name: 'Upload photo' })
    await user.upload(screen.getByLabelText('Choose photo file'), new File(['image'], 'site.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Confirm upload' }))
    expect(screen.getByRole('progressbar', { name: 'Upload in progress' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
    await act(async () => finish(new Response(JSON.stringify({ id: 91, houseId: 12,
      locationStatus: 'VERIFIED' }), { status: 201, headers: { 'Content-Type': 'application/json' } })))
    expect(screen.queryByText(/Photo uploaded/)).not.toBeInTheDocument()
    expect(getHouseDetail).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('updates the upload hint for Admin, Viewer and exact Site Manager community', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue(house)
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('button', { name: 'Upload photo' })).toBeEnabled()
    expect(screen.getByText('No site photos yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage own community' }))
    expect(await screen.findByRole('button', { name: 'Upload photo' })).toBeEnabled()
    expect(screen.getByText(/Demo manager area: Austin Council District 8.*Management entry is available/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage other community' }))
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
    expect(screen.getByText(/Demo manager area: Austin Council District 5.*outside your management area/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage lowercase community' }))
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
  })

  it('hides the old upload hint immediately during identity reload and after an authorization error', async () => {
    let rejectViewer!: (reason: Error) => void
    vi.mocked(getHouseDetail).mockResolvedValueOnce(house).mockResolvedValueOnce(house)
      .mockReturnValueOnce(new Promise((_, reject) => { rejectViewer = reject }))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await screen.findByRole('heading', { name: '12 Main St' })
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('button', { name: 'Upload photo' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading house details')
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
    rejectViewer(new ApiError('The current demo identity is not permitted (HTTP 403).', 403))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403')
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
  })

  it('does not reveal an Admin upload hint before details load or after detail failure', async () => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    vi.mocked(getHouseDetail).mockRejectedValue(new ApiError('Forbidden (HTTP 403).', 403))
    renderDetailWithIdentity()
    expect(screen.getByRole('status')).toHaveTextContent('Loading house details')
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403')
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument()
  })
  it('refetches the same house after identity changes and never displays the previous identity detail', async () => {
    vi.mocked(getHouseDetail).mockResolvedValueOnce(house)
      .mockResolvedValueOnce({ ...house, address: 'Admin verified house' })
    function Switch() {
      const { selectRole } = useDemoIdentity()
      return <button type="button" onClick={() => selectRole('ADMIN')}>Use Admin</button>
    }
    render(<DemoIdentityProvider><MemoryRouter initialEntries={['/houses/12']}>
      <Switch /><Routes><Route path="houses/:id" element={<HouseDetailPage />} /></Routes>
    </MemoryRouter></DemoIdentityProvider>)
    expect(await screen.findByRole('heading', { name: '12 Main St' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('heading', { name: 'Admin verified house' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '12 Main St' })).not.toBeInTheDocument()
    expect(vi.mocked(getHouseDetail).mock.calls[1]?.[2]?.role).toBe('ADMIN')
  })

  it('aborts an unfinished detail request when identity changes', async () => {
    let resolveOld!: (value: HouseDetail) => void
    vi.mocked(getHouseDetail).mockReturnValueOnce(new Promise(done => { resolveOld = done }))
      .mockResolvedValueOnce({ ...house, address: 'Verified under Admin' })
    function Switch() {
      const { selectRole } = useDemoIdentity()
      return <button type="button" onClick={() => selectRole('ADMIN')}>Use Admin</button>
    }
    render(<DemoIdentityProvider><MemoryRouter initialEntries={['/houses/12']}>
      <Switch /><Routes><Route path="houses/:id" element={<HouseDetailPage />} /></Routes>
    </MemoryRouter></DemoIdentityProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('heading', { name: 'Verified under Admin' })).toBeInTheDocument()
    resolveOld(house)
    await waitFor(() => expect(screen.queryByRole('heading', { name: '12 Main St' })).not.toBeInTheDocument())
    expect(vi.mocked(getHouseDetail).mock.calls[0]?.[1]?.aborted).toBe(true)
  })
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
