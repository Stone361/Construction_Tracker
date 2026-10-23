import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { getCurrentSummary } from '../services/summary'
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
  ConstructionMap: ({ children, initialView, onResetView }: {
    children: ReactNode; initialView?: { center: [number, number]; zoom: number }; onResetView?: () => void
  }) =>
    <section aria-label="Interactive map of Austin, Texas" data-initial-view={initialView ? `${initialView.center.join(',')}:${initialView.zoom}` : ''}>
      <button type="button" onClick={onResetView}>Reset view</button>{children}
    </section>,
}))
vi.mock('../components/map/HouseMarkers', () => ({
  HouseMarkers: ({ houses, selectedHouseId, onSelect, tone, showSelectedPopup }: {
    houses: HouseSummary[]; selectedHouseId: number | null; onSelect: (id: number) => void
    tone?: string; showSelectedPopup?: boolean
  }) => houses.map(house => <button key={house.id} type="button"
    aria-label={`Map marker for house ${house.id}`}
    data-selected={selectedHouseId === house.id}
    data-tone={tone ?? 'default'}
    data-popup-open={showSelectedPopup && selectedHouseId === house.id}
    onClick={() => onSelect(house.id)} />),
}))
vi.mock('../components/map/MapFocusTarget', () => ({
  MapFocusTarget: ({ request, restoreView }: { request: { lat: number; lng: number } | null;
    restoreView?: { center: [number, number]; zoom: number } | null }) => <>
      <output data-testid="map-focus">{request ? `${request.lat},${request.lng}` : 'none'}</output>
      <output data-testid="map-restore">{restoreView ? `${restoreView.center.join(',')}:${restoreView.zoom}` : 'none'}</output>
    </>,
}))
vi.mock('../services/houses', async importOriginal => {
  const original = await importOriginal<typeof import('../services/houses')>()
  return { ...original, getHouses: vi.fn(), getAllHouses: vi.fn() }
})
vi.mock('../services/summary', async importOriginal => {
  const original = await importOriginal<typeof import('../services/summary')>()
  return { ...original, getCurrentSummary: vi.fn() }
})

function house(id: number, overrides: Partial<HouseSummary> = {}): HouseSummary {
  return { id, address: `${id} Main St`, permitNo: `P-${id}`, community: 'Austin Council District 8',
    stage: 'FOUNDATION', lastPhotoBusinessDate: null, coverPhotoUrl: null, lat: 30 + id / 100, lng: -97,
    ...overrides }
}

function renderMap() {
  const result = render(<MemoryRouter><MapPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
  return result
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
  vi.mocked(getCurrentSummary).mockReset()
  vi.mocked(getCurrentSummary).mockResolvedValue({
    stageCounts: { LAND_CLEARING: 0, FOUNDATION: 0, FRAMING: 0, MEP: 0, INTERIOR: 0, CO_READY: 0 },
    staleHouseIds: [], totalHouses: 0,
  })
})

describe('map house data and selection', () => {
  it('links Admin to the independent create route and hides it from other roles', async () => {
    vi.mocked(getHouses).mockResolvedValue([])
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentityCycle /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
    expect(await screen.findByText('1 Main St')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403')
    expect(screen.queryByText('1 Main St')).not.toBeInTheDocument()
  })

  it('clears a selected house absent from the new identity result', async () => {
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)]).mockResolvedValueOnce([house(2)])
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentitySwitch /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
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
    expect(screen.getByRole('tab', { name: 'House Explorer' })).toBeInTheDocument()
    expect(screen.queryByText('MAP WORKSPACE')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'House Explorer' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('searchbox', { name: 'Search address' })).toHaveValue('REMOTE')
    expect(screen.getByText('1 house found · 1 map marker')).toBeInTheDocument()
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
    expect(screen.getByRole('tab', { name: 'House Explorer' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('searchbox', { name: 'Search address' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Community / Area')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Construction stage')).not.toBeInTheDocument()
    expect(screen.queryByText('2 houses in view · 2 map markers')).not.toBeInTheDocument()
    const back = screen.getByRole('button', { name: 'Back to list' })
    const header = back.closest('header')
    expect(header).not.toBeNull()
    expect(header?.firstElementChild).toBe(back)
    expect(header).toContainElement(screen.getByRole('heading', { name: 'House information' }))
    expect(header?.parentElement?.lastElementChild).toContainElement(screen.getByRole('heading', { name: '2 Main St' }))
    await user.click(back)
    expect(screen.getByRole('list', { name: 'House cards' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to list' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-selected', 'false')
    expect(screen.getByRole('searchbox', { name: 'Search address' })).toBeInTheDocument()
    expect(screen.getByLabelText('Construction stage')).toHaveValue('')
    expect(screen.getByText('2 houses in view · 2 map markers')).toBeInTheDocument()
    expect(screen.getByTestId('map-focus')).toHaveTextContent('none')
    expect(getHouses).toHaveBeenCalledOnce()
  })

  it('selects another marker using the same house information view without requesting again', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1), house(2)])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'Map marker for house 1' }))
    expect(screen.getByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Search address' })).not.toBeInTheDocument()
    expect(screen.queryByText('2 houses in view · 2 map markers')).not.toBeInTheDocument()
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

  it('filters the loaded view after returning from a selection without another request', async () => {
    const user = userEvent.setup()
    const allHouses = [house(1), house(2, { stage: 'FRAMING' })]
    vi.mocked(getHouses).mockResolvedValue(allHouses)
    vi.mocked(getAllHouses).mockResolvedValue(allHouses)
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    expect(screen.queryByLabelText('Construction stage')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to list' }))
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FRAMING')
    expect(await screen.findByText('2 Main St')).toBeInTheDocument()
    expect(screen.getByText('2 Main St')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '1 Main St' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
    expect(vi.mocked(getHouses).mock.calls[0]?.[0].stage).toBeNull()
    expect(getHouses).toHaveBeenCalledOnce()
  })

  it('keeps a selected house while it remains in a new map result', async () => {
    const user = userEvent.setup()
    let resolveMoved!: (value: Awaited<ReturnType<typeof getHouses>>) => void
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)])
      .mockReturnValueOnce(new Promise(done => { resolveMoved = done }))
    vi.mocked(getAllHouses).mockResolvedValue([house(1)])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    expect(screen.getByText('Loading houses from the backend…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Search address' })).not.toBeInTheDocument()
    expect(screen.queryByText('1 house in view · 1 map marker')).not.toBeInTheDocument()
    resolveMoved([house(1)])
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 1' })).toHaveAttribute('data-selected', 'true')
    expect(getHouses).toHaveBeenCalledTimes(2)
  })

  it('keeps selected-house errors and retry visible without restoring filters', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)])
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([house(1)])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('House data could not be loaded.')
    expect(screen.queryByRole('searchbox', { name: 'Search address' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry house data' }))
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    expect(getHouses).toHaveBeenCalledTimes(3)
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
    fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
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
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Construction stage')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByLabelText('Construction stage')).toHaveValue('FOUNDATION')
    expect(screen.getByLabelText('Community / Area')).toHaveValue('Austin Council District 8')
    expect(screen.getByRole('searchbox', { name: 'Search address' })).toHaveValue('main')
    await user.click(screen.getByRole('button', { name: 'View 1 Main St' }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'House Explorer' }))
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FOUNDATION')
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Open details for 1 Main St' }))
    expect(screen.getByText('Detail route')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'History back' }))
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Construction stage')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByLabelText('Construction stage')).toHaveValue('FOUNDATION')
    expect(screen.getByRole('region', { name: 'Interactive map of Austin, Texas' }))
      .toHaveAttribute('data-initial-view', '30.4,-97.6:14')
    expect(screen.getByRole('button', { name: 'View 1 Main St' })).toBeInTheDocument()
  })
})

describe('current Summary workspace', () => {
  const stageCounts = { LAND_CLEARING: 1, FOUNDATION: 2, FRAMING: 0, MEP: 0, INTERIOR: 0, CO_READY: 0 }

  it('defaults to Summary, uses backend counts and stale IDs, and keeps all warning markers on selection', async () => {
    vi.mocked(getCurrentSummary).mockResolvedValue({ stageCounts, staleHouseIds: [2, 3], totalHouses: 3 })
    vi.mocked(getAllHouses).mockResolvedValue([
      house(1), house(2, { address: 'Attention house', stage: 'LAND_CLEARING' }),
      house(3, { address: 'No coordinates', lat: null, lng: null }),
    ])
    const user = userEvent.setup()
    render(<MemoryRouter><MapPage /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('list', { name: 'Needs Attention houses' })).toBeInTheDocument()
    expect(screen.getByText('Total houses').parentElement).toHaveTextContent('3')
    expect(screen.getByText('Needs attention').parentElement).toHaveTextContent('2')
    expect(screen.getByText('No new site photos in over 14 days.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Construction stages' }))
      .getByText('Foundation').parentElement).toHaveTextContent('2 · 66.7%')
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-tone', 'warning')
    expect(screen.queryByRole('button', { name: 'Map marker for house 3' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Open details for/ })[0]).toHaveTextContent('Open details →')
    expect(screen.queryByText('Locate on map')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View Attention house' }))
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-popup-open', 'true')
    expect(screen.getByTestId('map-focus')).toHaveTextContent('30.02,-97')
    expect(screen.getByRole('list', { name: 'Needs Attention houses' })).toHaveTextContent('No coordinates')
    expect(getHouses).not.toHaveBeenCalled()
  })

  it('highlights the selected attention marker without removing other warning markers', async () => {
    vi.mocked(getCurrentSummary).mockResolvedValue({ stageCounts, staleHouseIds: [1, 2], totalHouses: 3 })
    vi.mocked(getAllHouses).mockResolvedValue([house(1), house(2), house(3)])
    const user = userEvent.setup()
    render(<MemoryRouter><MapPage /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    expect(screen.getByRole('button', { name: 'Map marker for house 1' })).toHaveAttribute('data-selected', 'true')
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-tone', 'warning')
    expect(screen.queryByRole('button', { name: 'Map marker for house 3' })).not.toBeInTheDocument()
  })

  it('keeps Explorer filters and map view separate from Summary selection', async () => {
    vi.mocked(getCurrentSummary).mockResolvedValue({ stageCounts, staleHouseIds: [2], totalHouses: 3 })
    vi.mocked(getAllHouses).mockResolvedValue([house(1), house(2)])
    vi.mocked(getHouses).mockResolvedValue([house(1)])
    const user = userEvent.setup()
    render(<MemoryRouter><MapPage /></MemoryRouter>)
    await screen.findByRole('button', { name: 'View 2 Main St' })
    await user.click(screen.getByRole('tab', { name: 'House Explorer' }))
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FOUNDATION')
    await user.type(screen.getByRole('searchbox', { name: 'Search address' }), 'main')
    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    await user.click(screen.getByRole('button', { name: 'View 2 Main St' }))
    expect(screen.getByTestId('map-focus')).toHaveTextContent('30.02,-97')
    await user.click(screen.getByRole('tab', { name: 'House Explorer' }))
    expect(screen.getByLabelText('Construction stage')).toHaveValue('FOUNDATION')
    expect(screen.getByRole('searchbox', { name: 'Search address' })).toHaveValue('main')
    expect(screen.getByTestId('map-restore')).toHaveTextContent('30.4,-97.6:14')
    expect(screen.getByRole('button', { name: 'Map marker for house 1' })).toHaveAttribute('data-tone', 'default')
  })

  it('clears tab selections and popup when returning to the default Summary view', async () => {
    vi.mocked(getCurrentSummary).mockResolvedValue({ stageCounts, staleHouseIds: [1, 2], totalHouses: 2 })
    vi.mocked(getAllHouses).mockResolvedValue([house(1), house(2)])
    vi.mocked(getHouses).mockResolvedValue([house(1), house(2)])
    const user = userEvent.setup()
    render(<MemoryRouter><MapPage /></MemoryRouter>)
    const marker = () => screen.getByRole('button', { name: 'Map marker for house 1' })
    await screen.findByRole('button', { name: 'View 1 Main St' })
    expect(marker()).toHaveAttribute('data-selected', 'false')
    expect(marker()).toHaveAttribute('data-popup-open', 'false')

    await user.click(screen.getByRole('tab', { name: 'House Explorer' }))
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.type(screen.getByRole('searchbox', { name: 'Search address' }), 'main')
    await user.click(marker())
    expect(marker()).toHaveAttribute('data-selected', 'true')
    await user.click(screen.getByRole('button', { name: 'Finish map move' }))

    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    expect(marker()).toHaveAttribute('data-selected', 'false')
    expect(marker()).toHaveAttribute('data-popup-open', 'false')
    expect(screen.getByTestId('map-restore')).toHaveTextContent('30.2672,-97.7431:12')
    expect(screen.getAllByRole('button', { name: /Map marker for house/ })).toHaveLength(2)

    await user.click(marker())
    expect(marker()).toHaveAttribute('data-popup-open', 'true')
    await user.click(screen.getByRole('tab', { name: 'House Explorer' }))
    expect(screen.getByRole('searchbox', { name: 'Search address' })).toHaveValue('main')
    expect(marker()).toHaveAttribute('data-selected', 'false')
    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    expect(marker()).toHaveAttribute('data-popup-open', 'false')
  })

  it('resets the active tab view and clears its marker selection and popup', async () => {
    vi.mocked(getCurrentSummary).mockResolvedValue({ stageCounts, staleHouseIds: [1], totalHouses: 1 })
    vi.mocked(getAllHouses).mockResolvedValue([house(1)])
    vi.mocked(getHouses).mockResolvedValue([house(1)])
    const user = userEvent.setup()
    render(<MemoryRouter><MapPage /></MemoryRouter>)
    const marker = () => screen.getByRole('button', { name: 'Map marker for house 1' })
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    expect(marker()).toHaveAttribute('data-popup-open', 'true')
    await user.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(marker()).toHaveAttribute('data-selected', 'false')
    expect(marker()).toHaveAttribute('data-popup-open', 'false')
    expect(screen.getByTestId('map-focus')).toHaveTextContent('none')
    expect(screen.getByTestId('map-restore')).toHaveTextContent('30.2672,-97.7431:12')

    await user.click(screen.getByRole('tab', { name: 'House Explorer' }))
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(marker())
    expect(marker()).toHaveAttribute('data-selected', 'true')
    await user.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(marker()).toHaveAttribute('data-selected', 'false')
    expect(screen.getByTestId('map-restore')).toHaveTextContent('30.2672,-97.7431:12')
  })

  it('switches the two workspace tabs with keyboard arrows', async () => {
    vi.mocked(getHouses).mockResolvedValue([])
    const user = userEvent.setup()
    render(<MemoryRouter><MapPage /></MemoryRouter>)
    screen.getByRole('tab', { name: 'Summary' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'House Explorer' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'House Explorer' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus()
  })

  it('keeps no-coordinate houses accessible through their detail entry', async () => {
    vi.mocked(getCurrentSummary).mockResolvedValue({ stageCounts, staleHouseIds: [3], totalHouses: 3 })
    vi.mocked(getAllHouses).mockResolvedValue([house(3, { lat: null, lng: null })])
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/map']}><Routes>
      <Route path="/map" element={<MapPage />} />
      <Route path="/houses/:id" element={<p>House details route</p>} />
    </Routes></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Open details for 3 Main St' }))
    expect(screen.getByText('House details route')).toBeInTheDocument()
  })

  it('keeps backend totals visible when attention house details fail, then retries the read', async () => {
    vi.mocked(getCurrentSummary).mockResolvedValue({ stageCounts, staleHouseIds: [1], totalHouses: 3 })
    vi.mocked(getAllHouses).mockRejectedValueOnce(new ApiError('House list unavailable (HTTP 503).', 503))
      .mockResolvedValueOnce([house(1)])
    const user = userEvent.setup()
    render(<MemoryRouter><MapPage /></MemoryRouter>)
    expect(await screen.findByText('Total houses')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503')
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry house details' }))
    expect(await screen.findByRole('button', { name: 'View 1 Main St' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 1' })).toBeInTheDocument()
  })

  it('distinguishes summary failures, retries, and ignores a prior identity response', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof getCurrentSummary>>) => void
    vi.mocked(getCurrentSummary).mockReturnValueOnce(new Promise(done => { resolveOld = done }))
      .mockRejectedValueOnce(new ApiError('Current summary unavailable (HTTP 503).', 503))
      .mockResolvedValueOnce({ stageCounts, staleHouseIds: [], totalHouses: 3 })
    const user = userEvent.setup()
    render(<DemoIdentityProvider><MemoryRouter><IdentitySwitch /><MapPage /></MemoryRouter></DemoIdentityProvider>)
    expect(screen.getByText('Loading current summary…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503')
    resolveOld({ stageCounts, staleHouseIds: [99], totalHouses: 3 })
    expect(screen.queryByText('99')).not.toBeInTheDocument()
    expect(vi.mocked(getCurrentSummary).mock.calls[0]?.[0].aborted).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Retry summary' }))
    expect(await screen.findByText('Total houses')).toBeInTheDocument()
    expect(screen.getByText('No houses need attention in the current summary.')).toBeInTheDocument()
    expect(vi.mocked(getCurrentSummary).mock.calls.at(-1)?.[1].role).toBe('ADMIN')
  })
})
