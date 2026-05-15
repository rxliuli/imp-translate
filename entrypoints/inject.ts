import { messager } from '@/lib/message'
import type { ContentAction } from '@/lib/message'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { selectorsForPath, type SiteRule } from '@/lib/rules'
import {
  extractBlocks,
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
  ensureShadowStyles,
} from '@/lib/render'
import { detectLanguage } from '@/lib/language-detect'
import { saveSettings } from '@/lib/storage'
import { isUrlOnly } from '@/lib/utils'

export default defineUnlistedScript(() => {
  const w = window as unknown as Record<string, unknown>
  if (w.__imp_injected) return
  w.__imp_injected = true

  if (window.self !== window.top && (window.innerWidth < 100 || window.innerHeight < 40)) return

  const ctx = new ContentScriptContext('inject')

  // Host-matched rules (each carries its own pathPattern). Path filtering
  // happens lazily when the walker reads opts.skipSelectors / includeSelectors,
  // so SPA route changes resolve to the right selector set without an IPC
  // round-trip — and without the race against MutationObserver that would
  // appear if pathname-active selectors arrived asynchronously.
  let hostRules: SiteRule[] = []
  let cachedPathname: string | null = null
  let cachedSelectors = { skipSelectors: [] as string[], includeSelectors: [] as string[] }

  function getActiveSelectors() {
    const p = location.pathname
    if (p !== cachedPathname) {
      cachedPathname = p
      cachedSelectors = selectorsForPath(hostRules, p)
    }
    return cachedSelectors
  }

  const extractOpts: ExtractOptions = {
    get skipSelectors() {
      return getActiveSelectors().skipSelectors
    },
    get includeSelectors() {
      return getActiveSelectors().includeSelectors
    },
    onShadowRoot: (r) => attachShadowObserver(r),
  }

  let isTranslating = false
  let targetLang = ''
  let observer: MutationObserver | null = null
  const shadowObservers = new Map<ShadowRoot, MutationObserver>()
  let clickRescanTimer: ReturnType<typeof setTimeout> | null = null
  let visibilityObserver: IntersectionObserver | null = null
  const blockMap = new Map<Element, TranslatableBlock>()
  let visibleBatch: TranslatableBlock[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  function discardSelfMutations() {
    observer?.takeRecords()
    for (const obs of shadowObservers.values()) obs.takeRecords()
  }

  function translateBatch(batch: TranslatableBlock[]) {
    for (const block of batch) {
      messager
        .sendMessage('translate', { text: block.text, targetLang })
        .then((translated) => {
          if (!isTranslating) return
          replaceWithTranslation([block], [translated])
          discardSelfMutations()
        })
        .catch((err) => {
          console.error('[imp-translate] translation error:', err)
          if (!isTranslating) return
          replaceWithError([block], (retryBlocks) => {
            translateBatch(retryBlocks)
          })
          discardSelfMutations()
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

    blocks = blocks.filter((b) => !isUrlOnly(b.text))
    if (blocks.length === 0) return

    for (const block of blocks) {
      markTranslated(block.element)
      block.element.setAttribute('data-imp-text', block.text)
    }

    blocks = await filterByLanguage(blocks)
    if (blocks.length === 0) return

    injectLoading(blocks)
    discardSelfMutations()
    translateBatch(blocks)
  }

  function flushVisibleBatch() {
    batchTimer = null
    if (!isTranslating || visibleBatch.length === 0) return
    const batch = visibleBatch.filter((b) => !b.element.hasAttribute(PROCESSED_ATTR))
    visibleBatch = []
    if (batch.length > 0) translateBlocks(batch)
  }

  function onIntersection(entries: IntersectionObserverEntry[]) {
    if (!isTranslating) return
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const el = entry.target
      if (el.hasAttribute(PROCESSED_ATTR)) {
        visibilityObserver?.unobserve(el)
        blockMap.delete(el)
        continue
      }
      const block = blockMap.get(el)
      if (block) {
        visibleBatch.push(block)
        visibilityObserver?.unobserve(el)
        blockMap.delete(el)
      }
    }
    if (visibleBatch.length > 0 && !batchTimer) {
      batchTimer = setTimeout(flushVisibleBatch, 50)
    }
  }

  function observeBlocks(blocks: TranslatableBlock[]) {
    if (!visibilityObserver) return
    for (const block of blocks) {
      if (block.element.hasAttribute(PROCESSED_ATTR)) continue
      if (blockMap.has(block.element)) continue
      blockMap.set(block.element, block)
      visibilityObserver.observe(block.element)
    }
  }

  function onToggle(e: Event) {
    if (!isTranslating) return
    const details = e.target as HTMLDetailsElement
    if (!details.open) return
    setTimeout(() => {
      if (!isTranslating) return
      const newBlocks = extractBlocks(details, extractOpts)
      discardSelfMutations()
      observeBlocks(newBlocks)
    }, 100)
  }

  // Catches click-to-expand patterns where the toggle is a CSS class change
  // (e.g. TV Tropes' .folderlabel.is-open ~ p { display: block }) — no DOM
  // mutation, no <details> toggle event, so the regular observer can't see
  // the newly-visible content. Debounced; rescan is idempotent against
  // already-translated subtrees via PROCESSED_ATTR.
  function onClick() {
    if (!isTranslating) return
    if (clickRescanTimer) clearTimeout(clickRescanTimer)
    clickRescanTimer = setTimeout(() => {
      clickRescanTimer = null
      rescanBlocks()
    }, 200)
  }

  let recheckTimer: ReturnType<typeof setTimeout> | null = null
  const pendingRecheck = new Set<Element>()

  async function retranslateElement(el: Element, newText: string) {
    const wrapper = el.querySelector(`.${RESULT_CLASS}`)
    if (!wrapper) {
      el.removeAttribute(PROCESSED_ATTR)
      el.removeAttribute('data-imp-text')
      const newBlocks = extractBlocks(el, extractOpts)
      discardSelfMutations()
      observeBlocks(newBlocks)
      return
    }
    repositionTranslation(el as HTMLElement, newText)
    el.setAttribute('data-imp-text', newText)
    discardSelfMutations()
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
        discardSelfMutations()
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

  function handleMutations(mutations: MutationRecord[]) {
    if (!isTranslating) return
    let needsDelayedRescan = false
    const newBlocks: TranslatableBlock[] = []
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
        if (addedEl.classList?.contains('imp-translate-br')) continue
        if (addedEl.hasAttribute('data-imp-wrap')) continue
        if (addedEl.hasAttribute(PROCESSED_ATTR)) continue
        if (addedEl.closest(`[${PROCESSED_ATTR}]`)) continue
        const extracted = extractBlocks(addedEl, extractOpts)
        if (extracted.length > 0) {
          newBlocks.push(...extracted)
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
    discardSelfMutations()
    if (newBlocks.length > 0) observeBlocks(newBlocks)
  }

  function attachShadowObserver(root: ShadowRoot) {
    if (shadowObservers.has(root)) return
    ensureShadowStyles(root)
    if (!isTranslating) return
    const obs = new MutationObserver(handleMutations)
    obs.observe(root, { childList: true, subtree: true, characterData: true })
    shadowObservers.set(root, obs)
  }

  function startObserver() {
    observer = new MutationObserver(handleMutations)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  function startUrlWatcher() {
    // wxt:locationchange fires on history.pushState / replaceState / popstate.
    // The active selector set updates lazily in getActiveSelectors via
    // location.pathname, so this handler only triggers a re-walk to pick up
    // elements that changed eligibility under the new pathname.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      if (!isTranslating) return
      onUrlChange()
    })
  }

  function rescanBlocks() {
    if (!isTranslating) return
    const newBlocks = extractBlocks(document.body, extractOpts)
    discardSelfMutations()
    observeBlocks(newBlocks)
  }

  function onUrlChange() {
    if (!isTranslating) return
    visibilityObserver?.disconnect()
    blockMap.clear()
    const blocks = extractBlocks(document.body, extractOpts)
    discardSelfMutations()
    observeBlocks(blocks)
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
    showToastBar({
      currentLang: targetLang,
      onRestore: () => {
        dismissToast()
        stopTranslation()
        messager.sendMessage('stopSelfTab')
      },
      onSettings: () => {
        dismissToast()
        messager.sendMessage('openOptionsPage')
      },
      onLangChange: async (lang) => {
        const rules = hostRules
        stopTranslation(true)
        await saveSettings({ targetLang: lang })
        messager.sendMessage('startSelfTab', { targetLang: lang })
        await startTranslation(lang, false, rules)
      },
      onResetTimer: (delayMs) => {
        if (toastTimer) {
          clearTimeout(toastTimer)
        }
        toastTimer = setTimeout(dismissToast, delayMs)
      },
    })
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
      const result = await browser.storage.local.get('settings')
      const settings = result.settings as Record<string, unknown> | undefined
      debugMode = settings?.debugMode === true
    } catch {}
  }

  async function startTranslation(
    lang: string,
    showToast = false,
    rules: SiteRule[] = [],
  ) {
    if (isTranslating) return
    isTranslating = true
    targetLang = lang
    hostRules = rules
    cachedPathname = null
    await loadDeveloperSettings()
    if (debugMode) injectDebugStyles()
    await waitForDOMReady()
    if (!isTranslating) return
    if (showToast) maybeShowToast()
    visibilityObserver = new IntersectionObserver(onIntersection, {
      rootMargin: '0px 0px 100% 0px',
    })
    const blocks = extractBlocks(document.body, extractOpts)
    document.addEventListener('toggle', onToggle, { capture: true })
    document.addEventListener('click', onClick, { passive: true, capture: true })
    startObserver()
    startUrlWatcher()
    observeBlocks(blocks)
  }

  function stopTranslation(keepToast = false) {
    isTranslating = false
    if (observer) {
      observer.disconnect()
      observer = null
    }
    for (const obs of shadowObservers.values()) {
      obs.disconnect()
    }
    shadowObservers.clear()
    if (visibilityObserver) {
      visibilityObserver.disconnect()
      visibilityObserver = null
    }
    blockMap.clear()
    visibleBatch = []
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    if (recheckTimer) {
      clearTimeout(recheckTimer)
      recheckTimer = null
    }
    if (delayedRescanTimer) {
      clearTimeout(delayedRescanTimer)
      delayedRescanTimer = null
    }
    if (clickRescanTimer) {
      clearTimeout(clickRescanTimer)
      clickRescanTimer = null
    }
    pendingRecheck.clear()
    document.removeEventListener('toggle', onToggle, { capture: true })
    document.removeEventListener('click', onClick, { capture: true })
    clearTranslations(document.body)
    removeStyles()
    removeDebugStyles()
    debugMode = false
    if (!keepToast) dismissToast()
  }

  browser.runtime.onMessage.addListener(
    (message: ContentAction, _sender, sendResponse) => {
      if (!message?.action) return
      if (message.action === 'startTranslation') {
        startTranslation(message.targetLang, message.showToast, message.rules)
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
