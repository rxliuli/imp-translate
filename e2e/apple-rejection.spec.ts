import { test, expect } from './fixtures'
import { configureMockProvider, startTranslation } from './helpers'

// Apple App Store Connect rejection emails place paragraphs as raw text
// nodes between <br><br> separators inside a single container — no <p>
// wrappers. Same shape appears in many email clients and CMS templates.
//
// E2E sibling to lib/dom.fixtures.test.ts: the unit test verifies
// extractBlocks() output shape; this verifies the user-visible result —
// translations actually injected into a real extension build, structure
// preserved, original page intact, wrap tag is <font> not <span>.
test('Apple-rejection-br: each <br><br> paragraph becomes its own translation', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/apple-rejection-br`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  await expect(
    page.locator('.imp-translate-result:not(.imp-translate-loading)').first(),
  ).toBeVisible({ timeout: 15000 })
  // Let any in-flight chunks settle before counting
  await expect
    .poll(
      async () => page.locator('.imp-translate-result.imp-translate-loading').count(),
      { timeout: 15000 },
    )
    .toBe(0)

  const results = page.locator('.imp-translate-result')
  const texts = await results.allTextContents()

  // 1. Per-paragraph segmentation: many short blocks, not one megablock.
  //    Mirrors lib/dom.fixtures.test.ts bound (>=8) but on the live extension.
  expect(texts.length).toBeGreaterThanOrEqual(8)

  // 2. Wrap tag — translation result element is <font>, not <span>.
  const tagNames = await results.evaluateAll((els) => els.map((el) => el.tagName))
  for (const t of tagNames) expect(t).toBe('FONT')

  // 3. Mock provider prefixes [翻译] — every block went through translation.
  for (const t of texts) expect(t).toContain('[翻译]')

  // 4. No megablock: largest translation stays bounded.
  //    Unit test caps original block text at <800; +[翻译] prefix → <900.
  const maxLen = Math.max(...texts.map((t) => t.length))
  expect(maxLen).toBeLessThan(900)

  // 5. Headings (the <b> tags between <br><br>) land as their own short
  //    blocks, NOT merged with the prose paragraph that follows.
  for (const heading of ['Issue Description', 'Next Steps', 'Resources']) {
    const block = texts.find((t) => t.includes(heading))
    expect(block, `missing translation for "${heading}"`).toBeDefined()
    expect(
      block!.length,
      `"${heading}" merged into a larger block: ${JSON.stringify(block)}`,
    ).toBeLessThan(40)
  }

  // 6. Original page intact — text and link href preserved alongside translations.
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).toContain('Issue Description')
  expect(bodyText).toContain('Next Steps')
  expect(bodyText).toContain('Guideline 2.3.10')
  const linkHref = await page
    .locator('a[href*="developer.apple.com"]')
    .getAttribute('href')
  expect(linkHref).toContain('app-store-connect')
})
