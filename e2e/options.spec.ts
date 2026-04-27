import { test, expect } from './fixtures'

test('options page renders with default settings', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)

  await expect(page.locator('text=Imp Translate')).toBeVisible()
  await expect(page.locator('text=Microsoft Translator')).toBeVisible()
  await expect(page.locator('text=Google Translate')).toBeVisible()
  await expect(page.locator('text=OpenAI Compatible')).toBeVisible()

  const msRadio = page.locator('button[role="radio"][value="microsoft"]')
  await expect(msRadio).toHaveAttribute('data-state', 'checked')
})

test('options page shows OpenAI settings when selected', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)

  await expect(page.locator('input[type="password"]')).not.toBeVisible()

  await page.locator('button[role="radio"][value="openai"]').click()

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

  // Open language select and pick Japanese (日本語)
  await page.locator('[data-slot="select-trigger"]').click()
  await page.getByRole('option', { name: '日本語' }).click()

  await page.locator('button[role="radio"][value="google"]').click()

  await page.waitForTimeout(200)
  await page.reload()

  await expect(page.locator('[data-slot="select-trigger"]')).toContainText('日本語')
  await expect(page.locator('button[role="radio"][value="google"]')).toHaveAttribute('data-state', 'checked')
})
