import { test, expect } from './fixtures'
import { startTranslation, stopTranslation, configureMockProvider } from './helpers'

test('content script translates page', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const translatedEl = page.locator('.imp-translate-result:not(.imp-translate-loading)').first()
  await expect(translatedEl).toBeVisible({ timeout: 15000 })

  const text = await translatedEl.textContent()
  expect(text).toBeTruthy()
  expect(text).toContain('[翻译]')

  await expect(page.locator('h1').first()).toContainText('Home Page')
})

test('content script restores original page', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  await stopTranslation(page)

  await expect(page.locator('.imp-translate-result')).toHaveCount(0)
  await expect(page.locator('h1')).toContainText('Home Page')
})
