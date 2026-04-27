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

test('translates content revealed by inner container scroll', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/inner-scroll`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  const bottomMsg = page.locator('#bottom-msg')
  await expect(bottomMsg.locator('.imp-translate-result')).toHaveCount(0)

  await page.evaluate(() => {
    const container = document.getElementById('scroll-container')!
    container.scrollTop = container.scrollHeight
  })

  const bottomTranslation = bottomMsg.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(bottomTranslation).toBeVisible({ timeout: 15000 })
  await expect(bottomTranslation).toContainText('[翻译]')
})

test('re-translates when text content changes dynamically', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/dynamic-text`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const tweet = page.locator('#tweet')
  const result = tweet.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(result).toBeVisible({ timeout: 15000 })

  const firstTranslation = await result.textContent()
  expect(firstTranslation).toContain('[翻译] This is a truncated message')

  await page.waitForTimeout(1000)
  await page.click('#show-more')

  await expect(result).toContainText('after expanding', { timeout: 15000 })
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
