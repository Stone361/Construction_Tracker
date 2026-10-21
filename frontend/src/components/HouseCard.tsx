import { Icon } from './Icon'
import type { HouseSummary } from '../services/houses'
import { displayPhotoDate, hasValidLocation, stageLabel } from '../services/houses'
import styles from './HouseCard.module.css'

export function HouseCard({ house, onSelect, onDetails }: {
  house: HouseSummary
  onSelect: (id: number) => void
  onDetails?: (id: number) => void
}) {
  const address = house.address ?? 'Address unavailable'
  return (
    <div className={styles.card}>
      <button type="button" className={styles.select} onClick={() => onSelect(house.id)} aria-label={`View ${address}`}>
        <span className={styles.coverPlaceholder} aria-hidden="true"><Icon name="pin" size={22} /></span>
        <span className={styles.content}>
          <span className={styles.address}>{address}</span>
          <span className={styles.community}>{house.community ?? 'Area unavailable'}</span>
          <span className={styles.meta}>
            <span>{stageLabel(house.stage)}</span>
            <span>{displayPhotoDate(house.lastPhotoBusinessDate)}</span>
          </span>
          {!hasValidLocation(house) && <span className={styles.noLocation}>Location unavailable · map will stay in place</span>}
        </span>
      </button>
      {onDetails && <button type="button" className={styles.details} onClick={() => onDetails(house.id)}
        aria-label={`Open details for ${address}`}>Open details →</button>}
    </div>
  )
}
