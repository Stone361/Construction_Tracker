import { useEffect, useRef, useState } from 'react'
import { useDemoIdentity } from './DemoIdentityContext'
import { ApiError } from '../services/apiClient'
import { getCommunityNames } from '../services/houses'
import styles from './AppShell.module.css'

type CommunityPicker =
  | { kind: 'loading' }
  | { kind: 'ready'; communities: string[] }
  | { kind: 'error'; message: string }
  | null

export function DemoIdentitySelector() {
  const { identity, selectRole, selectSiteManager } = useDemoIdentity()
  const [picker, setPicker] = useState<CommunityPicker>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  const closePicker = () => {
    request.current?.abort()
    request.current = null
    setPicker(null)
  }

  const loadCommunities = () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPicker({ kind: 'loading' })
    getCommunityNames(identity, controller.signal).then(
      communities => {
        if (!controller.signal.aborted) setPicker({ kind: 'ready', communities })
      },
      error => {
        if (!controller.signal.aborted) setPicker({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Communities could not be loaded.',
        })
      },
    )
  }

  return (
    <div className={styles.identityArea}>
      <div className={styles.identityControl}>
        <label className={styles.identityLabel} htmlFor="demo-identity">Demo identity</label>
        <select id="demo-identity" className={styles.identitySelect} value={identity.role} onChange={event => {
          if (event.target.value === 'SITE_MANAGER') {
            loadCommunities()
          } else {
            closePicker()
            selectRole(event.target.value as 'ADMIN' | 'VIEWER')
          }
        }}>
          <option value="VIEWER">Viewer</option>
          <option value="ADMIN">Admin</option>
          <option value="SITE_MANAGER">Site Manager</option>
        </select>
        {identity.role === 'SITE_MANAGER' &&
          <button className={styles.changeCommunity} type="button" onClick={loadCommunities}>Change community</button>}
      </div>
      {picker && <div className={styles.communityPicker}>
        <div className={styles.pickerHeading}>
          <strong>Site Manager community</strong>
          <button type="button" onClick={closePicker} aria-label="Cancel community selection">×</button>
        </div>
        {picker.kind === 'loading' && <p role="status">Loading communities…</p>}
        {picker.kind === 'error' && <div role="alert"><p>{picker.message}</p>
          <button type="button" onClick={loadCommunities}>Retry communities</button></div>}
        {picker.kind === 'ready' && (picker.communities.length === 0
          ? <p role="status">No communities are available from house data.</p>
          : <label className={styles.communityLabel}>Choose a community
              <select aria-label="Site Manager community" value="" onChange={event => {
                const community = event.target.value
                if (!picker.communities.includes(community)) return
                selectSiteManager(community)
                closePicker()
              }}>
                <option value="" disabled>Select a community</option>
                {picker.communities.map(community =>
                  <option key={community} value={community}>{community}</option>)}
              </select>
            </label>)}
      </div>}
    </div>
  )
}
