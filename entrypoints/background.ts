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

export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-translate') return
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const lang = await getTabTranslatingLang(tab.id)
    if (lang) {
      await stopTranslationForTab(tab.id)
    } else {
      const settings = await getSettings()
      await startTranslationForTab(tab.id, settings.targetLang)
    }
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

  // Auto-resume translation after navigation (full page reload)
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return
    const lang = await getTabTranslatingLang(tabId)
    if (!lang) return
    await injectContentScript(tabId)
    await sendToTab(tabId, { action: 'startTranslation', targetLang: lang })
  })

  browser.tabs.onRemoved.addListener(async (tabId) => {
    await browser.storage.session.remove(`tab_translating_${tabId}`)
  })
})
