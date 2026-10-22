import { fileURLToPath } from 'node:url'
import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

const tilePattern = 'https://tile.openstreetmap.org/**'
const tilePath = fileURLToPath(new URL('../fixtures/map-tile.svg', import.meta.url))
const tileResponse = { path: tilePath, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' } }

// Automated map tests use local tiles and controlled API responses.
const test = base.extend<{ networkGuard: void }>({
  networkGuard: [async ({ page }, use) => {
    const apiHeaders: Array<Record<string, string>> = []
    const leakedHeaders: string[] = []
    const runtimeErrors: string[] = []
    page.on('pageerror', error => runtimeErrors.push(error.message))
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiHeaders.push(request.headers())
      if (request.url().startsWith('https://tile.openstreetmap.org/')) {
        leakedHeaders.push(...Object.keys(request.headers()).filter(name => /^x-(user|role|community)(-|$)|^authorization$/i.test(name)))
      }
    })
    await page.route(tilePattern, route => route.fulfill(tileResponse))
    await page.route('**/api/houses*', route => route.fulfill({ json: [] }))
    await use()
    for (const headers of apiHeaders) {
      expect(headers['x-user']).toBe('frontend-demo')
      expect(headers['x-role']).toBe('VIEWER')
      expect(headers['x-community']).toBeUndefined()
    }
    expect(leakedHeaders, 'tiles must not receive business identity').toEqual([])
    expect(runtimeErrors, 'no uncaught browser errors').toEqual([])
  }, { auto: true }],
})

async function expectZoom(page: Page, zoom: number) {
  // Leaflet keeps cached levels; the active level has the highest z-index (maxZoom = 19).
  await expect(page.locator(`.leaflet-tile-container[style*="z-index: 19;"] img.leaflet-tile-loaded[src*="/${zoom}/"]`).first()).toBeVisible()
  await expect(page.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/)
}

async function expectAustinCentered(page: Page) {
  // Reconstruct the projected Austin position from the real tile coordinates.
  // This verifies Leaflet's internal size, not only the CSS container size.
  await expect.poll(() => page.locator('.leaflet-container').evaluate(element => {
    const tile = element.querySelector<HTMLImageElement>('.leaflet-tile-container[style*="z-index: 19;"] .leaflet-tile-loaded')
    const match = tile?.src.match(/\/(\d+)\/(\d+)\/(\d+)\.png/)
    if (!tile || !match) return 10000
    const zoom = Number(match[1]), x = Number(match[2]), y = Number(match[3])
    const scale = 256 * 2 ** zoom
    const projectedX = (1 + -97.7431 / 180) / 2 * scale
    const sin = Math.sin(30.2672 * Math.PI / 180)
    const projectedY = (1 - Math.log((1 + sin) / (1 - sin)) / (2 * Math.PI)) / 2 * scale
    const tileRect = tile.getBoundingClientRect(), mapRect = element.getBoundingClientRect()
    return Math.max(Math.abs(tileRect.left + projectedX - x * 256 - (mapRect.left + mapRect.width / 2)), Math.abs(tileRect.top + projectedY - y * 256 - (mapRect.top + mapRect.height / 2)))
  })).toBeLessThan(2)
}

test('landing page has honest search feedback and keyboard map navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Construction Tracker')
  await expect(page.getByRole('heading', { level: 1, name: /A clearer view of/ })).toBeVisible()
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible()
  await expect(page.getByText('Coming soon', { exact: true })).toBeVisible()
  const input = page.getByRole('searchbox', { name: 'City or ZIP code' })
  await input.focus()
  await expect(input).toBeFocused()
  await input.fill('Seattle 98101')
  await input.press('Enter')
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('status')).toContainText('Location search isn’t available yet.')
  await expect(page.getByRole('status')).toContainText('regardless of this input')
  await expect(input).toHaveValue('Seattle 98101')
  const explore = page.getByRole('main').getByRole('link', { name: 'Explore map' })
  await explore.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/map')
  await expect(page.getByRole('heading', { name: 'Austin, Texas', level: 1 })).toBeVisible()
  await expectZoom(page, 12)
  await expect(page.getByRole('status')).toContainText('No houses in the current map view.')
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0)
})

test('map zoom buttons, wheel, dragging and reset change the real Leaflet view', async ({ page }) => {
  await page.goto('/map')
  await expect(page.getByRole('region', { name: 'Interactive map of Austin, Texas' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible()
  await expectZoom(page, 12)
  await expectAustinCentered(page)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expectZoom(page, 13)
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expectZoom(page, 12)
  const bounds = await page.locator('.leaflet-container').boundingBox()
  if (!bounds) throw new Error('Map must have visible bounds')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, -180)
  await expectZoom(page, 13)
  const pane = page.locator('.leaflet-map-pane')
  const beforePan = await pane.getAttribute('style')
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 150, bounds.y + bounds.height / 2 + 80, { steps: 15 })
  await page.mouse.up()
  await expect.poll(() => pane.getAttribute('style')).not.toBe(beforePan)
  await page.getByRole('button', { name: 'Reset view' }).click()
  await expectZoom(page, 12)
  await expectAustinCentered(page)
})

test('landing keeps the main entry visible on short desktop and narrow screens', async ({ page }) => {
  await page.goto('/')
  for (const viewport of [{ width: 1318, height: 580 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const explore = page.getByRole('main').getByRole('link', { name: 'Explore map' })
    await expect(explore).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('searchbox', { name: 'City or ZIP code' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
  }
})

test('map handles container-only resizing and responsive viewport changes', async ({ page }) => {
  await page.goto('/map')
  await expectZoom(page, 12)
  const canvas = page.locator('.leaflet-container')
  // No window resize event: ResizeObserver must update Leaflet's size.
  await canvas.evaluate(element => { element.style.width = '640px' })
  await expect(canvas).toHaveJSProperty('clientWidth', 640)
  await expectAustinCentered(page)
  await canvas.evaluate(element => { element.style.width = '' })
  await expectAustinCentered(page)
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    if (viewport.width > 720) {
      await expect.poll(() => canvas.evaluate(element => element.clientWidth)).toBeCloseTo(viewport.width * .6, 0)
    } else {
      await expect.poll(() => canvas.evaluate(element => element.clientWidth)).toBe(viewport.width)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    await expectAustinCentered(page)
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible()
    const headerHeight = await page.getByRole('banner').evaluate(element => element.getBoundingClientRect().height)
    if (viewport.width > 720) {
      await expect.poll(() => canvas.evaluate(element => element.clientHeight)).toBe(viewport.height - headerHeight)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height)
    } else {
      await expect.poll(() => canvas.evaluate(element => element.clientHeight)).toBeGreaterThan(300)
    }
  }
})

test('house cards and map markers share one selection while a card focus updates the map bounds', async ({ page }) => {
  let requests = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/houses') requests += 1
  })
  await page.route('**/api/houses*', route => route.fulfill({ json: [
    { id: 11, address: '11 Main St', permitNo: 'P-11', community: 'Austin Council District 8',
      stage: 'FOUNDATION', lastPhotoBusinessDate: '2026-10-20', lat: 30.2672, lng: -97.7431 },
    { id: 12, address: '12 Main St', permitNo: 'P-12', community: 'Austin Council District 5',
      stage: 'FRAMING', lastPhotoBusinessDate: '2026-10-21', lat: 30.3, lng: -97.7 },
  ] }))
  await page.goto('/map')
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2)
  await expect(page.getByRole('status')).toContainText('2 houses in view · 2 map markers')
  const list = page.getByRole('list', { name: 'House cards' })
  await expect(list.getByRole('button').first()).toHaveAttribute('aria-label', 'View 12 Main St')
  await page.locator('.leaflet-marker-icon[title="House 11"]').click()
  await expect(page.getByRole('heading', { name: '11 Main St' })).toBeVisible()
  await expect(page.locator('.leaflet-marker-icon[title="House 11"]')).toHaveClass(/selected/)
  await page.locator('.leaflet-marker-icon[title="House 12"]').click()
  await expect(page.getByRole('heading', { name: '12 Main St' })).toBeVisible()
  await expect(page.locator('.leaflet-marker-icon[title="House 12"]')).toHaveClass(/selected/)
  await page.getByRole('button', { name: 'Back to list' }).click()
  await list.getByRole('button', { name: 'View 12 Main St' }).click()
  await expectZoom(page, 14)
  await expect(page.getByRole('heading', { name: '12 Main St' })).toBeVisible()
  await expect.poll(() => page.locator('.leaflet-marker-icon[title="House 12"]').evaluate(element => {
    const marker = element.getBoundingClientRect()
    const map = element.closest('.leaflet-container')?.getBoundingClientRect()
    if (!map) return 10000
    return Math.max(Math.abs(marker.left + marker.width / 2 - (map.left + map.width / 2)),
      Math.abs(marker.top + marker.height / 2 - (map.top + map.height / 2)))
  })).toBeLessThan(2)
  const mapPosition = await page.locator('.leaflet-map-pane').getAttribute('style')
  await page.getByRole('button', { name: 'Back to list' }).click()
  await expect(page.locator('.leaflet-map-pane')).toHaveAttribute('style', mapPosition ?? '')
  expect(requests).toBeGreaterThan(0)
  expect(requests).toBeLessThanOrEqual(4) // Initial query, StrictMode retry and one card-driven map move.
})

test('full-catalog filters stay independent of map bounds and clearing restores bounded browsing', async ({ page }) => {
  const queries: URL[] = []
  await page.route('**/api/houses*', route => {
    const url = new URL(route.request().url())
    queries.push(url)
    const inView = { id: 11, address: '8023 NW St', community: 'Austin Council District 8', stage: 'FOUNDATION', lat: 30.2672, lng: -97.7431 }
    const remote = { id: 12, address: '8023 SW St', community: 'Austin Council District 5', stage: 'FRAMING', lat: 40.3, lng: -100.7 }
    const noCoordinates = { id: 13, address: '8023 No Coordinates', community: 'Austin Council District 5', stage: 'FRAMING', lat: null, lng: null }
    return route.fulfill({ json: url.searchParams.has('minLat') ? [inView] : [inView, remote, noCoordinates] })
  })
  await page.goto('/map')
  await expect(page.getByRole('status')).toContainText('1 house in view · 1 map marker')
  await expect(page.getByLabel('Community / Area').locator('option')).toHaveCount(3)
  const initial = queries.find(query => query.searchParams.has('minLat'))
  const beforeFilters = queries.length
  expect(initial?.searchParams.has('bbox')).toBe(false)
  for (const name of ['minLat', 'maxLat', 'minLng', 'maxLng']) {
    expect(Number.isFinite(Number(initial?.searchParams.get(name)))).toBe(true)
  }
  expect(initial?.searchParams.has('stage')).toBe(false)
  await page.getByRole('searchbox', { name: 'Search address' }).fill('8023')
  await expect(page.getByRole('status')).toContainText('3 houses found · 2 map markers')
  await expect(page.getByRole('button', { name: 'View 8023 SW St' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View 8023 No Coordinates' })).toBeVisible()
  await page.getByLabel('Community / Area').selectOption('Austin Council District 5')
  await expect(page.getByRole('status')).toContainText('2 houses found · 1 map marker')
  await expect(page.getByRole('button', { name: 'View 8023 SW St' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View 8023 NW St' })).toHaveCount(0)
  await page.getByLabel('Construction stage').selectOption('FOUNDATION')
  await expect(page.getByRole('status')).toContainText('No houses match these filters.')
  await page.getByLabel('Construction stage').selectOption('FRAMING')
  await expect(page.getByRole('status')).toContainText('2 houses found · 1 map marker')
  await page.getByRole('searchbox', { name: 'Search address' }).fill('SW ST')
  await expect(page.getByRole('status')).toContainText('1 house found · 1 map marker')
  expect(queries).toHaveLength(beforeFilters)
  expect(queries.every(query => !query.searchParams.has('stage'))).toBe(true)

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const mapBounds = await page.locator('.leaflet-container').boundingBox()
  if (!mapBounds) throw new Error('Map must have visible bounds')
  const x = mapBounds.x + mapBounds.width / 2
  const y = mapBounds.y + mapBounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 160, y + 70, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByRole('status')).toContainText('1 house found · 1 map marker')
  await page.waitForTimeout(200)
  expect(queries).toHaveLength(beforeFilters)

  await page.getByLabel('Construction stage').selectOption('')
  await page.getByLabel('Community / Area').selectOption('')
  await page.getByRole('searchbox', { name: 'Search address' }).fill('')
  await expect(page.getByRole('status')).toContainText('1 house in view · 1 map marker')
  await expect.poll(() => queries.length).toBeGreaterThan(beforeFilters)
  expect(queries.at(-1)?.searchParams.get('minLat')).not.toBe(initial?.searchParams.get('minLat'))
})

test('long house list scrolls inside the right pane while the page and title stay fixed', async ({ page }) => {
  await page.route('**/api/houses*', route => route.fulfill({ json: Array.from({ length: 12 }, (_, index) => ({
    id: index + 1, address: `${index + 1} Main St`, community: 'Austin Council District 8',
    lastPhotoBusinessDate: null, lat: 30.2 + index / 100, lng: -97.8,
  })) }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/map')
  const list = page.getByRole('list', { name: 'House cards' })
  await expect(list.getByRole('listitem')).toHaveCount(12)
  const before = await page.getByRole('heading', { name: 'House Explorer' }).boundingBox()
  const body = list.locator('..')
  expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await body.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(list.getByRole('button', { name: 'View 12 Main St' })).toBeInViewport()
  const after = await page.getByRole('heading', { name: 'House Explorer' }).boundingBox()
  expect(after?.y).toBe(before?.y)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900)
})

test('backend failure is visible and can be retried', async ({ page }) => {
  let unavailable = true
  await page.route('**/api/houses*', route => unavailable
    ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } })
    : route.fulfill({ json: [] }))
  await page.goto('/map')
  await expect(page.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0)
  unavailable = false
  await page.getByRole('button', { name: 'Retry house data' }).click()
  await expect(page.getByRole('status')).toContainText('No houses in the current map view.')
})

test('map survives refresh, home navigation and browser back/forward', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('main').getByRole('link', { name: 'Explore map' }).click()
  await expect(page).toHaveURL('/map')
  await page.reload()
  await expectZoom(page, 12)
  await page.getByRole('link', { name: 'Back to home' }).click()
  await expect(page).toHaveURL('/')
  await page.goBack()
  await expect(page).toHaveURL('/map')
  await expect(page.getByRole('heading', { name: 'Austin, Texas', level: 1 })).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('searchbox', { name: 'City or ZIP code' })).toBeVisible()
})

test('tile failures show an explicit error and can be retried', async ({ page }) => {
  let failTiles = true
  await page.route(tilePattern, route => failTiles ? route.abort('failed') : route.fulfill(tileResponse))
  await page.goto('/map')
  await expect(page.getByRole('alert')).toContainText('Map tiles couldn’t load.')
  await expect(page.getByRole('button', { name: 'Retry map tiles' })).toBeVisible()
  failTiles = false
  await page.getByRole('button', { name: 'Retry map tiles' }).click()
  await expectZoom(page, 12)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Loading map…')).toHaveCount(0)
})

test('recovers from an unknown URL', async ({ page }) => {
  await page.goto('/missing-page')
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Return to workspace' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { level: 1, name: /A clearer view of/ })).toBeVisible()
})
