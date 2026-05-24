import { test, expect } from './fixtures'
import { startTranslation, configureMockProvider } from './helpers'

const TRANSLATED_SELECTOR = '.imp-translate-result:not(.imp-translate-loading)'

test('translates content inside a large iframe', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/with-iframes`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const frame = page.frameLocator('#large-iframe')
  await expect(frame.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })
})

test('translates content inside a dynamically added iframe', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/with-iframes`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const largeFrame = page.frameLocator('#large-iframe')
  await expect(largeFrame.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await page.locator('#add-iframe').click()

  const dynamicFrame = page.frameLocator('#dynamic-iframe')
  await expect(dynamicFrame.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })
})

test('reload stops translation in iframes too (no stale re-translate)', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/with-iframes`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const largeFrame = page.frameLocator('#large-iframe')
  await expect(largeFrame.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  // Reload: this stops translation (the reload-stop behavior). The iframe's
  // sub-frame onDOMContentLoaded handler must NOT read a stale session key
  // and re-translate. Regression guard for the cross-frame reload race.
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  // Give any erroneous (stale) translation a chance to appear, then assert
  // neither the main page nor the iframe got translated.
  await page.waitForTimeout(2000)
  await expect(page.locator(TRANSLATED_SELECTOR)).toHaveCount(0)
  await expect(largeFrame.locator(TRANSLATED_SELECTOR)).toHaveCount(0)
})

test('skips translation inside a tiny iframe', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/with-iframes`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  // Wait for the large iframe to confirm translation is running
  const largeFrame = page.frameLocator('#large-iframe')
  await expect(largeFrame.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  const tinyFrame = page.frameLocator('#tiny-iframe')
  await expect(tinyFrame.locator('.imp-translate-result')).toHaveCount(0)
})
