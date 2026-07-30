import { test, expect } from './fixtures'
import { startTranslation, configureMockProvider } from './helpers'

// x.com long-form posts render the entire body as ONE flat div with
// white-space:pre-wrap and only inline children — paragraph breaks are
// literal \n\n characters inside span text, with some spans crossing
// paragraph boundaries. The walker must segment on those blank lines and
// translate per paragraph (bilingual interleaving), instead of extracting
// the whole post as a single giant block whose translation lands in one
// blob at the bottom.
test('pre-wrap long post is translated per paragraph', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/x-longpost`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  // Four paragraphs → four interleaved translations, in document order:
  //   1. the heading span
  //   2. the "first stitch" paragraph (inside a span crossing boundaries)
  //   3. the paragraph containing the inline link
  //   4. the closing paragraph (two lines joined by a single soft \n)
  const results = page.locator('#longpost .imp-translate-result:not(.imp-translate-loading)')
  await expect(results).toHaveCount(4, { timeout: 15000 })

  await expect(results.nth(0)).toContainText('staging ground')
  await expect(results.nth(1)).toContainText('first stitch')
  await expect(results.nth(2)).toContainText('too cautious')
  await expect(results.nth(2)).toContainText('example.com/article')
  // A single \n is a soft line break — both lines stay in one block.
  await expect(results.nth(3)).toContainText('Line one of the closing paragraph')
  await expect(results.nth(3)).toContainText('Line two stays in the same block')

  // Regression guard: the first translation must be just the heading, not
  // the whole post translated as one block.
  await expect(results.nth(0)).not.toContainText('Line two')

  // The original text must remain intact alongside the translations.
  await expect(page.locator('#longpost')).toContainText(
    'The Manila week was not a summit, it was a staging ground for the chronology.',
  )
  await expect(page.locator('#post-link')).toHaveAttribute('href', 'https://example.com/article')
})
