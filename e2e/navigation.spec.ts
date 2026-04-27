import { test, expect } from './fixtures'
import { startTranslation, stopTranslation, getServiceWorker } from './helpers'

test('translation persists across full page navigation', async ({
  context,
}) => {
  const page = await context.newPage()
  await page.goto('https://example.com')
  await page.waitForLoadState('domcontentloaded')

  await startTranslation(page)
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  // Navigate to a different page in the same tab
  await page.goto('https://www.iana.org/help/example-domains')
  await page.waitForLoadState('domcontentloaded')

  // Translation should auto-resume on the new page
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })
})

test('translation state is saved immediately on start', async ({
  context,
}) => {
  const page = await context.newPage()
  await page.goto('https://example.com')
  await page.waitForLoadState('domcontentloaded')

  const sw = await getServiceWorker(context)
  const tabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url })
    return tabs[0]?.id
  }, 'https://example.com/')

  // Start translation
  await startTranslation(page, 'zh')

  // State should be saved immediately (not after translation completes)
  await page.waitForTimeout(200)
  const state = await sw.evaluate(async (tabId) => {
    const key = `tab_translating_${tabId}`
    const result = await chrome.storage.session.get(key)
    return result[key] ?? null
  }, tabId)
  expect(state).toBe('zh')
})

test('translation state is cleared on stop', async ({ context }) => {
  const page = await context.newPage()
  await page.goto('https://example.com')
  await page.waitForLoadState('domcontentloaded')

  const sw = await getServiceWorker(context)
  const tabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url })
    return tabs[0]?.id
  }, 'https://example.com/')

  await startTranslation(page, 'zh')
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  await stopTranslation(page)
  await page.waitForTimeout(200)

  const state = await sw.evaluate(async (tabId) => {
    const key = `tab_translating_${tabId}`
    const result = await chrome.storage.session.get(key)
    return result[key] ?? null
  }, tabId)
  expect(state).toBeNull()
})

test('bfcache restore cleans up translations after stop', async ({
  context,
}) => {
  const page = await context.newPage()
  await page.goto('https://example.com')
  await page.waitForLoadState('domcontentloaded')

  await startTranslation(page)
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  // Navigate away (original page may enter bfcache)
  await page.goto('https://www.iana.org/help/example-domains')
  await page.waitForLoadState('domcontentloaded')

  // Stop translation on the new page
  await stopTranslation(page)
  await page.waitForTimeout(200)

  // Go back — browser restores page from bfcache with stale translations
  await page.goBack({ waitUntil: 'domcontentloaded' })

  // pageshow handler should clean up translations
  await expect(page.locator('.imp-translate-result')).toHaveCount(0, {
    timeout: 5000,
  })
})

test('translation resumes after SPA navigation', async ({ context }) => {
  const page = await context.newPage()
  await page.goto('https://example.com')
  await page.waitForLoadState('domcontentloaded')

  await startTranslation(page)
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  // Simulate SPA navigation: change URL and replace content
  await page.evaluate(() => {
    history.pushState(null, '', '/new-page')
    document.querySelector('h1')!.textContent = 'New Page Title'
    document.querySelector('p')!.textContent =
      'This is new content after SPA navigation.'
  })

  // URL watcher should detect change and re-translate
  await expect(page.locator('.imp-translate-result').first()).toBeVisible({
    timeout: 15000,
  })
})
