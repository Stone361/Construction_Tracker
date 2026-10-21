import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHouse, emptyHouseForm, validateHouseForm } from './createHouse'
import { ApiError } from './apiClient'
import type { DemoIdentity } from '../app/DemoIdentityContext'

const admin: DemoIdentity = { user: 'frontend-demo', role: 'ADMIN', community: null }
const valid = { ...emptyHouseForm, permitNo: ' P-7 ', address: ' 7 Main St ', community: ' District 8 ',
  lat: '30.2672', lng: '-97.7431' }

afterEach(() => vi.unstubAllGlobals())

describe('create house contract', () => {
  it('trims required values and sends valid manual coordinates without source metadata', () => {
    const result = validateHouseForm(valid)
    expect(result.errors).toEqual({})
    expect(result.payload).toEqual({ permitNo: 'P-7', address: '7 Main St', community: 'District 8',
      lat: 30.2672, lng: -97.7431, sourceUrl: null, sourceFetchedAt: null })
    expect(validateHouseForm({ ...valid, lat: '', lng: '' }).payload).toMatchObject({ lat: null, lng: null })
  })

  it('requires actual text, coordinate pairs and backend numeric limits', () => {
    expect(validateHouseForm(emptyHouseForm).errors).toMatchObject({
      permitNo: expect.any(String), address: expect.any(String), community: expect.any(String),
    })
    expect(validateHouseForm({ ...valid, lng: '' }).errors.lng).toMatch(/together/)
    expect(validateHouseForm({ ...valid, lat: '90.0000001' }).errors.lat).toMatch(/-90 to 90/)
    expect(validateHouseForm({ ...valid, lng: '-180.0000001' }).errors.lng).toMatch(/-180 to 180/)
    expect(validateHouseForm({ ...valid, lat: '30.12345678' }).errors.lat).toMatch(/7 decimal/)
  })

  it('requires source URL and local time as a valid pair', () => {
    expect(validateHouseForm({ ...valid, sourceUrl: 'https://example.org/permit' }).errors.sourceFetchedAt)
      .toBeTruthy()
    expect(validateHouseForm({ ...valid, sourceFetchedAt: '2026-10-21T15:00' }).errors.sourceUrl)
      .toBeTruthy()
    expect(validateHouseForm({ ...valid, sourceUrl: 'file:///private/data', sourceFetchedAt: '2026-10-21T15:00' }).errors.sourceUrl)
      .toBeTruthy()
    expect(validateHouseForm({ ...valid, sourceUrl: 'https://user:secret@example.org/p', sourceFetchedAt: '2026-10-21T15:00' }).errors.sourceUrl)
      .toBeTruthy()
    expect(validateHouseForm({ ...valid, sourceUrl: 'https://example.org/p', sourceFetchedAt: '2026-10-21T15:00' }).payload?.sourceFetchedAt)
      .toMatch(/Z$/)
  })

  it('POSTs through the shared identity client and uses only a valid response ID', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 17 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const payload = validateHouseForm(valid).payload!
    await expect(createHouse(payload, new AbortController().signal, admin))
      .resolves.toEqual({ id: 42, kind: 'created' })
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/houses')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({ 'X-User': 'frontend-demo', 'X-Role': 'ADMIN',
      'Content-Type': 'application/json' })
    expect(options.headers).not.toHaveProperty('X-Community')
    expect(JSON.parse(options.body as string)).toEqual(payload)
    await expect(createHouse(payload, new AbortController().signal, admin))
      .resolves.toEqual({ id: 17, kind: 'existing' })
    await expect(createHouse(payload, new AbortController().signal, admin))
      .rejects.toThrow('invalid house creation response')
    await expect(createHouse(payload, new AbortController().signal, admin))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<ApiError>)
  })
})
