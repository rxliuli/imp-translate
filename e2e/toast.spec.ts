import { test, expect } from './fixtures'
import {
  startTranslation,
  stopTranslation,
  configureMockProvider,
  enableMobileMode,
  summonPanel,
} from './helpers'

const TOAST = '#imp-translate-toast'
const LANG_SELECT = `${TOAST} .imp-toast-lang`
const TRANSLATED = '.imp-translate-result:not(.imp-translate-loading)'

test('toast shows language selector on mobile', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await enableMobileMode(context)
  await startTranslation(page, 'ja', true)

  await expect(page.locator(TOAST)).toBeVisible({ timeout: 5000 })
  await expect(page.locator(LANG_SELECT)).toHaveValue('ja')
})

test('toast stays visible during language change', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await enableMobileMode(context)
  await startTranslation(page, 'ja', true)

  const toast = page.locator(TOAST)
  await expect(toast).toBeVisible({ timeout: 5000 })

  // Change language via select
  await page.locator(LANG_SELECT).selectOption('zh')

  // Toast must remain visible immediately after change
  await expect(toast).toBeVisible()

  // Still visible 2 seconds later (no premature dismiss)
  await page.waitForTimeout(2000)
  await expect(toast).toBeVisible()

  // Translation restarted with new language
  const result = page.locator(TRANSLATED).first()
  await expect(result).toBeVisible({ timeout: 15000 })
})

test('toast timer pauses when select is reopened after language change', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await enableMobileMode(context)
  await startTranslation(page, 'ja', true)

  const toast = page.locator(TOAST)
  const langSelect = page.locator(LANG_SELECT)
  await expect(toast).toBeVisible({ timeout: 5000 })

  // Change language
  await langSelect.selectOption('zh')
  await expect(toast).toBeVisible()

  // Wait 3s, then click select again without changing
  await page.waitForTimeout(3000)
  await langSelect.click()

  // Toast should still be visible 3s later (timer was paused by click)
  await page.waitForTimeout(3000)
  await expect(toast).toBeVisible()
})

test('toast auto-dismisses 5s after language change', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await enableMobileMode(context)
  await startTranslation(page, 'ja', true)

  const toast = page.locator(TOAST)
  await expect(toast).toBeVisible({ timeout: 5000 })

  await page.locator(LANG_SELECT).selectOption('zh')

  // Should dismiss within ~6s after the change (5s timer + animation)
  await expect(toast).not.toBeVisible({ timeout: 8000 })
})

test('toast restore button stops translation', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await enableMobileMode(context)
  await startTranslation(page, 'zh', true)

  const toast = page.locator(TOAST)
  await expect(toast).toBeVisible({ timeout: 5000 })

  // Wait for some translations to appear
  await expect(page.locator(TRANSLATED).first()).toBeVisible({ timeout: 15000 })

  // Click restore
  await page.locator(`${TOAST} .imp-toast-restore`).click()

  // Toast should disappear
  await expect(toast).not.toBeVisible({ timeout: 3000 })

  // Translations should be removed
  await expect(page.locator('.imp-translate-result')).toHaveCount(0)
})

// Mobile has no action popup, so clicking the toolbar icon while translating
// re-summons the panel instead of stopping the translation (see
// openPanelForActiveTab in entrypoints/background.ts). The translation staying
// on screen is what proves the click took the summon branch: a re-start would
// have been swallowed by the content script's isTranslating guard and no bar
// would have appeared at all.
test('summoning the panel while translating keeps the translation', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await enableMobileMode(context)
  await startTranslation(page, 'zh', true)

  const toast = page.locator(TOAST)
  await expect(toast).toBeVisible({ timeout: 5000 })
  const translated = page.locator(TRANSLATED)
  await expect(translated.first()).toBeVisible({ timeout: 15000 })
  const countBefore = await translated.count()

  // Let the auto-dismiss timer fire — the state the user is in when they tap
  // the icon to reach settings or switch language
  await expect(toast).not.toBeVisible({ timeout: 8000 })

  await summonPanel(page)

  await expect(toast).toBeVisible({ timeout: 3000 })
  await expect(page.locator(LANG_SELECT)).toHaveValue('zh')
  await expect(toast).toHaveCount(1)

  // Panel is interactive on the re-summoned bar, and translation survived
  await page.locator(`${TOAST} .imp-toast-lang`).selectOption('ja')
  await expect(page.locator(`${TOAST} .imp-toast-lang`)).toHaveValue('ja')
  await expect(page.locator(TRANSLATED).first()).toBeVisible({ timeout: 15000 })
  expect(await translated.count()).toBeGreaterThan(0)
  expect(countBefore).toBeGreaterThan(0)
})
