import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const tilePath = fileURLToPath(new URL('../fixtures/map-tile.svg', import.meta.url))
const existing = { id: 11, address: '11 Main St', community: 'Austin Council District 8',
  permitNo: 'P-11', stage: 'FOUNDATION', lat: 30.2672, lng: -97.7431 }

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    path: tilePath, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
  }))
  await page.route('**/api/houses*', route => route.fulfill({ json: [existing] }))
})

test('Admin creates a house through D and opens its independent C detail', async ({ page }) => {
  const writes: Array<{ method: string; headers: Record<string, string>; body: unknown }> = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/houses' && request.method() === 'POST') {
      writes.push({ method: request.method(), headers: request.headers(), body: request.postDataJSON() })
    }
  })
  await page.route('**/api/houses', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { id: 81 } })
    return route.fallback()
  })
  await page.route('**/api/houses/81', route => route.fulfill({ json: {
    id: 81, permitNo: 'P-81', address: '81 Main St', community: 'Austin Council District 8',
    lat: 30.2672, lng: -97.7431, stage: 'LAND_CLEARING', coverPhotoId: null,
    sourceType: 'MANUAL', sourceUrl: null, sourceFetchedAt: null, createdAt: null,
    createdBusinessDate: null, createdBy: 'frontend-demo', updatedAt: null, photos: [],
  } }))
  await page.goto('/map')
  await expect(page.getByRole('button', { name: 'View 11 Main St' })).toBeVisible()
  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await page.getByRole('link', { name: 'Add house' }).click()
  await expect(page).toHaveURL('/houses/new')
  await page.getByLabel(/Permit number/).fill('P-81')
  await page.getByLabel(/^Address/).fill('81 Main St')
  await page.getByLabel(/Community \/ administrative area/).fill('Austin Council District 8')
  await page.getByLabel('Latitude').fill('30.2672')
  await page.getByLabel('Longitude').fill('-97.7431')
  await page.getByRole('button', { name: 'Create house' }).click()
  await expect(page).toHaveURL('/houses/81')
  await expect(page.getByRole('heading', { level: 1, name: '81 Main St' })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]?.headers['x-role']).toBe('ADMIN')
  expect(writes[0]?.headers['x-user']).toBe('frontend-demo')
  expect(writes[0]?.headers['x-community']).toBeUndefined()
  expect(writes[0]?.body).toMatchObject({ permitNo: 'P-81', address: '81 Main St',
    community: 'Austin Council District 8', lat: 30.2672, lng: -97.7431 })
})

test('Viewer and Site Manager cannot submit from a direct D URL', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/houses') writes.push(request.url())
  })
  await page.goto('/houses/new')
  await expect(page.getByRole('alert')).toContainText('Only Admin can add houses')
  await expect(page.getByRole('button', { name: 'Create house' })).toHaveCount(0)
  await page.getByLabel('Demo identity').selectOption('SITE_MANAGER')
  await page.getByLabel('Site Manager community').selectOption('Austin Council District 8')
  await expect(page.getByRole('alert')).toContainText('Only Admin can add houses')
  await expect(page.getByRole('button', { name: 'Create house' })).toHaveCount(0)
  expect(writes).toEqual([])
})

test('HTTP 200 keeps D open until Admin chooses the existing house', async ({ page }) => {
  let posts = 0
  await page.route('**/api/houses', route => {
    if (route.request().method() === 'POST') {
      posts += 1
      return route.fulfill({ status: 200, json: { id: 11 } })
    }
    return route.fallback()
  })
  await page.route('**/api/houses/11', route => route.fulfill({ json: {
    ...existing, coverPhotoId: null, sourceType: 'MANUAL', sourceUrl: null,
    sourceFetchedAt: null, createdAt: null, createdBusinessDate: null,
    createdBy: null, updatedAt: null, photos: [],
  } }))
  await page.goto('/houses/new')
  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await page.getByLabel(/Permit number/).fill('P-11')
  await page.getByLabel(/^Address/).fill('11 Main St')
  await page.getByLabel(/Community \/ administrative area/).fill('Austin Council District 8')
  await page.getByRole('button', { name: 'Create house' }).click()
  const warning = page.getByRole('alert', { name: 'House already exists' })
  await expect(warning).toContainText('A house with this permit number already exists. No new house was created.')
  await expect(page).toHaveURL('/houses/new')
  await expect(page.getByRole('button', { name: 'Create house' })).toBeDisabled()
  await expect(page.getByLabel(/Permit number/)).toHaveValue('P-11')
  expect(posts).toBe(1)
  await page.getByRole('button', { name: 'View existing house' }).click()
  await expect(page).toHaveURL('/houses/11')
  await expect(page.getByRole('heading', { level: 1, name: '11 Main St' })).toBeVisible()
  expect(posts).toBe(1)
})
