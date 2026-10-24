import { test, expect } from './fixtures'
import { startTranslation, configureMockProvider, enableMobileMode } from './helpers'

// The toast bar is the only UI that floats over the page, and it is only ever
// shown on mobile — a site whose skin breaks it would never be noticed on
// desktop. It therefore lives in a shadow root, and these tests pin the
// *invariant* (page CSS cannot reach the panel) rather than one site's skin.
// See lib/render.ts: the host is the only place that needs `!important`,
// because a normal :host declaration loses to any document rule matching the
// host, after which the page's inherited values flow into the shadow tree.
const TOAST = '#imp-translate-toast'

async function openToastOn(page: Parameters<typeof startTranslation>[0], baseURL: string) {
  await page.goto(`${baseURL}/hostile-css`)
  await page.waitForLoadState('domcontentloaded')
  await configureMockProvider(page, baseURL)
  await enableMobileMode(page.context())
  await startTranslation(page, 'zh', true)
  await expect(page.locator(TOAST)).toBeVisible({ timeout: 5000 })
}

test('hostile page CSS cannot resize or hide the toast', async ({ context, baseURL }) => {
  const page = await context.newPage()
  await openToastOn(page, baseURL)

  const geometry = await page.evaluate(() => {
    const host = document.getElementById('imp-translate-toast')!
    const hostStyle = getComputedStyle(host)
    const root = host.shadowRoot!
    const rect = (sel: string) => {
      const r = root.querySelector(sel)!.getBoundingClientRect()
      return { left: r.left, right: r.right, width: r.width, height: r.height }
    }
    return {
      viewport: window.innerWidth,
      host: { display: hostStyle.display, position: hostStyle.position, width: host.getBoundingClientRect().width },
      bar: rect('.imp-toast-bar'),
      lang: rect('.imp-toast-lang'),
      restore: rect('.imp-toast-restore'),
      settings: rect('.imp-toast-settings'),
    }
  })

  // `imp-translate-toast { display: none !important; position: static }` and
  // `width: 50px !important` from the page must all lose.
  expect(geometry.host.display).toBe('block')
  expect(geometry.host.position).toBe('fixed')
  expect(Math.round(geometry.host.width)).toBe(geometry.viewport)

  // The bar keeps its own padding-based layout…
  expect(Math.round(geometry.bar.width)).toBe(geometry.viewport)
  // …the language select is not stretched by `select { width: 100% }`…
  expect(geometry.lang.width).toBeLessThan(geometry.viewport / 2)
  // …and both controls stay inside the viewport instead of being pushed off
  // the right edge (the AO3 regression: they ended up at x=390+ on a 390px
  // screen, invisible and unclickable).
  for (const rect of [geometry.restore, geometry.settings]) {
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
    expect(rect.right).toBeLessThanOrEqual(geometry.viewport)
  }
  // The select must not swallow the row.
  expect(geometry.lang.right).toBeLessThan(geometry.restore.left)
})

test('hostile page CSS does not leak into the toast, and it still works', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage()
  await openToastOn(page, baseURL)

  const styles = await page.evaluate(() => {
    const root = document.getElementById('imp-translate-toast')!.shadowRoot!
    const read = (sel: string) => {
      const cs = getComputedStyle(root.querySelector(sel)!)
      return {
        fontSize: cs.fontSize,
        letterSpacing: cs.letterSpacing,
        textTransform: cs.textTransform,
        boxSizing: cs.boxSizing,
      }
    }
    return { bar: read('.imp-toast-bar'), restore: read('.imp-toast-restore') }
  })

  // `* { font-size: 19px !important }`, `body { letter-spacing: 2px;
  // text-transform: uppercase }` and `* { box-sizing: content-box }` are all
  // stopped at the host boundary.
  expect(styles.bar.fontSize).toBe('14px')
  expect(styles.bar.letterSpacing).toBe('normal')
  expect(styles.bar.textTransform).toBe('none')
  expect(styles.restore.fontSize).toBe('14px')

  // The panel is the only way back to "show original" on mobile, so it has to
  // stay clickable under the hostile skin.
  await page.locator(`${TOAST} .imp-toast-restore`).click()
  await expect(page.locator(TOAST)).not.toBeVisible({ timeout: 3000 })
})
