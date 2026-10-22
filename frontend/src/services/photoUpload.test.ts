import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewerIdentity } from '../app/DemoIdentityContext'
import { maximumPhotoBytes, uploadHousePhoto, validatePhotoFile } from './photoUpload'

const png = () => new File(['image'], 'site.png', { type: 'image/png' })
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
const photo = { id: 91, houseId: 228, locationStatus: 'SUSPECT', stage: 'FOUNDATION' }

afterEach(() => vi.unstubAllGlobals())

describe('single photo upload contract', () => {
  it('accepts supported nonempty types through the exact 10,000,000-byte limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validatePhotoFile(new File(['a'], 'site', { type }))).toBeNull()
    }
    expect(validatePhotoFile(new File(['a'], 'site.svg', { type: 'image/svg+xml' }))).toMatch(/JPEG, PNG, or WebP/)
    expect(validatePhotoFile(new File([], 'empty.png', { type: 'image/png' }))).toMatch(/non-empty/)
    const large = png()
    Object.defineProperty(large, 'size', { configurable: true, value: maximumPhotoBytes })
    expect(validatePhotoFile(large)).toBeNull()
    Object.defineProperty(large, 'size', { value: maximumPhotoBytes + 1 })
    expect(validatePhotoFile(large)).toMatch(/10,000,000/)
  })

  it.each([201, 200] as const)('sends one multipart file with current identity and keeps HTTP %i distinct', async status => {
    const fetchMock = vi.fn().mockResolvedValue(response(status, photo))
    vi.stubGlobal('fetch', fetchMock)
    const identity = { user: 'frontend-demo', role: 'SITE_MANAGER' as const, community: 'DEMO-AUTH-A' }
    expect(await uploadHousePhoto(228, png(), identity)).toEqual({ status, photoId: 91, gpsStatus: 'SUSPECT' })
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/houses/228/photos')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({ 'X-User': 'frontend-demo', 'X-Role': 'SITE_MANAGER',
      'X-Community': 'DEMO-AUTH-A' })
    expect(options.headers).not.toHaveProperty('Content-Type')
    expect(options.body).toBeInstanceOf(FormData)
    const entries = Array.from((options.body as FormData).entries())
    expect(entries).toHaveLength(1)
    expect(entries[0]?.[0]).toBe('file')
    expect((entries[0]?.[1] as File).name).toBe('site.png')
  })

  it('submits renamed files with identical content and trusts the backend duplicate result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(201, photo))
      .mockResolvedValueOnce(response(200, photo))
    vi.stubGlobal('fetch', fetchMock)
    const first = new File(['same image bytes'], 'original.png', { type: 'image/png' })
    const renamed = new File(['same image bytes'], 'renamed.png', { type: 'image/png' })

    expect(await uploadHousePhoto(228, first, viewerIdentity)).toMatchObject({ status: 201, photoId: 91 })
    expect(await uploadHousePhoto(228, renamed, viewerIdentity)).toMatchObject({ status: 200, photoId: 91 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sent = fetchMock.mock.calls.map(call =>
      ((call[1] as RequestInit).body as FormData).get('file') as File)
    expect(sent.map(file => file.name)).toEqual(['original.png', 'renamed.png'])
    expect(await sent[0]!.text()).toBe(await sent[1]!.text())
  })

  it.each([401, 403, 413, 415, 422])('reports HTTP %i and the backend reason without retrying POST', async status => {
    const fetchMock = vi.fn().mockResolvedValue(response(status, { code: 'REJECTED', message: 'Backend detail' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(uploadHousePhoto(228, png(), viewerIdentity)).rejects.toMatchObject({
      status, message: expect.stringContaining('Backend detail'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats an interrupted connection as an unknown write outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection closed')))
    await expect(uploadHousePhoto(228, png(), viewerIdentity)).rejects.toThrow(/result is unknown/)
  })
})
