import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const tilePath = fileURLToPath(new URL('../fixtures/map-tile.svg', import.meta.url))
const houses = [
  { id: 11, address: '11 Main St', community: 'Austin Council District 8',
    stage: 'FOUNDATION', lat: 30.2672, lng: -97.7431 },
  { id: 12, address: '12 Main St', community: 'Austin Council District 5',
    stage: 'FRAMING', lat: 30.28, lng: -97.75 },
]
const detail = {
  ...houses[0], permitNo: 'P-11', coverPhotoId: null, sourceType: 'PUBLIC_DATA',
  sourceUrl: null, sourceFetchedAt: null, createdAt: null, createdBusinessDate: null,
  createdBy: null, updatedAt: null, photos: [],
}
const otherDetail = { ...detail, ...houses[1], id: 12, permitNo: 'P-12' }

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    path: tilePath, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
  }))
  await page.route('**/api/houses*', route => route.fulfill({
    json: houses,
  }))
  await page.route('**/api/houses/*', route => route.fulfill({
    json: new URL(route.request().url()).pathname === '/api/houses/12' ? otherDetail : detail,
  }))
})

test('Viewer switches to Admin on Overview and keeps Admin for map house data', async ({ page }) => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/houses')) {
      requests.push({ url: request.url(), headers: request.headers() })
    }
  })
  await page.goto('/')
  const identity = page.getByLabel('Demo identity')
  await expect(identity).toHaveValue('VIEWER')
  await identity.selectOption('ADMIN')
  await expect(identity).toHaveValue('ADMIN')
  await page.getByRole('main').getByRole('link', { name: 'Explore map' }).click()
  await expect(page).toHaveURL('/map')
  await expect(identity).toHaveValue('ADMIN')
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2)
  await expect(page.getByRole('status')).toContainText('2 houses in view · 2 map markers')
  await expect.poll(() => requests.some(request =>
    new URL(request.url).searchParams.has('minLat') && request.headers['x-role'] === 'ADMIN' &&
    request.headers['x-user'] === 'frontend-demo' && !('x-community' in request.headers))).toBe(true)
  await page.getByRole('button', { name: 'Open details for 11 Main St' }).click()
  await expect(page).toHaveURL('/houses/11')
  await expect(identity).toHaveValue('ADMIN')
  await expect(page.getByRole('heading', { name: '11 Main St', level: 1 })).toBeVisible()
  await expect.poll(() => requests.some(request => new URL(request.url).pathname === '/api/houses/11' &&
    request.headers['x-role'] === 'ADMIN' && !('x-community' in request.headers))).toBe(true)
  await page.reload()
  await expect(identity).toHaveValue('ADMIN')
  await expect(page).toHaveURL('/houses/11')
  await expect(page.getByRole('heading', { name: '11 Main St', level: 1 })).toBeVisible()
})

test('Site Manager uses a real community and Viewer drops the community header', async ({ page }) => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/houses')) {
      requests.push({ url: request.url(), headers: request.headers() })
    }
  })
  await page.goto('/map')
  await expect(page.getByRole('status')).toContainText('2 houses in view · 2 map markers')
  const identity = page.getByLabel('Demo identity')
  await identity.selectOption('SITE_MANAGER')
  await expect(identity).toHaveValue('VIEWER')
  await expect.poll(() => requests.some(request => new URL(request.url).search === '' &&
    request.headers['x-role'] === 'VIEWER')).toBe(true)
  await page.getByLabel('Site Manager community').selectOption('Austin Council District 8')
  await expect(identity).toHaveValue('SITE_MANAGER')
  await expect(page.getByRole('status')).toContainText('2 houses in view · 2 map markers')
  await expect.poll(() => requests.some(request => new URL(request.url).searchParams.has('minLat') &&
    request.headers['x-role'] === 'SITE_MANAGER' && request.headers['x-user'] === 'frontend-demo' &&
    request.headers['x-community'] === 'Austin Council District 8')).toBe(true)
  const requestCountBeforeViewer = requests.length
  await identity.selectOption('VIEWER')
  await expect(page).toHaveURL('/map')
  await expect(page.getByRole('status')).toContainText('2 houses in view · 2 map markers')
  await expect.poll(() => requests.slice(requestCountBeforeViewer).some(request => new URL(request.url).searchParams.has('minLat') &&
    request.headers['x-role'] === 'VIEWER' && !('x-community' in request.headers))).toBe(true)
  await page.getByRole('button', { name: 'Open details for 11 Main St' }).click()
  await expect(page).toHaveURL('/houses/11')
  await expect(identity).toHaveValue('VIEWER')
  await expect(page.getByRole('heading', { name: '11 Main St', level: 1 })).toBeVisible()
  await expect.poll(() => requests.slice(requestCountBeforeViewer).some(request =>
    new URL(request.url).pathname === '/api/houses/11' && request.headers['x-role'] === 'VIEWER' &&
    !('x-community' in request.headers))).toBe(true)
})

test('a delayed full-catalog Viewer response cannot replace Admin search results or reset the stage filter', async ({ page }) => {
  const holdViewer = true
  let releaseOld: (() => void) | undefined
  let oldQuery: string | undefined
  let adminQuery: string | undefined
  await page.route('**/api/houses*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/houses' || url.searchParams.has('minLat')) return route.fallback()
    const role = route.request().headers()['x-role']
    if (role === 'VIEWER' && holdViewer) {
      oldQuery = url.search
      await new Promise<void>(resolve => { releaseOld = resolve })
      try {
        await route.fulfill({ json: [{ ...houses[0], address: 'Old Viewer result' }] })
      } catch {
        // AbortController may cancel the old browser request before the mock is released.
      }
      return
    }
    if (role === 'ADMIN') {
      adminQuery = url.search
      await route.fulfill({ json: [{ ...houses[0], address: 'Latest Admin result' }] })
      return
    }
    await route.fulfill({ json: houses })
  })
  await page.goto('/map')
  await expect(page.getByRole('status')).toContainText('2 houses in view · 2 map markers')
  await page.getByLabel('Construction stage').selectOption('FOUNDATION')
  await expect.poll(() => oldQuery).toBeDefined()
  await page.getByLabel('Demo identity').selectOption('ADMIN')
  await expect(page.getByRole('button', { name: 'View Latest Admin result' })).toBeVisible()
  expect(adminQuery).toBe(oldQuery)
  expect(adminQuery).toBe('')
  releaseOld?.()
  await expect(page.getByRole('button', { name: 'View Old Viewer result' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Construction stage' })).toHaveValue('FOUNDATION')
  await expect(page.getByRole('status')).toContainText('1 house found · 1 map marker')
})

test('create entry and upload hint follow Admin, Viewer and exact Site Manager ownership', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') {
      writes.push(`${request.method()} ${request.url()}`)
    }
  })
  await page.goto('/map')
  await expect(page.getByRole('button', { name: 'View 11 Main St' })).toBeVisible()
  const identity = page.getByLabel('Demo identity')
  await identity.selectOption('ADMIN')
  await expect(page.getByRole('link', { name: 'Add house' })).toHaveAttribute('href', '/houses/new')
  await page.getByRole('button', { name: 'Open details for 11 Main St' }).click()
  await expect(page).toHaveURL('/houses/11')
  const upload = page.getByRole('button', { name: 'Upload photo' })
  await expect(upload).toBeEnabled()
  await expect(page.getByRole('list', { name: 'House photo history' }).getByRole('listitem').last())
    .toContainText('Upload photo')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await identity.selectOption('VIEWER')
  await expect(page.getByRole('heading', { name: '11 Main St', level: 1 })).toBeVisible()
  await expect(upload).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to map' }).click()
  await page.getByRole('button', { name: 'Back to list' }).click()
  await expect(page.getByRole('link', { name: /Add house/ })).toHaveCount(0)

  await identity.selectOption('SITE_MANAGER')
  await page.getByLabel('Site Manager community').selectOption('Austin Council District 8')
  await expect(identity).toHaveValue('SITE_MANAGER')
  await expect(page.getByRole('link', { name: /Add house/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open details for 11 Main St' }).click()
  await expect(upload).toBeEnabled()
  await page.getByRole('link', { name: 'Back to map' }).click()
  await page.getByRole('button', { name: 'Back to list' }).click()
  await page.getByRole('button', { name: 'Open details for 12 Main St' }).click()
  await expect(page.getByRole('heading', { name: '12 Main St', level: 1 })).toBeVisible()
  await expect(upload).toHaveCount(0)
  expect(writes).toEqual([])
})
