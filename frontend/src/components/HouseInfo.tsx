import type { HouseSummary } from '../services/houses'
import { displayPhotoDate, hasValidLocation, stageLabel } from '../services/houses'
import styles from './HouseInfo.module.css'

export function HouseInfo({ house, onDetails }: {
  house: HouseSummary
  onDetails?: (id: number) => void
}) {
  return (
    <div className={styles.detail}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>SELECTED HOUSE</p>
        <h3>{house.address ?? 'Address unavailable'}</h3>
        <p>{house.community ?? 'Area unavailable'}</p>
      </div>
      <dl className={styles.fields}>
        <div><dt>Permit number</dt><dd>{house.permitNo ?? 'Not available'}</dd></div>
        <div><dt>Construction stage</dt><dd><span className={styles.stage}>{stageLabel(house.stage)}</span></dd></div>
        <div><dt>Latest photo business date</dt><dd>{displayPhotoDate(house.lastPhotoBusinessDate)}</dd></div>
        <div><dt>Map location</dt><dd>{hasValidLocation(house) ? 'Available' : 'Unavailable'}</dd></div>
      </dl>
      {onDetails && <button type="button" className={styles.detailsLink} onClick={() => onDetails(house.id)}>
        Open full house details →
      </button>}
    </div>
  )
}
