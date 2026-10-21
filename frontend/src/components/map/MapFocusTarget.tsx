import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

export interface MapFocusRequest {
  lat: number
  lng: number
}

export function MapFocusTarget({ request }: { request: MapFocusRequest | null }) {
  const map = useMap()
  useEffect(() => {
    if (request) map.setView([request.lat, request.lng], Math.max(map.getZoom(), 14), { animate: false })
  }, [map, request])
  return null
}
