import { messager, sendToTab } from '@/lib/message'
import { getSettings, type TranslationProvider } from '@/lib/storage'
import { translate } from '@/lib/translator'
import { getCached, setCached, evictOldEntries } from '@/lib/cache'
import { createTranslateService, type TranslateService } from '@/lib/translate-service'
import { PublicPath } from 'wxt/browser'

async function injectContentScript(tabId: number) {
  await browser.scripting.executeScript({
    target: { tabId },
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
  await sendToTab(tabId, { action: 'startTranslation', targetLang, showToast })
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

async function toggleTranslationForActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  const lang = await getTabTranslatingLang(tab.id)
  if (lang) {
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
  browser.runtime.onInstalled.addListener(() => setupMobileAction())
  browser.runtime.onStartup.addListener(() => setupMobileAction())

  browser.action.onClicked.addListener(() => toggleTranslationForActiveTab())

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-translate') return
    await toggleTranslationForActiveTab()
  })

  messager.onMessage('getSettings', async () => {
    return await getSettings()
  })

  const BATCH_PARAMS: Record<
    TranslationProvider,
    { batchWindowMs: number; maxBatchSize: number; maxBatchChars?: number }
  > = {
    microsoft: { batchWindowMs: 50, maxBatchSize: 25 },
    google: { batchWindowMs: 50, maxBatchSize: 20, maxBatchChars: 14000 },
    openai: { batchWindowMs: 100, maxBatchSize: 20, maxBatchChars: 4000 },
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

  messager.onMessage('isMobile', async () => {
    return await isMobile()
  })

  messager.onMessage('openOptionsPage', async () => {
    await browser.runtime.openOptionsPage()
  })

  browser.webNavigation.onDOMContentLoaded.addListener(async (details) => {
    if (details.frameId !== 0) return
    const lang = await getTabTranslatingLang(details.tabId)
    if (!lang) return

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

    await injectContentScript(details.tabId)
    await sendToTab(details.tabId, {
      action: 'startTranslation',
      targetLang: lang,
    })
  })

  browser.tabs.onRemoved.addListener(async (tabId) => {
    await browser.storage.session.remove(`tab_translating_${tabId}`)
  })
})
