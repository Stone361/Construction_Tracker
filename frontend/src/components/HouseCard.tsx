import { useEffect, useRef, useState } from 'react'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { Icon } from './Icon'
import type { HouseSummary } from '../services/houses'
import { displayPhotoDate, hasValidLocation, stageLabel } from '../services/houses'
import { useProtectedImages } from '../services/useProtectedImages'
import styles from './HouseCard.module.css'

export function HouseCard({ house, onSelect, onDetails, tone = 'default', selected = false }: {
  house: HouseSummary
  onSelect: (id: number) => void
  onDetails?: (id: number) => void
  tone?: 'default' | 'warning'
  selected?: boolean
}) {
  const { identity, version } = useDemoIdentity()
  const cardRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const { imageFor, retry } = useProtectedImages(visible ? [house.coverPhotoUrl] : [], identity, version)
  const cover = house.coverPhotoUrl && visible ? imageFor(house.coverPhotoUrl) : null
  useEffect(() => {
    if (visible || !cardRef.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '120px' })
    observer.observe(cardRef.current)
    return () => observer.disconnect()
  }, [visible])
  const address = house.address ?? 'Address unavailable'
  return (
    <div className={`${styles.card} ${tone === 'warning' ? styles.warning : ''} ${selected ? styles.selected : ''}`} ref={cardRef}>
      <button type="button" className={styles.select} onClick={() => onSelect(house.id)}
        aria-label={`View ${address}`} aria-pressed={tone === 'warning' ? selected : undefined}>
        <span className={styles.coverPlaceholder}>
          {cover?.kind === 'ready' ? <img className={styles.coverImage} src={cover.src} alt={`Cover of ${address}`} />
            : <span className={styles.coverFallback} aria-label={cover?.kind === 'error' ? 'Cover unavailable'
              : house.coverPhotoUrl ? 'Loading cover' : 'No cover image'}>
              <Icon name="pin" size={22} />
            </span>}
        </span>
        <span className={styles.content}>
          <span className={styles.address}>{address}</span>
          <span className={styles.permit} title={house.permitNo ?? undefined}>
            {house.permitNo ? `Permit ${house.permitNo}` : 'Permit unavailable'}
          </span>
          <span className={styles.community}>{house.community ?? 'Area unavailable'}</span>
          <span className={styles.meta}>
            <span>{stageLabel(house.stage)}</span>
            <span>{displayPhotoDate(house.lastPhotoBusinessDate)}</span>
          </span>
          {!hasValidLocation(house) && <span className={styles.noLocation}>Location unavailable · map will stay in place</span>}
        </span>
      </button>
      {cover?.kind === 'error' && <div className={styles.coverError} role="alert">
        Cover unavailable. <button type="button" onClick={() => retry(house.coverPhotoUrl)}>Retry cover</button>
      </div>}
      {onDetails && <button type="button" className={styles.details} onClick={() => onDetails(house.id)}
        aria-label={`Open details for ${address}`}>Open details →</button>}
    </div>
  )
}
