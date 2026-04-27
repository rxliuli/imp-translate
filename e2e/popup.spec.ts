import { test, expect } from './fixtures'

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
