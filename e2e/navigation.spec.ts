import { test, expect } from './fixtures'
import { startTranslation, stopTranslation, getServiceWorker, configureMockProvider } from './helpers'

const TRANSLATED_SELECTOR = '.imp-translate-result:not(.imp-translate-loading)'

test('link click preserves translation', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await page.locator('#link-page2').click()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })
})

test('page reload clears translation', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await page.reload({ waitUntil: 'domcontentloaded' })

  await page.waitForTimeout(3000)
  await expect(page.locator('.imp-translate-result')).toHaveCount(0)
})

test('typed URL clears translation', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  // page.goto simulates typed navigation
  await page.goto(`${baseURL}/page3`)
  await page.waitForLoadState('domcontentloaded')

  await page.waitForTimeout(3000)
  await expect(page.locator('.imp-translate-result')).toHaveCount(0)
})

test('back/forward preserves translation', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await page.locator('#link-page2').click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })
})

test('translation state is saved on start and cleared on stop', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  const sw = await getServiceWorker(context)
  const tabId = await sw.evaluate(async (pattern) => {
    const tabs = await chrome.tabs.query({ url: `${pattern}/*` })
    return tabs[0]?.id
  }, baseURL)

  await configureMockProvider(page, baseURL)
  await startTranslation(page, 'zh')

  await page.waitForTimeout(200)
  const stateAfterStart = await sw.evaluate(async (tabId) => {
    const key = `tab_translating_${tabId}`
    const result = await chrome.storage.session.get(key)
    return result[key] ?? null
  }, tabId)
  expect(stateAfterStart).toBe('zh')

  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await stopTranslation(page)
  await page.waitForTimeout(200)

  const stateAfterStop = await sw.evaluate(async (tabId) => {
    const key = `tab_translating_${tabId}`
    const result = await chrome.storage.session.get(key)
    return result[key] ?? null
  }, tabId)
  expect(stateAfterStop).toBeNull()
})

test('SPA navigation continues translation', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await page.evaluate(() => {
    history.pushState(null, '', '/new-page')
    document.querySelector('h1')!.textContent = 'New Page Title'
    document.querySelector('p')!.textContent =
      'This is new content after SPA navigation.'
  })

  await expect(page.locator('.imp-translate-result').first()).toBeVisible({
    timeout: 15000,
  })
})

test('bfcache restore cleans up after stop', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator(TRANSLATED_SELECTOR).first()).toBeVisible({
    timeout: 15000,
  })

  await page.locator('#link-page2').click()
  await page.waitForLoadState('domcontentloaded')

  await stopTranslation(page)
  await page.waitForTimeout(200)

  await page.goBack({ waitUntil: 'domcontentloaded' })

  await expect(page.locator('.imp-translate-result')).toHaveCount(0, {
    timeout: 5000,
  })
})
