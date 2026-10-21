import { expect, test } from '@playwright/test'

test('opens the workspace without backend services', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Construction Tracker')
  await expect(page.getByRole('heading', { level: 1, name: 'Construction Tracker' })).toBeVisible()
  await expect(page.getByText('Map and project tools are coming soon.')).toBeVisible()
})

test('recovers from an unknown URL', async ({ page }) => {
  await page.goto('/missing-page')
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Return to workspace' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Construction Tracker' })).toBeVisible()
})
