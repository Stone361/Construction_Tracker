import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { MapPage } from '../pages/MapPage'
import { DemoIdentityProvider } from '../app/DemoIdentityProvider'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { ApiError } from '../services/apiClient'
import { getAllHouses, getHouses } from '../services/houses'
import type { HouseSummary } from '../services/houses'
import { mapSnapshotFromState } from '../services/mapNavigation'
import type { MapSnapshot } from '../services/mapNavigation'

vi.mock('../components/map/MapBoundsObserver', () => ({
  MapBoundsObserver: ({ onChange }: { onChange: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }, view?: { center: [number, number]; zoom: number }) => void }) => {
    useEffect(() => {
      onChange({ minLat: 30.1, maxLat: 30.5, minLng: -97.9, maxLng: -97.5 })
    }, [onChange])
    return <button type="button" onClick={() => onChange(
      { minLat: 30.2, maxLat: 30.6, minLng: -97.8, maxLng: -97.4 },
      { center: [30.4, -97.6], zoom: 14 },
    )}>Finish map move</button>
  },
}))

vi.mock('../components/map/ConstructionMap', () => ({
  ConstructionMap: ({ children, initialView }: { children: ReactNode; initialView?: { center: [number, number]; zoom: number } }) =>
    <section aria-label="Interactive map of Austin, Texas" data-initial-view={initialView ? `${initialView.center.join(',')}:${initialView.zoom}` : ''}>{children}</section>,
}))
vi.mock('../components/map/HouseMarkers', () => ({
  HouseMarkers: ({ houses, selectedHouseId, onSelect }: {
    houses: HouseSummary[]; selectedHouseId: number | null; onSelect: (id: number) => void
  }) => houses.map(house => <button key={house.id} type="button"
    aria-label={`Map marker for house ${house.id}`}
    data-selected={selectedHouseId === house.id}
    onClick={() => onSelect(house.id)} />),
}))
vi.mock('../components/map/MapFocusTarget', () => ({
  MapFocusTarget: ({ request }: { request: { lat: number; lng: number } | null }) =>
    <output data-testid="map-focus">{request ? `${request.lat},${request.lng}` : 'none'}</output>,
}))
vi.mock('../services/houses', async importOriginal => {
  const original = await importOriginal<typeof import('../services/houses')>()
  return { ...original, getHouses: vi.fn(), getAllHouses: vi.fn() }
})

function house(id: number, overrides: Partial<HouseSummary> = {}): HouseSummary {
  return { id, address: `${id} Main St`, permitNo: `P-${id}`, community: 'Austin Council District 8',
    stage: 'FOUNDATION', lastPhotoBusinessDate: null, coverPhotoUrl: null, lat: 30 + id / 100, lng: -97,
    ...overrides }
}

function renderMap() {
  return render(<MemoryRouter><MapPage /></MemoryRouter>)
}

function IdentitySwitch() {
  const { selectRole } = useDemoIdentity()
  return <button type="button" onClick={() => selectRole('ADMIN')}>Use Admin</button>
}

function IdentityCycle() {
  const { selectRole, selectSiteManager } = useDemoIdentity()
  return <>
    <button type="button" onClick={() => selectRole('ADMIN')}>Use Admin</button>
    <button type="button" onClick={() => selectSiteManager('Austin Council District 8')}>Use Site Manager</button>
    <button type="button" onClick={() => selectRole('VIEWER')}>Use Viewer</button>
  </>
}

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(getHouses).mockReset()
  vi.mocked(getAllHouses).mockReset()
  vi.mocked(getAllHouses).mockResolvedValue([])
})

describe('map house data and selection', () => {
  it('links Admin to the independent create route and hides it from other roles', async () => {
    vi.mocked(getHouses).mockResolvedValue([])
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentityCycle /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    expect(screen.queryByRole('link', { name: /Add house/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(screen.getByRole('link', { name: 'Add house' })).toHaveAttribute('href', '/houses/new')
    await user.click(screen.getByRole('button', { name: 'Use Site Manager' }))
    expect(screen.queryByRole('link', { name: /Add house/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    expect(screen.queryByRole('link', { name: /Add house/ })).not.toBeInTheDocument()
  })
  it('requeries under a new identity and ignores the old identity response', async () => {
    let resolveOld!: (value: HouseSummary[]) => void
    vi.mocked(getHouses).mockReturnValueOnce(new Promise(done => { resolveOld = done }))
      .mockResolvedValueOnce([house(2)])
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentitySwitch /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    await screen.findByText('Loading houses from the backend…')
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByText('2 Main St')).toBeInTheDocument()
    resolveOld([house(1)])
    expect(screen.queryByText('1 Main St')).not.toBeInTheDocument()
    expect(vi.mocked(getHouses).mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(vi.mocked(getHouses).mock.calls[1]?.[2]?.role).toBe('ADMIN')
  })

  it('shows an authorization failure after switching instead of old house data', async () => {
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)])
      .mockRejectedValueOnce(new ApiError('Access denied (HTTP 403).', 403))
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentitySwitch /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    expect(await screen.findByText('1 Main St')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403')
    expect(screen.queryByText('1 Main St')).not.toBeInTheDocument()
  })

  it('clears a selected house absent from the new identity result', async () => {
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)]).mockResolvedValueOnce([house(2)])
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentitySwitch /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    expect(screen.getByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('button', { name: 'View 2 Main St' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '1 Main St' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to list' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
  })

  it('ends on the last identity after rapid Viewer, Admin, Site Manager, Viewer changes', async () => {
    const oldResolvers: Array<(value: HouseSummary[]) => void> = []
    vi.mocked(getHouses).mockImplementationOnce(() => new Promise(done => { oldResolvers.push(done) }))
      .mockImplementationOnce(() => new Promise(done => { oldResolvers.push(done) }))
      .mockImplementationOnce(() => new Promise(done => { oldResolvers.push(done) }))
      .mockResolvedValueOnce([house(4, { address: 'Latest Viewer house' })])
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentityCycle /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    await waitFor(() => expect(getHouses).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    await waitFor(() => expect(getHouses).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Use Site Manager' }))
    await waitFor(() => expect(getHouses).toHaveBeenCalledTimes(3))
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    expect(await screen.findByRole('button', { name: 'View Latest Viewer house' })).toBeInTheDocument()
    oldResolvers.forEach(resolve => resolve([house(1, { address: 'Stale house' })]))
    expect(screen.queryByRole('button', { name: 'View Stale house' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(vi.mocked(getHouses).mock.calls.map(call => call[2]?.role))
      .toEqual(['VIEWER', 'ADMIN', 'SITE_MANAGER', 'VIEWER'])
    expect(vi.mocked(getHouses).mock.calls[2]?.[2]?.community).toBe('Austin Council District 8')
    expect(vi.mocked(getHouses).mock.calls.slice(0, 3).every(call => call[1]?.aborted)).toBe(true)
  })
  it('shows loading, sorted real cards, counts, and no duplicate fetch on selection', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof getHouses>>) => void
    vi.mocked(getHouses).mockReturnValue(new Promise(done => { resolve = done }))
    renderMap()
    expect(screen.getByText('Loading houses from the backend…')).toBeInTheDocument()
    resolve([house(1), house(2, { lastPhotoBusinessDate: '2026-10-20', lat: null, lng: null })])
    expect(await screen.findByText('2 houses in view · 1 map marker')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'House cards' })
    expect(within(list).getAllByRole('button', { name: /^View \d+ Main St$/ }).map(button => button.textContent)).toEqual([
      expect.stringContaining('2 Main St'), expect.stringContaining('1 Main St'),
    ])
    expect(within(list).getByRole('button', { name: 'View 2 Main St' })).toHaveTextContent('Location unavailable')
    expect(getHouses).toHaveBeenCalledOnce()
  })

  it('combines address, real area and stage on the loaded view for cards and markers', async () => {
    const user = userEvent.setup()
    const allHouses = [
      house(1, { address: '8023 NW St', community: 'Austin Council District 8', stage: 'FOUNDATION' }),
      house(2, { address: '8023 SW St', community: 'Austin Council District 5', stage: 'FRAMING' }),
      house(3, { address: '8110 Oak Ave', community: 'Austin Council District 8', stage: 'FRAMING' }),
    ]
    vi.mocked(getHouses).mockResolvedValue(allHouses)
    vi.mocked(getAllHouses).mockResolvedValue(allHouses)
    renderMap()
    expect(await screen.findByText('3 houses in view · 3 map markers')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'House Explorer' })).toBeInTheDocument()
    expect(screen.queryByText('Search and filters cover all houses; clear them to browse the current map view.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Community / Area')).toHaveValue('')
    await user.type(screen.getByRole('searchbox', { name: 'Search address' }), '8023')
    expect(await screen.findByText('2 houses found · 2 map markers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Community / Area'), 'Austin Council District 5')
    expect(screen.getByText('1 house found · 1 map marker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View 8023 SW St' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FOUNDATION')
    expect(screen.getByText('No houses match these filters.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Construction stage'), '')
    expect(screen.getByRole('button', { name: 'View 8023 SW St' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Community / Area'), '')
    expect(screen.getByText('2 houses found · 2 map markers')).toBeInTheDocument()
    expect(getHouses).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('searchbox', { name: 'Search address' })).toHaveValue('')
    expect(screen.getByLabelText('Community / Area')).toHaveValue('')
    expect(screen.getByLabelText('Construction stage')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    expect(await screen.findByText('3 houses in view · 3 map markers')).toBeInTheDocument()
    expect(getHouses).toHaveBeenCalledTimes(2)
  })

  it('searches beyond the current bounds, keeps results while the map moves, then resumes bounded browsing', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)])
      .mockResolvedValueOnce([house(2, { address: 'House in moved view' })])
    vi.mocked(getAllHouses).mockResolvedValue([
      house(1), house(99, { address: 'Remote Pine Road', lat: 40, lng: -100 }),
      house(100, { address: 'No coordinate home', lat: null, lng: null }),
    ])
    renderMap()
    expect(await screen.findByText('1 house in view · 1 map marker')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search address' }), 'REMOTE')
    expect(await screen.findByText('1 house found · 1 map marker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Remote Pine Road' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 99' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View Remote Pine Road' }))
    expect(screen.getByTestId('map-focus')).toHaveTextContent('40,-100')
    await user.click(screen.getByRole('button', { name: 'Back to list' }))
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    expect(screen.getByRole('button', { name: 'View Remote Pine Road' })).toBeInTheDocument()
    expect(getHouses).toHaveBeenCalledOnce()
    await user.clear(screen.getByRole('searchbox', { name: 'Search address' }))
    expect(await screen.findByText('House in moved view')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map marker for house 99' })).not.toBeInTheDocument()
    expect(getHouses).toHaveBeenCalledTimes(2)
    expect(vi.mocked(getHouses).mock.calls[1]?.[0].bounds.minLat).toBe(30.2)

    await user.type(screen.getByRole('searchbox', { name: 'Search address' }), 'No coordinate')
    expect(await screen.findByText('1 house found · 0 map markers')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View No coordinate home' }))
    expect(screen.getByRole('heading', { name: 'No coordinate home' })).toBeInTheDocument()
    expect(screen.getByTestId('map-focus')).toHaveTextContent('none')
    expect(getHouses).toHaveBeenCalledTimes(2)
  })

  it('selects from a card, highlights one marker, and returns to the list without another request', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1), house(2)])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 2 Main St' }))
    expect(screen.getByRole('heading', { name: '2 Main St' })).toBeInTheDocument()
    expect(screen.getByTestId('map-focus')).toHaveTextContent('30.02,-97')
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-selected', 'true')
    const back = screen.getByRole('button', { name: 'Back to list' })
    const header = back.closest('header')
    expect(header).not.toBeNull()
    expect(header?.firstElementChild).toBe(back)
    expect(header).toContainElement(screen.getByText('MAP WORKSPACE'))
    expect(header?.parentElement?.lastElementChild).toContainElement(screen.getByRole('heading', { name: '2 Main St' }))
    await user.click(back)
    expect(screen.getByRole('list', { name: 'House cards' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to list' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-selected', 'false')
    expect(screen.getByLabelText('Construction stage')).toHaveValue('')
    expect(screen.getByTestId('map-focus')).toHaveTextContent('none')
    expect(getHouses).toHaveBeenCalledOnce()
  })

  it('selects another marker using the same house information view without requesting again', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1), house(2)])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'Map marker for house 1' }))
    expect(screen.getByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Map marker for house 2' }))
    expect(screen.getByRole('heading', { name: '2 Main St' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 1' })).toHaveAttribute('data-selected', 'false')
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('map-focus')).toHaveTextContent('none')
    expect(getHouses).toHaveBeenCalledOnce()
  })

  it('selects a coordinate-free card without moving the map or fabricating fields', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(9, { address: null, permitNo: null,
      community: null, stage: null, lat: null, lng: null })])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View Address unavailable' }))
    expect(screen.getByRole('heading', { name: 'Address unavailable' })).toBeInTheDocument()
    expect(screen.getByText('Area unavailable')).toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.getByText('Stage unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('map-focus')).toHaveTextContent('none')
    expect(screen.queryByRole('button', { name: /Map marker for house/ })).not.toBeInTheDocument()
  })

  it('shows an honest empty response', async () => {
    vi.mocked(getHouses).mockResolvedValue([])
    renderMap()
    expect(await screen.findByText('No houses in the current map view.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows backend failure and retries without inventing houses', async () => {
    vi.mocked(getHouses).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    renderMap()
    expect(await screen.findByRole('alert')).toHaveTextContent('House data could not be loaded.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry house data' }))
    expect(await screen.findByText('No houses in the current map view.')).toBeInTheDocument()
    expect(getHouses).toHaveBeenCalledTimes(2)
  })

  it('queries after a completed map move without looping and uses the same filtered data for cards and markers', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)]).mockResolvedValueOnce([house(2)])
    renderMap()
    expect(await screen.findByText('1 Main St')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    expect(await screen.findByText('2 Main St')).toBeInTheDocument()
    expect(screen.queryByText('1 Main St')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toBeInTheDocument()
    expect(getHouses).toHaveBeenCalledTimes(2)
    expect(vi.mocked(getHouses).mock.calls[1]?.[0].bounds.minLat).toBe(30.2)
  })

  it('filters the loaded view without another request and clears a selection excluded by stage', async () => {
    const user = userEvent.setup()
    const allHouses = [house(1), house(2, { stage: 'FRAMING' })]
    vi.mocked(getHouses).mockResolvedValue(allHouses)
    vi.mocked(getAllHouses).mockResolvedValue(allHouses)
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FRAMING')
    expect(await screen.findByText('2 Main St')).toBeInTheDocument()
    expect(screen.getByText('2 Main St')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '1 Main St' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
    expect(vi.mocked(getHouses).mock.calls[0]?.[0].stage).toBeNull()
    expect(getHouses).toHaveBeenCalledOnce()
  })

  it('keeps a selected house while it remains in a new result', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1)])
    vi.mocked(getAllHouses).mockResolvedValue([house(1)])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FOUNDATION')
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 1' })).toHaveAttribute('data-selected', 'true')
  })

  it('opens detail from a card and restores the map filter and selection on return', async () => {
    const user = userEvent.setup()
    const onSnapshotChange = vi.fn()
    vi.mocked(getHouses).mockResolvedValue([house(1)])
    vi.mocked(getAllHouses).mockResolvedValue([house(1)])
    function DetailProbe() {
      const { id } = useParams()
      const location = useLocation()
      const snapshot = mapSnapshotFromState(location.state)
      return <><p>Detail ID: {id} · stage: {snapshot?.stage} · selected: {snapshot?.selectedHouseId}</p>
        <Link to="/map" state={location.state}>Back to map</Link></>
    }
    render(<MemoryRouter initialEntries={['/map']}><Routes>
      <Route path="/map" element={<MapPage onSnapshotChange={onSnapshotChange} />} />
      <Route path="/houses/:id" element={<DetailProbe />} />
    </Routes></MemoryRouter>)
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FOUNDATION')
    await user.selectOptions(screen.getByLabelText('Community / Area'), 'Austin Council District 8')
    await user.type(screen.getByRole('searchbox', { name: 'Search address' }), 'main')
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Open details for 1 Main St' }))
    expect(onSnapshotChange).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'FOUNDATION', community: 'Austin Council District 8', addressSearch: 'main', selectedHouseId: 1,
    }))
    expect(screen.getByText('Detail ID: 1 · stage: FOUNDATION · selected: 1')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Back to map' }))
    expect(screen.getByLabelText('Construction stage')).toHaveValue('FOUNDATION')
    expect(screen.getByLabelText('Community / Area')).toHaveValue('Austin Council District 8')
    expect(screen.getByRole('searchbox', { name: 'Search address' })).toHaveValue('main')
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Open full house details/ }))
    expect(screen.getByText('Detail ID: 1 · stage: FOUNDATION · selected: 1')).toBeInTheDocument()
  })

  it('preserves the map state when browser history goes back from details', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1)])
    vi.mocked(getAllHouses).mockResolvedValue([house(1)])
    function Journey() {
      const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null)
      const navigate = useNavigate()
      return <><button type="button" onClick={() => navigate(-1)}>History back</button><Routes>
        <Route path="/map" element={<MapPage savedSnapshot={snapshot} onSnapshotChange={setSnapshot} />} />
        <Route path="/houses/:id" element={<p>Detail route</p>} />
      </Routes></>
    }
    render(<MemoryRouter initialEntries={['/map']}><Journey /></MemoryRouter>)
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FOUNDATION')
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Open details for 1 Main St' }))
    expect(screen.getByText('Detail route')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'History back' }))
    expect(screen.getByLabelText('Construction stage')).toHaveValue('FOUNDATION')
    expect(screen.getByRole('region', { name: 'Interactive map of Austin, Texas' }))
      .toHaveAttribute('data-initial-view', '30.4,-97.6:14')
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
  })
})
