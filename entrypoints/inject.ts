import { messager } from '@/lib/message'
import type { ContentAction } from '@/lib/message'
import {
  extractBlocks,
  getVisibleBlocks,
  clearTranslations,
  markTranslated,
  type TranslatableBlock,
  PROCESSED_ATTR,
} from '@/lib/dom'
import {
  injectLoading,
  replaceWithTranslation,
  replaceWithError,
  removeStyles,
  showToastBar,
  hideToastBar,
} from '@/lib/render'
import { detectLanguage } from '@/lib/language-detect'

export default defineUnlistedScript(() => {
  let isTranslating = false
  let targetLang = ''
  let pendingBlocks: TranslatableBlock[] = []
  let observer: MutationObserver | null = null
  let scrollTimer: ReturnType<typeof setTimeout> | null = null
  let urlCheckTimer: ReturnType<typeof setInterval> | null = null
  let lastUrl = location.href

  async function translateBatch(batch: TranslatableBlock[]) {
    const texts = batch.map((b) => b.text)
    try {
      const result = await messager.sendMessage('translate', {
        texts,
        targetLang,
      })
      if (!isTranslating) return
      replaceWithTranslation(batch, result.texts)
    } catch (err) {
      console.error('[imp-translate] translation error:', err)
      if (!isTranslating) return
      replaceWithError(batch, (retryBlocks) => {
        translateBatch(retryBlocks)
      })
    }
  }

  async function filterByLanguage(
    blocks: TranslatableBlock[],
  ): Promise<TranslatableBlock[]> {
    const results = await Promise.all(blocks.map((b) => detectLanguage(b.text)))
    return blocks.filter((_, i) => results[i] !== targetLang)
  }

  async function translateBlocks(blocks: TranslatableBlock[]) {
    if (blocks.length === 0) return

    for (const block of blocks) {
      markTranslated(block.element)
    }

    blocks = await filterByLanguage(blocks)
    if (blocks.length === 0) return

    injectLoading(blocks)

    const BATCH_SIZE = 20
    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      if (!isTranslating) return
      const batch = blocks.slice(i, i + BATCH_SIZE)
      await translateBatch(batch)
    }
  }

  async function translateVisible() {
    if (!isTranslating) return
    const visible = getVisibleBlocks(pendingBlocks)
    const untranslated = visible.filter(
      (b) => !b.element.hasAttribute(PROCESSED_ATTR),
    )
    await translateBlocks(untranslated)
  }

  function onScroll() {
    if (scrollTimer) clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      translateVisible()
    }, 300)
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      if (!isTranslating) return
      let hasNew = false
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const el = node as Element
          if (el.classList?.contains('imp-translate-result')) continue
          const newBlocks = extractBlocks(el)
          if (newBlocks.length > 0) {
            pendingBlocks.push(...newBlocks)
            hasNew = true
          }
        }
      }
      if (hasNew) translateVisible()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  function startUrlWatcher() {
    urlCheckTimer = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        onUrlChange()
      }
    }, 500)
    window.addEventListener('popstate', () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        onUrlChange()
      }
    })
  }

  function onUrlChange() {
    if (!isTranslating) return
    clearTranslations(document.body)
    pendingBlocks = extractBlocks(document.body)
    translateVisible()
  }

  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function dismissToast() {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    hideToastBar()
  }

  async function maybeShowToast() {
    const mobile = await messager.sendMessage('isMobile')
    if (!mobile) return
    showToastBar(
      () => {
        dismissToast()
        stopTranslation()
        messager.sendMessage('stopSelfTab')
      },
      () => {
        dismissToast()
        messager.sendMessage('openOptionsPage')
      },
    )
    toastTimer = setTimeout(dismissToast, 5000)
  }

  async function startTranslation(lang: string) {
    if (isTranslating) return
    isTranslating = true
    targetLang = lang
    lastUrl = location.href
    maybeShowToast()
    pendingBlocks = extractBlocks(document.body)
    window.addEventListener('scroll', onScroll, { passive: true })
    startObserver()
    startUrlWatcher()
    await translateVisible()
  }

  function stopTranslation() {
    isTranslating = false
    if (observer) {
      observer.disconnect()
      observer = null
    }
    if (scrollTimer) {
      clearTimeout(scrollTimer)
      scrollTimer = null
    }
    if (urlCheckTimer) {
      clearInterval(urlCheckTimer)
      urlCheckTimer = null
    }
    window.removeEventListener('scroll', onScroll)
    clearTranslations(document.body)
    removeStyles()
    dismissToast()
    pendingBlocks = []
  }

  browser.runtime.onMessage.addListener(
    (message: ContentAction, _sender, sendResponse) => {
      if (!message?.action) return
      if (message.action === 'startTranslation') {
        startTranslation(message.targetLang)
      } else if (message.action === 'stopTranslation') {
        stopTranslation()
      } else if (message.action === 'getState') {
        sendResponse({ isTranslating })
        return true
      }
    },
  )

  window.addEventListener('pageshow', async (e) => {
    if (!e.persisted) return
    const lang = await messager.sendMessage('getSelfTabState')
    if (!lang && isTranslating) {
      stopTranslation()
    }
  })
})
