import { divIcon } from 'leaflet'
import { Marker } from 'react-leaflet'
import type { HouseSummary } from '../../services/houses'
import styles from './HouseMarkers.module.css'

const houseIcon = divIcon({
  className: styles.marker,
  html: '<span aria-hidden="true"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})
const selectedIcon = divIcon({
  className: `${styles.marker} ${styles.selected}`,
  html: '<span aria-hidden="true"></span>',
  iconSize: [27, 27],
  iconAnchor: [13, 13],
})

interface HouseMarkersProps {
  houses: Array<HouseSummary & { lat: number; lng: number }>
  selectedHouseId: number | null
  onSelect: (id: number) => void
}

export function HouseMarkers({ houses, selectedHouseId, onSelect }: HouseMarkersProps) {
  return <>{houses.map(house => (
    <Marker
      key={house.id}
      position={[house.lat, house.lng]}
      icon={house.id === selectedHouseId ? selectedIcon : houseIcon}
      zIndexOffset={house.id === selectedHouseId ? 1000 : 0}
      title={`House ${house.id}`}
      alt={`House ${house.id}`}
      eventHandlers={{ click: () => onSelect(house.id) }}
    />
  ))}</>
}
