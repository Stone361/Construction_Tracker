import { useEffect, useRef } from 'react'
import { divIcon } from 'leaflet'
import type { Marker as LeafletMarker } from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import type { HouseSummary } from '../../services/houses'
import { stageLabel } from '../../services/houses'
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
const warningIcon = divIcon({
  className: `${styles.marker} ${styles.warning}`,
  html: '<span aria-hidden="true"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})
const selectedWarningIcon = divIcon({
  className: `${styles.marker} ${styles.warning} ${styles.selected}`,
  html: '<span aria-hidden="true"></span>',
  iconSize: [27, 27],
  iconAnchor: [13, 13],
})

interface HouseMarkersProps {
  houses: Array<HouseSummary & { lat: number; lng: number }>
  selectedHouseId: number | null
  onSelect: (id: number) => void
  tone?: 'default' | 'warning'
  showSelectedPopup?: boolean
}

function HouseMarker({ house, selected, onSelect, tone, showSelectedPopup }: {
  house: HouseMarkersProps['houses'][number]
  selected: boolean
  onSelect: (id: number) => void
  tone: 'default' | 'warning'
  showSelectedPopup: boolean
}) {
  const marker = useRef<LeafletMarker | null>(null)
  useEffect(() => {
    if (selected && showSelectedPopup) marker.current?.openPopup()
  }, [selected, showSelectedPopup])
  return <Marker
      ref={marker}
      position={[house.lat, house.lng]}
      icon={tone === 'warning' ? selected ? selectedWarningIcon : warningIcon : selected ? selectedIcon : houseIcon}
      zIndexOffset={selected ? 1000 : 0}
      title={`House ${house.id}`}
      alt={`House ${house.id}`}
      eventHandlers={{ click: () => onSelect(house.id) }}
    >
      {showSelectedPopup && selected && <Popup>
        <strong>{house.address ?? 'Address not available'}</strong><br />
        {house.community ?? 'Area not available'} · {stageLabel(house.stage)}
      </Popup>}
    </Marker>
}

export function HouseMarkers({ houses, selectedHouseId, onSelect, tone = 'default',
  showSelectedPopup = false }: HouseMarkersProps) {
  return <>{houses.map(house => <HouseMarker key={house.id} house={house}
    selected={house.id === selectedHouseId} onSelect={onSelect} tone={tone}
    showSelectedPopup={showSelectedPopup} />)}</>
}
