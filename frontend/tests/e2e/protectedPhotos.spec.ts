import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/iZkAAAAASUVORK5CYII=', 'base64')
const photo = (id: number) => ({
  id, houseId: 225, stage: 'LAND_CLEARING', locationStatus: 'VERIFIED',
  takenAt: '2026-01-02T00:00:00Z', uploadedAt: '2026-10-20T00:00:00Z',
  businessDate: '2026-01-01', url: `/api/houses/225/photos/${id}/file`,
})
const detail = {
  id: 225, permitNo: 'DEMO-PHOTO-225', address: 'Photo demo, Austin, TX', community: 'DEMO-PHOTO',
  stage: 'LAND_CLEARING', lat: 30.2672, lng: -97.7431, coverPhotoId: 77,
  sourceType: 'MANUAL', sourceUrl: null, sourceFetchedAt: null, createdAt: null,
  createdBusinessDate: null, createdBy: 'demo-photos', updatedAt: null, photos: [photo(77), photo(78)],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/summary', route => route.fulfill({ json: {
    stageCounts: { LAND_CLEARING: 0, FOUNDATION: 0, FRAMING: 0, MEP: 0, INTERIOR: 0, CO_READY: 0 },
    staleHouseIds: [],
  } }))
  await page.route('**/api/houses*', route => route.fulfill({ json: [
    { id: 1, address: 'Other house', community: 'Austin Council District 8',
      stage: 'FOUNDATION', lat: 30.27, lng: -97.74 },
  ] }))
  await page.route('**/api/houses/225', route => route.fulfill({ json: detail }))
})

test('map cards use only backend-selected covers and detail shares the cover with photo history', async ({ page }) => {
  const tilePath = fileURLToPath(new URL('../fixtures/map-tile.svg', import.meta.url))
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    path: tilePath, contentType: 'image/svg+xml',
  }))
  await page.route(url => url.pathname === '/api/houses', route => route.fulfill({ json: [
    { id: 225, address: detail.address, community: detail.community, stage: detail.stage,
      lat: detail.lat, lng: detail.lng, coverPhotoUrl: '/api/houses/225/photos/77/file' },
    { id: 226, address: 'No cover house', community: detail.community, stage: detail.stage,
      lat: detail.lat, lng: detail.lng, coverPhotoUrl: null },
  ] }))
  const requests: string[] = []
  await page.route('**/api/houses/225/photos/*/file', route => {
    requests.push(new URL(route.request().url()).pathname)
    expect(route.request().headers()['x-role']).toBe('VIEWER')
    return route.fulfill({ body: png, contentType: 'image/png' })
  })
  await page.goto('/map')
  await page.getByRole('tab', { name: 'House Explorer' }).click()
  await expect(page.getByRole('img', { name: 'Cover of Photo demo, Austin, TX' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View No cover house' }).getByRole('img')).toHaveCount(0)
  expect(requests).toEqual(['/api/houses/225/photos/77/file'])
  await page.getByRole('button', { name: 'Open details for Photo demo, Austin, TX' }).click()
  await expect(page.getByRole('img', { name: 'Current cover of Photo demo, Austin, TX' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Site photo 1' })).toBeVisible()
  expect(requests.filter(path => path.endsWith('/77/file'))).toHaveLength(2)
})

test('authorized cover change updates detail and a freshly queried map card', async ({ page }) => {
  const tilePath = fileURLToPath(new URL('../fixtures/map-tile.svg', import.meta.url))
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    path: tilePath, contentType: 'image/svg+xml',
  }))
  let coverId = 77
  let listReads = 0
  let writes = 0
  const imageReads: string[] = []
  await page.route(url => url.pathname === '/api/houses', route => {
    listReads += 1
    return route.fulfill({ json: [{ id: 225, address: detail.address, community: detail.community,
      stage: detail.stage, lat: detail.lat, lng: detail.lng,
      coverPhotoUrl: `/api/houses/225/photos/${coverId}/file` }] })
  })
  await page.route('**/api/houses/225', route => route.fulfill({ json: { ...detail, coverPhotoId: coverId } }))
  await page.route('**/api/houses/225/cover', async route => {
    writes += 1
    expect(route.request().method()).toBe('PUT')
    expect(route.request().headers()['x-role']).toBe('ADMIN')
    expect(route.request().postDataJSON()).toEqual({ photoId: 78 })
    coverId = 78
    await route.fulfill({ status: 200, json: { ...detail, coverPhotoId: coverId } })
  })
  await page.route('**/api/houses/225/photos/*/file', route => {
    imageReads.push(new URL(route.request().url()).pathname)
    return route.fulfill({ body: png, contentType: 'image/png' })
  })

  await page.goto('/map')
  await page.getByRole('tab', { name: 'House Explorer' }).click()
  await expect(page.getByRole('img', { name: 'Cover of Photo demo, Austin, TX' })).toBeVisible()
  await page.getByRole('button', { name: 'Open details for Photo demo, Austin, TX' }).click()
  await expect(page.getByRole('img', { name: 'Current cover of Photo demo, Austin, TX' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set photo 2 as cover' })).toHaveCount(0)
  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await expect(page.getByRole('button', { name: 'Set photo 2 as cover' })).toBeEnabled()
  await page.getByRole('button', { name: 'Set photo 2 as cover' }).click()
  await expect(page.getByRole('region', { name: 'Cover photo details' }).getByText('Construction stage')).toBeVisible()
  await expect(page.getByText(/House cover updated/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set photo 2 as cover' })).toHaveCount(0)
  expect(writes).toBe(1)

  await page.getByRole('link', { name: 'Back to map' }).click()
  await page.getByRole('button', { name: 'Back to list' }).click()
  await expect(page.getByRole('img', { name: 'Cover of Photo demo, Austin, TX' })).toBeVisible()
  expect(listReads).toBeGreaterThanOrEqual(2)
  expect(imageReads.at(-1)).toBe('/api/houses/225/photos/78/file')
})

test('a cover write finishing after return to the map refreshes its card', async ({ page }) => {
  const tilePath = fileURLToPath(new URL('../fixtures/map-tile.svg', import.meta.url))
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    path: tilePath, contentType: 'image/svg+xml',
  }))
  let coverId = 77
  let listReads = 0
  let releaseWrite!: () => void
  let writeStarted!: () => void
  const started = new Promise<void>(resolve => { writeStarted = resolve })
  const gate = new Promise<void>(resolve => { releaseWrite = resolve })
  const imageReads: string[] = []
  await page.route(url => url.pathname === '/api/houses', route => {
    listReads += 1
    return route.fulfill({ json: [{ id: 225, address: detail.address, community: detail.community,
      stage: detail.stage, lat: detail.lat, lng: detail.lng,
      coverPhotoUrl: `/api/houses/225/photos/${coverId}/file` }] })
  })
  await page.route('**/api/houses/225', route => route.fulfill({ json: { ...detail, coverPhotoId: coverId } }))
  await page.route('**/api/houses/225/cover', async route => {
    writeStarted()
    await gate
    coverId = 78
    await route.fulfill({ status: 200, json: { ...detail, coverPhotoId: coverId } })
  })
  await page.route('**/api/houses/225/photos/*/file', route => {
    imageReads.push(new URL(route.request().url()).pathname)
    return route.fulfill({ body: png, contentType: 'image/png' })
  })

  await page.goto('/houses/225')
  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await page.getByRole('button', { name: 'Set photo 2 as cover' }).click()
  await started
  await page.getByRole('link', { name: 'Back to map' }).click()
  await page.getByRole('tab', { name: 'House Explorer' }).click()
  await expect(page.getByRole('img', { name: 'Cover of Photo demo, Austin, TX' })).toBeVisible()
  const readsBeforeWrite = listReads
  releaseWrite()
  await expect.poll(() => listReads).toBeGreaterThan(readsBeforeWrite)
  await expect.poll(() => imageReads.at(-1)).toBe('/api/houses/225/photos/78/file')
})

test('protected cards and lightbox use one identity-scoped fetch per photo', async ({ page }) => {
  const requests: Array<{ path: string; role: string | undefined; community: string | undefined }> = []
  await page.route('**/api/houses/225/photos/*/file', route => {
    const headers = route.request().headers()
    requests.push({ path: new URL(route.request().url()).pathname,
      role: headers['x-role'], community: headers['x-community'] })
    return route.fulfill({ body: png, contentType: 'image/png' })
  })
  await page.goto('/houses/225')
  await expect(page.getByRole('img', { name: 'Site photo 1' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Site photo 2' })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests.every(request => request.role === 'VIEWER' && !request.community)).toBe(true)
  await page.getByRole('button', { name: 'Preview photo 1' }).click()
  await expect(page.getByRole('img', { name: 'Enlarged site photo 1' })).toBeVisible()
  expect(requests).toHaveLength(2)
  await page.getByRole('button', { name: 'Close photo preview' }).click()

  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await expect(page.getByRole('img', { name: 'Site photo 1' })).toBeVisible()
  await expect.poll(() => requests.length).toBe(4)
  expect(requests.slice(2).every(request => request.role === 'ADMIN' && !request.community)).toBe(true)

  await page.getByLabel('Demo identity').selectOption('SITE_MANAGER')
  await page.getByLabel('Site Manager community').selectOption('Austin Council District 8')
  await expect(page.getByRole('img', { name: 'Site photo 1' })).toBeVisible()
  await expect.poll(() => requests.length).toBe(6)
  expect(requests.slice(4).every(request => request.role === 'SITE_MANAGER' &&
    request.community === 'Austin Council District 8')).toBe(true)
})

test('a missing file shows an error and retries without inventing a photo', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/houses/225/photos/*/file', route => {
    if (route.request().url().endsWith('/77/file')) {
      attempts += 1
      if (attempts === 1) return route.fulfill({ status: 404, json: { message: 'missing' } })
    }
    return route.fulfill({ body: png, contentType: 'image/png' })
  })
  await page.goto('/houses/225')
  await expect(page.getByText('This photo file was not found (HTTP 404).').first()).toBeVisible()
  await page.getByRole('button', { name: 'Retry photo 1' }).click()
  await expect(page.getByRole('img', { name: 'Site photo 1' })).toBeVisible()
  expect(attempts).toBe(2)
})
