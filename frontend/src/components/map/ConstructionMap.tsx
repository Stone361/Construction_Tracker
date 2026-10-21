import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { MapContainer, ScaleControl, TileLayer, useMap, ZoomControl } from 'react-leaflet'
import { Icon } from '../Icon'
import { AUSTIN_CENTER, AUSTIN_ZOOM, OSM_TILE_URL } from './mapSettings'
import type { MapView } from '../../services/mapNavigation'
import 'leaflet/dist/leaflet.css'
import styles from './ConstructionMap.module.css'

function ResizeMap() {
  const map = useMap()
  useEffect(() => {
    let frame = 0
    const resize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(map.getContainer())
    resize()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [map])
  return null
}

function ResetView() {
  const map = useMap()
  return (
    <button className={styles.reset} type="button" onClick={() => map.setView(AUSTIN_CENTER, AUSTIN_ZOOM)}>
      <Icon name="crosshair" size={18} />
      <span>Reset view</span>
    </button>
  )
}

interface ConstructionMapProps {
  decorative?: boolean
  controlsVisible?: boolean
  initialView?: MapView
  children?: ReactNode
}

// Map layers are provided as children. House selection and the fixed right pane
// belong to the map page, not this base map.
export function ConstructionMap({ decorative = false, controlsVisible = true, initialView, children }: ConstructionMapProps) {
  const [tileError, setTileError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    setTileError(false)
    setLoading(true)
    setAttempt(n => n + 1)
  }

  return (
    <section
      className={`${styles.root} ${decorative ? styles.decorative : ''} ${controlsVisible ? '' : styles.controlsHidden}`}
      aria-label={decorative ? 'Map backdrop of Austin, Texas' : 'Interactive map of Austin, Texas'}
    >
      <div className={styles.canvas} aria-hidden={decorative || undefined}>
        <MapContainer
          className={styles.leaflet ?? ''}
          center={initialView?.center ?? AUSTIN_CENTER}
          zoom={initialView?.zoom ?? (decorative ? 11 : AUSTIN_ZOOM)}
          minZoom={3}
          maxZoom={19}
          zoomControl={false}
          attributionControl={false}
          dragging={!decorative}
          scrollWheelZoom={!decorative}
          doubleClickZoom={!decorative}
          touchZoom={!decorative}
          boxZoom={!decorative}
          keyboard={!decorative}
        >
          <ResizeMap />
          <TileLayer
            key={attempt}
            url={OSM_TILE_URL}
            crossOrigin="anonymous"
            maxZoom={19}
            eventHandlers={{
              loading: () => setLoading(true),
              load: () => setLoading(false),
              tileerror: () => {
                setTileError(true)
                setLoading(false)
              },
            }}
          />
          {!decorative && <>
            <ZoomControl position="bottomright" />
            <ScaleControl position="bottomleft" />
            <ResetView />
          </>}
          {children}
        </MapContainer>
      </div>
      {tileError ? (
        <div className={styles.notice} role="alert">
          <span>Map tiles couldn’t load. Check your connection and try again.</span>
          <button type="button" onClick={retry}>Retry map tiles</button>
        </div>
      ) : loading && <div className={styles.loading} role="status">Loading map…</div>}
      <div className={styles.attribution}>
        <a href="https://leafletjs.com/" target="_blank" rel="noopener noreferrer">Leaflet</a>
        <span aria-hidden="true"> · </span>©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>
      </div>
    </section>
  )
}
