import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewerIdentity } from '../app/DemoIdentityContext'
import { displayChicagoBusinessDate, displayUtcInstant, getHouseDetail, latestPhotoBusinessDate, parseHouseDetail } from './houseDetail'

export const detailFixture = {
  id: 12, permitNo: 'P-12', address: '12 Main St', community: 'Austin Council District 8',
  lat: 30.2672, lng: -97.7431, stage: 'FOUNDATION', coverPhotoId: null,
  sourceType: 'PUBLIC_DATA', sourceUrl: 'https://example.org/permit/12',
  sourceFetchedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-02T01:00:00Z',
  createdBusinessDate: '2026-01-01', createdBy: 'importer', updatedAt: '2026-01-03T02:00:00Z',
  photos: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('house detail API', () => {
  it('requests the detail path with the existing simulated identity and maps the detail DTO', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(detailFixture), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getHouseDetail(12, undefined, viewerIdentity)).toMatchObject({
      id: 12, address: '12 Main St', sourceType: 'PUBLIC_DATA', createdBy: 'importer',
      sourceFetchedAt: '2026-01-01T00:00:00.000Z',
    })
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/houses/12')
    expect(options.headers).toMatchObject({
      'X-User': viewerIdentity.user, 'X-Role': viewerIdentity.role,
    })
    expect(options.headers).not.toHaveProperty('X-Community')
  })

  it('keeps optional fields honest and formats UTC instants separately from Chicago business dates', () => {
    const parsed = parseHouseDetail({ ...detailFixture, address: null, community: '', lat: null,
      sourceUrl: null, sourceFetchedAt: null, createdBusinessDate: null, stage: 'UNKNOWN' }, 12)
    expect(parsed).toMatchObject({ address: null, community: null, lat: null,
      sourceUrl: null, sourceFetchedAt: null, createdBusinessDate: null, stage: null })
    expect(displayUtcInstant('2026-01-01T00:00:00Z')).toMatch(/Jan 1, 2026.*UTC/)
    expect(displayChicagoBusinessDate('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('maps cover ID and real photo metadata in backend order without confusing house and photo stages', () => {
    const parsed = parseHouseDetail({ ...detailFixture, coverPhotoId: 8, photos: [
      { id: 8, houseId: 12, stage: 'LAND_CLEARING', takenAt: '2026-01-01T04:00:00Z',
        uploadedAt: '2026-01-03T07:00:00Z', businessDate: '2025-12-31', url: '/api/houses/12/photos/8/file' },
      { id: 9, houseId: 12, stage: 'FRAMING', takenAt: null, uploadedAt: null,
        businessDate: null, url: '/api/houses/12/photos/9/file' },
    ] }, 12)
    expect(parsed.stage).toBe('FOUNDATION')
    expect(parsed.coverPhotoId).toBe(8)
    expect(parsed.photos.map(photo => photo.id)).toEqual([8, 9])
    expect(parsed.photos[0]).toMatchObject({ stage: 'LAND_CLEARING',
      takenAt: '2026-01-01T04:00:00.000Z', uploadedAt: '2026-01-03T07:00:00.000Z',
      businessDate: '2025-12-31' })
    expect(parsed.photos[1]).toMatchObject({ stage: 'FRAMING', takenAt: null, uploadedAt: null })
  })

  it('finds the latest photo business date without using upload time or backend photo order', () => {
    const parsed = parseHouseDetail({ ...detailFixture, photos: [
      { id: 8, houseId: 12, businessDate: '2026-01-01', uploadedAt: '2026-10-22T00:00:00Z' },
      { id: 9, houseId: 12, businessDate: null, uploadedAt: '2026-10-23T00:00:00Z' },
      { id: 10, houseId: 12, businessDate: '2026-02-03', uploadedAt: '2026-03-01T00:00:00Z' },
    ] }, 12)
    expect(latestPhotoBusinessDate(parsed.photos)).toBe('2026-02-03')
    expect(latestPhotoBusinessDate(parsed.photos.slice(0, 2).filter(photo => photo.businessDate === null))).toBeNull()
    expect(latestPhotoBusinessDate([])).toBeNull()
  })

  it('rejects a response for a different house or a malformed detail DTO', () => {
    expect(() => parseHouseDetail({ ...detailFixture, id: 99 }, 12)).toThrow(/invalid house detail record/)
    expect(() => parseHouseDetail({ ...detailFixture, photos: null }, 12)).toThrow(/invalid house detail record/)
    expect(() => parseHouseDetail({ ...detailFixture, photos: [{ id: 3, houseId: 99 }] }, 12))
      .toThrow(/invalid photo record/)
  })

  it('does not use an external or mismatched photo URL from the detail response', () => {
    const parsed = parseHouseDetail({ ...detailFixture, photos: [
      { id: 8, houseId: 12, url: 'https://example.org/photo.png' },
      { id: 9, houseId: 12, url: '/api/houses/13/photos/9/file' },
    ] }, 12)
    expect(parsed.photos.map(photo => photo.url)).toEqual([null, null])
  })

  it('preserves distinct 401 and 404 failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getHouseDetail(12, undefined, viewerIdentity)).rejects.toMatchObject({ status: 401 })
    await expect(getHouseDetail(12, undefined, viewerIdentity)).rejects.toMatchObject({ status: 404 })
  })
})
