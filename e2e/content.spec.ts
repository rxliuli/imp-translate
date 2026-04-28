import { test, expect } from './fixtures'
import { startTranslation, stopTranslation, configureMockProvider } from './helpers'

test('content script translates page', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const translatedEl = page.locator('.imp-translate-result:not(.imp-translate-loading)').first()
  await expect(translatedEl).toBeVisible({ timeout: 15000 })

  const text = await translatedEl.textContent()
  expect(text).toBeTruthy()
  expect(text).toContain('[翻译]')

  await expect(page.locator('h1').first()).toContainText('Home Page')
})

test('translates content revealed by inner container scroll', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/inner-scroll`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  const bottomMsg = page.locator('#bottom-msg')
  await expect(bottomMsg.locator('.imp-translate-result')).toHaveCount(0)

  await page.evaluate(() => {
    const container = document.getElementById('scroll-container')!
    container.scrollTop = container.scrollHeight
  })

  const bottomTranslation = bottomMsg.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(bottomTranslation).toBeVisible({ timeout: 15000 })
  await expect(bottomTranslation).toContainText('[翻译]')
})

test('re-translates when text content changes dynamically', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/dynamic-text`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const tweet = page.locator('#tweet')
  const result = tweet.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(result).toBeVisible({ timeout: 15000 })

  const firstTranslation = await result.textContent()
  expect(firstTranslation).toContain('[翻译] This is a truncated message')

  await page.waitForTimeout(1000)
  await page.click('#show-more')

  await expect(result).toContainText('after expanding', { timeout: 15000 })
})

test('does not flicker when element is redrawn with same text', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const result = page.locator('.imp-translate-result:not(.imp-translate-loading)').first()
  await expect(result).toBeVisible({ timeout: 15000 })
  const translation = await result.textContent()

  // Simulate framework redraw: replace element innerHTML then restore (same text)
  await page.evaluate(() => {
    const p = document.querySelector('p')!
    const text = p.childNodes[0].textContent!
    p.childNodes[0].textContent = text
  })

  // Wait for debounce to settle
  await page.waitForTimeout(500)

  // Translation should still be present and unchanged — no loading flash
  await expect(result).toBeVisible()
  await expect(result).toHaveText(translation!)
  await expect(page.locator('.imp-translate-loading')).toHaveCount(0)
})

test('SPA navigation preserves existing translations', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const h1Result = page.locator('h1 .imp-translate-result:not(.imp-translate-loading)')
  await expect(h1Result).toBeVisible({ timeout: 15000 })
  const h1Translation = await h1Result.textContent()

  // SPA navigate — h1 keeps same text, p gets new text
  await page.evaluate(() => {
    history.pushState(null, '', '/new-page')
    document.querySelector('p')!.textContent = 'Brand new paragraph after navigation.'
  })

  // h1 translation should stay (no flicker)
  await expect(h1Result).toBeVisible()
  await expect(h1Result).toHaveText(h1Translation!)

  // new p should get translated
  const pResult = page.locator('p .imp-translate-result:not(.imp-translate-loading)')
  await expect(pResult).toContainText('Brand new paragraph', { timeout: 15000 })
})

// Reddit wraps details content in a height-animator that hides content when collapsed.
// Native <details> children still report offsetHeight>0 in Chromium (content-visibility),
// so this test uses display:none which is the reliable way to hide content from isHidden.
test('details element content is translated when expanded', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/details`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  const ruleText = page.locator('#rule-text')
  await expect(ruleText.locator('.imp-translate-result')).toHaveCount(0)

  await page.locator('summary').click()

  const contentTranslation = ruleText.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(contentTranslation).toBeVisible({ timeout: 15000 })
  await expect(contentTranslation).toContainText('[翻译]')
})

// Twitter timeline scenario: translate first, then click "Show more" which
// appends an @mention link as a sibling of the originally-truncated <span>.
// findInjectionPoint drilled into the span at translation time, so the <font>
// would be stuck before the new link unless retranslateElement repositions it.
// Regression test for the case demonstrated on
// https://x.com/MarioNawfal/status/2049040672083345418 viewed via T3chFalcon's timeline.
test('repositions translation when block gains new siblings after translation', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/sibling-after-translate`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  const block = page.locator('#block')
  const result = block.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(result).toBeVisible({ timeout: 15000 })

  // Initial: findInjectionPoint drilled into the only child span
  const initialParentId = await result.evaluate((el) => el.parentElement?.id)
  expect(initialParentId).toBe('text')

  // Append a sibling div — simulates "Show more" expanding a tweet
  await page.click('#add-mention')

  // Recheck retranslates with new text including @user
  await expect(result).toContainText('@user', { timeout: 15000 })

  // After repositioning: <font> must be a direct child of #block
  const finalParentId = await result.evaluate((el) => el.parentElement?.id)
  expect(finalParentId).toBe('block')

  // And it must come after the new mention wrapper
  const order = await page.evaluate(() => {
    const block = document.getElementById('block')!
    const children = Array.from(block.children)
    const mentionIndex = children.findIndex((c) => c.id === 'mention-wrapper')
    const fontIndex = children.findIndex((c) => c.classList.contains('imp-translate-result'))
    return { mentionIndex, fontIndex }
  })
  expect(order.fontIndex).toBeGreaterThan(order.mentionIndex)

  // The originally-injected separator inside the span must be cleaned up
  const leftoverBr = await page.locator('#text br.imp-translate-br').count()
  expect(leftoverBr).toBe(0)
})

test('translates content that renders after being added to DOM', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/delayed-render`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  const lazyText = page.locator('#lazy-text')
  await expect(lazyText).toHaveCount(0)

  await page.click('#load-content')

  const lazyTranslation = lazyText.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(lazyTranslation).toBeVisible({ timeout: 15000 })
  await expect(lazyTranslation).toContainText('[翻译]')
})

test('content script restores original page', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)
  await expect(page.locator('.imp-translate-result:not(.imp-translate-loading)').first()).toBeVisible({
    timeout: 15000,
  })

  await stopTranslation(page)

  await expect(page.locator('.imp-translate-result')).toHaveCount(0)
  await expect(page.locator('h1')).toContainText('Home Page')
})
