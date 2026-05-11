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
