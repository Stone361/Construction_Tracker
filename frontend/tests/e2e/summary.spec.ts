import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const tilePath = fileURLToPath(new URL('../fixtures/map-tile.svg', import.meta.url))
const counts = { LAND_CLEARING: 1, FOUNDATION: 2, FRAMING: 0, MEP: 0, INTERIOR: 0, CO_READY: 0 }
const houses = [
  { id: 11, address: '11 Main St', permitNo: 'P-11', community: 'Austin Council District 8',
    stage: 'FOUNDATION', lat: 30.2672, lng: -97.7431 },
  { id: 12, address: '12 No Map St', permitNo: 'P-12', community: 'Austin Council District 5',
    stage: 'LAND_CLEARING', lat: null, lng: null },
  { id: 13, address: '13 Other St', permitNo: 'P-13', community: 'Austin Council District 8',
    stage: 'FOUNDATION', lat: 30.28, lng: -97.75 },
]

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    path: tilePath, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
  }))
  await page.route('**/api/summary', route => route.fulfill({
    json: { stageCounts: counts, staleHouseIds: [11, 12] },
  }))
  await page.route(url => url.pathname === '/api/houses', route => route.fulfill({ json: houses }))
  await page.route('**/api/houses/12', route => route.fulfill({ json: {
    ...houses[1], coverPhotoId: null, sourceType: 'MANUAL', sourceUrl: null,
    sourceFetchedAt: null, createdAt: null, createdBusinessDate: null,
    createdBy: null, updatedAt: null, photos: [],
  } }))
})

test('Summary is default, maps only attention houses, and keeps the set while navigating', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  let summaryReads = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/summary') summaryReads += 1
  })
  await page.goto('/map')
  await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Total houses').locator('..')).toContainText('3')
  await expect(page.getByText('Needs attention', { exact: true }).locator('..')).toContainText('2')
  await expect(page.getByRole('list', { name: 'Needs Attention houses' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)
  await expect(page.locator('.leaflet-marker-icon[title="House 11"]')).toBeVisible()
  await expect(page.getByText('No new site photos in over 14 days.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open details for 11 Main St' })).toHaveText('Open details →')
  await page.getByRole('button', { name: 'View 11 Main St' }).click()
  await expect(page.locator('.leaflet-marker-icon[title="House 11"]')).toHaveClass(/selected/)
  await expect(page.locator('.leaflet-popup-content')).toContainText('11 Main St')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)
  const readsBeforePan = summaryReads
  const bounds = await page.locator('.leaflet-container').boundingBox()
  if (!bounds) throw new Error('Map bounds unavailable')
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y + 60, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)
  expect(summaryReads).toBe(readsBeforePan)
  await page.getByRole('button', { name: 'Open details for 12 No Map St' }).click()
  await expect(page).toHaveURL('/houses/12')
  await expect(page.getByRole('heading', { name: '12 No Map St', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Back to map' }).click()
  await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true')
  expect(pageErrors).toEqual([])
})

test('all demo roles can read Summary and Explorer filters survive tab switches', async ({ page }) => {
  const summaryRoles: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/summary') summaryRoles.push(request.headers()['x-role'] ?? '')
  })
  await page.goto('/map')
  await expect(page.getByText('Total houses')).toBeVisible()
  await page.getByRole('tab', { name: 'House Explorer' }).click()
  await page.getByLabel('Construction stage').selectOption('FOUNDATION')
  await expect(page.getByRole('status')).toContainText('2 houses found · 2 map markers')
  await page.getByRole('tab', { name: 'Summary' }).click()
  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await expect(page.getByText('Total houses')).toBeVisible()
  await page.getByLabel('Demo identity').selectOption('SITE_MANAGER')
  await page.getByLabel('Site Manager community').selectOption('Austin Council District 8')
  await expect(page.getByText('Total houses')).toBeVisible()
  await page.getByRole('tab', { name: 'House Explorer' }).click()
  await expect(page.getByLabel('Construction stage')).toHaveValue('FOUNDATION')
  await expect.poll(() => summaryRoles).toContain('SITE_MANAGER')
  expect(summaryRoles).toContain('VIEWER')
  expect(summaryRoles).toContain('ADMIN')
})

test('tab switches and Reset view clear marker selection and popup without clearing Explorer filters', async ({ page }) => {
  await page.goto('/map')
  const warningMarker = page.locator('.leaflet-marker-icon[title="House 11"]')
  await expect(warningMarker).toBeVisible()
  await expect(warningMarker).not.toHaveClass(/selected/)
  await expect(page.locator('.leaflet-popup')).toHaveCount(0)

  await page.getByRole('tab', { name: 'House Explorer' }).click()
  await page.getByLabel('Construction stage').selectOption('FOUNDATION')
  await page.getByRole('button', { name: 'View 13 Other St' }).click()
  await page.getByRole('tab', { name: 'Summary' }).click()
  await expect(warningMarker).not.toHaveClass(/selected/)
  await expect(page.locator('.leaflet-popup')).toHaveCount(0)
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)

  await page.getByRole('button', { name: 'View 11 Main St' }).click()
  await expect(warningMarker).toHaveClass(/selected/)
  await expect(page.locator('.leaflet-popup-content')).toContainText('11 Main St')
  await page.getByRole('button', { name: 'Reset view' }).click()
  await expect(warningMarker).not.toHaveClass(/selected/)
  await expect(page.locator('.leaflet-popup')).toHaveCount(0)

  await page.getByRole('tab', { name: 'House Explorer' }).click()
  await expect(page.getByLabel('Construction stage')).toHaveValue('FOUNDATION')
  await expect(page.locator('.leaflet-marker-icon[title="House 13"]')).not.toHaveClass(/selected/)
})
