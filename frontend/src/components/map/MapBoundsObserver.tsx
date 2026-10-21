import { useCallback, useEffect, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { HouseBounds } from '../../services/houses'
import type { MapView } from '../../services/mapNavigation'

function currentBounds(map: ReturnType<typeof useMap>): HouseBounds {
  const bounds = map.getBounds()
  const crossesLongitudeLimit = bounds.getWest() < -180 || bounds.getEast() > 180
  const clampLat = (value: number) => Math.max(-90, Math.min(90, value))
  return {
    minLat: clampLat(bounds.getSouth()),
    maxLat: clampLat(bounds.getNorth()),
    minLng: crossesLongitudeLimit ? -180 : bounds.getWest(),
    maxLng: crossesLongitudeLimit ? 180 : bounds.getEast(),
  }
}

export function MapBoundsObserver({ onChange }: { onChange: (bounds: HouseBounds, view?: MapView) => void }) {
  const lastBounds = useRef('')
  const map = useMap()

  const report = useCallback(() => {
    const bounds = currentBounds(map)
    const key = Object.values(bounds).map(value => value.toFixed(6)).join(',')
    if (key === lastBounds.current) return
    lastBounds.current = key
    const center = map.getCenter()
    onChange(bounds, { center: [center.lat, center.lng], zoom: map.getZoom() })
  }, [map, onChange])

  useMapEvents({ moveend: report })

  useEffect(() => {
    map.whenReady(report)
  }, [map, report])

  return null
}
