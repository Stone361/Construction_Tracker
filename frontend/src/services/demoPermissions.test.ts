import { describe, expect, it } from 'vitest'
import { viewerIdentity } from '../app/DemoIdentityContext'
import { canCreateHouse, canManageHouse } from './demoPermissions'

describe('display-only demo permissions', () => {
  const admin = { ...viewerIdentity, role: 'ADMIN' as const }
  const manager = { ...viewerIdentity, role: 'SITE_MANAGER' as const, community: 'Austin Council District 8' }

  it('reserves house creation for Admin', () => {
    expect(canCreateHouse(admin)).toBe(true)
    expect(canCreateHouse(manager)).toBe(false)
    expect(canCreateHouse(viewerIdentity)).toBe(false)
  })

  it('uses exact backend community matching for management hints', () => {
    expect(canManageHouse(admin, null)).toBe(true)
    expect(canManageHouse(manager, 'Austin Council District 8')).toBe(true)
    expect(canManageHouse(manager, 'Austin Council District 5')).toBe(false)
    expect(canManageHouse(manager, 'austin council district 8')).toBe(false)
    expect(canManageHouse(manager, null)).toBe(false)
    expect(canManageHouse({ ...manager, community: null }, 'Austin Council District 8')).toBe(false)
    expect(canManageHouse(viewerIdentity, 'Austin Council District 8')).toBe(false)
  })
})
