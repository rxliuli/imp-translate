import { test, expect } from './fixtures'

test('options page renders with default settings', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)

  await expect(page.locator('text=Imp Translate Settings')).toBeVisible()
  await expect(page.locator('text=Microsoft Translator')).toBeVisible()
  await expect(page.locator('text=Google Translate')).toBeVisible()
  await expect(page.locator('text=OpenAI Compatible')).toBeVisible()

  // Microsoft should be selected by default
  const msRadio = page.locator('input[type="radio"][value="microsoft"]')
  await expect(msRadio).toBeChecked()
})

test('options page shows OpenAI settings when selected', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)

  // OpenAI fields should not be visible
  await expect(page.locator('input[type="password"]')).not.toBeVisible()

  // Select OpenAI
  await page.locator('input[type="radio"][value="openai"]').click()

  // OpenAI fields should appear
  await expect(page.getByText('API Endpoint', { exact: true })).toBeVisible()
  await expect(page.getByText('API Key', { exact: true })).toBeVisible()
  await expect(page.getByText('Model', { exact: true })).toBeVisible()
  await expect(page.getByText('System Prompt', { exact: true })).toBeVisible()
})

test('options page saves and persists settings', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)

  // Change language to Japanese
  await page.locator('select').selectOption('ja')

  // Select Google provider
  await page.locator('input[type="radio"][value="google"]').click()

  // Auto-saves — wait a moment then reload to verify persistence
  await page.waitForTimeout(200)
  await page.reload()
  await expect(page.locator('select')).toHaveValue('ja')
  await expect(page.locator('input[type="radio"][value="google"]')).toBeChecked()
})
