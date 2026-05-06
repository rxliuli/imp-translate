import { test, expect } from './fixtures'
import {
  startTranslation,
  configureMockProvider,
  setCustomRules,
} from './helpers'

const TRANSLATED_SELECTOR = '.imp-translate-result:not(.imp-translate-loading)'

// Resolve the test server URL through the imp.test alias so site rules
// (which key on hostname) can match. The Chrome --host-resolver-rules flag
// in fixtures.ts maps imp.test → 127.0.0.1.
function impHost(baseURL: string): string {
  return baseURL.replace('127.0.0.1', 'imp.test')
}

test('path-gated include rule activates only on matching pathname', async ({
  context,
  baseURL,
}) => {
  const impURL = impHost(baseURL)
  const page = await context.newPage()
  await page.goto(`${impURL}/scoped`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, impURL)
  // Path-gated include: only the [data-target] paragraph should be in scope on /scoped.
  await setCustomRules(context, 'imp.test#+#:matches-path(/scoped) [data-target]')

  await startTranslation(page)

  // [data-target] paragraph translates
  await expect(page.locator(`p[data-target] ${TRANSLATED_SELECTOR}`)).toBeVisible({
    timeout: 15000,
  })

  // Plain paragraph (outside include scope) is left alone — give the walker
  // enough time to have processed the page so the absence is meaningful.
  await page.waitForTimeout(2000)
  const plainTranslated = await page
    .locator(`p:not([data-target]) ${TRANSLATED_SELECTOR}`)
    .count()
  expect(plainTranslated).toBe(0)
})

test('path-gated rule on non-matching path lets the page translate normally', async ({
  context,
  baseURL,
}) => {
  const impURL = impHost(baseURL)
  const page = await context.newPage()
  await page.goto(`${impURL}/regular`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, impURL)
  // Include rule scoped to /never — won't fire on /regular, so includeSelectors
  // is empty and the walker translates everything (no include filter).
  await setCustomRules(context, 'imp.test#+#:matches-path(/never) [data-target]')

  await startTranslation(page)

  await expect(page.locator(`p[data-target] ${TRANSLATED_SELECTOR}`)).toBeVisible({
    timeout: 15000,
  })
  await expect(
    page.locator(`p:not([data-target]) ${TRANSLATED_SELECTOR}`),
  ).toBeVisible({ timeout: 15000 })
})

test('SPA navigation re-evaluates path-gated rules', async ({ context, baseURL }) => {
  const impURL = impHost(baseURL)
  const page = await context.newPage()
  await page.goto(`${impURL}/regular`)
  await page.waitForLoadState('domcontentloaded')

  await configureMockProvider(page, impURL)
  // Rule activates only on /scoped — initial /regular page should translate
  // both paragraphs (rule inactive); after pushState to /scoped, newly-added
  // content should be filtered through the include scope.
  await setCustomRules(context, 'imp.test#+#:matches-path(/scoped) [data-target]')

  await startTranslation(page)

  // Initial page: rule inactive, both paragraphs translate.
  await expect(
    page.locator(`p:not([data-target]) ${TRANSLATED_SELECTOR}`),
  ).toBeVisible({ timeout: 15000 })
  await expect(page.locator(`p[data-target] ${TRANSLATED_SELECTOR}`)).toBeVisible({
    timeout: 15000,
  })

  // SPA navigate to /scoped, then a beat later inject fresh paragraphs. The
  // gap mirrors realistic SPAs (React render after route change) and gives
  // the inject script time to round-trip getRulesForUrl with the SW before
  // the mutation observer sees the new content. Without this gap there is a
  // race: pushState and DOM update in the same tick let the observer walk
  // new elements with the previous (rule-inactive) selectors.
  await page.evaluate(() => history.pushState(null, '', '/scoped'))
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const block = document.createElement('div')
    block.id = 'spa-block'
    block.innerHTML =
      '<p data-target id="spa-target">SPA content within the include scope.</p>' +
      '<p id="spa-plain">SPA content outside the include scope.</p>'
    document.body.appendChild(block)
  })

  // Targeted paragraph translates after rule activates.
  await expect(
    page.locator(`#spa-target ${TRANSLATED_SELECTOR}`),
  ).toBeVisible({ timeout: 15000 })

  // Plain SPA paragraph stays untranslated even after settle time, because
  // the now-active include rule scopes translation to [data-target] only.
  await page.waitForTimeout(2000)
  const plainSpaTranslated = await page
    .locator(`#spa-plain ${TRANSLATED_SELECTOR}`)
    .count()
  expect(plainSpaTranslated).toBe(0)
})
