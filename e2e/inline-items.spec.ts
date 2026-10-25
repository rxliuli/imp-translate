import { test, expect } from './fixtures'
import { startTranslation, configureMockProvider } from './helpers'

// AO3's tag list (<ul class="commas">, li { display: inline }) and work action
// bar (<ul class="actions">, li { display: inline-block }) put many separate
// labels in one parent container, and FanFiction.net's chapter nav does the same
// around a skipped <select>. The walker splits them per item (see
// isInlineItemList and isInlineBlockRow in lib/dom.ts), so the page carries one
// .imp-translate-result per item instead of one aggregated result at the end of
// the container. lib/dom.test.ts only covers the returned blocks; this test
// covers what it cannot see — the content script reacting to its own injection
// (MutationObserver, isStale, retranslateElement, repositionTranslation,
// discardSelfMutations). A container full of sibling results is exactly where a
// self-triggered retranslation loop would show up.
const TAG_ITEMS = [
  ['tag-self-insert', 'Self-Insert'],
  ['tag-cyoa', 'CYOA'],
  ['tag-telekenesis', 'Telekenesis'],
  ['tag-time-travel', 'Time Travel'],
  ['tag-fix-it', 'Fix-It'],
] as const

const ACTION_ITEMS = [
  ['action-entire-work', 'Entire Work'],
  ['action-next-chapter', 'Next Chapter'],
  ['action-comments', 'Comments'],
  ['action-share', 'Share'],
] as const

const NAV_ITEMS = [
  ['bar-prev', 'Prev'],
  ['bar-next', 'Next'],
] as const

const CONTROLS = [
  ['#tag-list', TAG_ITEMS],
  ['#action-list', ACTION_ITEMS],
  ['#chapter-nav', NAV_ITEMS],
] as const

// Settled result (the loading state shares the class on the same element).
const DONE = '.imp-translate-result:not(.imp-translate-loading)'
const EXPECTED_RESULTS = TAG_ITEMS.length + ACTION_ITEMS.length + NAV_ITEMS.length + 1

interface MockLogEntry {
  texts: string[]
  receivedAt: number
  completedAt: number | null
}

async function getMockLog(page: import('@playwright/test').Page, baseURL: string) {
  const resp = await page.request.get(`${baseURL}/mock/log`)
  return (await resp.json()) as MockLogEntry[]
}

test('injects one translation per item in a single inline container', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/inline-items`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  // Granularity: one result per tag (5), per action (4) and per nav button (2),
  // not one or two aggregated results at the end of the container.
  await expect(page.locator(`#tag-list ${DONE}`)).toHaveCount(TAG_ITEMS.length, { timeout: 15000 })
  await expect(page.locator(`#action-list ${DONE}`)).toHaveCount(ACTION_ITEMS.length, {
    timeout: 15000,
  })
  // FFN-shaped nav: the skipped <select> cuts the inline run, so each button owns
  // its own result instead of one "Prev Next" over the whole row.
  await expect(page.locator(`#chapter-nav ${DONE}`)).toHaveCount(NAV_ITEMS.length, {
    timeout: 15000,
  })
  await expect(page.locator('#chapter-nav font[data-imp-wrap]')).toHaveCount(0)

  // Control: an ordinary paragraph still translates, and nothing else on the
  // page produced a result (the hidden dropdown inside "Share" stays untranslated).
  await expect(page.locator(`#control ${DONE}`)).toHaveCount(1)
  await expect(page.locator(DONE)).toHaveCount(EXPECTED_RESULTS)

  // Landing point: each item owns exactly its own translation, inside its own
  // <li>/<button> — so "CYOA" carries "[翻译] CYOA", not the whole list's text
  // standing at the end of the container.
  for (const [listId, items] of CONTROLS) {
    for (const [id, text] of items) {
      const itemResult = page.locator(`#${id}`).locator(DONE)
      await expect(itemResult).toHaveCount(1)
      await expect(itemResult).toHaveText(`[翻译] ${text}`)
    }
    // Nothing was appended directly under the container as an aggregate.
    await expect(page.locator(`${listId} > ${DONE}`)).toHaveCount(0)
  }

  // The pre-fix shape wrapped the sibling items in a <font data-imp-wrap>; the
  // per-item walk must never create one here.
  await expect(page.locator('font[data-imp-wrap]')).toHaveCount(0)

  // Every item really went through the mock translator (the assertions above
  // are not reading some stale text).
  const requested = new Set(
    (await getMockLog(page, baseURL)).flatMap((e) => e.texts.map((t) => t.trim())),
  )
  for (const [, text] of [...TAG_ITEMS, ...ACTION_ITEMS, ...NAV_ITEMS]) {
    expect(requested).toContain(text)
  }

  // Stability: our own insertion of N sibling results is a childList mutation
  // in the container the walker just processed. Baseline is taken after the
  // startup settle window (the content script rescans 1s after start), so what
  // is measured below is only self-triggered churn.
  await page.waitForTimeout(1500)
  const before = {
    results: await page.locator(DONE).count(),
    requests: (await getMockLog(page, baseURL)).length,
  }
  expect(before.results).toBe(EXPECTED_RESULTS)

  await page.waitForTimeout(1500)
  const after = {
    results: await page.locator(DONE).count(),
    requests: (await getMockLog(page, baseURL)).length,
  }

  // A self-triggered retranslation shows up either as extra <font> results left
  // behind by repositionTranslation or as new translation requests for items
  // that were already translated.
  expect(after.results).toBe(before.results)
  expect(after.requests).toBe(before.requests)
})
