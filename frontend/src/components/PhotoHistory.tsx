import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { displayChicagoBusinessDate, displayUtcInstant } from '../services/houseDetail'
import type { HousePhoto } from '../services/houseDetail'
import { useProtectedImages } from '../services/useProtectedImages'
import type { ProtectedImageState } from '../services/useProtectedImages'
import { stageLabel } from '../services/houses'
import { PhotoUploadCard } from './PhotoUploadCard'
import type { UploadOutcome } from './PhotoUploadCard'
import styles from './PhotoHistory.module.css'

function PhotoFacts({ photo }: { photo: HousePhoto }) {
  return <span className={styles.facts}>
    <span><span>Photo stage</span><strong>{stageLabel(photo.stage)}</strong></span>
    <span><span>Taken at · UTC</span><strong>{displayUtcInstant(photo.takenAt)}</strong></span>
    <span><span>Uploaded at · UTC</span><strong>{displayUtcInstant(photo.uploadedAt)}</strong></span>
    <span><span>Time source</span><strong>{photo.takenAtSource ?? 'Not available'}</strong></span>
    <span><span>Business date · Chicago</span><strong>{displayChicagoBusinessDate(photo.businessDate)}</strong></span>
    <span><span>GPS status</span><strong>{photo.locationStatus ?? 'Not available'}</strong></span>
  </span>
}

function PhotoVisual({ image, number, large = false }: { image: ProtectedImageState; number: number; large?: boolean }) {
  if (image.kind === 'ready') return <img className={large ? styles.photoLarge : styles.photoImage}
    src={image.src} alt={large ? `Enlarged site photo ${number}` : `Site photo ${number}`} />
  return <span className={`${styles.photoFallback} ${large ? styles.photoFallbackLarge : ''}`}
    role={image.kind === 'loading' ? 'status' : 'alert'}>
    {image.kind === 'loading' ? 'Loading photo…' : image.message}
  </span>
}

export function PhotoHistory({ houseId, photos, canUpload = false, onUploadComplete, onRefreshDetails }: {
  houseId: number
  photos: HousePhoto[]
  canUpload?: boolean
  onUploadComplete?: (outcome: UploadOutcome) => void
  onRefreshDetails?: () => void
}) {
  const { identity, version } = useDemoIdentity()
  const { imageFor, retry } = useProtectedImages(photos.map(photo => photo.url), identity, version)
  const railRef = useRef<HTMLOListElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [scrollable, setScrollable] = useState({ left: false, right: false })
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null)
  const selectedIndex = photos.findIndex(photo => photo.id === selectedPhotoId)
  const selectedPhoto = selectedIndex >= 0 ? photos[selectedIndex] : null
  const isOpen = selectedPhoto !== null

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const measure = () => {
      const next = {
        left: rail.scrollLeft > 1,
        right: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1,
      }
      setScrollable(current => current.left === next.left && current.right === next.right ? current : next)
    }
    measure()
    rail.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(rail)
    return () => {
      rail.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [photos, canUpload])

  useEffect(() => {
    if (!isOpen) return
    const root = document.getElementById('root')
    const previousInert = root?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      if (root) root.inert = previousInert
      document.body.style.overflow = previousOverflow
      if (triggerRef.current?.isConnected) triggerRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) dialogRef.current?.focus()
  }, [isOpen, selectedPhotoId])

  const movePhoto = (direction: -1 | 1) => {
    setSelectedPhotoId(current => {
      const index = photos.findIndex(photo => photo.id === current)
      if (index < 0) return current
      return photos[Math.max(0, Math.min(photos.length - 1, index + direction))]?.id ?? current
    })
  }

  const scroll = (direction: -1 | 1) => {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * Math.max(rail.clientWidth * .8, 240), behavior: 'smooth' })
  }

  const jumpToUpload = () => {
    const rail = railRef.current
    if (rail) rail.scrollTo({ left: rail.scrollWidth, behavior: 'smooth' })
  }

  return <section className={styles.section} aria-labelledby="photo-history-heading">
    <div className={styles.header}>
      <div>
        <p className={styles.eyebrow}>SITE RECORD</p>
        <h2 id="photo-history-heading">Photo history</h2>
        <p>Photo details and protected original images come from the house record.</p>
      </div>
      {canUpload && scrollable.right && <button className={styles.jumpToUpload} type="button"
        onClick={jumpToUpload}>Upload card at end →</button>}
      {(scrollable.left || scrollable.right) && <div className={styles.scrollButtons} aria-label="Photo list controls">
        <button type="button" aria-label="Scroll photos left" disabled={!scrollable.left} onClick={() => scroll(-1)}>←</button>
        <button type="button" aria-label="Scroll photos right" disabled={!scrollable.right} onClick={() => scroll(1)}>→</button>
      </div>}
    </div>
    {photos.length === 0 && <p className={canUpload ? styles.emptyWithUpload : styles.empty}>No site photos yet.</p>}
    {(photos.length > 0 || canUpload) &&
      <ol className={styles.rail} ref={railRef} aria-label="House photo history">
        {photos.map((photo, index) => <li key={photo.id} className={styles.item}>
          <button type="button" className={styles.photoCard} aria-label={`Preview photo ${index + 1}`}
            onClick={event => { triggerRef.current = event.currentTarget; setSelectedPhotoId(photo.id) }}>
            <PhotoVisual image={imageFor(photo.url)} number={index + 1} />
            <span className={styles.photoDetails}><span className={styles.photoNumber}>Photo {index + 1}</span><PhotoFacts photo={photo} /></span>
          </button>
          {imageFor(photo.url).kind === 'error' && photo.url && <button className={styles.retry} type="button"
            onClick={() => retry(photo.url)}>Retry photo {index + 1}</button>}
        </li>)}
        {canUpload && <li key="upload" className={styles.item}>
          <PhotoUploadCard houseId={houseId} onComplete={onUploadComplete} onRefreshDetails={onRefreshDetails} />
        </li>}
      </ol>}
    {selectedPhoto && createPortal(
      <div className={styles.backdrop}>
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="photo-preview-heading"
          ref={dialogRef} tabIndex={-1} onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setSelectedPhotoId(null) }
            if (event.key === 'ArrowLeft') { event.preventDefault(); movePhoto(-1) }
            if (event.key === 'ArrowRight') { event.preventDefault(); movePhoto(1) }
            if (event.key === 'Tab') {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
              const first = buttons[0]
              const last = buttons[buttons.length - 1]
              if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
                event.preventDefault(); last?.focus()
              } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
                event.preventDefault(); first?.focus()
              }
            }
          }}>
          <div className={styles.dialogHeader}>
            <div><p className={styles.eyebrow}>PHOTO PREVIEW · PROTECTED ORIGINAL</p>
              <h2 id="photo-preview-heading">Photo {selectedIndex + 1} of {photos.length}</h2></div>
            <button type="button" className={styles.close} aria-label="Close photo preview"
              onClick={() => setSelectedPhotoId(null)}>✕</button>
          </div>
          <PhotoVisual image={imageFor(selectedPhoto.url)} number={selectedIndex + 1} large />
          {imageFor(selectedPhoto.url).kind === 'error' && selectedPhoto.url &&
            <button className={styles.retry} type="button" onClick={() => retry(selectedPhoto.url)}>Retry photo</button>}
          <div className={styles.dialogFooter}>
            <button type="button" disabled={selectedIndex === 0} onClick={() => movePhoto(-1)}>← Previous</button>
            <PhotoFacts photo={selectedPhoto} />
            <button type="button" disabled={selectedIndex === photos.length - 1} onClick={() => movePhoto(1)}>Next →</button>
          </div>
        </div>
      </div>, document.body)}
  </section>
}
