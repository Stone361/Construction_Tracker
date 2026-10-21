import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { displayUtcInstant } from '../services/houseDetail'
import type { HousePhoto } from '../services/houseDetail'
import { stageLabel } from '../services/houses'
import styles from './PhotoHistory.module.css'

function PhotoFacts({ photo }: { photo: HousePhoto }) {
  return <span className={styles.facts}>
    <span><span>Photo stage</span><strong>{stageLabel(photo.stage)}</strong></span>
    <span><span>Taken at · UTC</span><strong>{displayUtcInstant(photo.takenAt)}</strong></span>
    <span><span>Uploaded at · UTC</span><strong>{displayUtcInstant(photo.uploadedAt)}</strong></span>
  </span>
}

function Placeholder({ large = false }: { large?: boolean }) {
  return <span className={`${styles.placeholder} ${large ? styles.placeholderLarge : ''}`} aria-label="Image placeholder">
    <span className={styles.placeholderMark} aria-hidden="true">CT</span>
    <span>Image placeholder</span>
  </span>
}

export function PhotoHistory({ photos }: { photos: HousePhoto[] }) {
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
  }, [photos])

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

  return <section className={styles.section} aria-labelledby="photo-history-heading">
    <div className={styles.header}>
      <div>
        <p className={styles.eyebrow}>SITE RECORD</p>
        <h2 id="photo-history-heading">Photo history</h2>
        <p>Photo details come from the house record. Images are placeholders until protected viewing is available.</p>
      </div>
      {(scrollable.left || scrollable.right) && <div className={styles.scrollButtons} aria-label="Photo list controls">
        <button type="button" aria-label="Scroll photos left" disabled={!scrollable.left} onClick={() => scroll(-1)}>←</button>
        <button type="button" aria-label="Scroll photos right" disabled={!scrollable.right} onClick={() => scroll(1)}>→</button>
      </div>}
    </div>
    {photos.length === 0 ? <p className={styles.empty}>No site photos yet.</p> :
      <ol className={styles.rail} ref={railRef} aria-label="House photo history">
        {photos.map((photo, index) => <li key={photo.id} className={styles.item}>
          <button type="button" className={styles.photoCard} aria-label={`Preview photo ${index + 1}`}
            onClick={event => { triggerRef.current = event.currentTarget; setSelectedPhotoId(photo.id) }}>
            <Placeholder />
            <span className={styles.photoDetails}><span className={styles.photoNumber}>Photo {index + 1}</span><PhotoFacts photo={photo} /></span>
          </button>
        </li>)}
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
            <div><p className={styles.eyebrow}>PHOTO PREVIEW · IMAGE PLACEHOLDER</p>
              <h2 id="photo-preview-heading">Photo {selectedIndex + 1} of {photos.length}</h2></div>
            <button type="button" className={styles.close} aria-label="Close photo preview"
              onClick={() => setSelectedPhotoId(null)}>✕</button>
          </div>
          <Placeholder large />
          <div className={styles.dialogFooter}>
            <button type="button" disabled={selectedIndex === 0} onClick={() => movePhoto(-1)}>← Previous</button>
            <PhotoFacts photo={selectedPhoto} />
            <button type="button" disabled={selectedIndex === photos.length - 1} onClick={() => movePhoto(1)}>Next →</button>
          </div>
        </div>
      </div>, document.body)}
  </section>
}
