import { test, expect } from './fixtures'
import { startTranslation, configureMockProvider } from './helpers'

// Grok/ChatGPT-style streaming answers mutate the DOM while translation
// requests are in flight. These tests reproduce the three failure modes
// observed on x.com/i/grok (translations reverting to a truncated early
// chunk after streaming finished):
//   1. a stale in-flight response overwrites a newer translation
//   2. text that grows between extraction and translation gets translated
//      from the frozen extraction-time snapshot
//   3. a streamed-in inner span gets marked as its own block nested inside
//      the already-tracked <li>

const PARTIAL_A = 'This launch triggered'
const FULL_A =
  'This launch triggered hype around domestic semiconductor self-sufficiency in global markets.'

const PARTIAL_B = 'This announcement sparked'
const FULL_B =
  'This announcement sparked a wave of enthusiasm across the entire technology economy overnight.'

const PARTIAL_C = 'The post highlights'
const FULL_C =
  'The post highlights the magical contrast in relative valuations amid geopolitics and sentiment.'

interface MockLogEntry {
  texts: string[]
  receivedAt: number
  completedAt: number | null
}

async function getMockLog(page: import('@playwright/test').Page, baseURL: string) {
  const resp = await page.request.get(`${baseURL}/mock/log`)
  return (await resp.json()) as MockLogEntry[]
}

// The streamed text is translated while partial; the block then grows to the
// full sentence and is retranslated. The mock server delays the partial-text
// response so it arrives AFTER the full-text response — the extension must
// drop the stale response instead of letting it overwrite the newer
// translation (last-writer-wins race).
test('stale translation response does not overwrite newer translation', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  // Delay the partial text's translation so it resolves long after the
  // full text's translation.
  await page.request.post(`${baseURL}/mock/delays`, {
    data: { delays: [{ text: PARTIAL_A, ms: 4000 }] },
  })
  await page.goto(`${baseURL}/grok-stream`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  // Wait until the li is marked and has its loading wrapper — the partial
  // translation request is now in flight (and stalled by the mock).
  const result = page.locator('#stream-li .imp-translate-result')
  await expect(result).toBeAttached({ timeout: 15000 })

  // Streaming continues: the text node grows in place to the full sentence.
  await page.evaluate((full) => {
    const chunk = document.querySelector('#stream-li .chunk')!
    chunk.firstChild!.textContent = full
  }, FULL_A)

  // The recheck retranslates with the full text; its response is fast, so the
  // full translation must appear while the partial request is still pending.
  await expect(result).toContainText('semiconductor', { timeout: 15000 })

  // Sanity-check the race premise: the delayed partial response has not been
  // sent yet when the full translation is already displayed.
  const logDuring = await getMockLog(page, baseURL)
  const partialEntry = logDuring.find((e) => e.texts.includes(PARTIAL_A))
  expect(partialEntry).toBeTruthy()
  expect(partialEntry!.completedAt).toBeNull()

  // Now wait for the stale partial response to be delivered...
  await expect
    .poll(
      async () => {
        const log = await getMockLog(page, baseURL)
        return log.find((e) => e.texts.includes(PARTIAL_A))?.completedAt ?? null
      },
      { timeout: 10000 },
    )
    .not.toBeNull()
  await page.waitForTimeout(800)

  // ...and the displayed translation must still be the full one. Before the
  // fix, the stale response overwrote it with "[翻译] This launch triggered".
  await expect(result).toHaveText(`[翻译] ${FULL_A}`)
  await expect(page.locator('#stream-li .imp-translate-loading')).toHaveCount(0)
  await expect(page.locator('#stream-li')).toHaveAttribute('data-imp-text', FULL_A)
})

// A streamed-in block whose text grows between MutationObserver extraction
// and the batched translation flush must be translated with its CURRENT
// text, not the extraction-time snapshot. Before the fix the element was
// permanently stuck with the truncated translation: the growth mutation
// happened before the element was marked, so the recheck path never fired.
test('text that grows before batch translation is translated in full', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/grok-stream`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  // Wait for the static content to translate so startup has settled.
  await expect(
    page.locator('#stream-li .imp-translate-result:not(.imp-translate-loading)'),
  ).toBeVisible({ timeout: 15000 })

  // Stream in a new li, then grow its text in a 0ms timeout: the
  // MutationObserver microtask extracts the partial text first, and the
  // growth lands before the 50ms batch flush marks & translates the block.
  await page.evaluate(
    ([partial, full]) => {
      const ul = document.createElement('ul')
      const li = document.createElement('li')
      li.id = 'li-b'
      const outer = document.createElement('span')
      const inner = document.createElement('span')
      inner.className = 'chunk'
      inner.textContent = partial
      outer.appendChild(inner)
      li.appendChild(outer)
      ul.appendChild(li)
      document.getElementById('chat')!.appendChild(ul)
      setTimeout(() => {
        inner.firstChild!.textContent = full
      }, 0)
    },
    [PARTIAL_B, FULL_B] as const,
  )

  const result = page.locator('#li-b .imp-translate-result:not(.imp-translate-loading)')
  await expect(result).toHaveText(`[翻译] ${FULL_B}`, { timeout: 10000 })
  await expect(page.locator('#li-b')).toHaveAttribute('data-imp-text', FULL_B)
})

// React-style streaming re-render: the framework replaces the inner span
// with a new one carrying the fuller text while the parent li is still
// waiting in the translation batch. The new span must not be tracked as an
// independent nested block — otherwise the li and the span each hold a
// different data-imp-text and race to write the same result element.
test('streamed replacement span is not marked as a nested block', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await page.goto(`${baseURL}/grok-stream`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, baseURL)
  await startTranslation(page)

  await expect(
    page.locator('#stream-li .imp-translate-result:not(.imp-translate-loading)'),
  ).toBeVisible({ timeout: 15000 })

  await page.evaluate(
    ([partial, full]) => {
      const ul = document.createElement('ul')
      const li = document.createElement('li')
      li.id = 'li-c'
      const outer = document.createElement('span')
      const inner = document.createElement('span')
      inner.className = 'chunk'
      inner.textContent = partial
      outer.appendChild(inner)
      li.appendChild(outer)
      ul.appendChild(li)
      document.getElementById('chat')!.appendChild(ul)
      setTimeout(() => {
        const fresh = document.createElement('span')
        fresh.className = 'chunk'
        fresh.textContent = full
        outer.replaceChildren(fresh)
      }, 0)
    },
    [PARTIAL_C, FULL_C] as const,
  )

  const li = page.locator('#li-c')
  const result = li.locator('.imp-translate-result:not(.imp-translate-loading)')
  await expect(result).toHaveText(`[翻译] ${FULL_C}`, { timeout: 10000 })
  await expect(li).toHaveAttribute('data-imp-text', FULL_C)
  // Only the li itself may carry the translated marker — no nested marks.
  await expect(li.locator('[data-imp-translated]')).toHaveCount(0)
  await expect(li.locator('.imp-translate-result')).toHaveCount(1)
})
