import type { DemoIdentity } from '../app/DemoIdentityContext'

// Display-only hints. The backend remains the authority for every write request.
export function canCreateHouse(identity: DemoIdentity): boolean {
  return identity.role === 'ADMIN'
}

export function canManageHouse(identity: DemoIdentity, houseCommunity: string | null): boolean {
  if (identity.role === 'ADMIN') return true
  return identity.role === 'SITE_MANAGER' && identity.community !== null &&
    identity.community.length > 0 && identity.community.trim() === identity.community &&
    houseCommunity !== null && houseCommunity.trim().length > 0 &&
    identity.community === houseCommunity
}
