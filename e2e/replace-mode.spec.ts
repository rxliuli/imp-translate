import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  configureMockProvider,
  getServiceWorker,
  openBackgroundPopup,
  setDisplayMode,
  startTranslation,
  stopTranslation,
} from './helpers'

const RESULT = '.imp-translate-result'
const TRANSLATED = `${RESULT}:not(.imp-translate-loading)`

async function openPage(page: Page, url: string) {
  await page.goto(url)
  await page.waitForLoadState('domcontentloaded')
}

test('options page switches to replace mode and the page is translated in place', async ({
  context,
  baseURL,
  extensionId,
}) => {
  const page = await context.newPage()
  await openPage(page, `${baseURL}/replace-mode`)
  await configureMockProvider(page, baseURL)

  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  await options.getByText('Replace', { exact: true }).click()
  await expect(options.locator('button[role="radio"][value="replace"]')).toHaveAttribute(
    'data-state',
    'checked',
  )
  const sw = await getServiceWorker(context)
  await expect
    .poll(() =>
      sw.evaluate(
        async () =>
          ((await chrome.storage.local.get('settings')).settings as { displayMode?: string })
            ?.displayMode,
      ),
    )
    .toBe('replace')
  await options.close()

  // The popup goes through the background's startTranslationForTab, which
  // reads displayMode from settings.
  const popup = await openBackgroundPopup(context, extensionId)
  await popup.getByRole('button', { name: 'Translate Page' }).click()

  await expect(page.locator('#plain')).toHaveText(
    '[翻译] This is a plain paragraph that should be replaced in place.',
    { timeout: 15000 },
  )
  await expect(page.locator('#title')).toContainText('[翻译]')
  await expect(page.locator(RESULT)).toHaveCount(0)
  // Only the Text node changed: no wrapper or child element was added.
  expect(await page.locator('#plain').evaluate((p) => p.childNodes.length)).toBe(1)

  await popup.getByRole('button', { name: 'Show Original' }).click()
  await expect(page.locator('#plain')).toHaveText(
    'This is a plain paragraph that should be replaced in place.',
    { timeout: 5000 },
  )
})

test('replace mode keeps inline elements and restores the exact markup', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await openPage(page, `${baseURL}/replace-mode`)
  await configureMockProvider(page, baseURL)
  await setDisplayMode(context, 'replace')

  const before = await page.evaluate(() => {
    const p = document.getElementById('linked')!
    const w = window as unknown as { __nodes: Node[]; __link: Element }
    w.__nodes = [...p.childNodes]
    w.__link = document.getElementById('docs-link')!
    return {
      body: document.body.innerHTML,
      linked: p.innerHTML,
      plain: document.getElementById('plain')!.innerHTML,
    }
  })

  await startTranslation(page)

  const link = page.locator('#docs-link')
  await expect(link).toHaveText('[翻译]the documentation', { timeout: 15000 })
  await expect(page.locator('#linked')).toContainText('[翻译]Please read')
  await expect(page.locator('#linked')).toContainText('[翻译] before you start.')
  await expect(page.locator(RESULT)).toHaveCount(0)

  const identity = await page.evaluate(() => {
    const p = document.getElementById('linked')!
    const w = window as unknown as { __nodes: Node[]; __link: Element }
    const now = [...p.childNodes]
    return {
      sameLink: document.getElementById('docs-link') === w.__link,
      href: (w.__link as HTMLAnchorElement).getAttribute('href'),
      sameNodes: now.length === w.__nodes.length && now.every((n, i) => n === w.__nodes[i]),
      linkChildren: w.__link.childNodes.length,
      elementCount: p.querySelectorAll('*').length,
    }
  })
  expect(identity).toEqual({
    sameLink: true,
    href: '/docs',
    sameNodes: true,
    linkChildren: 1,
    elementCount: 1,
  })

  await stopTranslation(page)

  await expect(page.locator('#linked')).toHaveText(
    'Please read the documentation before you start.',
  )
  const after = await page.evaluate(() => ({
    body: document.body.innerHTML,
    linked: document.getElementById('linked')!.innerHTML,
    plain: document.getElementById('plain')!.innerHTML,
  }))
  expect(after.linked).toBe(before.linked)
  expect(after.plain).toBe(before.plain)
  expect(after.body).toBe(before.body)
  // Restored text nodes are still the page's own nodes.
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { __nodes: Node[] }
      const now = [...document.getElementById('linked')!.childNodes]
      return now.every((n, i) => n === w.__nodes[i])
    }),
  ).toBe(true)
})

test('switching back to bilingual appends translations again', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await openPage(page, `${baseURL}/replace-mode`)
  await configureMockProvider(page, baseURL)
  await setDisplayMode(context, 'replace')

  await startTranslation(page)
  await expect(page.locator('#plain')).toContainText('[翻译]', { timeout: 15000 })
  await stopTranslation(page)
  await expect(page.locator('#plain')).toHaveText(
    'This is a plain paragraph that should be replaced in place.',
  )

  await setDisplayMode(context, 'bilingual')
  await startTranslation(page)

  const result = page.locator(`#plain ${TRANSLATED}`)
  await expect(result).toBeVisible({ timeout: 15000 })
  await expect(result).toContainText(
    '[翻译] This is a plain paragraph that should be replaced in place.',
  )
  // The original text is still there, next to the translation.
  expect(
    await page.locator('#plain').evaluate((p) => (p.firstChild as Text).data),
  ).toBe('This is a plain paragraph that should be replaced in place.')
  await expect(page.locator(`#linked ${TRANSLATED}`)).toBeVisible()
  await expect(page.locator('#docs-link')).toHaveText('the documentation')
})

// React 19 page whose text keeps changing (counters every 500ms, a span
// toggled every 700ms, list items added/removed every 900ms). Replace mode
// must only ever write Text.data — anything else (wrapping, moving, removing
// nodes) makes React throw on its next commit and blanks the page.
for (const mode of ['replace', 'bilingual'] as const) {
  test(`React page keeps working under ${mode} mode`, async ({ context, baseURL }) => {
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await openPage(page, `${baseURL}/react-app`)
    await expect(page.locator('#s1')).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__childListMutations))
      .toBe('number')
    await configureMockProvider(page, baseURL)
    await setDisplayMode(context, mode)

    const logBefore = (await (await page.request.get(`${baseURL}/mock/log`)).json()).length
    await startTranslation(page)
    await expect(page.locator('main')).toContainText('[翻译]', { timeout: 15000 })

    // Sample #s1/#s2 every 50ms for 3s: whether they show a translation, and
    // how often that flips (a flicker between source and translated text).
    const samples = await page.evaluate(async () => {
      const out: { s1: boolean; s2: boolean }[] = []
      const end = performance.now() + 3000
      while (performance.now() < end) {
        out.push({
          s1: document.getElementById('s1')!.textContent!.includes('[翻译]'),
          s2: document.getElementById('s2')!.textContent!.includes('[翻译]'),
        })
        await new Promise((r) => setTimeout(r, 50))
      }
      return out
    })
    const flips = (key: 's1' | 's2') =>
      samples.reduce((n, s, i) => n + (i > 0 && s[key] !== samples[i - 1][key] ? 1 : 0), 0)
    const ratio = (key: 's1' | 's2') => samples.filter((s) => s[key]).length / samples.length
    const requests =
      (await (await page.request.get(`${baseURL}/mock/log`)).json()).length - logBefore
    const stats = {
      mode,
      requests,
      samples: samples.length,
      s1Flips: flips('s1'),
      s1TranslatedRatio: Number(ratio('s1').toFixed(2)),
      s2Flips: flips('s2'),
      s2TranslatedRatio: Number(ratio('s2').toFixed(2)),
    }
    console.log('[react-app]', JSON.stringify(stats))
    test.info().annotations.push({ type: 'react-app stats', description: JSON.stringify(stats) })

    // The page is still alive and in sync with React's state.
    for (let i = 0; i < 5; i++) {
      const check = await page.evaluate(() => {
        const state = (window as unknown as {
          __state: {
            count: number
            visible: boolean
            items: number[]
            word5: string
            word6: string
          }
        }).__state
        const hasCount = (id: string) =>
          new RegExp(`(^|\\D)${state.count}(\\D|$)`).test(
            document.getElementById(id)!.textContent!,
          )
        return {
          s1: hasCount('s1'),
          s2: hasCount('s2'),
          s3: !!document.querySelector('#s3 > span:not([class*="imp-"])') === state.visible,
          s4: document.querySelectorAll('#s4 > li').length === state.items.length,
          s5: document.querySelector('#s5 em')!.textContent!.includes(state.word5),
          s6: document.getElementById('s6')!.textContent!.includes(state.word6),
          count: state.count,
        }
      })
      expect(check, `sample ${i}`).toMatchObject({
        s1: true,
        s2: true,
        s3: true,
        s4: true,
        s5: true,
        s6: true,
      })
      await page.waitForTimeout(400)
    }
    const count = await page.evaluate(
      () => (window as unknown as { __state: { count: number } }).__state.count,
    )
    expect(count).toBeGreaterThan(6)

    if (mode === 'replace') {
      // S5/S6 got translated in place...
      await expect(page.locator('#s5')).toContainText('[翻译]')
      await expect(page.locator('#s6')).toContainText('[翻译]')
      const structure = await page.evaluate(() => {
        const w = window as unknown as {
          __s5refs: { em: Element; a: Element }
          __childListMutations: number
          __childListLog: string[]
        }
        const s5 = document.getElementById('s5')!
        return {
          sameEm: s5.querySelector('em') === w.__s5refs.em,
          sameA: s5.querySelector('a') === w.__s5refs.a,
          wraps: document.querySelectorAll('[data-imp-wrap]').length,
          s6Children: document.getElementById('s6')!.childNodes.length,
          childList: w.__childListMutations,
          log: w.__childListLog,
        }
      })
      // ...without touching the structure: same elements, no wrappers, no
      // split text, and no childList changes made by the translator.
      expect(structure).toEqual({
        sameEm: true,
        sameA: true,
        wraps: 0,
        s6Children: 1,
        childList: 0,
        log: [],
      })
      // Static text is translated once, not on every re-render.
      const log = (await (await page.request.get(`${baseURL}/mock/log`)).json()) as {
        texts: string[]
      }[]
      const titleRequests = log
        .slice(logBefore)
        .filter((e) => e.texts.some((t) => t.includes('Framework translation test page'))).length
      expect(titleRequests).toBeLessThanOrEqual(1)
    }

    expect(pageErrors).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { __errors: string[] }).__errors)).toEqual(
      [],
    )
    await stopTranslation(page)
  })
}

// Bilingual mode skips <nav>/<footer> to protect their layout; replace mode
// only rewrites Text.data, so it translates them too.
test('replace mode translates nav and footer in place', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await openPage(page, `${baseURL}/replace-mode`)
  await configureMockProvider(page, baseURL)
  await setDisplayMode(context, 'replace')

  const before = await page.evaluate(() => {
    const w = window as unknown as { __save: Element; __saveText: Node; __login: Element }
    w.__save = document.getElementById('save')!
    w.__saveText = w.__save.firstChild!
    w.__login = document.getElementById('login')!
    return document.body.innerHTML
  })

  await startTranslation(page)

  await expect(page.locator('#login')).toHaveText('[翻译] Log in', { timeout: 15000 })
  await expect(page.locator('#save')).toHaveText('[翻译] Save')
  await expect(page.locator('#footer-note')).toHaveText('[翻译] Footer notice for this page')
  await expect(page.locator(RESULT)).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { __save: Element; __saveText: Node; __login: Element }
      const save = document.getElementById('save')!
      return {
        sameSave: save === w.__save,
        sameSaveText: save.firstChild === w.__saveText && save.childNodes.length === 1,
        sameLogin: document.getElementById('login') === w.__login,
        navChildren: document.getElementById('nav')!.children.length,
      }
    }),
  ).toEqual({ sameSave: true, sameSaveText: true, sameLogin: true, navChildren: 2 })

  await stopTranslation(page)
  await expect(page.locator('#save')).toHaveText('Save')
  expect(await page.evaluate(() => document.body.innerHTML)).toBe(before)
})

test('bilingual mode still leaves nav and footer alone', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await openPage(page, `${baseURL}/replace-mode`)
  await configureMockProvider(page, baseURL)
  await setDisplayMode(context, 'bilingual')

  await startTranslation(page)
  await expect(page.locator(`#plain ${TRANSLATED}`)).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await expect(page.locator(`#nav ${RESULT}`)).toHaveCount(0)
  await expect(page.locator(`#footer ${RESULT}`)).toHaveCount(0)
  await expect(page.locator('#login')).toHaveText('Log in')
  await expect(page.locator('#save')).toHaveText('Save')
  await expect(page.locator('#footer-note')).toHaveText('Footer notice for this page')
})
