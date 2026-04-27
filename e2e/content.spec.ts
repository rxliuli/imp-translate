import { test, expect } from './fixtures'
import { startTranslation, stopTranslation } from './helpers'

test('content script translates page via Microsoft Translator', async ({
  context,
}) => {
  const page = await context.newPage()
  await page.goto('https://example.com')
  await page.waitForLoadState('domcontentloaded')

  await startTranslation(page)

  const translatedEl = page.locator('.imp-translate-result:not(.imp-translate-loading)').first()
  await expect(translatedEl).toBeVisible({ timeout: 15000 })

  const text = await translatedEl.textContent()
  expect(text).toBeTruthy()
  expect(text!.length).toBeGreaterThan(0)

  await expect(page.locator('h1').first()).toContainText('Example Domain')
})

test('content script restores original page', async ({ context }) => {
  const page = await context.newPage()
  await page.goto('https://example.com')
  await page.waitForLoadState('domcontentloaded')

  await startTranslation(page)
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  await stopTranslation(page)

  await expect(page.locator('.imp-translate-result')).toHaveCount(0)
  await expect(page.locator('h1')).toContainText('Example Domain')
})
