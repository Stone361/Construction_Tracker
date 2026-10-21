import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { IdentityContext, identityStorageKey, identityStorageVersion, restoreDemoIdentity, viewerIdentity } from './DemoIdentityContext'
import type { DemoIdentity, IdentityContextValue } from './DemoIdentityContext'

function initialIdentity(): DemoIdentity {
  try {
    return restoreDemoIdentity(sessionStorage.getItem(identityStorageKey))
  } catch {
    return viewerIdentity
  }
}

export function DemoIdentityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => ({ identity: initialIdentity(), version: 0 }))

  useEffect(() => {
    try {
      sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion, identity: state.identity }))
    } catch {
      // Storage can be unavailable in restricted browser contexts; the current tab still works.
    }
  }, [state.identity])

  const apply = (identity: DemoIdentity) => setState(current =>
    current.identity.role === identity.role && current.identity.community === identity.community
      ? current : { identity, version: current.version + 1 })

  const value: IdentityContextValue = {
    ...state,
    selectRole: role => apply({ user: 'frontend-demo', role, community: null }),
    selectSiteManager: community => {
      if (community.trim() !== community || !community) return
      apply({ user: 'frontend-demo', role: 'SITE_MANAGER', community })
    },
  }
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}
