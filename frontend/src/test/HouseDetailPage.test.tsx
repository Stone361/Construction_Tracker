import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HouseDetailPage } from '../pages/HouseDetailPage'
import { getHouseDetail } from '../services/houseDetail'
import { setHouseCover } from '../services/houseCover'
import { advanceHouse } from '../services/advanceHouse'
import type { HouseDetail } from '../services/houseDetail'
import type { MapSnapshot } from '../services/mapNavigation'
import { ApiError } from '../services/apiClient'
import { DemoIdentityProvider } from '../app/DemoIdentityProvider'
import { identityStorageKey, identityStorageVersion, useDemoIdentity } from '../app/DemoIdentityContext'

vi.mock('../services/houseDetail', async importOriginal => {
  const original = await importOriginal<typeof import('../services/houseDetail')>()
  return { ...original, getHouseDetail: vi.fn() }
})
vi.mock('../services/houseCover', () => ({ setHouseCover: vi.fn() }))
vi.mock('../services/advanceHouse', () => ({ advanceHouse: vi.fn() }))

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

function renderDetailWithIdentity(onStageWriteSettled?: () => void) {
  return render(<DemoIdentityProvider><MemoryRouter initialEntries={['/houses/12']}>
    <IdentityControls /><Routes><Route path="houses/:id"
      element={<HouseDetailPage {...(onStageWriteSettled ? { onStageWriteSettled } : {})} />} /></Routes>
  </MemoryRouter></DemoIdentityProvider>)
}

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(getHouseDetail).mockReset()
  vi.mocked(setHouseCover).mockReset()
  vi.mocked(advanceHouse).mockReset()
})
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('house detail page', () => {
  const twoPhotos: HouseDetail = { ...house, coverPhotoId: 8, photos: [
    { id: 8, stage: 'FOUNDATION', takenAt: null, uploadedAt: null, businessDate: null, url: null },
    { id: 9, stage: 'LAND_CLEARING', locationStatus: 'SUSPECT', takenAt: null, uploadedAt: null, businessDate: null, url: null },
  ] }
  const eligibleHouse: HouseDetail = { ...house, photos: [{ id: 91, stage: 'FOUNDATION',
    locationStatus: 'UNKNOWN', takenAt: null, uploadedAt: null, businessDate: null, url: null }] }
  const useAdmin = () => sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
    identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))

  it('cancels before POST and advances only after confirmation, then refetches the detail', async () => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValueOnce(eligibleHouse)
      .mockResolvedValueOnce({ ...eligibleHouse, stage: 'FRAMING' })
    vi.mocked(advanceHouse).mockResolvedValue()
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    const dialog = screen.getByRole('dialog', { name: 'Advance construction stage?' })
    expect(dialog).toHaveTextContent('Foundation → Framing')
    expect(dialog).toHaveTextContent('cannot move a house back')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(advanceHouse).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Advance to Framing' })).toHaveFocus()
    expect(advanceHouse).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    expect(advanceHouse).toHaveBeenCalledWith(12, 'FOUNDATION', 'FRAMING',
      expect.objectContaining({ role: 'ADMIN' }), expect.any(Function))
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('Advance accepted')
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(2))
    expect(within(await screen.findByRole('region', { name: 'Construction progress' })).getByText('Current stage')
      .parentElement).toHaveTextContent('Framing')
  })

  it('blocks duplicate confirmation while a submitted write is pending', async () => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValue(eligibleHouse)
    let finish!: () => void
    vi.mocked(advanceHouse).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submitting stage advance/ })).toBeDisabled()
    expect(advanceHouse).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(2))
    expect(advanceHouse).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: 409, reason: '当前施工阶段已变化', refreshed: { ...eligibleHouse, stage: 'FRAMING' as const } },
    { status: 422, reason: '当前施工阶段缺少非 SUSPECT 的照片', refreshed: { ...eligibleHouse, photos: [] } },
  ])('shows HTTP $status business reason and reloads the authoritative detail', async ({ status, reason, refreshed }) => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValueOnce(eligibleHouse).mockResolvedValueOnce(refreshed)
    vi.mocked(advanceHouse).mockRejectedValue(new ApiError(`${reason} (HTTP ${status}).`, status))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    expect(await screen.findByText(new RegExp(reason))).toBeInTheDocument()
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(2))
    if (status === 422) expect(screen.getByRole('button', { name: 'Advance unavailable' })).toBeDisabled()
    else expect(screen.getByRole('region', { name: 'Construction progress' })).toHaveTextContent('Framing')
  })

  it('treats a network result as unknown, rereads details and never retries the POST', async () => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValue(eligibleHouse)
    vi.mocked(advanceHouse).mockRejectedValue(new ApiError('The stage advance result is unknown.'))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    expect(await screen.findByText(/The advance result is unknown/)).toBeInTheDocument()
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(2))
    expect(advanceHouse).toHaveBeenCalledTimes(1)
  })

  it('rereads again if a timed-out POST later settles, without sending it again', async () => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValue(eligibleHouse)
    let lateSettle!: () => void
    vi.mocked(advanceHouse).mockImplementation((_id, _from, _to, _identity, onLateSettle) => {
      if (!onLateSettle) throw new Error('Expected late settlement callback')
      lateSettle = onLateSettle
      return Promise.reject(new ApiError('The stage advance result is unknown.'))
    })
    const listInvalidated = vi.fn()
    const user = userEvent.setup()
    renderDetailWithIdentity(listInvalidated)
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(2))
    await act(async () => lateSettle())
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(3))
    expect(advanceHouse).toHaveBeenCalledTimes(1)
    expect(listInvalidated).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403])('shows HTTP %i as an identity or permission error', async status => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValue(eligibleHouse)
    vi.mocked(advanceHouse).mockRejectedValue(new ApiError(`Permission error (HTTP ${status}).`, status))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    expect(await screen.findByText(`Permission error (HTTP ${status}).`)).toBeInTheDocument()
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(2))
  })

  it('does not apply an old identity advance outcome to the new identity', async () => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValue(eligibleHouse)
    let finish!: () => void
    vi.mocked(advanceHouse).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    expect(screen.queryByRole('button', { name: 'Advance to Framing' })).not.toBeInTheDocument()
    await act(async () => finish())
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(3))
    expect(vi.mocked(getHouseDetail).mock.calls[2]?.[2]?.role).toBe('VIEWER')
    expect(screen.queryByText(/Advance accepted/)).not.toBeInTheDocument()
  })

  it('does not apply a previous house advance result to a different detail route', async () => {
    useAdmin()
    vi.mocked(getHouseDetail).mockResolvedValueOnce(eligibleHouse)
      .mockResolvedValueOnce({ ...house, id: 13, address: '13 Main St', stage: 'CO_READY' })
    let finish!: () => void
    vi.mocked(advanceHouse).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter initialEntries={['/houses/12']}>
      <Routes><Route path="houses/:id" element={<><HouseDetailPage /><RouteSwitcher /></>} /></Routes>
    </MemoryRouter></DemoIdentityProvider>)
    await user.click(await screen.findByRole('button', { name: 'Advance to Framing' }))
    await user.click(screen.getByRole('button', { name: 'Confirm advance' }))
    await user.click(screen.getByRole('link', { name: 'Next house' }))
    expect(await screen.findByRole('heading', { name: '13 Main St' })).toBeInTheDocument()
    await act(async () => finish())
    expect(screen.getByRole('heading', { name: '13 Main St' })).toBeInTheDocument()
    expect(screen.queryByText(/Advance accepted/)).not.toBeInTheDocument()
    expect(getHouseDetail).toHaveBeenCalledTimes(2)
  })

  it('marks the current cover, prevents duplicate setting and applies the returned detail', async () => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    vi.mocked(getHouseDetail).mockResolvedValue(twoPhotos)
    let finish!: (value: HouseDetail) => void
    vi.mocked(setHouseCover).mockReturnValue(new Promise(resolve => { finish = resolve }))
    renderDetailWithIdentity()
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.getByRole('button', { name: 'Preview photo 1' })).toHaveAccessibleDescription('Current cover')
    expect(screen.queryByRole('button', { name: 'Set photo 1 as cover' })).not.toBeInTheDocument()
    const setButton = screen.getByRole('button', { name: 'Set photo 2 as cover' })
    await userEvent.click(setButton)
    expect(setButton).toBeDisabled()
    expect(setButton).toHaveTextContent('Setting cover')
    expect(setButton).toHaveAttribute('aria-busy', 'true')
    expect(setHouseCover).toHaveBeenCalledWith(12, 9, expect.objectContaining({ role: 'ADMIN' }))
    await act(async () => finish({ ...twoPhotos, coverPhotoId: 9 }))
    expect(await screen.findByText(/House cover updated/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set photo 2 as cover' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set photo 1 as cover' })).toBeEnabled()
    expect(within(screen.getByRole('button', { name: 'Preview photo 2' })).getByText('Current cover')).toBeInTheDocument()
    expect(getHouseDetail).toHaveBeenCalledTimes(1)
    expect(setHouseCover).toHaveBeenCalledTimes(1)
  })

  it('shows cover actions only for Admin and an exact matching Site Manager community', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue(twoPhotos)
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Set photo 2 as cover' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('button', { name: 'Set photo 2 as cover' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Manage own community' }))
    expect(await screen.findByRole('button', { name: 'Set photo 2 as cover' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Manage other community' }))
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Set photo 2 as cover' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage lowercase community' }))
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('button', { name: 'Set photo 2 as cover' })).not.toBeInTheDocument()
  })

  it('keeps an error visible with a refresh option without changing the current cover', async () => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    vi.mocked(getHouseDetail).mockResolvedValue(twoPhotos)
    vi.mocked(setHouseCover).mockRejectedValue(new ApiError('Photo belongs to another house (HTTP 422).', 422))
    renderDetailWithIdentity()
    await screen.findByRole('button', { name: 'Set photo 2 as cover' })
    await userEvent.click(screen.getByRole('button', { name: 'Set photo 2 as cover' }))
    expect(await screen.findByText(/Photo belongs to another house \(HTTP 422\)/)).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Preview photo 1' })).getByText('Current cover')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh house details' }))
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(2))
  })

  it('ignores a previous identity cover result after switching back to Viewer', async () => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    vi.mocked(getHouseDetail).mockResolvedValue(twoPhotos)
    let finish!: (value: HouseDetail) => void
    vi.mocked(setHouseCover).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    await user.click(await screen.findByRole('button', { name: 'Set photo 2 as cover' }))
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    expect(screen.queryByRole('button', { name: 'Set photo 2 as cover' })).not.toBeInTheDocument()
    await act(async () => finish({ ...twoPhotos, coverPhotoId: 9 }))
    await waitFor(() => expect(getHouseDetail).toHaveBeenCalledTimes(3))
    expect(vi.mocked(getHouseDetail).mock.calls[2]?.[2]?.role).toBe('VIEWER')
    expect(within(screen.getByRole('button', { name: 'Preview photo 1' })).getByText('Current cover')).toBeInTheDocument()
    expect(screen.queryByText(/House cover updated/)).not.toBeInTheDocument()
  })

  it('does not apply a late cover result to a different house route', async () => {
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } }))
    vi.mocked(getHouseDetail).mockResolvedValueOnce(twoPhotos)
      .mockResolvedValueOnce({ ...house, id: 13, address: '13 Main St', coverPhotoId: null, photos: [] })
    let finish!: (value: HouseDetail) => void
    vi.mocked(setHouseCover).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter initialEntries={['/houses/12']}>
      <Routes><Route path="houses/:id" element={<><HouseDetailPage /><RouteSwitcher /></>} /></Routes>
    </MemoryRouter></DemoIdentityProvider>)
    await user.click(await screen.findByRole('button', { name: 'Set photo 2 as cover' }))
    await user.click(screen.getByRole('link', { name: 'Next house' }))
    expect(await screen.findByRole('heading', { name: '13 Main St' })).toBeInTheDocument()
    await act(async () => finish({ ...twoPhotos, coverPhotoId: 9 }))
    expect(screen.getByText('No cover selected. The image area is a placeholder.')).toBeInTheDocument()
    expect(screen.queryByText(/House cover updated/)).not.toBeInTheDocument()
    expect(getHouseDetail).toHaveBeenCalledTimes(2)
  })
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
    expect(screen.queryByRole('button', { name: /Set photo .* as cover/ })).not.toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'https://example.org/permit/12' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Cover photo details' })).toBeInTheDocument()
    expect(screen.getByText(/No cover selected/)).toBeInTheDocument()
    expect(screen.getByText('No site photos yet.')).toBeInTheDocument()
    first.unmount()
    renderDetail()
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(getHouseDetail).toHaveBeenCalledTimes(2)
  })

  it('keeps the two main cards focused and shows public provenance directly', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue({ ...house, photos: [
      { id: 8, stage: 'FOUNDATION', takenAt: null, uploadedAt: '2026-10-22T00:00:00Z', businessDate: null, url: null },
      { id: 9, stage: 'FOUNDATION', takenAt: null, uploadedAt: '2026-09-01T00:00:00Z', businessDate: '2026-01-05', url: null },
    ] })
    renderDetail()
    const property = await screen.findByRole('region', { name: 'Property' })
    const record = screen.getByRole('region', { name: 'Record and location' })
    expect(within(property).getAllByRole('term')).toHaveLength(4)
    expect(within(record).getAllByRole('term')).toHaveLength(4)
    expect(within(record).getByText('Map coordinates').parentElement).toHaveTextContent('30.267200, -97.743100')
    expect(within(record).getByText('Source URL').parentElement).toHaveTextContent('Fetched at · UTC: Jan 1, 2026')
    expect(within(record).getByRole('link', { name: 'https://example.org/permit/12' })).toBeVisible()
    expect(within(record).getByText('Record created').parentElement).toHaveTextContent('By importer')
    expect(within(record).getByText('Record created').parentElement).toHaveTextContent('Jan 2, 2026')
    expect(within(record).getByText('Latest photo business date · Chicago').parentElement).toHaveTextContent('Jan 5, 2026')
    expect(record).not.toHaveTextContent('Updated at')
    expect(record).not.toHaveTextContent('Source type')
  })

  it('shows unavailable source fields for a manual house without inventing photo activity', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue({ ...house, sourceType: 'MANUAL', sourceUrl: null,
      sourceFetchedAt: null, photos: [] })
    renderDetail()
    const record = await screen.findByRole('region', { name: 'Record and location' })
    expect(within(record).getAllByRole('term')).toHaveLength(4)
    expect(within(record).getByText('Source URL').parentElement).toHaveTextContent('Not available')
    expect(within(record).getByText('Source URL').parentElement).toHaveTextContent('Fetched at · UTC: Not available')
    expect(within(record).getByText('Latest photo business date · Chicago').parentElement).toHaveTextContent('No site photos yet')
    expect(within(record).queryByRole('link')).not.toBeInTheDocument()
  })

  it('shares the selected cover image with photo history and does not infer a cover when none is set', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:cover-12')
    URL.revokeObjectURL = vi.fn()
    const file = '/api/houses/12/photos/8/file'
    const withPhoto = { ...house, coverPhotoId: 8, photos: [{ id: 8, stage: 'FOUNDATION' as const,
      takenAt: null, uploadedAt: null, businessDate: null, url: file }] }
    vi.mocked(getHouseDetail).mockResolvedValueOnce(withPhoto)
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' }), {
      status: 200, headers: { 'Content-Type': 'image/png' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const view = renderDetail()
    expect(await screen.findByRole('img', { name: 'Current cover of 12 Main St' })).toHaveAttribute('src', 'blob:cover-12')
    expect(screen.getByRole('img', { name: 'Site photo 1' })).toHaveAttribute('src', 'blob:cover-12')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(file)
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-12')

    vi.mocked(getHouseDetail).mockResolvedValueOnce({ ...withPhoto, coverPhotoId: null })
    renderDetail()
    await screen.findByRole('heading', { name: '12 Main St' })
    expect(screen.queryByRole('img', { name: /Current cover/ })).not.toBeInTheDocument()
    expect(screen.getByText(/No cover selected/)).toBeInTheDocument()
  })

  it('shows the selected photo capture, upload and photo-stage metadata without its ID', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue({ ...house, stage: 'FRAMING', coverPhotoId: 8,
      photos: [{ id: 8, stage: 'LAND_CLEARING', takenAtSource: 'EXIF',
        takenAt: '2026-01-02T03:04:05Z', uploadedAt: '2026-01-05T06:07:08Z',
        businessDate: '2026-01-01', url: null }] })
    renderDetail()
    const cover = await screen.findByRole('region', { name: 'Cover photo details' })
    expect(within(cover).getByText('Date taken').parentElement).toHaveTextContent('Jan 2, 2026')
    expect(within(cover).getByText('Uploaded at').parentElement).toHaveTextContent('Jan 5, 2026')
    expect(within(cover).getByText('Construction stage').parentElement).toHaveTextContent('Land clearing')
    expect(cover).not.toHaveTextContent('Framing')
    expect(cover).not.toHaveTextContent('#8')
    expect(cover).not.toHaveTextContent('GPS')
  })

  it('does not present an upload-time fallback as an actual capture time', async () => {
    vi.mocked(getHouseDetail).mockResolvedValue({ ...house, coverPhotoId: 8,
      photos: [{ id: 8, stage: null, takenAtSource: 'UPLOAD',
        takenAt: '2026-01-05T06:07:08Z', uploadedAt: '2026-01-05T06:07:08Z',
        businessDate: null, url: null }] })
    renderDetail()
    const cover = await screen.findByRole('region', { name: 'Cover photo details' })
    expect(within(cover).getByText('Date taken').parentElement).toHaveTextContent('Not available')
    expect(within(cover).getByText('Uploaded at').parentElement).toHaveTextContent('Jan 5, 2026')
    expect(within(cover).getByText('Construction stage').parentElement).toHaveTextContent('Not available')
  })

  it('keeps the placeholder and allows retry if the selected cover file fails', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:retried-cover')
    URL.revokeObjectURL = vi.fn()
    vi.mocked(getHouseDetail).mockResolvedValue({ ...house, coverPhotoId: 8, photos: [{ id: 8,
      stage: 'FOUNDATION', takenAt: null, uploadedAt: null, businessDate: null,
      url: '/api/houses/12/photos/8/file' }] })
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' }), {
        status: 200, headers: { 'Content-Type': 'image/png' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    renderDetail()
    expect(await screen.findByText(/Cover image could not be loaded/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry cover' }))
    expect(await screen.findByRole('img', { name: 'Current cover of 12 Main St' })).toHaveAttribute('src', 'blob:retried-cover')
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
      .mockResolvedValueOnce({ ...house, id: 13, address: '13 Main St', stage: 'CO_READY' })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/houses/12']}>
      <Routes>
        <Route path="houses/:id" element={<><HouseDetailPage /><RouteSwitcher /></>} />
      </Routes>
    </MemoryRouter>)
    await user.click(screen.getByRole('link', { name: 'Next house' }))
    expect(await screen.findByRole('heading', { name: '13 Main St' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Construction progress' })).getByText('None — final stage')).toBeInTheDocument()
    resolveOld(house)
    await waitFor(() => expect(screen.getByRole('heading', { name: '13 Main St' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: '12 Main St' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Construction progress' })).getByText('None — final stage')).toBeInTheDocument()
    expect(vi.mocked(getHouseDetail).mock.calls[0]?.[1]?.aborted).toBe(true)
  })

  it('hides old progress while identity changes and recalculates from the new detail', async () => {
    let finishAdmin!: (value: HouseDetail) => void
    vi.mocked(getHouseDetail).mockResolvedValueOnce({ ...house, photos: [{ id: 1, stage: 'FOUNDATION',
      locationStatus: 'UNKNOWN', takenAt: null, uploadedAt: null, businessDate: null, url: null }] })
      .mockReturnValueOnce(new Promise(resolve => { finishAdmin = resolve }))
    const user = userEvent.setup()
    renderDetailWithIdentity()
    expect(await screen.findByRole('region', { name: 'Construction progress' })).toHaveTextContent('Satisfied')
    expect(screen.queryByRole('button', { name: /Advance to Framing/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(screen.getByText('Loading house details…')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Construction progress' })).not.toBeInTheDocument()
    await act(async () => finishAdmin({ ...house, stage: 'FRAMING', photos: [] }))
    const progress = await screen.findByRole('region', { name: 'Construction progress' })
    expect(progress).toHaveTextContent('Not satisfied')
    expect(within(progress).getByRole('button', { name: /Advance unavailable/ })).toBeDisabled()
    expect(within(progress).getAllByText('MEP')).toHaveLength(2)
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
    expect(screen.getByRole('heading', { name: 'Cover photo details' })).toBeInTheDocument()
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
