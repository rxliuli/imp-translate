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

// After the collapsed tweet is translated, "Show more" swaps the lead span's
// text for the full post. The rescan must re-split it, translate the new
// paragraphs, keep the lead's translation with the lead, and drop the stale
// clone left over from the collapsed render (React never removes it).
test('paragraphs revealed by "Show more" are translated after the split', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/x-showmore`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const done = '.imp-translate-result:not(.imp-translate-loading)'
  await expect(page.locator(`#tweet ${done}`)).toHaveCount(2, { timeout: 15000 })
  await expect(page.locator(`#lead ${done}`)).toContainText('Opening paragraph')

  await page.click('#show-more')

  await expect(page.locator(`#tweet ${done}`)).toHaveCount(3, { timeout: 15000 })
  const texts = await page.locator(`#tweet ${done}`).allTextContents()
  // Document order: lead, tail (full), third.
  expect(texts.map((t) => t.replace(/^\[翻译\]\s*/, '').slice(0, 9))).toEqual([
    'Opening p', 'Collapsed', 'Third par',
  ])
  expect(texts[1]).toContain('continues here')
  // The lead keeps exactly its own translation, in place.
  await expect(page.locator(`#lead ${done}`)).toHaveCount(1)
  await expect(page.locator(`#lead ${done}`)).not.toContainText('Collapsed')
  // No stale duplicate of the collapsed tail (nor its t.co link) survives.
  const tweetText = await page.locator('#tweet').textContent()
  expect(tweetText).not.toContain('https://t.co/abc')
  expect(tweetText!.match(/Collapsed tail/g)).toHaveLength(2) // original + its translation
})

// Same, but the truncated text had no blank line, so the collapsed tweet was
// translated as ONE block with the mark on the tweetText div itself. After
// "Show more" the div's text has paragraph breaks: it must be re-segmented,
// not retranslated as a single block that lands in one blob at the bottom.
test('"Show more" on a tweet translated as one block re-segments it per paragraph', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/x-showmore-nosplit`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const done = '.imp-translate-result:not(.imp-translate-loading)'
  await expect(page.locator(`#tweet ${done}`)).toHaveCount(1, { timeout: 15000 })
  await expect(page.locator('#tweet')).toHaveAttribute('data-imp-translated', 'true')

  await page.click('#show-more')

  await expect(page.locator(`#tweet ${done}`)).toHaveCount(3, { timeout: 15000 })
  const texts = await page.locator(`#tweet ${done}`).allTextContents()
  expect(texts.map((t) => t.replace(/^\[翻译\]\s*/, '').slice(0, 9))).toEqual([
    'Following', 'Most roya', 'They have',
  ])
  // Per-paragraph, not one blob: no single result contains two paragraphs.
  expect(texts.some((t) => t.includes('Following') && t.includes('Most royal'))).toBe(false)
  // The div is no longer the (single) marked block.
  await expect(page.locator('#tweet')).not.toHaveAttribute('data-imp-translated', 'true')
  const tweetText = await page.locator('#tweet').textContent()
  expect(tweetText).not.toContain('https://t.co/xyz')
})
