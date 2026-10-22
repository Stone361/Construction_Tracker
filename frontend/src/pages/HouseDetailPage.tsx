import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { Link, useLocation, useParams } from 'react-router'
import { ApiError } from '../services/apiClient'
import { PhotoHistory } from '../components/PhotoHistory'
import type { UploadOutcome } from '../components/PhotoUploadCard'
import { displayChicagoBusinessDate, displayUtcInstant, getHouseDetail } from '../services/houseDetail'
import type { HouseDetail } from '../services/houseDetail'
import { stageLabel } from '../services/houses'
import { canManageHouse } from '../services/demoPermissions'
import { mapSnapshotFromState } from '../services/mapNavigation'
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

export function HouseDetailPage({ savedSnapshot = null }: { savedSnapshot?: MapSnapshot | null }) {
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
  const latestKey = useRef(key)
  const refreshController = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    latestKey.current = key
  }, [key])

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

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link className={styles.back} to="/map" state={backState} aria-label="Back to map">← Back to map</Link>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>HOUSE DETAILS</p>
          <h1>{state.kind === 'ready' ? state.house.address ?? 'Address unavailable' : 'House information'}</h1>
          <p>Property record and permit source details.</p>
        </div>

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
              <div className={styles.coverVisual} aria-label="Cover image placeholder">
                <span className={styles.coverMark} aria-hidden="true">CT</span>
                <span>Image placeholder</span>
              </div>
              <div className={styles.coverCaption}>
                <h2 id="cover-heading">Current cover</h2>
                <p>{state.house.coverPhotoId === null
                  ? 'No cover selected. The image area is a placeholder.'
                  : `Cover photo #${state.house.coverPhotoId} selected. Cover preview is planned for a later stage.`}</p>
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
                <div><dt>Coordinates</dt><dd>{state.house.lat !== null && state.house.lng !== null
                  ? `${state.house.lat.toFixed(6)}, ${state.house.lng.toFixed(6)}` : 'Not available'}</dd></div>
              </dl>
              {state.house.community?.startsWith('Austin Council District ') &&
                <p className={styles.areaNote}>Austin Council District is an administrative district, not a residential community.</p>}
              {identity.role === 'SITE_MANAGER' && <p className={styles.areaNote}>
                Demo manager area: {identity.community}. {canManageHouse(identity, state.house.community)
                  ? 'Management entry is available for this house.'
                  : 'This house is outside your management area; management entry is hidden.'}
              </p>}
            </section>
            <section className={styles.card} aria-labelledby="source-heading">
              <h2 id="source-heading">Record and source</h2>
              <dl className={styles.fields}>
                <div><dt>Source type</dt><dd>{state.house.sourceType === 'PUBLIC_DATA' ? 'Public data'
                  : state.house.sourceType === 'MANUAL' ? 'Manual entry' : 'Not available'}</dd></div>
                <div><dt>Source URL</dt><dd>{sourceLink(state.house.sourceUrl)}</dd></div>
                <div><dt>Source fetched at · UTC</dt><dd>{displayUtcInstant(state.house.sourceFetchedAt)}</dd></div>
                <div><dt>Created at · UTC</dt><dd>{displayUtcInstant(state.house.createdAt)}</dd></div>
                <div><dt>Created business date · Chicago</dt><dd>{displayChicagoBusinessDate(state.house.createdBusinessDate)}</dd></div>
                <div><dt>Created by</dt><dd>{state.house.createdBy ?? 'Not available'}</dd></div>
                <div><dt>Updated at · UTC</dt><dd>{displayUtcInstant(state.house.updatedAt)}</dd></div>
              </dl>
            </section>
            </div>
            {photoRefreshError?.key === key && <div className={styles.message} role="alert">
              <p>{photoRefreshError.message}</p>
              <button type="button" onClick={refreshPhotoHistory}>Retry photo history</button>
            </div>}
            <PhotoHistory key={`${version}:${state.house.id}`} houseId={state.house.id} photos={state.house.photos}
              canUpload={canManageHouse(identity, state.house.community)}
              onUploadComplete={uploadComplete} onRefreshDetails={refreshPhotoHistory} />
          </div>
        )}
      </div>
    </div>
  )
}
