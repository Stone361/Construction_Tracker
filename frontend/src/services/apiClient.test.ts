import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewerIdentity } from '../app/DemoIdentityContext'
import { apiIdentityHeaders, getJson, getProtectedImage } from './apiClient'

afterEach(() => vi.unstubAllGlobals())

describe('shared business API identity and errors', () => {
  it('uses only the current role headers and rejects an incomplete manager before fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(apiIdentityHeaders(viewerIdentity)).toEqual({ 'X-User': 'frontend-demo', 'X-Role': 'VIEWER' })
    expect(apiIdentityHeaders({ user: 'frontend-demo', role: 'ADMIN', community: null }))
      .toEqual({ 'X-User': 'frontend-demo', 'X-Role': 'ADMIN' })
    expect(apiIdentityHeaders({ user: 'frontend-demo', role: 'SITE_MANAGER', community: 'Austin Council District 8' }))
      .toEqual({ 'X-User': 'frontend-demo', 'X-Role': 'SITE_MANAGER', 'X-Community': 'Austin Council District 8' })
    await expect(getJson('/api/houses', undefined,
      { user: 'frontend-demo', role: 'SITE_MANAGER', community: null }))
      .rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never attaches business identity to a nonlocal URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getJson('https://tile.openstreetmap.org/1/2/3.png', undefined, viewerIdentity))
      .rejects.toThrow(/local \/api\//)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'not accepted'],
    [403, 'not permitted'],
    [404, 'not found'],
    [503, 'request failed'],
  ])('distinguishes HTTP %i without treating it as empty data', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    await expect(getJson('/api/houses', undefined, viewerIdentity))
      .rejects.toMatchObject({ status, message: expect.stringContaining(message) })
  })

  it('explains a network failure without misreporting it as empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(getJson('/api/houses', undefined, viewerIdentity))
      .rejects.toThrow(/Could not reach the backend/)
  })

  it.each([
    [{ user: 'frontend-demo', role: 'VIEWER', community: null }, undefined],
    [{ user: 'frontend-demo', role: 'ADMIN', community: null }, undefined],
    [{ user: 'frontend-demo', role: 'SITE_MANAGER', community: 'Austin Council District 8' }, 'Austin Council District 8'],
  ] as const)('reads protected original photos with the current identity', async (identity, community) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' }), {
      headers: { 'Content-Type': 'image/png' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    expect((await getProtectedImage('/api/houses/12/photos/8/file', controller.signal, identity)).size).toBeGreaterThan(0)
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/houses/12/photos/8/file')
    expect(options.signal).toBe(controller.signal)
    expect(options.headers).toMatchObject({ 'X-User': 'frontend-demo', 'X-Role': identity.role })
    expect((options.headers as Record<string, string>)['X-Community']).toBe(community)
  })

  it('rejects external image URLs before sending credentials, and distinguishes image failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new TypeError('network failure'))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const path = '/api/houses/12/photos/8/file'
    await expect(getProtectedImage('https://tile.openstreetmap.org/1/2/3.png', controller.signal, viewerIdentity))
      .rejects.toThrow(/invalid/)
    expect(fetchMock).not.toHaveBeenCalled()
    for (const status of [401, 403, 404]) {
      await expect(getProtectedImage(path, controller.signal, viewerIdentity)).rejects.toMatchObject({ status })
    }
    await expect(getProtectedImage(path, controller.signal, viewerIdentity))
      .rejects.toThrow(/Could not reach the backend/)
  })
})
