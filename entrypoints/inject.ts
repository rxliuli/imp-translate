import { messager } from '@/lib/message'
import type { ContentAction } from '@/lib/message'
import {
  extractBlocks,
  getVisibleBlocks,
  clearTranslations,
  markTranslated,
  type TranslatableBlock,
  type ExtractOptions,
  PROCESSED_ATTR,
  RESULT_CLASS,
  getVisibleText,
} from '@/lib/dom'
import {
  injectLoading,
  replaceWithTranslation,
  replaceWithError,
  repositionTranslation,
  removeStyles,
  injectDebugStyles,
  removeDebugStyles,
  showToastBar,
  hideToastBar,
} from '@/lib/render'
import { detectLanguage } from '@/lib/language-detect'

export default defineUnlistedScript(() => {
  let extractOpts: ExtractOptions = { skipSelectors: [], includeSelectors: [] }

  let isTranslating = false
  let targetLang = ''
  let pendingBlocks: TranslatableBlock[] = []
  let observer: MutationObserver | null = null
  let scrollTimer: ReturnType<typeof setTimeout> | null = null
  let urlCheckTimer: ReturnType<typeof setInterval> | null = null
  let lastUrl = location.href

  function translateBatch(batch: TranslatableBlock[]) {
    for (const block of batch) {
      messager
        .sendMessage('translate', { text: block.text, targetLang })
        .then((translated) => {
          if (!isTranslating) return
          replaceWithTranslation([block], [translated])
        })
        .catch((err) => {
          console.error('[imp-translate] translation error:', err)
          if (!isTranslating) return
          replaceWithError([block], (retryBlocks) => {
            translateBatch(retryBlocks)
          })
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
      block.element.setAttribute('data-imp-text', block.text)
    }

    blocks = await filterByLanguage(blocks)
    if (blocks.length === 0) return

    injectLoading(blocks)
    translateBatch(blocks)
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

  function onToggle(e: Event) {
    if (!isTranslating) return
    const details = e.target as HTMLDetailsElement
    if (!details.open) return
    setTimeout(() => {
      if (!isTranslating) return
      const newBlocks = extractBlocks(details, extractOpts)
      for (const block of newBlocks) {
        if (!block.element.hasAttribute(PROCESSED_ATTR)) {
          pendingBlocks.push(block)
        }
      }
      translateVisible()
    }, 100)
  }

  let recheckTimer: ReturnType<typeof setTimeout> | null = null
  const pendingRecheck = new Set<Element>()

  async function retranslateElement(el: Element, newText: string) {
    const wrapper = el.querySelector(`.${RESULT_CLASS}`)
    if (!wrapper) {
      el.removeAttribute(PROCESSED_ATTR)
      el.removeAttribute('data-imp-text')
      const newBlocks = extractBlocks(el, extractOpts)
      if (newBlocks.length > 0) {
        pendingBlocks.push(...newBlocks)
        translateVisible()
      }
      return
    }
    repositionTranslation(el as HTMLElement, newText)
    el.setAttribute('data-imp-text', newText)
    const block: TranslatableBlock = { element: el as HTMLElement, text: newText }
    const filtered = await filterByLanguage([block])
    if (filtered.length === 0) return
    try {
      const translated = await messager.sendMessage('translate', {
        text: newText,
        targetLang,
      })
      if (!isTranslating) return
      if (wrapper.parentElement) {
        wrapper.textContent = translated
      }
    } catch {
      // keep old translation on error
    }
  }

  function flushRecheck() {
    recheckTimer = null
    if (!isTranslating) return
    for (const el of pendingRecheck) {
      if (!el.hasAttribute(PROCESSED_ATTR)) continue
      const storedText = el.getAttribute('data-imp-text')
      if (!storedText) continue
      const currentText = getVisibleText(el, extractOpts.skipSelectors).trim()
      if (storedText === currentText) continue
      retranslateElement(el, currentText)
    }
    pendingRecheck.clear()
  }

  let delayedRescanTimer: ReturnType<typeof setTimeout> | null = null

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      if (!isTranslating) return
      let hasNew = false
      let needsDelayedRescan = false
      for (const mutation of mutations) {
        const target = mutation.target
        if (target instanceof Element && target.closest(`.${RESULT_CLASS}`)) continue
        const el = target instanceof Element ? target : target.parentElement
        const translated = el?.closest(`[${PROCESSED_ATTR}]`)
        if (translated) {
          pendingRecheck.add(translated as Element)
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const addedEl = node as Element
          if (addedEl.classList?.contains(RESULT_CLASS)) continue
          if (addedEl.hasAttribute(PROCESSED_ATTR)) continue
          if (addedEl.closest(`[${PROCESSED_ATTR}]`)) continue
          const newBlocks = extractBlocks(addedEl, extractOpts)
          if (newBlocks.length > 0) {
            pendingBlocks.push(...newBlocks)
            hasNew = true
          } else {
            const tag = addedEl.tagName.toLowerCase()
            if (!tag.includes('loader') && tag !== 'script' && tag !== 'style') {
              const text = addedEl.textContent?.trim()
              if (text && text.length > 20) {
                needsDelayedRescan = true
              }
            }
          }
        }
      }
      if (pendingRecheck.size > 0) {
        if (recheckTimer) clearTimeout(recheckTimer)
        recheckTimer = setTimeout(flushRecheck, 300)
      }
      if (needsDelayedRescan) {
        if (delayedRescanTimer) clearTimeout(delayedRescanTimer)
        delayedRescanTimer = setTimeout(rescanBlocks, 500)
      }
      if (hasNew) translateVisible()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
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

  function rescanBlocks() {
    if (!isTranslating) return
    const newBlocks = extractBlocks(document.body, extractOpts)
    let hasNew = false
    for (const block of newBlocks) {
      if (!block.element.hasAttribute(PROCESSED_ATTR)) {
        pendingBlocks.push(block)
        hasNew = true
      }
    }
    if (hasNew) translateVisible()
  }

  function onUrlChange() {
    if (!isTranslating) return
    pendingBlocks = extractBlocks(document.body, extractOpts)
    translateVisible()
    setTimeout(rescanBlocks, 1000)
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

  function waitForDOMReady(): Promise<void> {
    if (document.readyState !== 'loading') return Promise.resolve()
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
    })
  }

  let debugMode = false

  async function loadDeveloperSettings() {
    try {
      const result = await browser.storage.sync.get('settings')
      const settings = result.settings as Record<string, unknown> | undefined
      debugMode = settings?.debugMode === true
    } catch {}
  }

  async function startTranslation(
    lang: string,
    showToast = false,
    skipSelectors: string[] = [],
    includeSelectors: string[] = [],
  ) {
    if (isTranslating) return
    isTranslating = true
    targetLang = lang
    extractOpts = { skipSelectors, includeSelectors }
    await loadDeveloperSettings()
    if (debugMode) injectDebugStyles()
    await waitForDOMReady()
    if (!isTranslating) return
    lastUrl = location.href
    if (showToast) maybeShowToast()
    pendingBlocks = extractBlocks(document.body, extractOpts)
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    document.addEventListener('toggle', onToggle, { capture: true })
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
    if (recheckTimer) {
      clearTimeout(recheckTimer)
      recheckTimer = null
    }
    if (delayedRescanTimer) {
      clearTimeout(delayedRescanTimer)
      delayedRescanTimer = null
    }
    pendingRecheck.clear()
    document.removeEventListener('scroll', onScroll, { capture: true })
    document.removeEventListener('toggle', onToggle, { capture: true })
    clearTranslations(document.body)
    removeStyles()
    removeDebugStyles()
    debugMode = false
    dismissToast()
    pendingBlocks = []
  }

  browser.runtime.onMessage.addListener(
    (message: ContentAction, _sender, sendResponse) => {
      if (!message?.action) return
      if (message.action === 'startTranslation') {
        startTranslation(
          message.targetLang,
          message.showToast,
          message.skipSelectors,
          message.includeSelectors,
        )
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
