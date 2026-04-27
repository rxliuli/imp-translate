import type { Page, BrowserContext } from '@playwright/test'

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

export async function startTranslation(page: Page, targetLang = 'zh') {
  const tabId = await getTabId(page)
  const sw = await getServiceWorker(page.context())
  await sw.evaluate(
    async ([tabId, lang]) => {
      const key = `tab_translating_${tabId}`
      await chrome.storage.session.set({ [key]: lang })
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['/inject.js'],
      })
      chrome.tabs.sendMessage(tabId, {
        action: 'startTranslation',
        targetLang: lang,
      })
    },
    [tabId, targetLang] as const,
  )
}

export async function stopTranslation(page: Page) {
  const tabId = await getTabId(page)
  const sw = await getServiceWorker(page.context())
  await sw.evaluate(
    async ([tabId]) => {
      chrome.tabs.sendMessage(tabId, { action: 'stopTranslation' })
      const key = `tab_translating_${tabId}`
      await chrome.storage.session.remove(key)
    },
    [tabId] as const,
  )
}
