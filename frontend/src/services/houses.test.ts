import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewerIdentity } from '../app/DemoIdentityContext'
import { displayPhotoDate, getCommunityNames, getHouses, hasValidLocation, houseListPath, parseHouseList, sortHousesByPhotoDate, stageLabel } from './houses'
import type { HouseQuery } from './houses'

const query: HouseQuery = {
  bounds: { minLat: 30.1, maxLat: 30.5, minLng: -97.9, maxLng: -97.5 },
  stage: null,
}

afterEach(() => vi.unstubAllGlobals())

describe('house list API', () => {
  it('uses the backend list shape and sends the simulated identity on GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: 11, address: '101 Main St', permitNo: 'P-11', community: 'Austin Council District 8',
        lat: 30.2672, lng: -97.7431, stage: 'FOUNDATION', lastPhotoBusinessDate: '2026-10-20' },
    ]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await getHouses(query, undefined, viewerIdentity)).toEqual([{ id: 11, address: '101 Main St', permitNo: 'P-11',
      community: 'Austin Council District 8', lat: 30.2672, lng: -97.7431,
      stage: 'FOUNDATION', lastPhotoBusinessDate: '2026-10-20' }])
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/houses?minLat=30.1&maxLat=30.5&minLng=-97.9&maxLng=-97.5')
    expect(options.headers).toMatchObject({
      'X-User': viewerIdentity.user,
      'X-Role': viewerIdentity.role,
    })
    expect(options.headers).not.toHaveProperty('X-Community')
  })

  it('combines four independent bounds with one stage and never sends bbox', () => {
    const path = houseListPath({ ...query, stage: 'FRAMING' })
    const url = new URL(path, 'http://localhost')
    expect(url.searchParams.get('stage')).toBe('FRAMING')
    expect(url.searchParams.get('minLat')).toBe('30.1')
    expect(url.searchParams.get('maxLng')).toBe('-97.5')
    expect(url.searchParams.has('bbox')).toBe(false)
  })

  it('keeps records but excludes incomplete, nonnumeric and out-of-range locations', () => {
    const houses = parseHouseList([
      { id: 1, lat: 30, lng: -97 },
      { id: 2, lat: null, lng: -97 },
      { id: 3, lat: '30', lng: -97 },
      { id: 4, lat: 91, lng: -97 },
      { id: 5, lat: 30, lng: Number.POSITIVE_INFINITY },
    ])
    expect(houses).toHaveLength(5)
    expect(houses.filter(hasValidLocation).map(house => house.id)).toEqual([1])
  })

  it('sorts by latest photo business date, then ascending ID, with undated houses last', () => {
    const houses = parseHouseList([
      { id: 8, lastPhotoBusinessDate: null },
      { id: 7, lastPhotoBusinessDate: '2026-10-20' },
      { id: 3, lastPhotoBusinessDate: '2026-10-21' },
      { id: 2, lastPhotoBusinessDate: '2026-10-21' },
      { id: 1, lastPhotoBusinessDate: null },
    ])
    expect(sortHousesByPhotoDate(houses).map(house => house.id)).toEqual([2, 3, 7, 1, 8])
    expect(houses.map(house => house.id)).toEqual([8, 7, 3, 2, 1])
  })

  it('uses honest fallbacks for missing fields and invalid photo dates', () => {
    const house = parseHouseList([{ id: 4, address: null, community: '', permitNo: null,
      stage: 'UNKNOWN', lastPhotoBusinessDate: '2026-02-30' }])
    expect(house).toHaveLength(1)
    expect(house[0]).toMatchObject({ address: null, community: null, permitNo: null,
      stage: null, lastPhotoBusinessDate: null })
    expect(stageLabel(house[0]?.stage ?? null)).toBe('Stage unavailable')
    expect(displayPhotoDate(house[0]?.lastPhotoBusinessDate ?? null)).toBe('No photo activity date')
  })

  it('rejects a malformed list or invalid house ID', () => {
    expect(() => parseHouseList({ houses: [] })).toThrow(/unexpected house list format/)
    expect(() => parseHouseList([{ id: '1', lat: 30, lng: -97 }])).toThrow(/invalid house record/)
  })

  it('reports HTTP authorization errors without treating them as empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    await expect(getHouses(query, undefined, viewerIdentity)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/HTTP 403/) })
  })

  it('derives exact unique community names from the real unbounded list under the current identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: 1, community: 'Austin Council District 8' },
      { id: 2, community: 'Austin Council District 5' },
      { id: 3, community: 'Austin Council District 8' },
      { id: 4, community: null },
    ]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getCommunityNames(viewerIdentity)).toEqual(['Austin Council District 5', 'Austin Council District 8'])
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/houses')
    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({ 'X-Role': 'VIEWER' })
  })

  it('sends manager community only for Site Manager, with no stale community after returning to Viewer', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const manager = { user: 'frontend-demo', role: 'SITE_MANAGER' as const, community: 'Austin Council District 8' }
    await getHouses(query, undefined, manager)
    await getHouses(query, undefined, viewerIdentity)
    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({
      'X-User': 'frontend-demo', 'X-Role': 'SITE_MANAGER', 'X-Community': 'Austin Council District 8',
    })
    expect(fetchMock.mock.calls[1]?.[1].headers).not.toHaveProperty('X-Community')
  })
})
