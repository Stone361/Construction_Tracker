import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import type { MapView } from '../../services/mapNavigation'

export interface MapFocusRequest {
  lat: number
  lng: number
}

export function MapFocusTarget({ request, restoreView = null }: {
  request: MapFocusRequest | null
  restoreView?: MapView | null
}) {
  const map = useMap()
  useEffect(() => {
    if (restoreView) map.setView(restoreView.center, restoreView.zoom, { animate: false })
  }, [map, restoreView])
  useEffect(() => {
    if (request) map.setView([request.lat, request.lng], Math.max(map.getZoom(), 14), { animate: false })
  }, [map, request])
  return null
}
