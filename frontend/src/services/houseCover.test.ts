import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewerIdentity } from '../app/DemoIdentityContext'
import { setHouseCover } from './houseCover'

const updated = { id: 12, coverPhotoId: 8, photos: [{ id: 8, houseId: 12,
  stage: 'FOUNDATION', url: '/api/houses/12/photos/8/file' }] }

afterEach(() => vi.unstubAllGlobals())

describe('set house cover', () => {
  it.each([
    [{ ...viewerIdentity, role: 'ADMIN' as const }, undefined],
    [{ ...viewerIdentity, role: 'SITE_MANAGER' as const, community: 'Austin Council District 8' }, 'Austin Council District 8'],
  ])('sends the exact PUT contract with the current identity and parses updated detail', async (identity, community) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await setHouseCover(12, 8, identity)).coverPhotoId).toBe(8)
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/houses/12/cover')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body as string)).toEqual({ photoId: 8 })
    expect(options.headers).toMatchObject({ 'X-User': 'frontend-demo', 'X-Role': identity.role,
      'Content-Type': 'application/json' })
    expect((options.headers as Record<string, string>)['X-Community']).toBe(community)
  })

  it.each([401, 403, 422])('keeps HTTP %i distinct from success', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    await expect(setHouseCover(12, 8, viewerIdentity)).rejects.toMatchObject({ status,
      message: expect.stringContaining(`HTTP ${status}`) })
  })

  it('reports a lost write acknowledgement as unknown and rejects a mismatched response', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('network lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...updated, coverPhotoId: 9 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(setHouseCover(12, 8, viewerIdentity)).rejects.toThrow(/result is unknown/)
    await expect(setHouseCover(12, 8, viewerIdentity)).rejects.toThrow(/response was invalid/)
  })

  it('rejects an invalid photo ID before sending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(setHouseCover(12, 0, viewerIdentity)).rejects.toThrow(/valid photo/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
