import { messager } from '@/lib/message'
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
  needsBlankLineSplit,
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
  ensureStylesFor,
  injectRunLoading,
} from '@/lib/render'
import {
  collectReplaceableTextNodes,
  applyReplacement,
  entriesIntact,
  getSourceText,
  markLoading,
  unmarkLoading,
  restoreReplacements,
  restoreOwner,
  pruneDisconnected,
  blockOwner,
  type ReplaceEntry,
} from '@/lib/replace'
import {
  getRewrite,
  MAX_REWRITES,
  noteRewrite,
  onRewriteStale,
  resetRewriteCounts,
  restoreRewrite,
  rewriteBlock,
  rewriteIntact,
  rewriteText,
} from '@/lib/rewrite'
import { getSettings, saveSettings, type DisplayMode } from '@/lib/storage'
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
    // Replace mode only writes Text.data — the walk itself included.
    get noStructuralWrites() {
      return displayMode === 'replace'
    },
    // Same reason: in-place text swaps can't break nav/footer layout, so
    // replace mode translates page chrome and ignores include rules.
    get translateChrome() {
      return displayMode === 'replace'
    },
    isRunProcessed: (nodes) => nodes.some((n) => runOfNode.get(n)?.processed === true),
  }

  let isTranslating = false
  let targetLang = ''
  let displayMode: DisplayMode = 'bilingual'
  let observer: MutationObserver | null = null
  const shadowObservers = new Map<ShadowRoot, MutationObserver>()
  let clickRescanTimer: ReturnType<typeof setTimeout> | null = null
  let visibilityObserver: IntersectionObserver | null = null
  // Observed element -> its pending blocks: one for an element block, or the
  // virtual blocks (runs) of a mixed container.
  const blockMap = new Map<Element, TranslatableBlock[]>()
  let downBatch: TranslatableBlock[] = []
  let downTimer: ReturnType<typeof setTimeout> | null = null
  let upBatch: TranslatableBlock[] = []
  let upTimer: ReturnType<typeof setTimeout> | null = null
  // Bumped by every start/stop. Responses carry the id they were sent under
  // and are dropped when it no longer matches: after a language switch the
  // old session's requests are still in flight with the same source text, so
  // the data-imp-text token alone can't tell them apart.
  let sessionId = 0

  // Replace-mode virtual blocks (a run of nodes inside a mixed container, see
  // TranslatableBlock.nodes). Their container may hold several runs and block
  // children, so their state can't live in attributes on it: it is keyed by
  // the run's first node (runStates), with reverse lookups from every top-level
  // node of the run (runOfNode, for mutation rechecks) and from the container
  // (containerRuns, for childList changes directly in it). Reassigned on stop.
  interface RunState {
    nodes: Node[]
    container: HTMLElement
    // data-imp-text equivalent: the ownership token for in-flight requests.
    text: string
    processed: boolean
    noop: boolean
    // Bilingual fallback nodes inserted after the run's last node.
    inserted: HTMLElement[] | null
    // Top-level nodes of a structural rewrite (lib/rewrite.ts) standing in
    // for `nodes`, which are detached meanwhile.
    rewritten: Node[] | null
  }
  let runStates = new WeakMap<Node, RunState>()
  let runOfNode = new WeakMap<Node, RunState>()
  let containerRuns = new WeakMap<Element, Set<RunState>>()

  // Replace-mode request failures, keyed by blockOwner: the block is
  // unmarked so a rescan/recheck picks it up again, but not within
  // RETRY_BACKOFF_MS of the last failure.
  const RETRY_BACKOFF_MS = 5000
  const MAX_AUTO_RETRIES = 3
  let failures = new WeakMap<Node, { at: number; count: number }>()
  // Owners whose rewrite loop was given up on (warned once).
  let rewriteGaveUp = new WeakSet<Node>()

  function isBlockProcessed(block: TranslatableBlock): boolean {
    if (block.nodes) return runStates.get(block.nodes[0])?.processed === true
    return block.element.hasAttribute(PROCESSED_ATTR)
  }

  function getBlockText(block: TranslatableBlock): string | null {
    if (block.nodes) return runStates.get(block.nodes[0])?.text ?? null
    return block.element.getAttribute('data-imp-text')
  }

  function setBlockText(block: TranslatableBlock, text: string) {
    if (block.nodes) {
      const state = runStates.get(block.nodes[0])
      if (state) state.text = text
      return
    }
    block.element.setAttribute('data-imp-text', text)
  }

  function setBlockNoop(block: TranslatableBlock, noop: boolean) {
    if (block.nodes) {
      const state = runStates.get(block.nodes[0])
      if (state) state.noop = noop
      return
    }
    if (noop) block.element.setAttribute('data-imp-noop', '')
    else block.element.removeAttribute('data-imp-noop')
  }

  // markTranslated + data-imp-text, or the virtual-block equivalent.
  function markBlock(block: TranslatableBlock) {
    if (!block.nodes) {
      markTranslated(block.element)
      block.element.setAttribute('data-imp-text', block.text)
      return
    }
    const prev = runStates.get(block.nodes[0])
    if (prev) unregisterRun(prev)
    const state: RunState = {
      nodes: block.nodes,
      container: block.element,
      text: block.text,
      processed: true,
      noop: false,
      inserted: null,
      rewritten: null,
    }
    runStates.set(block.nodes[0], state)
    for (const n of block.nodes) runOfNode.set(n, state)
    let runs = containerRuns.get(block.element)
    if (!runs) {
      runs = new Set()
      containerRuns.set(block.element, runs)
    }
    runs.add(state)
  }

  // Forget a run (and remove its bilingual fallback nodes, if any). Its
  // in-place replacements are left to the caller.
  function unregisterRun(state: RunState) {
    if (runStates.get(state.nodes[0]) === state) runStates.delete(state.nodes[0])
    for (const n of liveNodes(state)) {
      if (runOfNode.get(n) === state) runOfNode.delete(n)
    }
    for (const n of state.nodes) {
      if (runOfNode.get(n) === state) runOfNode.delete(n)
    }
    containerRuns.get(state.container)?.delete(state)
    if (state.inserted) {
      for (const n of state.inserted) n.remove()
      state.inserted = null
    }
  }

  // The nodes a run currently shows: its own, or the rewrite standing in.
  function liveNodes(state: RunState): Node[] {
    return state.rewritten ?? state.nodes
  }

  // Undo a structural rewrite of the block, if any (its in-place Text.data
  // replacements are left alone).
  function undoRewrite(block: TranslatableBlock): boolean {
    const owner = blockOwner(block)
    if (!getRewrite(owner)) return false
    if (block.nodes) {
      const state = runStates.get(block.nodes[0])
      if (state?.rewritten) {
        for (const n of state.rewritten) {
          if (runOfNode.get(n) === state) runOfNode.delete(n)
        }
        state.rewritten = null
      }
    }
    return restoreRewrite(owner)
  }

  function unmarkBlock(block: TranslatableBlock) {
    if (block.nodes) {
      const state = runStates.get(block.nodes[0])
      if (state) unregisterRun(state)
      return
    }
    block.element.removeAttribute(PROCESSED_ATTR)
    block.element.removeAttribute('data-imp-text')
  }

  // Put the page's text back for this block only (a virtual block's
  // container may hold other translated runs).
  function restoreBlock(block: TranslatableBlock) {
    undoRewrite(block)
    if (block.nodes) restoreOwner(block.nodes[0])
    else restoreReplacements(block.element)
  }

  function blockSourceText(block: TranslatableBlock): string {
    return getSourceText(block.nodes ?? block.element, extractOpts.skipSelectors).trim()
  }

  // `o` already covers `b`'s text.
  function blockContains(o: TranslatableBlock, b: TranslatableBlock): boolean {
    const target = b.nodes ? b.nodes[0] : b.element
    if (o.nodes) return o.nodes.some((n) => n.contains(target))
    return o.element.contains(target)
  }

  function inBackoff(block: TranslatableBlock): boolean {
    const f = failures.get(blockOwner(block))
    return !!f && Date.now() - f.at < RETRY_BACKOFF_MS
  }

  // A replace-mode request failed: unmark the block so a later rescan or
  // recheck translates it again (after the backoff), and schedule a few
  // automatic retries.
  function translationFailed(block: TranslatableBlock) {
    const owner = blockOwner(block)
    const count = (failures.get(owner)?.count ?? 0) + 1
    failures.set(owner, { at: Date.now(), count })
    if (!block.nodes) unmarkLoading(block.element)
    unmarkBlock(block)
    if (count > MAX_AUTO_RETRIES) return
    const sid = sessionId
    setTimeout(() => {
      if (sid !== sessionId || !isTranslating) return
      if (!owner.isConnected || isBlockProcessed(block)) return
      const newBlocks = extractBlocks(block.element, extractOpts)
      discardSelfMutations()
      observeBlocks(newBlocks)
    }, RETRY_BACKOFF_MS + 50)
  }

  function discardSelfMutations() {
    observer?.takeRecords()
    for (const obs of shadowObservers.values()) obs.takeRecords()
  }

  // The element's data-imp-text is the ownership token for in-flight
  // requests: a recheck may retranslate an element with newer text while an
  // older request is still pending (streaming pages), and responses can
  // arrive out of order. A response may only be applied if its source text
  // still matches the element's current data-imp-text.
  function isStale(block: TranslatableBlock): boolean {
    return getBlockText(block) !== block.text
  }

  function translateBatch(batch: TranslatableBlock[]) {
    const t = debugTime(`translateBatch(n=${batch.length})`)
    const sid = sessionId
    for (const block of batch) {
      messager
        .sendMessage('translate', { text: block.text, targetLang })
        .then((translated) => {
          if (sid !== sessionId || !isTranslating || isStale(block)) return
          replaceWithTranslation([block], [translated])
          discardSelfMutations()
        })
        .catch((err) => {
          console.error('[imp-translate] translation error:', err)
          if (sid !== sessionId || !isTranslating || isStale(block)) return
          replaceWithError([block], (retryBlocks) => {
            translateBatch(retryBlocks)
          })
          discardSelfMutations()
        })
    }
    t(`sent ${batch.length} translate messages`)
  }

  // Short description of a block for logs: tag + start of its text.
  function describeBlock(block: TranslatableBlock): string {
    const tag = block.element.tagName.toLowerCase() + (block.nodes ? ' (run)' : '')
    return `<${tag}> "${block.text.slice(0, 40)}"`
  }

  // Replace mode's remaining bilingual path: logged, and marked in developer
  // mode (on the block element, or a virtual block's container).
  function fallbackToBilingual(blocks: TranslatableBlock[], reason: string) {
    for (const block of blocks) {
      console.warn(`[imp-translate] replace mode: bilingual fallback for ${describeBlock(block)}: ${reason}`)
      if (devMode) block.element.setAttribute('data-imp-fallback', 'bilingual')
    }
    translateAsBilingual(blocks)
  }

  // Bilingual fallback for a replace-mode block that can't be (or turned out
  // not to be) replaceable in place.
  function translateAsBilingual(blocks: TranslatableBlock[]) {
    const plain: TranslatableBlock[] = []
    for (const block of blocks) {
      if (block.nodes) translateRunAsBilingual(block)
      else plain.push(block)
    }
    if (plain.length === 0) return
    injectLoading(plain)
    discardSelfMutations()
    translateBatch(plain)
  }

  // Bilingual fallback for a virtual block: nothing can be wrapped, so the
  // result is inserted after the run's last node (insert-only).
  function translateRunAsBilingual(block: TranslatableBlock) {
    const state = runStates.get(block.nodes![0])
    if (!state || state.text !== block.text) return
    const last = block.nodes![block.nodes!.length - 1]
    // The page restructured the run meanwhile; its recheck re-extracts it.
    if (last.parentNode !== block.element) return
    if (state.inserted) for (const n of state.inserted) n.remove()
    const { inserted, wrapper } = injectRunLoading(block.element, last, block.text)
    state.inserted = inserted
    discardSelfMutations()
    const sid = sessionId
    const current = () =>
      sid === sessionId && isTranslating && !isStale(block) && state.inserted === inserted
    messager
      .sendMessage('translate', { text: block.text, targetLang })
      .then((translated) => {
        if (!current()) return
        if (!translated || translated.toLowerCase() === block.text.toLowerCase()) {
          for (const n of inserted) n.remove()
          state.inserted = null
          state.noop = true
        } else {
          wrapper.className = RESULT_CLASS
          wrapper.textContent = translated
          failures.delete(blockOwner(block))
        }
        discardSelfMutations()
      })
      .catch((err) => {
        console.error('[imp-translate] translation error:', err)
        if (!current()) return
        translationFailed(block)
        discardSelfMutations()
      })
  }

  // Replace mode. Single-node blocks use the plain `translate` message; a
  // block spread over several Text nodes (inline <a>/<strong>/...) needs
  // per-node aligned segments. When the segment output can't be mapped onto
  // the nodes, the block is rebuilt from it (structural rewrite, see
  // lib/rewrite.ts); only when there is no tagged output at all (provider
  // without segment support, declined translation) does it fall back to
  // bilingual. Failures leave the original text untouched — no error/retry
  // UI, since that would have to be appended anyway.
  async function translateInPlace(block: TranslatableBlock, entries: ReplaceEntry[]) {
    const el = block.element
    const sid = sessionId
    let translations: string[] | null
    let html: string | null = null
    let sentIndices: number[] = []
    let reason: string | null = null
    try {
      if (entries.length === 1) {
        translations = [await messager.sendMessage('translate', { text: block.text, targetLang })]
      } else {
        const res = await messager.sendMessage('translateSegments', {
          segments: entries.map((e) => e.segment),
          targetLang,
        })
        translations = res.segments
        html = res.html
        sentIndices = res.sentIndices
        reason = res.reason
      }
    } catch (err) {
      console.error('[imp-translate] translation error:', err)
      if (sid !== sessionId || !isTranslating || isStale(block)) return
      // An older in-place translation (retranslation) stays on screen; the
      // block itself is unmarked so it is picked up again after the backoff.
      translationFailed(block)
      discardSelfMutations()
      return
    }
    if (sid !== sessionId || !isTranslating || isStale(block)) return
    if (!block.nodes) unmarkLoading(el)
    if (!translations || translations.length !== entries.length) {
      if (html) {
        rewriteInPlace(block, entries, sentIndices, html, reason ?? 'unmappable output')
        return
      }
      // A retranslation may still show our older in-place translation; put
      // the page's text back before appending the bilingual one.
      restoreBlock(block)
      fallbackToBilingual([block], reason ?? 'no segment translation')
      return
    }
    // The page edited one of the nodes while we waited: its mutation has
    // already queued a recheck, which will retranslate from the new text.
    if (!entriesIntact(entries)) {
      discardSelfMutations()
      return
    }
    const joined = entries.map((e, i) => translations[i]?.trim() || e.source.trim()).join(' ')
    const source = entries.map((e) => e.source.trim()).join(' ')
    if (!translations.some((tr) => tr.trim()) || joined.toLowerCase() === source.toLowerCase()) {
      // Nothing to show instead of the page's text (drops an older
      // translation on retranslation).
      restoreBlock(block)
      setBlockNoop(block, true)
    } else {
      applyReplacement(blockOwner(block), entries, translations, {
        keepNodeWhitespace: entries.length === 1,
      })
    }
    failures.delete(blockOwner(block))
    discardSelfMutations()
  }

  // Structural rewrite of a block whose segment translation can't be poured
  // into its Text nodes.
  function rewriteInPlace(
    block: TranslatableBlock,
    entries: ReplaceEntry[],
    sentIndices: number[],
    html: string,
    reason: string,
  ) {
    // The page edited the block meanwhile: its recheck retranslates it.
    if (!entriesIntact(entries)) {
      discardSelfMutations()
      return
    }
    // A retranslation may still show our older in-place translation: the
    // detached originals must hold the page's text.
    restoreBlock(block)
    const owner = blockOwner(block)
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()
    if (norm(rewriteText(html)) === norm(block.text)) {
      // Nothing to show instead of the page's text.
      setBlockNoop(block, true)
      failures.delete(owner)
      discardSelfMutations()
      return
    }
    if (!noteRewrite(owner)) {
      // The page keeps undoing our rewrites (each undo retranslates and
      // rewrites again): give up and leave the page's text.
      if (!rewriteGaveUp.has(owner)) {
        rewriteGaveUp.add(owner)
        console.warn(
          `[imp-translate] replace mode: giving up on ${describeBlock(block)}: rewritten more than ${MAX_REWRITES} times, the page keeps changing it`,
        )
      }
      if (devMode) block.element.setAttribute('data-imp-fallback', 'rewrite-loop')
      discardSelfMutations()
      return
    }
    const rec = rewriteBlock(block, owner, entries, sentIndices, html, {
      debugReason: devMode ? reason : undefined,
      skipSelectors: extractOpts.skipSelectors,
    })
    if (!rec) {
      // The run's nodes moved meanwhile: keep the page's text, and let a
      // later rescan/recheck pick the block up again.
      console.warn(
        `[imp-translate] replace mode: structural rewrite of ${describeBlock(block)} skipped: block structure changed`,
      )
      unmarkBlock(block)
      discardSelfMutations()
      return
    }
    console.warn(
      `[imp-translate] replace mode: structural rewrite of ${describeBlock(block)}: ${reason} | engine html: ${html.slice(0, 200)}`,
    )
    if (block.nodes) {
      const state = runStates.get(block.nodes[0])
      if (state) {
        state.rewritten = rec.insertedNodes
        // Mutation lookups (findRun) and the walk's isRunProcessed must find
        // the run through the nodes now on screen.
        for (const n of rec.insertedNodes) runOfNode.set(n, state)
      }
    }
    failures.delete(blockOwner(block))
    discardSelfMutations()
  }

  function translateBlocksInPlace(blocks: TranslatableBlock[]) {
    pruneDisconnected()
    const fallback: TranslatableBlock[] = []
    for (const block of blocks) {
      // Not expected (a rewritten block stays marked), but its content would
      // be our own clones.
      undoRewrite(block)
      // reuseOwned: a block unmarked after a failed retranslation (see
      // translationFailed) may still show its own older translation.
      const entries = collectReplaceableTextNodes(block, extractOpts.skipSelectors, {
        reuseOwned: true,
      })
      if (!entries) {
        fallback.push(block)
        continue
      }
      ensureStylesFor(block.element)
      // Loading styles apply to the whole element; a virtual block's
      // container holds other content too.
      if (!block.nodes) markLoading(block.element)
      translateInPlace(block, entries)
    }
    discardSelfMutations()
    if (fallback.length > 0) {
      fallbackToBilingual(fallback, 'text not mappable onto whole text nodes')
    }
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
    const sid = sessionId

    blocks = blocks.filter((b) => !isUrlOnly(b.text))
    if (blocks.length === 0) return

    const seen = new Set<Node>()
    blocks = blocks.filter((b) => {
      if (isBlockProcessed(b)) return false
      // An already-translated ancestor owns this text — its translation
      // covers it, and a nested mark would race it for the result element.
      // (A virtual block's element is its container: check it too.)
      const above = b.nodes ? b.element : b.element.parentElement
      if (above?.closest(`[${PROCESSED_ATTR}]`)) return false
      if (inBackoff(b)) return false
      const key = blockOwner(b)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Streaming re-renders can queue both an element and a descendant added
    // later (e.g. React swapping the inner span of a pending <li>). Keep the
    // outermost block; its text includes the descendant's.
    blocks = blocks.filter((b) => !blocks.some((o) => o !== b && blockContains(o, b)))
    if (blocks.length === 0) return

    for (const block of blocks) {
      // The text was captured at extraction time; on streaming pages it may
      // have grown while the block waited in the visibility/batch queues.
      // Translate what is in the DOM now, not the stale snapshot — without
      // this, the growth mutation predates the mark, so no recheck would
      // ever repair the truncated translation.
      const current = blockSourceText(block)
      if (current && current !== block.text) block.text = current
      markBlock(block)
    }

    blocks = await filterByLanguage(blocks)
    if (blocks.length === 0) return
    if (sid !== sessionId || !isTranslating) return

    if (displayMode === 'replace') {
      translateBlocksInPlace(blocks)
      return
    }
    injectLoading(blocks)
    discardSelfMutations()
    translateBatch(blocks)
  }

  function flushDownBatch() {
    downTimer = null
    if (!isTranslating || downBatch.length === 0) return
    const batch = downBatch.filter((b) => !isBlockProcessed(b))
    downBatch = []
    if (batch.length > 0) translateBlocks(batch)
  }

  function flushUpBatch() {
    upTimer = null
    if (!isTranslating || upBatch.length === 0) return
    const batch = upBatch.filter((b) => !isBlockProcessed(b))
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
      // Several virtual blocks can share one observed container.
      const list = blockMap.get(el)
      visibilityObserver?.unobserve(el)
      blockMap.delete(el)
      if (!list) continue
      for (const block of list) {
        if (isBlockProcessed(block)) continue
        if (scrollDirection === 'up') {
          upBatch.push(block)
        } else {
          downBatch.push(block)
        }
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
      if (isBlockProcessed(block)) continue
      const list = blockMap.get(block.element)
      if (list) {
        const key = blockOwner(block)
        if (!list.some((b) => blockOwner(b) === key)) list.push(block)
        continue
      }
      blockMap.set(block.element, [block])
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
  // Virtual runs whose text may have changed, and runs whose node list the
  // page changed (children added/removed in or next to the run).
  const pendingRunRecheck = new Set<RunState>()
  const pendingRunReset = new Set<RunState>()

  // Replace-mode retranslation of a block whose page text changed. Nodes the
  // page didn't touch keep showing our old translation until the new one
  // lands (like bilingual mode keeps the old result) — restoring them first
  // made partially-dynamic paragraphs flash between original and translation
  // on every update. Returns false when the block can't be remapped in
  // place; the caller then re-extracts it.
  async function retranslateInPlace(block: TranslatableBlock): Promise<boolean> {
    const el = block.element
    // A structurally rewritten block shows our clones, not the page's nodes:
    // put the originals back and translate them afresh (the original text
    // shows until the new translation lands).
    if (undoRewrite(block)) {
      const text = blockSourceText(block)
      if (text) block.text = text
    }
    const entries = collectReplaceableTextNodes(block, extractOpts.skipSelectors, {
      reuseOwned: true,
    })
    if (!entries) return false
    setBlockText(block, block.text)
    setBlockNoop(block, false)
    ensureStylesFor(el)
    if (!block.nodes) markLoading(el)
    discardSelfMutations()
    const sid = sessionId
    const filtered = await filterByLanguage([block])
    if (sid !== sessionId || !isTranslating || isStale(block)) return true
    if (filtered.length === 0) {
      // Now already in the target language: show the page's own text.
      restoreBlock(block)
      setBlockNoop(block, true)
      discardSelfMutations()
      return true
    }
    translateInPlace(block, entries)
    return true
  }

  // Throw a run's translation away and re-extract its container: the run's
  // node list no longer matches the page, or it can't be remapped in place.
  // Other runs of the container stay processed and are skipped by the walk.
  function resetRun(state: RunState) {
    restoreOwner(state.nodes[0])
    unregisterRun(state)
    if (!state.container.isConnected) return
    const newBlocks = extractBlocks(state.container, extractOpts)
    discardSelfMutations()
    observeBlocks(newBlocks)
  }

  async function retranslateRun(state: RunState, newText: string) {
    const block: TranslatableBlock = {
      element: state.container,
      text: newText,
      nodes: state.nodes,
    }
    if (!state.inserted && (await retranslateInPlace(block))) return
    if (runStates.get(state.nodes[0]) !== state) return
    resetRun(state)
  }

  // The run's nodes are still consecutive children of its container (our own
  // inserted results aside).
  function runIntact(state: RunState): boolean {
    const { container } = state
    if (state.rewritten) {
      const rec = getRewrite(state.nodes[0])
      return !!rec && rewriteIntact(rec)
    }
    const nodes = state.nodes
    if (nodes[0].parentNode !== container) return false
    for (let i = 1; i < nodes.length; i++) {
      let next = nodes[i - 1].nextSibling
      while (next && isOurInjectedNode(next)) next = next.nextSibling
      if (next !== nodes[i]) return false
    }
    return true
  }

  function isOurInjectedNode(n: Node): boolean {
    if (n.nodeType !== Node.ELEMENT_NODE) return false
    const cl = (n as Element).classList
    return cl.contains(RESULT_CLASS) || cl.contains('imp-translate-br')
  }

  // The virtual run `node` belongs to (the node itself or an ancestor is one
  // of the run's top-level nodes).
  function findRun(node: Node | null): RunState | undefined {
    for (let cur = node; cur && cur !== document.body; cur = cur.parentNode) {
      const state = runOfNode.get(cur)
      if (state) return state
    }
    return undefined
  }

  async function retranslateElement(el: Element, newText: string) {
    const sid = sessionId
    // The element was translated as one block, but its new text has blank-line
    // paragraph breaks in a pre-wrap context (x.com "Show more" on a tweet
    // whose truncated text had none). The walker would have segmented it, so
    // re-walk it instead of retranslating the whole thing as a single block —
    // clearing the mark first, otherwise shouldSkip hides it from the walk.
    // Replace mode never splits (no structural writes): the block is simply
    // retranslated as a whole below.
    if (displayMode !== 'replace' && needsBlankLineSplit(el)) {
      // Put our in-place translations back first: the split works on the
      // page's text, and clearTranslations only undoes bilingual markup.
      restoreReplacements(el)
      clearTranslations(el)
      const newBlocks = extractBlocks(el, extractOpts)
      discardSelfMutations()
      observeBlocks(newBlocks)
      return
    }
    const wrapper = el.querySelector(`.${RESULT_CLASS}`)
    if (
      !wrapper &&
      displayMode === 'replace' &&
      (await retranslateInPlace({ element: el as HTMLElement, text: newText }))
    ) {
      return
    }
    if (!wrapper) {
      // A noop block, or a replace-mode block that can no longer be mapped
      // in place: restore the nodes that still carry our translation, so
      // the re-extracted block sees only the page's current text, then
      // translate it from scratch.
      restoreReplacements(el)
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
    if (sid !== sessionId || filtered.length === 0) return
    try {
      const translated = await messager.sendMessage('translate', {
        text: newText,
        targetLang,
      })
      if (sid !== sessionId || !isTranslating) return
      // A newer recheck may have superseded this one while awaiting.
      if (el.getAttribute('data-imp-text') !== newText) return
      if (wrapper.parentElement) {
        // Reset to the plain result class: the original request for this
        // element may have been dropped as stale while the wrapper was still
        // in its loading state, so the spinner class must be cleared here.
        ;(wrapper as HTMLElement).className = RESULT_CLASS
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
      // Source text, not visible text: in replace mode the visible text is
      // our translation. Our own writes never change the source text, so
      // they can't trigger a retranslation loop.
      const currentText = getSourceText(el, extractOpts.skipSelectors).trim()
      // A structural rewrite the page changed (our clones, or the detached
      // originals) is redone even when the source text is the same.
      const rewrite = getRewrite(el)
      if (storedText === currentText && (!rewrite || rewriteIntact(rewrite))) continue
      retranslateElement(el, currentText)
    }
    pendingRecheck.clear()
    for (const state of pendingRunReset) {
      if (runStates.get(state.nodes[0]) !== state) continue
      pendingRunRecheck.delete(state)
      resetRun(state)
    }
    pendingRunReset.clear()
    for (const state of pendingRunRecheck) {
      if (runStates.get(state.nodes[0]) !== state || !state.processed) continue
      if (!runIntact(state)) {
        resetRun(state)
        continue
      }
      const currentText = getSourceText(state.nodes, extractOpts.skipSelectors).trim()
      if (currentText === state.text) continue
      retranslateRun(state, currentText)
    }
    pendingRunRecheck.clear()
  }

  // The page changed the detached originals of a rewritten block (e.g. a
  // framework updated text it rendered): recheck it, which undoes the
  // rewrite and translates the page's current content.
  onRewriteStale((rec) => {
    if (!isTranslating) return
    const state = runStates.get(rec.owner)
    if (state) pendingRunRecheck.add(state)
    else if (rec.owner instanceof Element) pendingRecheck.add(rec.owner)
    else return
    if (recheckTimer) clearTimeout(recheckTimer)
    recheckTimer = setTimeout(flushRecheck, 300)
  })

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
      // Virtual runs (replace mode) carry no attribute to find them by.
      let resetContainer: Element | null = null
      if (displayMode === 'replace') {
        const run = findRun(target)
        if (run) pendingRunRecheck.add(run)
        const runs =
          mutation.type === 'childList' && target instanceof Element
            ? containerRuns.get(target)
            : undefined
        if (runs && runs.size > 0) {
          const changed = [...mutation.addedNodes, ...mutation.removedNodes].filter(
            (n) => !isOurInjectedNode(n),
          )
          if (changed.length > 0) {
            // Children added/removed in or right next to a run change what
            // the run is: re-extract it rather than patching its node list.
            for (const state of runs) {
              const nodes = liveNodes(state)
              const touches =
                changed.some((n) => nodes.includes(n)) ||
                (mutation.previousSibling !== null && nodes.includes(mutation.previousSibling)) ||
                (mutation.nextSibling !== null && nodes.includes(mutation.nextSibling))
              if (touches) {
                pendingRunReset.add(state)
                resetContainer = target as Element
              }
            }
          }
        }
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const addedEl = node as Element
        if (addedEl.classList?.contains(RESULT_CLASS)) continue
        if (addedEl.classList?.contains('imp-translate-br')) continue
        if (addedEl.hasAttribute('data-imp-wrap')) continue
        if (addedEl.hasAttribute(PROCESSED_ATTR)) continue
        if (addedEl.closest(`[${PROCESSED_ATTR}]`)) continue
        // Covered by the run reset (which re-extracts the container) or by
        // the recheck of the run it was added into.
        if (resetContainer && addedEl.parentNode === resetContainer) continue
        if (displayMode === 'replace' && findRun(addedEl.parentNode)) continue
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
    if (pendingRecheck.size > 0 || pendingRunRecheck.size > 0 || pendingRunReset.size > 0) {
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

  // Only observe here — do NOT push our stylesheet into the shadow root.
  // Styles are adopted lazily in injectLoading, for the roots that actually
  // receive a translation. Touching adoptedStyleSheets on every shadow root
  // the walker visits (~200 on a GitHub discussion: hidden <tool-tip>s and
  // <include-fragment>s) makes Dark Reader's per-root adopted-sheet watcher
  // re-render + re-match CSS variables ~200 times in one frame — tens of
  // seconds of main-thread time on an iPhone, seen as a white, unresponsive
  // page after translate + scroll.
  function attachShadowObserver(root: ShadowRoot) {
    if (shadowObservers.has(root)) return
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

  // Shared by both local re-translate paths (language change and
  // "Translate"): stop (harmless even if already restored — see onTranslate
  // below), tell the background this tab is translating again, then restart
  // locally with the retained host rules. `showToast` controls whether
  // startTranslation rebuilds the bar via maybeShowToast: "Translate"
  // needs that to flip it into "translating" mode, while a language change
  // keeps the bar it already has (rebuilding would replay the slide-in while
  // the user is still on the select).
  async function restartTranslation(lang: string, showToast: boolean) {
    const rules = hostRules
    stopTranslation(true)
    messager.sendMessage('startSelfTab', { targetLang: lang })
    // The display mode may have changed in the options page since this
    // session started.
    const { displayMode: mode } = await getSettings()
    await startTranslation(lang, showToast, rules, mode)
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
      translating: isTranslating,
      onRestore: () => {
        dismissToast()
        stopTranslation()
        messager.sendMessage('stopSelfTab')
      },
      // Calling stopTranslation(true) inside restartTranslation on an
      // already-restored page is harmless, so no idle/translating branch
      // is needed here.
      onTranslate: () => {
        restartTranslation(targetLang, true)
      },
      onSettings: () => {
        dismissToast()
        messager.sendMessage('openOptionsPage')
      },
      onLangChange: async (lang) => {
        await saveSettings({ targetLang: lang })
        await restartTranslation(lang, false)
      },
      onResetTimer: (delayMs) => {
        if (toastTimer) {
          clearTimeout(toastTimer)
        }
        toastTimer = setTimeout(dismissToast, delayMs)
      },
    })
    // Restart the countdown so a re-summoned bar doesn't vanish immediately.
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(dismissToast, 5000)
  }

  function waitForDOMReady(): Promise<void> {
    if (document.readyState !== 'loading') return Promise.resolve()
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
    })
  }

  let devMode = false

  async function loadDeveloperSettings() {
    try {
      const result = await browser.storage.local.get('settings')
      const settings = result.settings as Record<string, unknown> | undefined
      devMode = settings?.developerMode === true
    } catch {}
  }

  async function startTranslation(
    lang: string,
    showToast = false,
    rules: SiteRule[] = [],
    mode: DisplayMode = 'bilingual',
  ) {
    const t = debugTime('content:startTranslation')
    if (isTranslating) { t('skipped — already translating'); return }
    isTranslating = true
    sessionId++
    targetLang = lang
    displayMode = mode
    hostRules = rules
    cachedPathname = null
    t('state set')
    await loadDeveloperSettings()
    t('loadDeveloperSettings done')
    if (devMode) injectDebugStyles()
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
    sessionId++
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
    pendingRunRecheck.clear()
    pendingRunReset.clear()
    runStates = new WeakMap()
    runOfNode = new WeakMap()
    containerRuns = new WeakMap()
    failures = new WeakMap()
    rewriteGaveUp = new WeakSet()
    resetRewriteCounts()
    document.removeEventListener('toggle', onToggle, { capture: true })
    document.removeEventListener('click', onClick, { capture: true })
    document.removeEventListener('scroll', onScroll, { capture: true })
    restoreReplacements()
    clearTranslations(document.body)
    removeStyles()
    removeDebugStyles()
    devMode = false
    if (!keepToast) dismissToast()
  }

  // Registered synchronously during injection (this is an unlisted script
  // driven by scripting.executeScript), so the background's post-inject
  // startTranslation can't outrun the listener. Handlers deliberately do not
  // return or await the work: the background only needs the message delivered,
  // not the translation to finish, and waiting here would keep the sender's
  // response channel (and the SW) busy for the whole first scan.
  messager.onMessage('startTranslation', ({ data }) => {
    startTranslation(data.targetLang, data.showToast, data.rules, data.displayMode)
  })
  messager.onMessage('stopTranslation', () => {
    stopTranslation()
    maybeShowToast()
  })
  messager.onMessage('getState', () => isTranslating)

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
  // This avoids the race where the startTranslation message arrives before
  // the content script's message listener is registered in some frames.
  //
  // Only the top frame auto-inits. Sub-frames are driven explicitly by the
  // background's webNavigation handlers (which send a per-frame
  // startTranslation), so they never self-start from a session key that may
  // still be stale during a reload. The listener above is registered
  // synchronously, so the background's post-inject startTranslation can't outrace it.
  ;(async () => {
    if (window.self !== window.top) return
    await waitForDOMReady()
    const lang = await messager.sendMessage('getSelfTabState')
    if (!lang) return
    if (isTranslating) return
    const [rules, settings] = await Promise.all([
      messager.sendMessage('getMatchedRulesForHostname', {
        hostname: location.hostname,
      }),
      getSettings(),
    ])
    if (isTranslating) return
    startTranslation(lang, false, rules, settings.displayMode)
  })()
})
