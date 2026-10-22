import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { Link, useLocation, useParams } from 'react-router'
import { ApiError } from '../services/apiClient'
import { PhotoHistoryContent } from '../components/PhotoHistory'
import { ConstructionProgress } from '../components/ConstructionProgress'
import { StageAdvanceDialog } from '../components/StageAdvanceDialog'
import type { UploadOutcome } from '../components/PhotoUploadCard'
import { displayChicagoBusinessDate, displayUtcInstant, getHouseDetail, latestPhotoBusinessDate } from '../services/houseDetail'
import type { HouseDetail } from '../services/houseDetail'
import { stageLabel } from '../services/houses'
import type { ConstructionStage } from '../services/houses'
import { canManageHouse } from '../services/demoPermissions'
import { mapSnapshotFromState } from '../services/mapNavigation'
import { useProtectedImages } from '../services/useProtectedImages'
import { setHouseCover } from '../services/houseCover'
import { advanceHouse } from '../services/advanceHouse'
import { constructionProgressFor } from '../services/constructionProgress'
import type { MapSnapshot } from '../services/mapNavigation'
import styles from './HouseDetailPage.module.css'

type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; house: HouseDetail }
  | { kind: 'error'; message: string }

function sourceLink(url: string | null) {
  if (!url) return 'Not available'
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
    }
  } catch {
    // A malformed source is displayed as text rather than made clickable.
  }
  return url
}

export function HouseDetailPage({ savedSnapshot = null, onCoverWriteSettled, onStageWriteSettled }: {
  savedSnapshot?: MapSnapshot | null
  onCoverWriteSettled?: () => void
  onStageWriteSettled?: () => void
}) {
  const { identity, version } = useDemoIdentity()
  const { id: rawId } = useParams()
  const location = useLocation()
  const snapshot = mapSnapshotFromState(location.state) ?? savedSnapshot
  const backState = snapshot ? { mapSnapshot: snapshot } : undefined
  const id = rawId && /^[1-9]\d*$/.test(rawId) && Number.isSafeInteger(Number(rawId)) ? Number(rawId) : null
  const [retry, setRetry] = useState(0)
  const [photoRefreshError, setPhotoRefreshError] = useState<{ key: string; message: string } | null>(null)
  const [result, setResult] = useState<{ key: string; state: DetailState } | null>(null)
  const key = id === null ? 'invalid' : `${version}:${id}:${retry}`
  const scope = id === null ? 'invalid' : `${version}:${id}`
  const [confirmation, setConfirmation] = useState<{ key: string; scope: string; houseId: number;
    fromStage: ConstructionStage; toStage: ConstructionStage; returnFocus: HTMLElement | null } | null>(null)
  const [pendingAdvance, setPendingAdvance] = useState<{ houseId: number; scope: string } | null>(null)
  const [advanceNotice, setAdvanceNotice] = useState<{ scope: string; kind: 'success' | 'error' | 'warning';
    message: string } | null>(null)
  const latestKey = useRef(key)
  const latestScope = useRef(scope)
  const latestHouseId = useRef(id)
  const mounted = useRef(false)
  const advancePendingRef = useRef(false)
  const refreshController = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    latestKey.current = key
    latestScope.current = scope
    latestHouseId.current = id
  }, [id, key, scope])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (id === null) return
    const controller = new AbortController()
    getHouseDetail(id, controller.signal, identity).then(
      house => {
        if (!controller.signal.aborted && latestKey.current === key) {
          setResult({ key, state: { kind: 'ready', house } })
        }
      },
      error => {
        if (controller.signal.aborted || latestKey.current !== key) return
        const message = error instanceof ApiError && error.status === 404
          ? 'This house was not found (HTTP 404).'
          : error instanceof ApiError ? error.message : 'House details could not be loaded.'
        setResult({ key, state: { kind: 'error', message } })
      },
    )
    return () => {
      controller.abort()
      refreshController.current?.abort()
      refreshController.current = null
    }
  }, [id, key, identity])

  const state: DetailState = result?.key === key ? result.state : { kind: 'loading' }
  const photos = state.kind === 'ready' ? state.house.photos : []
  const images = useProtectedImages(photos.map(photo => photo.url), identity, version)
  const coverPhoto = state.kind === 'ready' && state.house.coverPhotoId !== null
    ? photos.find(photo => photo.id === state.house.coverPhotoId) : null
  const cover = coverPhoto?.url ? images.imageFor(coverPhoto.url) : null
  const refreshPhotoHistory = () => {
    if (id === null || latestKey.current !== key) return
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setPhotoRefreshError(null)
    getHouseDetail(id, controller.signal, identity).then(
      house => {
        if (!controller.signal.aborted && latestKey.current === key) {
          setResult({ key, state: { kind: 'ready', house } })
        }
      },
      error => {
        if (controller.signal.aborted || latestKey.current !== key) return
        const reason = error instanceof Error ? error.message : 'The backend could not be reached.'
        setPhotoRefreshError({ key, message: `Photo history could not be refreshed. ${reason}` })
      },
    ).finally(() => {
      if (refreshController.current === controller) refreshController.current = null
    })
  }
  const uploadComplete = (outcome: UploadOutcome) => {
    if (outcome.status === 201 || outcome.status === 200) refreshPhotoHistory()
  }
  const updateCover = async (photoId: number) => {
    if (id === null || state.kind !== 'ready' || !canManageHouse(identity, state.house.community)) {
      throw new ApiError('The current demo identity cannot set this house cover (HTTP 403).', 403)
    }
    const submittedKey = key
    let updatedHouse: HouseDetail
    try {
      updatedHouse = await setHouseCover(id, photoId, identity)
    } catch (error) {
      // A network loss or invalid acknowledgement does not prove the PUT failed.
      if (!(error instanceof ApiError) || error.status === undefined) onCoverWriteSettled?.()
      if (mounted.current && latestKey.current !== submittedKey && latestHouseId.current === id) {
        setRetry(current => current + 1)
      }
      throw error
    }
    onCoverWriteSettled?.()
    if (mounted.current && latestKey.current === submittedKey) {
      setResult({ key: submittedKey, state: { kind: 'ready', house: updatedHouse } })
    } else if (mounted.current && latestHouseId.current === id) {
      // The write may finish after an identity switch's GET. Recheck under the current identity.
      setRetry(current => current + 1)
    }
  }

  const requestAdvance = (fromStage: ConstructionStage, toStage: ConstructionStage) => {
    if (id === null || state.kind !== 'ready' || advancePendingRef.current ||
        !canManageHouse(identity, state.house.community) ||
        state.house.stage !== fromStage || constructionProgressFor(state.house).nextStage !== toStage ||
        !constructionProgressFor(state.house).photoRequirementMet) return
    setAdvanceNotice(null)
    setConfirmation({ key, scope, houseId: id, fromStage, toStage,
      returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null })
  }
  const activeConfirmation = confirmation?.key === key && state.kind === 'ready' &&
    state.house.stage === confirmation.fromStage &&
    canManageHouse(identity, state.house.community) &&
    constructionProgressFor(state.house).photoRequirementMet ? confirmation : null

  const confirmAdvance = async () => {
    if (!activeConfirmation || advancePendingRef.current) return
    const attempt = activeConfirmation
    advancePendingRef.current = true
    setPendingAdvance({ houseId: attempt.houseId, scope: attempt.scope })
    setConfirmation(null)
    let notice: { kind: 'success' | 'error' | 'warning'; message: string }
    let listMayHaveChanged = false
    try {
      await advanceHouse(attempt.houseId, attempt.fromStage, attempt.toStage, identity, () => {
        onStageWriteSettled?.()
        if (mounted.current && latestHouseId.current === attempt.houseId) setRetry(current => current + 1)
      })
      listMayHaveChanged = true
      notice = { kind: 'success', message: 'Advance accepted. Check the current stage from the refreshed house details below.' }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        notice = { kind: 'warning', message: `${error.message} Check the refreshed house details below.` }
      } else if (error instanceof ApiError && error.status === 422) {
        notice = { kind: 'warning', message: `${error.message} Check the refreshed house details below.` }
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        notice = { kind: 'error', message: error.message }
      } else {
        listMayHaveChanged = true
        notice = { kind: 'warning', message: 'The advance result is unknown. Check the refreshed stage before trying again; the request will not be resent automatically.' }
      }
    } finally {
      advancePendingRef.current = false
      if (mounted.current) setPendingAdvance(null)
    }
    if (listMayHaveChanged) onStageWriteSettled?.()
    if (mounted.current && latestHouseId.current === attempt.houseId) {
      if (latestScope.current === attempt.scope) setAdvanceNotice({ scope: attempt.scope, ...notice })
      setRetry(current => current + 1)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link className={styles.back} to="/map" state={backState} aria-label="Back to map">← Back to map</Link>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>HOUSE DETAILS</p>
          <h1>{state.kind === 'ready' ? state.house.address ?? 'Address unavailable' : 'House information'}</h1>
          <p>Property details and construction activity.</p>
        </div>

        {pendingAdvance?.houseId === id && <div className={styles.advanceNotice} role="status">
          {pendingAdvance.scope === scope ? 'Submitting stage advance… Do not submit again.'
            : 'A previous identity’s stage request is still settling. Wait for the result before another advance.'}
        </div>}
        {advanceNotice?.scope === scope && <div className={`${styles.advanceNotice} ${styles[advanceNotice.kind]}`}
          role={advanceNotice.kind === 'success' ? 'status' : 'alert'}>{advanceNotice.message}</div>}

        {id === null ? (
          <div className={styles.message} role="alert">Invalid house ID. Use a positive numeric ID.</div>
        ) : state.kind === 'loading' ? (
          <div className={styles.message} role="status">Loading house details…</div>
        ) : state.kind === 'error' ? (
          <div className={styles.message} role="alert">
            <p>{state.message}</p>
            <button type="button" onClick={() => setRetry(current => current + 1)}>Retry details</button>
          </div>
        ) : (
          <div className={styles.detailContent}>
            <section className={styles.coverCard} aria-labelledby="cover-heading">
              <div className={styles.coverVisual}>
                {cover?.kind === 'ready'
                  ? <img className={styles.coverImage} src={cover.src} alt={`Current cover of ${state.house.address ?? 'house'}`} />
                  : <><span className={styles.coverMark} aria-hidden="true">CT</span>
                    <span>{state.house.coverPhotoId === null ? 'Image placeholder'
                      : cover?.kind === 'loading' ? 'Loading cover…' : 'Cover unavailable'}</span></>}
              </div>
              <div className={styles.coverCaption}>
                <h2 id="cover-heading">Cover photo details</h2>
                {state.house.coverPhotoId === null
                  ? <p>No cover selected. The image area is a placeholder.</p>
                  : <dl className={styles.coverFacts}>
                    <div><dt>Date taken</dt><dd>{displayUtcInstant(
                      coverPhoto?.takenAtSource === 'EXIF' ? coverPhoto.takenAt : null)}</dd></div>
                    <div><dt>Uploaded at</dt><dd>{displayUtcInstant(coverPhoto?.uploadedAt ?? null)}</dd></div>
                    <div><dt>Construction stage</dt><dd>{coverPhoto?.stage ? stageLabel(coverPhoto.stage) : 'Not available'}</dd></div>
                  </dl>}
                {cover?.kind === 'error' && <p role="alert">Cover image could not be loaded. {cover.message}</p>}
                {cover?.kind === 'error' && coverPhoto?.url && <button className={styles.retryCover} type="button"
                  onClick={() => images.retry(coverPhoto.url)}>Retry cover</button>}
              </div>
            </section>
            <div className={styles.sections}>
              <section className={styles.card} aria-labelledby="property-heading">
                <h2 id="property-heading">Property</h2>
                <dl className={styles.fields}>
                  <div><dt>Address</dt><dd>{state.house.address ?? 'Not available'}</dd></div>
                  <div><dt>Permit number</dt><dd>{state.house.permitNo ?? 'Not available'}</dd></div>
                  <div><dt>Community / administrative area</dt><dd>{state.house.community ?? 'Not available'}</dd></div>
                  <div><dt>Construction stage</dt><dd>{stageLabel(state.house.stage)}</dd></div>
                </dl>
              </section>
              <section className={styles.card} aria-labelledby="record-heading">
                <h2 id="record-heading">Record and location</h2>
                <dl className={styles.fields}>
                  <div><dt>Map coordinates</dt><dd>{state.house.lat !== null && state.house.lng !== null
                    ? `${state.house.lat.toFixed(6)}, ${state.house.lng.toFixed(6)}` : 'Not available'}</dd></div>
                  <div><dt>Source URL</dt><dd>{sourceLink(state.house.sourceUrl)}
                    <span className={styles.fieldSecondary}>Fetched at · UTC: {displayUtcInstant(state.house.sourceFetchedAt)}</span>
                  </dd></div>
                  <div><dt>Record created</dt><dd>{state.house.createdBy ? `By ${state.house.createdBy}` : 'Creator not available'}
                    <span className={styles.fieldSecondary}>{displayUtcInstant(state.house.createdAt)}</span>
                  </dd></div>
                  <div><dt>Latest photo business date · Chicago</dt><dd>{state.house.photos.length === 0
                    ? 'No site photos yet' : displayChicagoBusinessDate(latestPhotoBusinessDate(state.house.photos))}</dd></div>
                </dl>
              </section>
            </div>
            {state.house.community?.startsWith('Austin Council District ') &&
              <p className={styles.areaNote}>Austin Council District is an administrative district, not a residential community.</p>}
            {identity.role === 'SITE_MANAGER' && <p className={styles.areaNote}>
              Demo manager area: {identity.community}. {canManageHouse(identity, state.house.community)
                ? 'Management entry is available for this house.'
                : 'This house is outside your management area; management entry is hidden.'}
            </p>}
            <ConstructionProgress house={state.house} identity={identity}
              advancing={pendingAdvance?.houseId === id} onRequestAdvance={requestAdvance} />
            {photoRefreshError?.key === key && <div className={styles.message} role="alert">
              <p>{photoRefreshError.message}</p>
              <button type="button" onClick={refreshPhotoHistory}>Retry photo history</button>
            </div>}
            <PhotoHistoryContent key={`${version}:${state.house.id}`} houseId={state.house.id} photos={state.house.photos} images={images}
              coverPhotoId={state.house.coverPhotoId} onSetCover={updateCover}
              canUpload={canManageHouse(identity, state.house.community)}
              onUploadComplete={uploadComplete} onRefreshDetails={refreshPhotoHistory} />
          </div>
        )}
        {activeConfirmation && <StageAdvanceDialog fromStage={activeConfirmation.fromStage}
          toStage={activeConfirmation.toStage} onCancel={() => setConfirmation(null)} onConfirm={confirmAdvance}
          returnFocus={activeConfirmation.returnFocus} />}
      </div>
    </div>
  )
}
