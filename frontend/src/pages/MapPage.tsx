import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { Link, useLocation, useNavigate } from 'react-router'
import { ConstructionMap } from '../components/map/ConstructionMap'
import { HouseMarkers } from '../components/map/HouseMarkers'
import { MapFocusTarget } from '../components/map/MapFocusTarget'
import { MapBoundsObserver } from '../components/map/MapBoundsObserver'
import { AUSTIN_CENTER, AUSTIN_ZOOM } from '../components/map/mapSettings'
import type { MapFocusRequest } from '../components/map/MapFocusTarget'
import { HouseCard } from '../components/HouseCard'
import { HouseInfo } from '../components/HouseInfo'
import { Icon } from '../components/Icon'
import { ApiError } from '../services/apiClient'
import { constructionStages, getAllHouses, getHouses, hasValidLocation, houseListPath, sortHousesByPhotoDate, stageLabel } from '../services/houses'
import type { ConstructionStage, HouseBounds, HouseQuery, HouseSummary } from '../services/houses'
import { mapSnapshotFromState } from '../services/mapNavigation'
import { canCreateHouse } from '../services/demoPermissions'
import { communityOptions, filterHouses } from '../services/houseFilters'
import type { HouseFilters } from '../services/houseFilters'
import type { MapSnapshot, MapView } from '../services/mapNavigation'
import styles from './MapPage.module.css'

type HouseState =
  | { kind: 'loading' }
  | { kind: 'ready'; houses: HouseSummary[] }
  | { kind: 'error'; message: string }

export function MapPage({ savedSnapshot = null, onSnapshotChange, coverRevision = 0, stageRevision = 0 }: {
  savedSnapshot?: MapSnapshot | null
  onSnapshotChange?: (snapshot: MapSnapshot) => void
  coverRevision?: number
  stageRevision?: number
} = {}) {
  const navigate = useNavigate()
  const { identity, version } = useDemoIdentity()
  const location = useLocation()
  const [initialSnapshot] = useState(() => mapSnapshotFromState(location.state) ?? savedSnapshot)
  const [initialView] = useState<MapView>(() => initialSnapshot?.view ?? {
    center: [AUSTIN_CENTER[0], AUSTIN_CENTER[1]], zoom: AUSTIN_ZOOM,
  })
  const [view, setView] = useState<MapView>(initialView)
  const [stage, setStage] = useState<ConstructionStage | null>(initialSnapshot?.stage ?? null)
  const [community, setCommunity] = useState<string | null>(initialSnapshot?.community ?? null)
  const [addressSearch, setAddressSearch] = useState(initialSnapshot?.addressSearch ?? '')
  const [debouncedAddress, setDebouncedAddress] = useState(addressSearch)
  const [mapControlsVisible, setMapControlsVisible] = useState(true)
  const mapHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerOverMap = useRef(false)
  const keyboardFocusOnControl = useRef(false)
  const pointerUsingControl = useRef(false)
  const [bounds, setBounds] = useState<HouseBounds | null>(null)
  const filtersActive = debouncedAddress.trim() !== '' || community !== null || stage !== null
  const query = useMemo<HouseQuery | null>(() => !filtersActive && bounds ? { bounds, stage: null } : null, [bounds, filtersActive])
  const [result, setResult] = useState<{ key: string; state: HouseState } | null>(null)
  const [allResult, setAllResult] = useState<{ key: string; state: HouseState } | null>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [selectedHouseId, setSelectedHouseId] = useState<number | null>(initialSnapshot?.selectedHouseId ?? null)
  const [focusRequest, setFocusRequest] = useState<MapFocusRequest | null>(null)

  const queryKey = query === null ? null : `${version}:${coverRevision}:${stageRevision}:${houseListPath(query)}:${requestKey}`
  const allKey = `${version}:${coverRevision}:${stageRevision}:${requestKey}`
  const latestQueryKey = useRef(queryKey)
  const latestAllKey = useRef(allKey)

  const clearMapHideTimer = useCallback(() => {
    if (mapHideTimer.current !== null) clearTimeout(mapHideTimer.current)
    mapHideTimer.current = null
  }, [])
  const showMapControls = useCallback(() => {
    clearMapHideTimer()
    setMapControlsVisible(true)
  }, [clearMapHideTimer])
  const scheduleMapControlsHide = useCallback(() => {
    clearMapHideTimer()
    if (keyboardFocusOnControl.current || pointerUsingControl.current) return
    mapHideTimer.current = setTimeout(() => {
      setMapControlsVisible(false)
      mapHideTimer.current = null
    }, 2000)
  }, [clearMapHideTimer])

  useEffect(() => clearMapHideTimer, [clearMapHideTimer])

  useEffect(() => {
    onSnapshotChange?.({ view, stage, selectedHouseId, community, addressSearch })
  }, [onSnapshotChange, view, stage, selectedHouseId, community, addressSearch])

  useEffect(() => {
    const finishControlInteraction = () => {
      if (!pointerUsingControl.current) return
      pointerUsingControl.current = false
      if (!pointerOverMap.current) scheduleMapControlsHide()
    }
    window.addEventListener('pointerup', finishControlInteraction)
    window.addEventListener('pointercancel', finishControlInteraction)
    return () => {
      window.removeEventListener('pointerup', finishControlInteraction)
      window.removeEventListener('pointercancel', finishControlInteraction)
    }
  }, [scheduleMapControlsHide])

  useLayoutEffect(() => {
    latestQueryKey.current = queryKey
    latestAllKey.current = allKey
  }, [queryKey, allKey])

  useEffect(() => {
    const controller = new AbortController()
    getAllHouses(controller.signal, identity).then(
      houses => {
        if (controller.signal.aborted || latestAllKey.current !== allKey) return
        setAllResult({ key: allKey, state: { kind: 'ready', houses } })
      },
      error => {
        if (!controller.signal.aborted && latestAllKey.current === allKey) {
          setAllResult({
            key: allKey,
            state: { kind: 'error', message: error instanceof ApiError ? error.message : 'Search data could not be loaded.' },
          })
        }
      },
    )
    return () => controller.abort()
  }, [allKey, identity])

  useEffect(() => {
    if (query === null || queryKey === null) return
    const controller = new AbortController()
    getHouses(query, controller.signal, identity).then(
      houses => {
        if (controller.signal.aborted || latestQueryKey.current !== queryKey) return
        setResult({ key: queryKey, state: { kind: 'ready', houses } })
        setSelectedHouseId(current => current !== null && !houses.some(house => house.id === current) ? null : current)
        setFocusRequest(null)
      },
      error => {
        if (!controller.signal.aborted && latestQueryKey.current === queryKey) {
          setResult({
            key: queryKey,
            state: { kind: 'error', message: error instanceof ApiError ? error.message : 'House data could not be loaded.' },
          })
        }
      },
    )
    return () => controller.abort()
  }, [query, queryKey, identity])

  const onBoundsChange = useCallback((nextBounds: HouseBounds, nextView?: MapView) => {
    if (nextView) setView(nextView)
    setBounds(current => {
      if (current && houseListPath({ bounds: current, stage: null }) ===
          houseListPath({ bounds: nextBounds, stage: null })) return current
      return nextBounds
    })
  }, [])

  const allState: HouseState = allResult?.key === allKey ? allResult.state : { kind: 'loading' }
  const houseState: HouseState = filtersActive ? allState :
    queryKey !== null && result?.key === queryKey ? result.state : { kind: 'loading' }

  const houses = useMemo(() => filtersActive
    ? allResult?.key === allKey && allResult.state.kind === 'ready' ? allResult.state.houses : []
    : result?.key === queryKey && result.state.kind === 'ready' ? result.state.houses : [],
  [filtersActive, allResult, allKey, result, queryKey])
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAddress(addressSearch)
      if (houseState.kind === 'ready') setSelectedHouseId(current => current !== null &&
        !filterHouses(houses, { address: addressSearch, community, stage }).some(house => house.id === current)
        ? null : current)
    }, 250)
    return () => clearTimeout(timer)
  }, [addressSearch, community, stage, houses, houseState.kind])
  const areas = useMemo(() => communityOptions(allResult?.key === allKey && allResult.state.kind === 'ready'
    ? allResult.state.houses : []), [allResult, allKey])
  const visibleHouses = useMemo(() => filterHouses(houses, {
    address: debouncedAddress, community, stage,
  }), [houses, debouncedAddress, community, stage])
  const mappedHouses = useMemo(() => visibleHouses.filter(hasValidLocation), [visibleHouses])
  const selectedHouse = visibleHouses.find(house => house.id === selectedHouseId) ?? null

  const keepSelectionWithin = (filters: HouseFilters) => {
    setSelectedHouseId(current => current !== null &&
      !filterHouses(houses, filters).some(house => house.id === current) ? null : current)
    setFocusRequest(null)
  }

  const selectFromMarker = (id: number) => {
    setSelectedHouseId(id)
    setFocusRequest(null)
  }
  const selectFromCard = (id: number) => {
    const house = visibleHouses.find(item => item.id === id)
    if (!house) return
    setSelectedHouseId(id)
    setFocusRequest(hasValidLocation(house) ? { lat: house.lat, lng: house.lng } : null)
  }
  const openDetails = (id: number) => {
    const snapshot = { view, stage, selectedHouseId: id, community, addressSearch } satisfies MapSnapshot
    onSnapshotChange?.(snapshot)
    navigate(`/houses/${id}`, { state: { mapSnapshot: snapshot } })
  }

  return (
    <div className={styles.page}>
      <div
        className={`${styles.mapPane} ${mapControlsVisible ? '' : styles.controlsHidden}`}
        onMouseEnter={() => {
          pointerOverMap.current = true
          showMapControls()
        }}
        onMouseLeave={() => {
          pointerOverMap.current = false
          scheduleMapControlsHide()
        }}
        onPointerDownCapture={event => {
          if (event.target instanceof Element && event.target.closest('a, button')) {
            pointerUsingControl.current = true
            showMapControls()
          }
        }}
        onFocusCapture={event => {
          if (event.target instanceof Element && event.target.matches('a:focus-visible, button:focus-visible')) {
            keyboardFocusOnControl.current = true
            showMapControls()
          }
        }}
        onBlurCapture={event => {
          const next = event.relatedTarget
          keyboardFocusOnControl.current = next instanceof Element &&
            event.currentTarget.contains(next) && next.matches('a:focus-visible, button:focus-visible')
          if (!keyboardFocusOnControl.current && !pointerOverMap.current) scheduleMapControlsHide()
        }}
      >
        <ConstructionMap controlsVisible={mapControlsVisible} initialView={initialView}>
          <MapBoundsObserver onChange={onBoundsChange} />
          <HouseMarkers houses={mappedHouses} selectedHouseId={selectedHouseId} onSelect={selectFromMarker} />
          <MapFocusTarget request={focusRequest} />
        </ConstructionMap>
        <div className={styles.area}>
          <Link to="/" className={styles.back}><Icon name="arrow-left" size={15} />Back to home</Link>
          <p>EXPLORING</p>
          <h1>Austin<span>, Texas</span></h1>
        </div>
        <p className={styles.hint}>Drag to explore<span> · </span>Scroll to zoom</p>
      </div>
      <aside className={styles.infoPane} aria-label="House information">
        <header className={styles.infoHeader}>
          {selectedHouse && <button className={styles.backToList} type="button" onClick={() => {
            setSelectedHouseId(null)
            setFocusRequest(null)
          }}><Icon name="arrow-left" size={16} />Back to list</button>}
          <p>MAP WORKSPACE</p>
          <div className={styles.infoHeadingRow}>
            <h2>{selectedHouse ? 'House information' : 'House Explorer'}</h2>
            {!selectedHouse && canCreateHouse(identity) &&
              <Link className={styles.addHouse} to="/houses/new" state={{ mapSnapshot: { view, stage, selectedHouseId, community, addressSearch } }} aria-label="Add house">+ Add house</Link>}
          </div>
          <div className={styles.filters}>
            <label className={styles.filter} htmlFor="house-address-search">
              <span>Search address</span>
              <span className={styles.searchField}>
                <input id="house-address-search" type="search" value={addressSearch}
                  onChange={event => setAddressSearch(event.target.value)}
                  placeholder="House number or street name" />
              </span>
            </label>
            <div className={styles.filterRow}>
              <label className={styles.filter} htmlFor="house-community">
                <span>Community / Area</span>
                <select id="house-community" value={community ?? ''}
                  onChange={event => {
                    const next = event.target.value || null
                    setCommunity(next)
                    keepSelectionWithin({ address: debouncedAddress, community: next, stage })
                  }}>
                  <option value="">All areas</option>
                  {community !== null && !areas.includes(community) &&
                    <option value={community}>{community}</option>}
                  {areas.map(area => <option key={area} value={area}>{area}</option>)}
                </select>
              </label>
              <label className={styles.filter} htmlFor="construction-stage">
                <span>Construction stage</span>
                <select id="construction-stage" value={stage ?? ''} onChange={event => {
                  const next = event.target.value === '' ? null : event.target.value as ConstructionStage
                  setStage(next)
                  keepSelectionWithin({ address: debouncedAddress, community, stage: next })
                }}>
                  <option value="">All stages</option>
                  {constructionStages.map(stage => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
                </select>
              </label>
            </div>
            {(addressSearch.trim() !== '' || debouncedAddress.trim() !== '' || community !== null || stage !== null) &&
              <button className={styles.clearFilters} type="button" onClick={() => {
                setAddressSearch('')
                setDebouncedAddress('')
                setCommunity(null)
                setStage(null)
              }}>Clear filters</button>}
            {allState.kind === 'error' && houseState.kind === 'ready' && !filtersActive &&
              <p className={styles.filterError} role="alert">Area options and search are unavailable. <button type="button" onClick={() => setRequestKey(key => key + 1)}>Retry search data</button></p>}
          </div>
        </header>
        <div className={styles.dataStatus}>
          {houseState.kind === 'loading' && <p role="status">Loading houses from the backend…</p>}
          {houseState.kind === 'error' && <div role="alert">
            <p>{houseState.message}</p>
            <button type="button" onClick={() => {
              setRequestKey(key => key + 1)
            }}>Retry house data</button>
          </div>}
          {houseState.kind === 'ready' && <p role="status">
            {visibleHouses.length === 0
              ? filtersActive
                ? houses.length === 0 ? 'No houses in the database.' : 'No houses match these filters.'
                : 'No houses in the current map view.'
              : `${visibleHouses.length} ${visibleHouses.length === 1 ? 'house' : 'houses'} ${filtersActive ? 'found' : 'in view'} · ${mappedHouses.length} map ${mappedHouses.length === 1 ? 'marker' : 'markers'}`}
          </p>}
        </div>
        <div className={styles.panelBody}>
          {houseState.kind === 'ready' && selectedHouse && <HouseInfo house={selectedHouse} onDetails={openDetails} />}
          {houseState.kind === 'ready' && !selectedHouse && visibleHouses.length > 0 &&
            <ol className={styles.cardList} aria-label="House cards">
              {sortHousesByPhotoDate(visibleHouses).map(house =>
                <li key={house.id}><HouseCard house={house} onSelect={selectFromCard} onDetails={openDetails} /></li>) }
            </ol>}
          {houseState.kind === 'ready' && visibleHouses.length === 0 &&
            <p className={styles.panelMessage}>{filtersActive
              ? 'Try another address, area, or stage to see more houses.'
              : 'Move the map to see more houses.'}</p>}
          {houseState.kind === 'loading' &&
            <p className={styles.panelMessage}>The house list will appear when loading finishes.</p>}
          {houseState.kind === 'error' &&
            <p className={styles.panelMessage}>House cards are unavailable until the request succeeds.</p>}
        </div>
      </aside>
    </div>
  )
}
