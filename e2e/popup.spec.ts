import { test, expect } from './fixtures'
import { configureMockProvider, openBackgroundPopup, startTranslation } from './helpers'

const TRANSLATED = '.imp-translate-result:not(.imp-translate-loading)'

test('popup renders with translate button and language selector', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)

  await expect(page.locator('text=Imp Translate')).toBeVisible()
  await expect(page.locator('text=Translate Page')).toBeVisible()

  const select = page.locator('select')
  await expect(select).toBeVisible()
  const value = await select.inputValue()
  expect(value).toBeTruthy()
})

test('popup language selector changes target language', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)

  const select = page.locator('select')
  await select.selectOption('ja')
  await expect(select).toHaveValue('ja')

  // Reopen popup — language should persist
  await page.reload()
  await expect(page.locator('select')).toHaveValue('ja')
})

test('popup settings button opens options page', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)

  const [optionsPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('button').filter({ has: page.locator('svg') }).last().click(),
  ])

  await expect(optionsPage).toHaveURL(new RegExp(`chrome-extension://${extensionId}/options.html`))
})

// Covers what the three tests above can't: the popup's translate/restore path
// against a tab that is really translating. The button label is the assertion —
// it comes from the getTabState query, refetched after each mutation.
test('popup translates and restores the active tab', async ({
  context,
  baseURL,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator(TRANSLATED).first()).toBeVisible({ timeout: 15000 })

  const popup = await openBackgroundPopup(context, extensionId)
  const restore = popup.getByRole('button', { name: 'Show Original' })
  await expect(restore).toBeVisible({ timeout: 5000 })

  await restore.click()

  // The popup asked the background to stop, and the page really reverted
  await expect(page.locator('.imp-translate-result')).toHaveCount(0, { timeout: 5000 })
  await expect(popup.getByRole('button', { name: 'Translate Page' })).toBeVisible({
    timeout: 5000,
  })

  // ...and back again
  await popup.getByRole('button', { name: 'Translate Page' }).click()
  await expect(page.locator(TRANSLATED).first()).toBeVisible({ timeout: 15000 })
  await expect(restore).toBeVisible({ timeout: 5000 })
})
