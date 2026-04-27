import { messager, sendToTab } from '@/lib/message'
import { getSettings } from '@/lib/storage'
import { translate } from '@/lib/translator'
import { getCached, setCached, evictOldEntries } from '@/lib/cache'

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

async function startTranslationForTab(tabId: number, targetLang: string) {
  await setTabTranslatingLang(tabId, targetLang)
  await injectContentScript(tabId)
  await sendToTab(tabId, { action: 'startTranslation', targetLang })
}

async function stopTranslationForTab(tabId: number) {
  try {
    await sendToTab(tabId, { action: 'stopTranslation' })
  } catch {
    // Content script may not be loaded
  }
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
    await startTranslationForTab(tab.id, settings.targetLang)
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

  messager.onMessage('translate', async ({ data }) => {
    const { texts, targetLang } = data
    const results = new Array<string>(texts.length)
    const uncachedIndices: number[] = []

    await Promise.all(
      texts.map(async (text, i) => {
        const cached = await getCached(text, targetLang)
        if (cached !== undefined) {
          results[i] = cached
        } else {
          uncachedIndices.push(i)
        }
      }),
    )

    if (uncachedIndices.length > 0) {
      const settings = await getSettings()
      const uncachedTexts = uncachedIndices.map((i) => texts[i])
      const translated = await translate(uncachedTexts, targetLang, settings)
      for (let j = 0; j < uncachedIndices.length; j++) {
        results[uncachedIndices[j]] = translated.texts[j]
        setCached(uncachedTexts[j], targetLang, translated.texts[j])
      }
      evictOldEntries()
    }

    return { texts: results }
  })

  messager.onMessage('startTab', async ({ data }) => {
    await startTranslationForTab(data.tabId, data.targetLang)
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
  })

  messager.onMessage('isMobile', async () => {
    return await isMobile()
  })

  messager.onMessage('openOptionsPage', async () => {
    await browser.runtime.openOptionsPage()
  })

  // Track tabs where translation should not resume (reload/typed navigation)
  const skipResumeTabs = new Set<number>()

  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return
    const isForwardBack = (details as any).transitionQualifiers?.includes(
      'forward_back',
    )
    if (
      !isForwardBack &&
      (details.transitionType === 'reload' ||
        details.transitionType === 'typed')
    ) {
      skipResumeTabs.add(details.tabId)
      setTabTranslatingLang(details.tabId, null)
    }
  })

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return
    if (skipResumeTabs.has(tabId)) {
      skipResumeTabs.delete(tabId)
      return
    }
    const lang = await getTabTranslatingLang(tabId)
    if (!lang) return
    await injectContentScript(tabId)
    await sendToTab(tabId, { action: 'startTranslation', targetLang: lang })
  })

  browser.tabs.onRemoved.addListener(async (tabId) => {
    await browser.storage.session.remove(`tab_translating_${tabId}`)
  })
})
