import { expect, test } from '@playwright/test'

test('detail progress follows photo metadata and identity; cancel sends no advance', async ({ page }) => {
  let advanceRequests = 0
  const detail = {
    id: 225, permitNo: 'DEMO-225', address: 'Progress demo, Austin, TX', community: 'North Austin',
    lat: 30.2, lng: -97.7, stage: 'FOUNDATION', coverPhotoId: null, sourceType: 'MANUAL',
    sourceUrl: null, sourceFetchedAt: null, createdAt: null, createdBusinessDate: null,
    createdBy: 'demo', updatedAt: null, photos: [
      { id: 1, houseId: 225, stage: 'FOUNDATION', locationStatus: 'SUSPECT',
        takenAt: null, uploadedAt: null, businessDate: null, url: null },
      { id: 2, houseId: 225, stage: 'FOUNDATION', locationStatus: 'UNKNOWN',
        takenAt: null, uploadedAt: null, businessDate: null, url: null },
    ],
  }
  await page.route(url => url.pathname === '/api/houses', route => route.fulfill({ json: [
    { id: 225, address: detail.address, community: 'North Austin', stage: 'FOUNDATION',
      lat: detail.lat, lng: detail.lng },
    { id: 226, address: 'Other house', community: 'South Austin', stage: 'LAND_CLEARING',
      lat: detail.lat, lng: detail.lng },
  ] }))
  await page.route('**/api/houses/225', route => route.fulfill({ json: detail }))
  await page.route('**/api/houses/225/advance', route => {
    advanceRequests += 1
    return route.abort()
  })

  await page.goto('/houses/225')
  const progress = page.getByRole('region', { name: 'Construction progress' })
  await expect(progress.getByText('Satisfied')).toBeVisible()
  await expect(progress.getByText('Framing', { exact: true }).last()).toBeVisible()
  await expect(progress.getByRole('button', { name: /Advance/ })).toHaveCount(0)

  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await expect(progress.getByRole('button', { name: 'Advance to Framing' })).toBeEnabled()
  await progress.getByRole('button', { name: 'Advance to Framing' }).click()
  await expect(page.getByRole('dialog', { name: 'Advance construction stage?' })).toContainText('Foundation → Framing')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByLabel('Demo identity').selectOption('SITE_MANAGER')
  await page.getByLabel('Site Manager community').selectOption('South Austin')
  await expect(progress.getByRole('button', { name: /Advance/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Change community' }).click()
  await page.getByLabel('Site Manager community').selectOption('North Austin')
  await expect(progress.getByRole('button', { name: 'Advance to Framing' })).toBeEnabled()
  await page.getByLabel('Demo identity').selectOption('VIEWER')
  await expect(progress.getByRole('button', { name: /Advance/ })).toHaveCount(0)
  expect(advanceRequests).toBe(0)
})

test('Admin confirms once; detail and the preserved stage-filtered map reread backend data', async ({ page }) => {
  let stage = 'FOUNDATION'
  let writes = 0
  let detailReads = 0
  const listStages: Array<string | null> = []
  const detail = () => ({
    id: 225, permitNo: 'DEMO-225', address: 'Progress demo, Austin, TX', community: 'North Austin',
    lat: 30.2672, lng: -97.7431, stage, coverPhotoId: null, sourceType: 'MANUAL',
    sourceUrl: null, sourceFetchedAt: null, createdAt: null, createdBusinessDate: null,
    createdBy: 'demo', updatedAt: null, photos: [{ id: 1, houseId: 225, stage: 'FOUNDATION',
      locationStatus: 'UNKNOWN', takenAt: null, uploadedAt: null, businessDate: null, url: null }],
  })
  await page.route('**/api/**', route => route.abort())
  await page.route('**/api/houses*', route => {
    const requestedStage = new URL(route.request().url()).searchParams.get('stage')
    listStages.push(requestedStage)
    return route.fulfill({ json: requestedStage && requestedStage !== stage ? [] : [{
      id: 225, permitNo: 'DEMO-225', address: 'Progress demo, Austin, TX', community: 'North Austin',
      lat: 30.2672, lng: -97.7431, stage, coverPhotoUrl: null, lastPhotoBusinessDate: null,
    }] })
  })
  await page.route('**/api/houses/225', route => {
    detailReads += 1
    return route.fulfill({ json: detail() })
  })
  await page.route('**/api/houses/225/advance', route => {
    writes += 1
    expect(route.request().headers()['x-role']).toBe('ADMIN')
    expect(route.request().postDataJSON()).toEqual({ fromStage: 'FOUNDATION', toStage: 'FRAMING' })
    stage = 'FRAMING'
    return route.fulfill({ json: detail() })
  })

  await page.goto('/map')
  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await page.getByLabel('Construction stage').selectOption('FOUNDATION')
  await page.getByRole('button', { name: 'Open details for Progress demo, Austin, TX' }).click()
  const progress = page.getByRole('region', { name: 'Construction progress' })
  await progress.getByRole('button', { name: 'Advance to Framing' }).click()
  expect(writes).toBe(0)
  await page.getByRole('button', { name: 'Confirm advance' }).click()
  await expect(progress.getByText('Current stage', { exact: true }).locator('..')).toContainText('Framing')
  expect(writes).toBe(1)
  expect(detailReads).toBeGreaterThanOrEqual(2)
  await page.getByRole('link', { name: 'Back to map' }).click()
  await expect(page.getByRole('combobox', { name: 'Construction stage' })).toHaveValue('FOUNDATION')
  await expect(page.getByText('No houses match these filters.')).toBeVisible()
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0)
  expect(listStages.at(-1)).toBeNull()
  expect(writes).toBe(1)
})
