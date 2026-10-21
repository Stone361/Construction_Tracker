import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { MapPage } from '../pages/MapPage'
import { getHouses } from '../services/houses'
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
  return { ...original, getHouses: vi.fn() }
})

function house(id: number, overrides: Partial<HouseSummary> = {}): HouseSummary {
  return { id, address: `${id} Main St`, permitNo: `P-${id}`, community: 'Austin Council District 8',
    stage: 'FOUNDATION', lastPhotoBusinessDate: null, lat: 30 + id / 100, lng: -97,
    ...overrides }
}

function renderMap() {
  return render(<MemoryRouter><MapPage /></MemoryRouter>)
}

beforeEach(() => vi.mocked(getHouses).mockReset())

describe('map house data and selection', () => {
  it('shows loading, sorted real cards, counts, and no duplicate fetch on selection', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof getHouses>>) => void
    vi.mocked(getHouses).mockReturnValue(new Promise(done => { resolve = done }))
    renderMap()
    expect(screen.getByText('Loading houses from the backend…')).toBeInTheDocument()
    resolve([house(1), house(2, { lastPhotoBusinessDate: '2026-10-20', lat: null, lng: null })])
    expect(await screen.findByText('2 houses in view · 1 map marker')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Houses sorted by latest photo business date' })
    expect(within(list).getAllByRole('button', { name: /^View \d+ Main St$/ }).map(button => button.textContent)).toEqual([
      expect.stringContaining('2 Main St'), expect.stringContaining('1 Main St'),
    ])
    expect(within(list).getByRole('button', { name: 'View 2 Main St' })).toHaveTextContent('Location unavailable')
    expect(getHouses).toHaveBeenCalledOnce()
  })

  it('selects from a card, highlights one marker, and returns to the list without another request', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1), house(2)])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 2 Main St' }))
    expect(screen.getByRole('heading', { name: '2 Main St' })).toBeInTheDocument()
    expect(screen.getByTestId('map-focus')).toHaveTextContent('30.02,-97')
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-selected', 'true')
    await user.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('list', { name: 'Houses sorted by latest photo business date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map marker for house 2' })).toHaveAttribute('data-selected', 'false')
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
    expect(await screen.findByText('No houses match this map view and stage.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows backend failure and retries without inventing houses', async () => {
    vi.mocked(getHouses).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    renderMap()
    expect(await screen.findByRole('alert')).toHaveTextContent('House data could not be loaded.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry house data' }))
    expect(await screen.findByText('No houses match this map view and stage.')).toBeInTheDocument()
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

  it('ignores a stale response after a rapid stage change and clears a selection excluded by the new result', async () => {
    const user = userEvent.setup()
    let resolveStale!: (value: HouseSummary[]) => void
    vi.mocked(getHouses).mockResolvedValueOnce([house(1)])
      .mockReturnValueOnce(new Promise(done => { resolveStale = done }))
      .mockResolvedValueOnce([house(2, { stage: 'FRAMING' })])
    renderMap()
    await user.click(await screen.findByRole('button', { name: 'View 1 Main St' }))
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FOUNDATION')
    await user.selectOptions(screen.getByLabelText('Construction stage'), 'FRAMING')
    expect(await screen.findByText('2 Main St')).toBeInTheDocument()
    resolveStale([house(1)])
    expect(screen.getByText('2 Main St')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '1 Main St' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map marker for house 1' })).not.toBeInTheDocument()
    expect(vi.mocked(getHouses).mock.calls[2]?.[0].stage).toBe('FRAMING')
    expect(vi.mocked(getHouses).mock.calls[1]?.[1]?.aborted).toBe(true)
  })

  it('keeps a selected house while it remains in a new result', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1)])
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
    await screen.findByRole('button', { name: 'View 1 Main St' })
    await user.click(screen.getByRole('button', { name: 'Open details for 1 Main St' }))
    expect(onSnapshotChange).toHaveBeenCalledWith(expect.objectContaining({ stage: 'FOUNDATION', selectedHouseId: 1 }))
    expect(screen.getByText('Detail ID: 1 · stage: FOUNDATION · selected: 1')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Back to map' }))
    expect(screen.getByLabelText('Construction stage')).toHaveValue('FOUNDATION')
    expect(await screen.findByRole('heading', { name: '1 Main St' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Open full house details/ }))
    expect(screen.getByText('Detail ID: 1 · stage: FOUNDATION · selected: 1')).toBeInTheDocument()
  })

  it('preserves the map state when browser history goes back from details', async () => {
    const user = userEvent.setup()
    vi.mocked(getHouses).mockResolvedValue([house(1)])
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
