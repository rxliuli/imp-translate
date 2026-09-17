import type { Page, BrowserContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRules, matchRulesForHostname, type SiteRule } from '../lib/rules'

const __dirname = dirname(fileURLToPath(import.meta.url))
const builtinRulesRaw = readFileSync(resolve(__dirname, '../lib/rules.txt'), 'utf-8')
const builtinRules = parseRules(builtinRulesRaw)

async function computeRulesForPage(page: Page): Promise<SiteRule[]> {
  const hostname = new URL(page.url()).hostname
  const sw = await getServiceWorker(page.context())
  const settings = (await sw.evaluate(async () => {
    const r = await chrome.storage.local.get('settings')
    return r.settings as { developerMode?: boolean; customRules?: string } | undefined
  })) ?? {}

  const allRules: SiteRule[] = [...builtinRules]
  if (settings.developerMode && typeof settings.customRules === 'string') {
    allRules.push(...parseRules(settings.customRules))
  }
  return matchRulesForHostname(allRules, hostname)
}

export async function setCustomRules(context: BrowserContext, rules: string) {
  const sw = await getServiceWorker(context)
  await sw.evaluate(async (customRules) => {
    const existing = ((await chrome.storage.local.get('settings')).settings ?? {}) as Record<
      string,
      unknown
    >
    await chrome.storage.local.set({
      settings: { ...existing, developerMode: true, customRules },
    })
  }, rules)
}

export async function getServiceWorker(context: BrowserContext) {
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  return sw
}

export async function getTabId(page: Page): Promise<number> {
  const url = page.url()
  const sw = await getServiceWorker(page.context())
  const tabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url })
    return tabs[0]?.id
  }, url)
  if (!tabId) throw new Error('No tab ID found')
  return tabId
}

// Messages to the content script go through @webext-core/messaging on the
// receiving side, so tests must send the library's wire envelope
// ({ id, type, data, timestamp }) instead of a bare { action } object — the
// content script's listener rejects anything without a `type` and
// `timestamp`, and `tabs.sendMessage` would then hang with no response.
// Keeping the envelope in one place here keeps that coupling visible.
export async function sendToContentScript(
  context: BrowserContext,
  tabId: number,
  type: 'startTranslation' | 'stopTranslation' | 'showToast' | 'getState',
  data?: unknown,
): Promise<unknown> {
  const sw = await getServiceWorker(context)
  return await sw.evaluate(
    async ([tabId, type, data]) =>
      await chrome.tabs.sendMessage(tabId, {
        id: 1,
        type,
        data,
        timestamp: Date.now(),
      }),
    [tabId, type, data] as const,
  )
}

export async function configureMockProvider(page: Page, baseURL: string) {
  const sw = await getServiceWorker(page.context())
  await sw.evaluate(async (endpoint) => {
    await chrome.storage.local.set({
      settings: {
        provider: 'openai',
        targetLang: 'zh',
        openai: {
          apiKey: 'test-key',
          endpoint,
          model: 'mock',
          systemPrompt: 'Translate to {{targetLang}}.',
        },
      },
    })
  }, `${baseURL}/v1/chat/completions`)
}

export async function startTranslation(page: Page, targetLang = 'zh', showToast = false) {
  const tabId = await getTabId(page)
  const sw = await getServiceWorker(page.context())
  const rules = await computeRulesForPage(page)
  await sw.evaluate(
    async ([tabId, lang]) => {
      await chrome.storage.session.set({ [`tab_translating_${tabId}`]: lang })
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['/inject.js'],
      })
    },
    [tabId, targetLang] as const,
  )
  await sendToContentScript(page.context(), tabId, 'startTranslation', {
    targetLang,
    showToast,
    rules,
  })
}

export async function enableMobileMode(context: BrowserContext) {
  const sw = await getServiceWorker(context)
  await sw.evaluate(() => {
    chrome.runtime.getPlatformInfo = (() =>
      Promise.resolve({ os: 'android', arch: 'x86-64', nacl_arch: 'x86-64' })) as any
  })
}

export async function stopTranslation(page: Page) {
  const tabId = await getTabId(page)
  const sw = await getServiceWorker(page.context())
  try {
    await sendToContentScript(page.context(), tabId, 'stopTranslation')
  } catch {
    // No content script in this tab (the test may drive a tab that just
    // navigated, e.g. before the background re-injected on DOMContentLoaded).
    // Clearing the session key below is what the assertions depend on — the
    // same best-effort shape the background's stopTranslationForTab uses.
  }
  await sw.evaluate(async (tabId) => {
    await chrome.storage.session.remove(`tab_translating_${tabId}`)
  }, tabId)
}

// What the background sends to a tab that is already translating when the
// toolbar icon is clicked on mobile (there is no popup there, so the in-page
// toast bar is the control panel). `chrome.action.onClicked` can't be
// dispatched from a test, so the background's branch is exercised through the
// message it emits.
export async function summonPanel(page: Page) {
  const tabId = await getTabId(page)
  await sendToContentScript(page.context(), tabId, 'showToast')
}

// The popup inspects `tabs.query({ active: true, currentWindow: true })`, so
// opening popup.html as a normal tab (what a plain page.goto does) makes it
// inspect itself — a chrome-extension:// page with no content script, which is
// never translating. Creating the tab in the background instead keeps the page
// under test active, and is the only way to reach the popup's translate path:
// chrome.action.onClicked cannot be dispatched from a test.
export async function openBackgroundPopup(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const url = `chrome-extension://${extensionId}/popup.html`
  const sw = await getServiceWorker(context)
  await sw.evaluate(async (url) => {
    await chrome.tabs.create({ url, active: false })
  }, url)

  for (let i = 0; i < 50; i++) {
    const found = context.pages().find((p) => p.url().startsWith(url))
    if (found) {
      await found.waitForLoadState('domcontentloaded')
      return found
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('popup tab did not appear')
}

// Chrome has no chrome.action.getIcon, so to assert icon state in e2e we
// monkey-patch chrome.action.setIcon in the service worker and record every
// call. Detect kind by path: '/icon/active/...' is active, anything else is
// default. Idempotent — safe to call once per test before the navigation we
// care about.
export async function instrumentSetIcon(context: BrowserContext) {
  const sw = await getServiceWorker(context)
  await sw.evaluate(() => {
    type Call = { tabId?: number; icon: 'active' | 'default' }
    const g = globalThis as {
      __setIconCalls?: Call[]
      __setIconOrig?: typeof chrome.action.setIcon
    }
    if (g.__setIconCalls) return
    g.__setIconCalls = []
    g.__setIconOrig = chrome.action.setIcon.bind(chrome.action)
    chrome.action.setIcon = ((details: chrome.action.TabIconDetails) => {
      const path = details.path
      const sample =
        typeof path === 'string'
          ? path
          : ((path as Record<string, string> | undefined)?.['16'] ?? '')
      const icon: Call['icon'] = sample.includes('active') ? 'active' : 'default'
      g.__setIconCalls!.push({ tabId: details.tabId, icon })
      return g.__setIconOrig!(details)
    }) as typeof chrome.action.setIcon
  })
}

export async function getLastIcon(
  context: BrowserContext,
  tabId: number,
): Promise<'active' | 'default' | null> {
  const sw = await getServiceWorker(context)
  return sw.evaluate((tabId) => {
    type Call = { tabId?: number; icon: 'active' | 'default' }
    const calls = (globalThis as { __setIconCalls?: Call[] }).__setIconCalls ?? []
    const mine = calls.filter((c) => c.tabId === tabId)
    return mine.length > 0 ? mine[mine.length - 1].icon : null
  }, tabId)
}
