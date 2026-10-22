import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { uploadHousePhoto, validatePhotoFile } from '../services/photoUpload'
import type { GpsStatus } from '../services/photoUpload'
import styles from './PhotoHistory.module.css'

export interface UploadOutcome { status: 200 | 201; photoId: number; gpsStatus: GpsStatus }

export function PhotoUploadCard({ houseId, onComplete, onRefreshDetails }: {
  houseId: number
  onComplete?: ((outcome: UploadOutcome) => void) | undefined
  onRefreshDetails?: (() => void) | undefined
}) {
  const { identity } = useDemoIdentity()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const chooseButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogButtonRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef(false)
  const previewRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const submittingRef = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!outcome) return
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    dialogButtonRef.current?.focus()
    return () => {
      if (root) root.inert = wasInert
      document.body.style.overflow = previousOverflow
    }
  }, [outcome])

  useEffect(() => {
    if (!outcome && !file && restoreFocusRef.current) {
      restoreFocusRef.current = false
      chooseButtonRef.current?.focus()
    }
  }, [outcome, file])

  const clearPreview = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setPreview(null)
  }
  const choose = (selected: File | null) => {
    if (submittingRef.current) return
    clearPreview()
    setFile(null)
    setError(null)
    if (!selected) return
    const issue = validatePhotoFile(selected)
    if (issue) { setError(issue); return }
    const url = URL.createObjectURL(selected)
    previewRef.current = url
    setPreview(url)
    setFile(selected)
  }
  const acknowledgeOutcome = () => {
    if (!outcome) return
    const finished = outcome
    clearPreview()
    setFile(null)
    restoreFocusRef.current = true
    setOutcome(null)
    onComplete?.(finished)
  }
  const submit = async () => {
    if (!file || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      // Once sent, a write cannot safely be claimed canceled. Ignore its result
      // after this house/identity view unmounts; a later detail read reconciles it.
      const outcome = await uploadHousePhoto(houseId, file, identity)
      if (mountedRef.current) setOutcome(outcome)
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'Upload result is unknown. Check house details before retrying.')
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  return <div className={`${styles.uploadCard} ${dragging ? styles.uploadCardDragging : ''}`}
    onDragOver={event => { event.preventDefault(); if (!submitting) setDragging(true) }}
    onDragLeave={() => setDragging(false)}
    onDrop={event => {
      event.preventDefault()
      setDragging(false)
      if (submittingRef.current) return
      if (event.dataTransfer.files.length !== 1) {
        setError('Choose one photo at a time.')
        return
      }
      choose(event.dataTransfer.files[0] ?? null)
    }}>
    <input ref={inputRef} className={styles.fileInput} tabIndex={-1} type="file"
      aria-label="Choose photo file" accept="image/jpeg,image/png,image/webp"
      onChange={event => { choose(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = '' }} />
    {file && preview ? <>
      <img className={styles.uploadPreview} src={preview} alt="Selected photo preview" />
      <strong className={styles.uploadFilename}>{file.name}</strong>
      <span>{file.size.toLocaleString('en-US')} bytes · One photo</span>
      {submitting && <div role="status" className={styles.uploadProgress}>
        <progress aria-label="Upload in progress" />Uploading photo…</div>}
      <div className={styles.uploadActions}>
        <button type="button" onClick={submit} disabled={submitting}>Confirm upload</button>
        <button type="button" onClick={() => { clearPreview(); setFile(null); setError(null) }}
          disabled={submitting}>Cancel</button>
      </div>
    </> : <button ref={chooseButtonRef} type="button" className={styles.uploadChoose} onClick={() => inputRef.current?.click()}
      disabled={submitting} aria-label="Upload photo">
      <span className={styles.uploadPlus} aria-hidden="true">+</span>
      <strong>Upload photo</strong>
      <span>Choose or drop one image</span>
    </button>}
    {error && <div className={styles.uploadError} role="alert">
      <p>{error}</p>
      {onRefreshDetails && <button type="button" onClick={onRefreshDetails}>Refresh house details</button>}
    </div>}
    {outcome && createPortal(<div className={styles.uploadResultBackdrop}>
      <div className={styles.uploadResultDialog} role="alertdialog" aria-modal="true"
        aria-labelledby="upload-result-heading" aria-describedby="upload-result-description"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); acknowledgeOutcome() }
          if (event.key === 'Tab') { event.preventDefault(); dialogButtonRef.current?.focus() }
        }}>
        <p className={styles.uploadResultEyebrow}>PHOTO UPLOAD</p>
        <h2 id="upload-result-heading">{outcome.status === 201 ? 'Photo uploaded successfully' : 'Photo already exists'}</h2>
        <p id="upload-result-description">{outcome.status === 201
          ? `The photo was saved. GPS status: ${outcome.gpsStatus}. The photo history will update when you continue.`
          : `A photo with the same content already exists in this house (#${outcome.photoId}). No new photo was created. GPS status: ${outcome.gpsStatus}. The photo history will refresh when you continue.`}</p>
        <button ref={dialogButtonRef} type="button" onClick={acknowledgeOutcome}>Back to upload</button>
      </div>
    </div>, document.body)}
  </div>
}
