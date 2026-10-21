import { createContext, useContext } from 'react'

export type DemoRole = 'ADMIN' | 'SITE_MANAGER' | 'VIEWER'

export interface DemoIdentity {
  user: string
  role: DemoRole
  community: string | null
}

export const viewerIdentity: DemoIdentity = { user: 'frontend-demo', role: 'VIEWER', community: null }
export const identityStorageKey = 'construction-tracker-demo-identity'
export const identityStorageVersion = 1

export function restoreDemoIdentity(value: string | null): DemoIdentity {
  if (!value) return viewerIdentity
  try {
    const saved: unknown = JSON.parse(value)
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return viewerIdentity
    const record = saved as Record<string, unknown>
    if (record.version !== identityStorageVersion || typeof record.identity !== 'object' ||
        record.identity === null || Array.isArray(record.identity)) return viewerIdentity
    const identity = record.identity as Record<string, unknown>
    if (identity.user !== 'frontend-demo') return viewerIdentity
    if (identity.role === 'ADMIN' || identity.role === 'VIEWER') {
      return identity.community === null ? { user: 'frontend-demo', role: identity.role, community: null } : viewerIdentity
    }
    if (identity.role === 'SITE_MANAGER' && typeof identity.community === 'string' &&
        identity.community.trim() === identity.community && identity.community.length > 0) {
      return { user: 'frontend-demo', role: 'SITE_MANAGER', community: identity.community }
    }
  } catch {
    // Invalid session data must never create an invalid backend identity.
  }
  return viewerIdentity
}

export interface IdentityContextValue {
  identity: DemoIdentity
  version: number
  selectRole: (role: 'ADMIN' | 'VIEWER') => void
  selectSiteManager: (community: string) => void
}

const fallback: IdentityContextValue = {
  identity: viewerIdentity,
  version: 0,
  selectRole: () => {},
  selectSiteManager: () => {},
}
export const IdentityContext = createContext<IdentityContextValue>(fallback)

export function useDemoIdentity(): IdentityContextValue {
  return useContext(IdentityContext)
}
