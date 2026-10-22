import { expect, test } from '@playwright/test'

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/iZkAAAAASUVORK5CYII=', 'base64')
const photo = { id: 93, houseId: 228, stage: 'FOUNDATION', locationStatus: 'SUSPECT',
  takenAt: '2026-10-20T00:00:00Z', uploadedAt: '2026-10-21T00:00:00Z',
  businessDate: '2026-10-19', url: '/api/houses/228/photos/93/file' }
const baseDetail = { id: 228, permitNo: 'DEMO-AUTH-228', address: 'Authorization demo, Austin, TX',
  community: 'DEMO-AUTH-A', stage: 'FOUNDATION', lat: 30.2672, lng: -97.7431,
  coverPhotoId: null, sourceType: 'MANUAL', sourceUrl: null, sourceFetchedAt: null,
  createdAt: null, createdBusinessDate: null, createdBy: 'demo', updatedAt: null }

test.beforeEach(async ({ page }) => {
  await page.route('**/api/houses*', route => route.fulfill({ json: [
    { id: 228, address: baseDetail.address, community: 'DEMO-AUTH-A', stage: 'FOUNDATION', lat: 30.2672, lng: -97.7431 },
    { id: 229, address: 'Other demo', community: 'DEMO-AUTH-B', stage: 'FOUNDATION', lat: 30.28, lng: -97.75 },
  ] }))
})

for (const status of [201, 200] as const) {
  test(`Admin sees the HTTP ${status} upload result before returning to the upload card`, async ({ page }) => {
    let photos = status === 200 ? [photo] : []
    let detailReads = 0
    const writes: Array<{ role: string | undefined; community: string | undefined; contentType: string | undefined; body: string }> = []
    await page.route('**/api/houses/228', route => {
      detailReads += 1
      return route.fulfill({ json: { ...baseDetail, photos } })
    })
    await page.route('**/api/houses/228/photos/93/file', route => route.fulfill({ body: image, contentType: 'image/png' }))
    await page.route('**/api/houses/228/photos', route => {
      const request = route.request()
      const headers = request.headers()
      writes.push({ role: headers['x-role'], community: headers['x-community'],
        contentType: headers['content-type'], body: request.postData() ?? '' })
      photos = [photo]
      return route.fulfill({ status, json: photo })
    })
    await page.goto('/houses/228')
    await page.getByLabel('Demo identity').selectOption('ADMIN')
    const chooser = page.getByRole('button', { name: 'Upload photo' })
    await expect(chooser).toBeEnabled()
    await page.getByLabel('Choose photo file').setInputFiles({ name: 'new-site.png', mimeType: 'image/png', buffer: image })
    await expect(page.getByRole('img', { name: 'Selected photo preview' })).toBeVisible()
    await expect(page.getByText('new-site.png')).toBeVisible()
    expect(writes).toHaveLength(0)
    const readsBeforeUpload = detailReads
    await page.getByRole('button', { name: 'Confirm upload' }).click()
    await expect(page.getByRole('alertdialog', { name: status === 201
      ? 'Photo uploaded successfully' : 'Photo already exists' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to upload' })).toBeFocused()
    expect(detailReads).toBe(readsBeforeUpload)
    await page.getByRole('button', { name: 'Back to upload' }).click()
    await expect(page.getByRole('button', { name: 'Upload photo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload photo' })).toBeFocused()
    await expect.poll(() => detailReads).toBe(readsBeforeUpload + 1)
    await expect(page.getByRole('img', { name: 'Site photo 1' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'House photo history' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('button', { name: 'Preview photo 1' }).click()
    await expect(page.getByRole('img', { name: 'Enlarged site photo 1' })).toBeVisible()
    expect(writes).toHaveLength(1)
    expect(writes[0]?.role).toBe('ADMIN')
    expect(writes[0]?.community).toBeUndefined()
    expect(writes[0]?.contentType).toContain('multipart/form-data; boundary=')
    expect(writes[0]?.body).toContain('name="file"; filename="new-site.png"')
  })
}

test('Viewer and other-community Site Manager cannot upload; own-community manager can', async ({ page }) => {
  const writes: string[] = []
  await page.route('**/api/houses/228', route => route.fulfill({ json: { ...baseDetail, photos: [] } }))
  await page.route('**/api/houses/228/photos', route => {
    writes.push(route.request().method())
    return route.fulfill({ status: 403, json: { code: 'FORBIDDEN', message: 'No permission' } })
  })
  await page.goto('/houses/228')
  const upload = page.getByRole('button', { name: 'Upload photo' })
  await expect(upload).toHaveCount(0)
  const identity = page.getByLabel('Demo identity')
  await identity.selectOption('SITE_MANAGER')
  await page.getByLabel('Site Manager community').selectOption('DEMO-AUTH-B')
  await expect(upload).toHaveCount(0)
  await page.getByRole('button', { name: 'Change community' }).click()
  await page.getByLabel('Site Manager community').selectOption('DEMO-AUTH-A')
  await expect(upload).toBeEnabled()
  await identity.selectOption('VIEWER')
  await expect(upload).toHaveCount(0)
  expect(writes).toEqual([])
})
