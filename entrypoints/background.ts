import { messager, sendToTab } from '@/lib/message'
import { getSettings, type TranslationProvider } from '@/lib/storage'
import { translate } from '@/lib/translator'
import { getCached, setCached, evictOldEntries } from '@/lib/cache'
import { createTranslateService, type TranslateService } from '@/lib/translate-service'
import { eldDetectLanguage } from '@/lib/eld-detect'
import { parseRules, matchRulesForHostname, type SiteRule } from '@/lib/rules'
import { getEffectiveRules, setupRemoteRulesAlarm, fetchRemoteRulesIfNeeded } from '@/lib/remote-rules'
import { PublicPath } from 'wxt/browser'

async function getMatchedRulesForHostname(hostname: string): Promise<SiteRule[]> {
  const effectiveRules = await getEffectiveRules()
  const rules: SiteRule[] = matchRulesForHostname(effectiveRules, hostname)
  try {
    const result = await browser.storage.local.get('settings')
    const settings = result.settings as Record<string, unknown> | undefined
    if (settings?.developerMode && typeof settings.customRules === 'string') {
      rules.push(...matchRulesForHostname(parseRules(settings.customRules), hostname))
    }
  } catch {}
  return rules
}

function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

function hostnameFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

async function injectContentScript(tabId: number) {
  await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['/inject.js'],
  })
}

async function getTabTranslatingLang(tabId: number): Promise<string | null> {
  const key = `tab_translating_${tabId}`
  const result = await browser.storage.session.get(key)
  return (result[key] as string) ?? null
}

async function setTabTranslatingLang(tabId: number, lang: string | null) {
  const key = `tab_translating_${tabId}`
  if (lang) {
    await browser.storage.session.set({ [key]: lang })
  } else {
    await browser.storage.session.remove(key)
  }
}

const defaultIcon: Record<number, PublicPath> = {
  16: '/icon/16.png',
  32: '/icon/32.png',
  48: '/icon/48.png',
  96: '/icon/96.png',
  128: '/icon/128.png',
}

const activeIcon: Record<number, PublicPath> = {
  16: '/icon/active/16-active.png',
  32: '/icon/active/32-active.png',
  48: '/icon/active/48-active.png',
  96: '/icon/active/96-active.png',
  128: '/icon/active/128-active.png',
}

async function startTranslationForTab(
  tabId: number,
  targetLang: string,
  showToast = false,
) {
  await setTabTranslatingLang(tabId, targetLang)
  await browser.action.setIcon({ tabId, path: activeIcon })
  await injectContentScript(tabId)
  const tab = await browser.tabs.get(tabId)
  const rules = await getMatchedRulesForHostname(hostnameFromUrl(tab.url))
  await sendToTab(tabId, {
    action: 'startTranslation',
    targetLang,
    showToast,
    rules,
  })
}

async function stopTranslationForTab(tabId: number) {
  try {
    await sendToTab(tabId, { action: 'stopTranslation' })
  } catch {
    // Content script may not be loaded
  }
  await browser.action.setIcon({ tabId, path: defaultIcon })
  await setTabTranslatingLang(tabId, null)
}

async function isPageTranslating(tabId: number): Promise<boolean> {
  try {
    const response = (await sendToTab(tabId, { action: 'getState' })) as
      | { isTranslating: boolean }
      | undefined
    return response?.isTranslating === true
  } catch {
    return false
  }
}

async function toggleTranslationForActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  if (isPdfUrl(tab.url)) return
  if (await isPageTranslating(tab.id)) {
    await stopTranslationForTab(tab.id)
  } else {
    const settings = await getSettings()
    await startTranslationForTab(tab.id, settings.targetLang, true)
  }
}

async function isMobile(): Promise<boolean> {
  const info = await browser.runtime.getPlatformInfo()
  return info.os === 'android' || info.os === 'ios'
}

async function setupMobileAction() {
  if (await isMobile()) {
    await browser.action.setPopup({ popup: '' })
  }
}

export default defineBackground(() => {
  setupRemoteRulesAlarm()

  browser.runtime.onInstalled.addListener(() => setupMobileAction())
  browser.runtime.onStartup.addListener(() => setupMobileAction())

  browser.action.onClicked.addListener(() => toggleTranslationForActiveTab())

  // browser.commands is unavailable on Firefox Android
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/commands#browser_compatibility
  if (import.meta.env.BROWSER !== 'firefox') {
    browser.commands.onCommand.addListener(async (command) => {
      if (command !== 'toggle-translate') return
      await toggleTranslationForActiveTab()
    })
  }

  messager.onMessage('getSettings', async () => {
    return await getSettings()
  })

  const BATCH_PARAMS: Record<
    TranslationProvider,
    { batchWindowMs: number; maxBatchSize: number; maxBatchChars?: number }
  > = {
    microsoft: { batchWindowMs: 50, maxBatchSize: 25 },
    google: { batchWindowMs: 50, maxBatchSize: 20, maxBatchChars: 14000 },
    openai: { batchWindowMs: 100, maxBatchSize: 8, maxBatchChars: 1000 },
  }

  const services = new Map<TranslationProvider, TranslateService>()

  function getService(provider: TranslationProvider): TranslateService {
    let service = services.get(provider)
    if (!service) {
      service = createTranslateService({
        ...BATCH_PARAMS[provider],
        getCached,
        setCached,
        translator: async (texts, lang) => {
          const settings = await getSettings()
          const result = await translate(texts, lang, settings)
          return result.texts
        },
        onAfterFlush: () => evictOldEntries(),
      })
      services.set(provider, service)
    }
    return service
  }

  messager.onMessage('translate', async ({ data }) => {
    const settings = await getSettings()
    return getService(settings.provider).translate(data.text, data.targetLang)
  })

  messager.onMessage('startTab', async ({ data }) => {
    await startTranslationForTab(data.tabId, data.targetLang, true)
  })

  messager.onMessage('stopTab', async ({ data }) => {
    await stopTranslationForTab(data.tabId)
  })

  messager.onMessage('getTabState', async ({ data }) => {
    if (!(await isPageTranslating(data.tabId))) return null
    return await getTabTranslatingLang(data.tabId)
  })

  messager.onMessage('getSelfTabState', async ({ sender }) => {
    const tabId = sender.tab?.id
    if (!tabId) return null
    return await getTabTranslatingLang(tabId)
  })

  messager.onMessage('stopSelfTab', async ({ sender }) => {
    const tabId = sender.tab?.id
    if (!tabId) return
    await setTabTranslatingLang(tabId, null)
    await browser.action.setIcon({ tabId, path: defaultIcon })
  })

  messager.onMessage('startSelfTab', async ({ sender, data }) => {
    const tabId = sender.tab?.id
    if (!tabId) return
    await setTabTranslatingLang(tabId, data.targetLang)
  })

  messager.onMessage('isMobile', async () => {
    return await isMobile()
  })

  messager.onMessage('openOptionsPage', async () => {
    await browser.runtime.openOptionsPage()
  })

  messager.onMessage('detectLanguage', ({ data }) => {
    return eldDetectLanguage(data.text)
  })

  messager.onMessage('refreshRemoteRules', async () => {
    await fetchRemoteRulesIfNeeded(true)
  })

  // Per WebExtension spec, per-tab action icons reset on navigation (Chrome +
  // Firefox follow this; Safari preserves them). Reapply on commit — the
  // earliest event we can hook — so the icon doesn't blink to default during
  // link nav. If the navigation turns out to be a reload, the reload branch
  // in onDOMContentLoaded below will revert it.
  browser.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId !== 0) return
    const lang = await getTabTranslatingLang(details.tabId)
    if (!lang) return
    if (isPdfUrl(details.url)) {
      await setTabTranslatingLang(details.tabId, null)
      await browser.action.setIcon({ tabId: details.tabId, path: defaultIcon })
      return
    }
    await browser.action.setIcon({ tabId: details.tabId, path: activeIcon })
  })

  browser.webNavigation.onDOMContentLoaded.addListener(async (details) => {
    if (isPdfUrl(details.url)) return
    const lang = await getTabTranslatingLang(details.tabId)
    if (!lang) return

    if (details.frameId === 0) {
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId: details.tabId },
          func: () =>
            (performance.getEntriesByType('navigation') as PerformanceNavigationTiming[])[0]
              ?.type,
        })
        if (result?.result === 'reload') {
          await setTabTranslatingLang(details.tabId, null)
          await browser.action.setIcon({ tabId: details.tabId, path: defaultIcon })
          return
        }
      } catch {
        // scripting may fail on restricted pages; skip reload check
      }
    }

    await injectContentScript(details.tabId)
    const tab = await browser.tabs.get(details.tabId)
    const rules = await getMatchedRulesForHostname(hostnameFromUrl(tab.url))
    await sendToTab(details.tabId, {
      action: 'startTranslation',
      targetLang: lang,
      rules,
    })
  })

  browser.tabs.onRemoved.addListener(async (tabId) => {
    await browser.storage.session.remove(`tab_translating_${tabId}`)
  })

  if (import.meta.env.DEV) {
    const activeTabId = async () =>
      (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id
    ;(globalThis as Record<string, unknown>).__imp = {
      start: async (lang?: string, tabId?: number) => {
        const id = tabId ?? (await activeTabId())
        if (!id) return null
        const settings = await getSettings()
        await startTranslationForTab(id, lang ?? settings.targetLang, false)
        return id
      },
      stop: async (tabId?: number) => {
        const id = tabId ?? (await activeTabId())
        if (!id) return null
        await stopTranslationForTab(id)
        return id
      },
      toggle: () => toggleTranslationForActiveTab(),
      state: async (tabId?: number) => {
        const id = tabId ?? (await activeTabId())
        if (!id) return null
        return { tabId: id, lang: await getTabTranslatingLang(id) }
      },
    }
  }
})
