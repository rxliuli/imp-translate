import { messager } from '@/lib/message'
import type { ContentAction } from '@/lib/message'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { selectorsForPath, type SiteRule } from '@/lib/rules'
import {
  extractBlocks,
  clearTranslations,
  markTranslated,
  getVisibleBlocks,
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
import { saveSettings } from '@/lib/storage'
import { isUrlOnly, debugTime } from '@/lib/utils'

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
  let downBatch: TranslatableBlock[] = []
  let downTimer: ReturnType<typeof setTimeout> | null = null
  let upBatch: TranslatableBlock[] = []
  let upTimer: ReturnType<typeof setTimeout> | null = null

  function discardSelfMutations() {
    observer?.takeRecords()
    for (const obs of shadowObservers.values()) obs.takeRecords()
  }

  function translateBatch(batch: TranslatableBlock[]) {
    const t = debugTime(`translateBatch(n=${batch.length})`)
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
    t(`sent ${batch.length} translate messages`)
  }

  async function filterByLanguage(
    blocks: TranslatableBlock[],
  ): Promise<TranslatableBlock[]> {
    if (blocks.length === 0) return blocks
    const results = await messager.sendMessage('detectLanguageBatch', {
      texts: blocks.map((b) => b.text),
    })
    return blocks.filter((_, i) => results[i] !== targetLang)
  }

  async function translateBlocks(blocks: TranslatableBlock[]) {
    if (blocks.length === 0) return

    blocks = blocks.filter((b) => !isUrlOnly(b.text))
    if (blocks.length === 0) return

    const seen = new Set<Element>()
    blocks = blocks.filter((b) => {
      if (b.element.hasAttribute(PROCESSED_ATTR)) return false
      if (seen.has(b.element)) return false
      seen.add(b.element)
      return true
    })
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

  function flushDownBatch() {
    downTimer = null
    if (!isTranslating || downBatch.length === 0) return
    const batch = downBatch.filter((b) => !b.element.hasAttribute(PROCESSED_ATTR))
    downBatch = []
    if (batch.length > 0) translateBlocks(batch)
  }

  function flushUpBatch() {
    upTimer = null
    if (!isTranslating || upBatch.length === 0) return
    const batch = upBatch.filter((b) => !b.element.hasAttribute(PROCESSED_ATTR))
    upBatch = []
    if (batch.length > 0) translateBlocks(batch)
  }

  const lastScrollTops = new WeakMap<EventTarget, number>()
  let scrollDirection: 'up' | 'down' = 'down'
  let lastUpTime = 0
  const UP_COOLDOWN = 200
  function updateScrollDirection(actualDir: 'up' | 'down') {
    if (actualDir === 'up') {
      scrollDirection = 'up'
      lastUpTime = performance.now()
    } else if (performance.now() - lastUpTime > UP_COOLDOWN) {
      scrollDirection = 'down'
    }
  }
  function onScroll(e: Event) {
    const target = e.target
    if (target === document || target === document.documentElement) {
      const y = window.scrollY
      const prev = lastScrollTops.get(document) ?? y
      if (y < prev) updateScrollDirection('up')
      else if (y > prev) updateScrollDirection('down')
      lastScrollTops.set(document, y)
    } else if (target instanceof Element) {
      const y = target.scrollTop
      const prev = lastScrollTops.get(target)
      if (prev !== undefined) {
        if (y < prev) updateScrollDirection('up')
        else if (y > prev) updateScrollDirection('down')
      }
      lastScrollTops.set(target, y)
    }
    if (scrollDirection === 'up' && upBatch.length > 0 && upTimer) {
      clearTimeout(upTimer)
      upTimer = setTimeout(() => {
        const t = debugTime('content:flushUpBatch')
        flushUpBatch()
        t('done')
      }, 300)
    }
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
        if (scrollDirection === 'up') {
          upBatch.push(block)
        } else {
          downBatch.push(block)
        }
        visibilityObserver?.unobserve(el)
        blockMap.delete(el)
      }
    }
    if (downBatch.length > 0 && !downTimer) {
      downTimer = setTimeout(() => {
        const t = debugTime('content:flushDownBatch')
        flushDownBatch()
        t('done')
      }, 50)
    }
    if (upBatch.length > 0) {
      if (upTimer) clearTimeout(upTimer)
      upTimer = setTimeout(() => {
        const t = debugTime('content:flushUpBatch')
        flushUpBatch()
        t('done')
      }, 300)
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
    // Only the top frame shows the toast bar. startTranslation is broadcast
    // to every frame (so iframe content gets translated too); without this
    // guard each large iframe would render its own toast inside itself.
    if (window.self !== window.top) return
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
    const t = debugTime('content:startTranslation')
    if (isTranslating) { t('skipped — already translating'); return }
    isTranslating = true
    targetLang = lang
    hostRules = rules
    cachedPathname = null
    t('state set')
    await loadDeveloperSettings()
    t('loadDeveloperSettings done')
    if (debugMode) injectDebugStyles()
    await waitForDOMReady()
    t('waitForDOMReady done')
    if (!isTranslating) { t('stopped mid-init'); return }
    if (showToast) { maybeShowToast(); t('maybeShowToast called') }
    visibilityObserver = new IntersectionObserver(onIntersection, {
      rootMargin: '0px 0px 100% 0px',
    })
    t('observer created')
    const blocks = extractBlocks(document.body, extractOpts)
    t(`extractBlocks done — ${blocks.length} blocks`)
    document.addEventListener('toggle', onToggle, { capture: true })
    document.addEventListener('click', onClick, { passive: true, capture: true })
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    startObserver()
    startUrlWatcher()
    observeBlocks(blocks)
    t('observeBlocks done — waiting for IntersectionObserver')

    // Immediately translate visible blocks instead of waiting for
    // IntersectionObserver + 50ms batch timer. The observer callback
    // correctly skips already-processed elements via PROCESSED_ATTR.
    const visibleBlocks = getVisibleBlocks(blocks)
    if (visibleBlocks.length > 0) {
      t(`translating ${visibleBlocks.length} visible blocks immediately`)
      translateBlocks(visibleBlocks)
    }

    // SPA frameworks (React, Reddit's Lit-based UI, etc.) hydrate
    // progressively — elements may exist in the DOM but have zero layout
    // dimensions when the initial extractBlocks runs, so isHidden()
    // filters them out. A delayed rescan catches them once rendering
    // settles, without requiring the user to toggle translation off/on.
    delayedRescanTimer = setTimeout(rescanBlocks, 1000)
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
    downBatch = []
    upBatch = []
    if (downTimer) {
      clearTimeout(downTimer)
      downTimer = null
    }
    if (upTimer) {
      clearTimeout(upTimer)
      upTimer = null
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
    document.removeEventListener('scroll', onScroll, { capture: true })
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
      return
    }
    // BFCache restore race: on a refresh (F5), Chrome may fire pageshow
    // on the preserved page BEFORE onDOMContentLoaded clears the session
    // key. Wait a frame and re-check so the reload-triggered key clear
    // has time to propagate. True back/forward navigation keeps the key
    // set, so the re-check is a no-op.
    if (lang && isTranslating) {
      await new Promise((r) => setTimeout(r, 100))
      const lang2 = await messager.sendMessage('getSelfTabState')
      if (!lang2 && isTranslating) {
        stopTranslation()
      }
    }
  })

  // Auto-init: when inject.js is loaded (via injectContentScript from
  // startTranslationForTab), check if this tab should be translating.
  // This avoids the race where sendToTab(startTranslation) arrives before
  // the content script's message listener is registered in some frames.
  //
  // Only the top frame auto-inits. Sub-frames are driven explicitly by the
  // background's webNavigation handlers (which send a per-frame
  // startTranslation), so they never self-start from a session key that may
  // still be stale during a reload. The listener above is registered
  // synchronously, so the background's post-inject sendToTab can't outrace it.
  ;(async () => {
    if (window.self !== window.top) return
    await waitForDOMReady()
    const lang = await messager.sendMessage('getSelfTabState')
    if (!lang) return
    if (isTranslating) return
    const rules = await messager.sendMessage('getMatchedRulesForHostname', {
      hostname: location.hostname,
    })
    startTranslation(lang, false, rules)
  })()
})
