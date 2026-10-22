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
  await page.route('**/api/houses*', route => route.fulfill({ json: [
    { id: 1, address: 'Other house', community: 'Austin Council District 8',
      stage: 'FOUNDATION', lat: 30.27, lng: -97.74 },
  ] }))
  await page.route('**/api/houses/225', route => route.fulfill({ json: detail }))
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
