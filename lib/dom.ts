const INLINE_TAGS = new Set([
  '#text', 'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'br',
  'cite', 'code', 'del', 'dfn', 'em', 'font', 'i', 'input', 'ins', 'kbd',
  'label', 'mark', 'nobr', 'q', 'rp', 'rt', 'ruby', 's',
  'samp', 'small', 'span', 'strong', 'sub', 'sup', 'tt',
  'u', 'var', 'wbr', 'img',
])

const NO_LETTER_RE = /^\P{L}+$/u
const ASCII_SHORT_RE = /^[a-zA-Z0-9]{1,2}$/
// A blank line: two newlines separated only by intra-line whitespace. In
// white-space:pre-wrap contexts this is a rendered paragraph break.
const BLANK_LINE_RE = /\n[^\S\n]*\n/
// A full separator run: maximal whitespace stretch containing a blank line.
const SEP_RUN_RE = /\s*\n[^\S\n]*\n\s*/

const SKIP_TAGS = new Set([
  'script', 'style', 'textarea', 'svg', 'template', 'noscript',
  'iframe', 'math', 'select', 'option', 'video', 'audio', 'canvas',
  'pre', 'time',
])

const LEAF_BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th',
  'dd', 'dt', 'blockquote', 'figcaption', 'caption',
])

const CONTAINER_TAGS = new Set([
  'div', 'article', 'section', 'main', 'aside',
  'details', 'summary', 'legend',
])

const SKIP_CONTAINERS = new Set(['nav', 'footer'])

const EDITOR_SELECTOR = [
  '.RichEditor-root:has([contenteditable="true"])',
  '.DraftEditor-root:has([contenteditable="true"])',
  '[data-lexical-editor][contenteditable="true"]',
  '.ProseMirror[contenteditable="true"]',
  '[data-slate-editor][contenteditable="true"]',
  '.ql-editor[contenteditable="true"]',
  '.ck-editor:has([contenteditable="true"])',
  '.tox-editor-container:has([contenteditable="true"])',
  '.cm-editor',
  '.monaco-editor',
].join(',')

const RESULT_CLASS = 'imp-translate-result'
const PROCESSED_ATTR = 'data-imp-translated'
const WRAP_ATTR = 'data-imp-wrap'
const OVERSIZED_BLOCK_THRESHOLD = 8000

function isInlineish(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (SKIP_TAGS.has(tag)) return false
  if (hasBlockChild(el)) return false
  if (INLINE_TAGS.has(tag)) return isDisplayInline(el)
  if (isDisplayInline(el)) return true
  return false
}

function isWhitespaceText(node: Node): boolean {
  return (
    node.nodeType === Node.TEXT_NODE && !(node.textContent || '').trim()
  )
}

function isBr(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).tagName.toLowerCase() === 'br'
  )
}

// Split a run of inline-ish siblings on "paragraph" boundaries. A boundary is
// a soft-node run (brs and whitespace text) containing either <br>{2,} — the
// fake-paragraph pattern App Store / old webmail / Discord embed emails use —
// or, when splitOnBlankLines is set (white-space:pre-wrap contexts, e.g. x.com
// long posts), a blank line: two newlines in the whitespace text. A single
// <br> or single \n is a soft line break and stays in the segment.
function segmentRunByBrBr(run: Node[], splitOnBlankLines = false): Node[][] {
  const segments: Node[][] = []
  let current: Node[] = []
  let i = 0
  const isSoft = (n: Node) => isBr(n) || isWhitespaceText(n)
  while (i < run.length) {
    if (!isSoft(run[i]) || (!isBr(run[i]) && !splitOnBlankLines)) {
      current.push(run[i])
      i++
      continue
    }
    let j = i
    let brCount = 0
    let wsText = ''
    while (j < run.length && isSoft(run[j])) {
      if (isBr(run[j])) brCount++
      else wsText += run[j].textContent ?? ''
      j++
    }
    const boundary = brCount >= 2 || (splitOnBlankLines && BLANK_LINE_RE.test(wsText))
    if (boundary) {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
      i = j
    } else {
      while (i < j) {
        current.push(run[i])
        i++
      }
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}

export interface TranslatableBlock {
  element: HTMLElement
  text: string
}

export interface ExtractOptions {
  skipSelectors?: string[]
  includeSelectors?: string[]
  onShadowRoot?: (root: ShadowRoot) => void
}

function hasShadowDescendant(el: Element): boolean {
  if (el.shadowRoot) return true
  const all = el.querySelectorAll('*')
  for (const desc of all) {
    if (desc.shadowRoot) return true
  }
  return false
}

function hasStatefulInteractive(el: Element): boolean {
  return el.matches('[aria-expanded]') || el.querySelector('[aria-expanded]') !== null
}

function closestThroughShadow(el: Element, selector: string): Element | null {
  let current: Element | null = el
  while (current) {
    const found = current.closest(selector)
    if (found) return found
    const root = current.getRootNode()
    if (root instanceof ShadowRoot) current = root.host
    else current = null
  }
  return null
}

function shouldSkip(el: Element, opts?: ExtractOptions): boolean {
  if (opts?.includeSelectors && opts.includeSelectors.length > 0) {
    const inside = opts.includeSelectors.some((s) => closestThroughShadow(el, s))
    if (!inside) {
      const contains = opts.includeSelectors.some((s) => el.querySelector(s))
      if (!contains && !hasShadowDescendant(el)) return true
    }
  }
  if (opts?.skipSelectors) {
    for (const s of opts.skipSelectors) {
      if (el.matches(s)) return true
    }
  }
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true
  if (el.classList.contains('notranslate')) return true
  if (el.getAttribute('translate') === 'no') return true
  if ((el as HTMLElement).isContentEditable) return true
  if (el.closest(EDITOR_SELECTOR)) return true
  if (el.classList.contains(RESULT_CLASS)) return true
  if (el.hasAttribute(PROCESSED_ATTR)) return true
  return false
}

function isHidden(el: HTMLElement): boolean {
  if (el.checkVisibility && !el.checkVisibility()) return true
  if (el.offsetWidth <= 1 || el.offsetHeight <= 1) return true
  return getComputedStyle(el).visibility === 'hidden'
}

function visibleTextOfChild(child: Node, skipSelectors?: string[]): string {
  if (child.nodeType === Node.TEXT_NODE) return child.textContent ?? ''
  if (child.nodeType !== Node.ELEMENT_NODE) return ''
  const childEl = child as HTMLElement
  if (SKIP_TAGS.has(childEl.tagName.toLowerCase())) return ''
  if (childEl.classList.contains(RESULT_CLASS)) return ''
  if (childEl.classList.contains('notranslate')) return ''
  if (childEl.getAttribute('translate') === 'no') return ''
  if (childEl.isContentEditable) return ''
  if (isHidden(childEl)) return ''
  if (skipSelectors && skipSelectors.some((s) => childEl.matches(s))) return ''
  return getVisibleText(childEl, skipSelectors)
}

function getVisibleText(el: Element, skipSelectors?: string[]): string {
  let text = ''
  for (const child of el.childNodes) text += visibleTextOfChild(child, skipSelectors)
  return text
}

// Same as getVisibleText but over an arbitrary node list rather than an
// element's childNodes — lets us compute a wrapper's text from its prospective
// children before the wrapper is actually created/inserted (deferred write).
function visibleTextOfNodes(nodes: Node[], skipSelectors?: string[]): string {
  let text = ''
  for (const child of nodes) text += visibleTextOfChild(child, skipSelectors)
  return text
}

function isBlockTag(tag: string): boolean {
  return !INLINE_TAGS.has(tag) && !SKIP_TAGS.has(tag)
}

function isDisplayInline(el: Element): boolean {
  const inlineDisplay = (el as HTMLElement).style?.display
  if (inlineDisplay) return inlineDisplay.startsWith('inline')
  // Consult computed style for ALL elements, including inline-default tags
  // (a, span, etc.). Flex/grid containers blockify their children — e.g.
  // shadcn's "On This Page" sidebar renders <a> links in a flex-col container,
  // so each <a> has computed display:block. Without this check, they all merge
  // into one translation block, destroying the outline structure.
  // Safe for the read/write split: this runs in the walk's read phase, before
  // any deferred write, so it never forces a post-mutation reflow.
  return getComputedStyle(el).display.startsWith('inline')
}

// Detect "fake paragraph" markup: 2+ <br>s in a row (possibly with whitespace
// text between them). Triggers walkMixed even on otherwise-leaf containers so
// br-br segmentation can run.
function hasBrBrSeparator(el: Element): boolean {
  let consecutiveBrs = 0
  for (const child of el.childNodes) {
    if (isBr(child)) {
      consecutiveBrs++
      if (consecutiveBrs >= 2) return true
    } else if (!isWhitespaceText(child)) {
      consecutiveBrs = 0
    }
  }
  return false
}

// x.com long-form posts (and other pre-wrap renderers) put an entire article
// into one flat element whose only structure is literal \n\n inside inline
// span text — no <p>, no <br>. Detect that shape so the walker can segment
// per paragraph instead of extracting one giant block.
function preservesNewlines(el: Element): boolean {
  const ws = getComputedStyle(el).whiteSpace
  return ws.startsWith('pre') || ws === 'break-spaces'
}

// Exported for the content script's recheck path: a translated element whose
// text later gains blank lines (x.com "Show more" on a tweet whose truncated
// text had none) must be re-segmented, not retranslated as one block.
export function needsBlankLineSplit(el: Element): boolean {
  return hasBlankLineSeparator(el)
}

function hasBlankLineSeparator(el: Element): boolean {
  // Style check first: getComputedStyle is cheap relative to textContent,
  // which allocates the full subtree text — only pay that on pre-wrap
  // elements, which are rare.
  if (!preservesNewlines(el)) return false
  const text = el.textContent
  if (!text || !BLANK_LINE_RE.test(text)) return false
  return !isHidden(el as HTMLElement)
}

// Split `t` so each separator run (whitespace containing a blank line)
// becomes its own standalone text node. Returns the separator nodes.
function splitTextAtBlankLines(t: Text): Text[] {
  const seps: Text[] = []
  let node = t
  for (;;) {
    const m = SEP_RUN_RE.exec(node.data)
    if (!m) break
    const sep = m.index > 0 ? node.splitText(m.index) : node
    const rest = m[0].length < sep.data.length ? sep.splitText(m[0].length) : null
    seps.push(sep)
    if (!rest) break
    node = rest
  }
  return seps
}

// Nodes produced by segmentPreservedNewlines for a given source element: the
// hoisted separator text nodes and the element clones holding the content
// after each separator. Frameworks that own the source element (React on
// x.com) don't know about them: when the page later replaces the source's
// text wholesale ("Show more" swaps the truncated text for the full post),
// the old clones stay behind as stale duplicates. Tracking them lets a later
// re-split drop the ones whose content now lives in the source again.
const splitDerivedNodes = new WeakMap<Element, { sep: Text; clone: Element | null }[]>()

function isStaleDerivedClone(clone: Element, sourceText: string): boolean {
  const probe = getVisibleText(clone).trim()
  if (!probe) return true
  // Compare on a prefix: the stale clone may end with content that the
  // fresh source no longer has (x.com appends the "Show more" t.co link to
  // the truncated tail), and the source may continue where the clone ended.
  const head = probe.slice(0, 32)
  if (head.length < 8) return sourceText.includes(probe)
  return sourceText.includes(head)
}

// Prepare a preserves-newlines element for run segmentation: split every
// blank-line separator out of its text node and hoist it up through inline
// ancestors until it is a direct child of `parent` (cloning the ancestor at
// each level, Text.splitText-style). Afterwards the direct-child run has the
// same shape as br-br markup — content nodes with whitespace separator nodes
// between them — and segmentRunByBrBr(run, true) applies unchanged. The
// separators stay in the DOM (never wrapped), so rendering is untouched.
//
// This mutates during the walk's read phase, unlike the deferred writes used
// elsewhere — acceptable because blank-line pre-wrap elements are rare (one
// per long post), so the extra reflow is bounded.
function segmentPreservedNewlines(parent: Element) {
  const doc = parent.ownerDocument!
  const walker = doc.createTreeWalker(parent, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        // Block-level descendants segment themselves when the walk recurses
        // into them; splitting across their boundary would move rendered
        // whitespace between formatting contexts.
        if (!isInlineish(el)) return NodeFilter.FILTER_REJECT
        if (el.classList.contains(RESULT_CLASS)) return NodeFilter.FILTER_REJECT
        if (el.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT
        if (el.getAttribute('translate') === 'no') return NodeFilter.FILTER_REJECT
        if ((el as HTMLElement).isContentEditable) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_SKIP
      }
      return BLANK_LINE_RE.test((node as Text).data)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP
    },
  })
  const targets: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) targets.push(n as Text)

  // Elements about to be split that were split before: their previous
  // derived nodes are stale if the source now contains that content again.
  const seenSources = new Set<Element>()
  const dropStaleDerived = (p: Element) => {
    if (seenSources.has(p)) return
    seenSources.add(p)
    const prev = splitDerivedNodes.get(p)
    if (!prev) return
    const sourceText = getVisibleText(p)
    const kept: { sep: Text; clone: Element | null }[] = []
    for (const d of prev) {
      const stale = d.clone
        ? d.clone.isConnected && isStaleDerivedClone(d.clone, sourceText)
        : false
      if (stale) {
        d.clone!.remove()
        if (d.sep.isConnected) d.sep.remove()
      } else if (d.sep.isConnected || d.clone?.isConnected) {
        kept.push(d)
      }
    }
    if (kept.length > 0) splitDerivedNodes.set(p, kept)
    else splitDerivedNodes.delete(p)
  }

  for (const t of targets) {
    for (const sep of splitTextAtBlankLines(t)) {
      let cur: Node = sep
      while (cur.parentNode && cur.parentNode !== parent) {
        const p = cur.parentNode as Element
        dropStaleDerived(p)
        const after = p.cloneNode(false) as Element
        after.removeAttribute('id')
        // The split element may already be translated (x.com "Show more"
        // grows a translated span into several paragraphs). The clone is new
        // content that must be walked and translated on its own, so it must
        // not inherit our translation state.
        after.removeAttribute(PROCESSED_ATTR)
        after.removeAttribute('data-imp-text')
        after.removeAttribute('data-imp-noop')
        while (cur.nextSibling) after.appendChild(cur.nextSibling)
        // Our own injected nodes (the translation result and its <br>) sit at
        // the tail of the element and would otherwise ride along into the last
        // clone. They belong to the original, whose mark and text they match.
        for (const n of Array.from(after.childNodes)) {
          if (isOurInjectedNode(n)) p.appendChild(n)
        }
        const gp = p.parentNode!
        gp.insertBefore(cur, p.nextSibling)
        const hasClone = after.childNodes.length > 0
        if (hasClone) gp.insertBefore(after, cur.nextSibling)
        const list = splitDerivedNodes.get(p) ?? []
        list.push({ sep, clone: hasClone ? after : null })
        splitDerivedNodes.set(p, list)
      }
    }
  }
}

function isOurInjectedNode(n: Node): boolean {
  if (n.nodeType !== Node.ELEMENT_NODE) return false
  const cl = (n as Element).classList
  return cl.contains(RESULT_CLASS) || cl.contains('imp-translate-br')
}

function hasBlockChild(el: Element): boolean {
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase()
    if (isBlockTag(tag)) {
      if (tag.includes('-') && !child.textContent?.trim()) continue
      // A block-tag element with display:inline-* (e.g. Google's
      // overflow-x carousel uses an inline-block <div> wrapper above the
      // flex card row) is a transparent wrapper for layout purposes — its
      // descendants can still contain real blocks. Recurse instead of
      // skipping outright.
      if (isDisplayInline(child)) {
        if (hasBlockChild(child)) return true
        continue
      }
      return true
    }
    // Recurse through inline-tag wrappers so nested inline chains (e.g.
    // Quora's div > span > span > p) don't hide real block descendants
    // from a leaf-extraction decision. Bounded by inline-chain depth,
    // which is naturally small in real DOM.
    if (INLINE_TAGS.has(tag)) {
      if (hasBlockChild(child)) return true
    }
  }
  return false
}

function isLeafBlock(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (!LEAF_BLOCK_TAGS.has(tag)) return false
  if (hasBlockChild(el)) return false
  return true
}

export function extractBlocks(root: Element = document.body, opts?: ExtractOptions): TranslatableBlock[] {
  // Skip ancestors of root must be checked here, not per-element in shouldSkip:
  // walker descends from root, so any skip ancestor inside the subtree gets
  // visited and matched cheaply via matches(). Ancestors above root are outside
  // the walk and need a one-time closest() check at entry.
  if (opts?.skipSelectors) {
    for (const s of opts.skipSelectors) {
      if (closestThroughShadow(root, s)) return []
    }
  }
  const blocks: TranslatableBlock[] = []
  // Deferred writes. The walk is a pure read phase — every DOM mutation
  // (wrapper insertion, shadow-root style/observer setup) is collected here and
  // flushed in one write phase after the walk. Interleaving writes with the
  // walk's layout reads (getComputedStyle/checkVisibility/getBoundingClientRect)
  // would force a synchronous reflow per write — quadratic on large DOMs like
  // Reddit (~2s). Batching keeps reads cheap and coalesces reflow into one.
  const pendingWraps: {
    parent: Element
    wrapper: HTMLElement
    refNode: Node
    seg: Node[]
  }[] = []
  const pendingShadowRoots: ShadowRoot[] = []

  function tryExtract(node: Element): boolean {
    if (isHidden(node as HTMLElement)) return false
    if (opts?.includeSelectors && opts.includeSelectors.length > 0) {
      const inside = opts.includeSelectors.some((s) => closestThroughShadow(node, s))
      if (!inside) {
        const contains = opts.includeSelectors.some((s) => node.querySelector(s))
        if (!contains) return false
      }
    }
    const text = getVisibleText(node, opts?.skipSelectors).trim()
    if (text && !NO_LETTER_RE.test(text) && !ASCII_SHORT_RE.test(text)) {
      if (import.meta.env.DEV && text.length > OVERSIZED_BLOCK_THRESHOLD) {
        console.warn(
          `[imp-translate] oversized block (${text.length} chars) — likely a walker bug. Element:`,
          node,
        )
      }
      blocks.push({ element: node as HTMLElement, text })
      return true
    }
    return false
  }

  // Read-only counterpart of tryExtract for the multi-node wrapper case: decide
  // eligibility and compute the block text from the segment nodes *in place*,
  // create the <font> wrapper detached (cheap, no layout impact), and record the
  // actual insertion/child-move for the write phase. The include gate is checked
  // on `parent` rather than the wrapper — equivalent, since the wrapper is a
  // plain <font> directly under `parent` that never matches an include selector.
  function deferWrap(parent: Element, seg: Node[]) {
    if (opts?.includeSelectors && opts.includeSelectors.length > 0) {
      const inside = opts.includeSelectors.some((s) => closestThroughShadow(parent, s))
      if (!inside) {
        const contains = seg.some((n) => n.nodeType === Node.ELEMENT_NODE && opts.includeSelectors!.some((s) => (n as Element).matches(s) || (n as Element).querySelector(s)))
        if (!contains) return
      }
    }
    const text = visibleTextOfNodes(seg, opts?.skipSelectors).trim()
    if (!text || NO_LETTER_RE.test(text) || ASCII_SHORT_RE.test(text)) return
    if (import.meta.env.DEV && text.length > OVERSIZED_BLOCK_THRESHOLD) {
      console.warn(
        `[imp-translate] oversized block (${text.length} chars) — likely a walker bug. Parent:`,
        parent,
      )
    }
    const wrapper = parent.ownerDocument!.createElement('font')
    wrapper.setAttribute(WRAP_ATTR, 'true')
    blocks.push({ element: wrapper, text })
    pendingWraps.push({ parent, wrapper, refNode: seg[0], seg })
  }

  function walkMixed(parent: Element, splitOnBlankLines = false) {
    const isCustomElement = parent.tagName.includes('-')
    const children = Array.from(parent.childNodes)
    let run: Node[] = []

    const flushSegment = (seg: Node[]) => {
      while (seg.length > 0 && (isWhitespaceText(seg[0]) || isBr(seg[0]))) {
        seg.shift()
      }
      while (
        seg.length > 0 &&
        (isWhitespaceText(seg[seg.length - 1]) || isBr(seg[seg.length - 1]))
      ) {
        seg.pop()
      }
      if (seg.length === 0) return

      if (seg.length === 1 && seg[0].nodeType === Node.ELEMENT_NODE) {
        walk(seg[0] as Element)
        return
      }

      if (isCustomElement) {
        // Wrapping breaks Web Component slot distribution: only direct children
        // of the host carry slot="..." semantics. Walk each element child
        // individually; loose text between them is unrendered without slotting.
        for (const n of seg) {
          if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element)
        }
        return
      }

      // Reparenting framework-managed stateful nodes (e.g. spoilers, accordions)
      // breaks React reconciliation: when the framework later runs removeChild
      // on a node it expects under `parent`, our wrapper is in the way and
      // the call throws NotFoundError.
      const hasStateful = seg.some(
        (n) => n.nodeType === Node.ELEMENT_NODE && hasStatefulInteractive(n as Element),
      )
      if (hasStateful) {
        for (const n of seg) {
          if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element)
        }
        return
      }

      // <font> over <span>: site CSS/JS targets `span` far more often than the
      // near-deprecated `<font>`, so a font wrapper is more transparent to the
      // host page. Same tag as our translation result element. Insertion is
      // deferred to the write phase (see deferWrap) to avoid layout thrash.
      deferWrap(parent, seg)
    }

    const flush = () => {
      if (run.length === 0) return
      const segments = segmentRunByBrBr(run, splitOnBlankLines)
      for (const seg of segments) {
        flushSegment(seg)
      }
      run = []
    }

    for (const child of children) {
      if (isInlineish(child)) {
        run.push(child)
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        flush()
        walk(child as Element)
      }
    }
    flush()
  }

  function walk(node: Element) {
    if (shouldSkip(node, opts)) return

    const tag = node.tagName.toLowerCase()

    if (SKIP_CONTAINERS.has(tag)) return

    // Pre-wrap content whose paragraphs are literal blank lines in the text
    // (x.com long posts): normalize the separators to direct children, then
    // segment the run like br-br fake paragraphs. Checked before the leaf
    // paths so a leaf block or flat div with blank lines splits too.
    if (hasBlankLineSeparator(node)) {
      segmentPreservedNewlines(node)
      walkMixed(node, true)
      walkShadow(node)
      return
    }

    if (isLeafBlock(node)) {
      tryExtract(node)
      walkShadow(node)
      return
    }

    if (hasBlockChild(node) || hasBrBrSeparator(node)) {
      walkMixed(node)
      walkShadow(node)
      return
    }

    if (tryExtract(node)) {
      walkShadow(node)
      return
    }

    for (const child of node.children) {
      walk(child)
    }
    walkShadow(node)
  }

  function walkShadow(node: Element) {
    const root = node.shadowRoot
    if (!root) return
    // Defer the onShadowRoot callback (style injection + observer attach) — it
    // mutates the shadow root and would dirty layout mid-walk.
    pendingShadowRoots.push(root)
    for (const child of root.children) {
      walk(child)
    }
  }

  walk(root)
  if (root instanceof Element) walkShadow(root)

  // WRITE PHASE — every DOM mutation happens here, after all layout reads, so
  // the browser coalesces the work into a single reflow instead of one per node.
  for (const { parent, wrapper, refNode, seg } of pendingWraps) {
    parent.insertBefore(wrapper, refNode)
    for (const n of seg) wrapper.appendChild(n)
  }
  for (const root of pendingShadowRoots) opts?.onShadowRoot?.(root)

  return blocks
}

export function getVisibleBlocks(blocks: TranslatableBlock[]): TranslatableBlock[] {
  const viewportHeight = window.innerHeight
  return blocks.filter((block) => {
    const rect = block.element.getBoundingClientRect()
    return rect.bottom > 0 && rect.top < viewportHeight * 2
  })
}

export function markTranslated(el: HTMLElement) {
  el.setAttribute(PROCESSED_ATTR, 'true')
}

export function clearTranslations(root: Element = document.body) {
  function clearScope(scope: ParentNode) {
    scope.querySelectorAll(`.${RESULT_CLASS}`).forEach((el) => el.remove())
    scope.querySelectorAll('.imp-translate-br').forEach((el) => el.remove())
    scope.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((el) => {
      el.removeAttribute(PROCESSED_ATTR)
      el.removeAttribute('data-imp-text')
      el.removeAttribute('data-imp-noop')
    })
    scope.querySelectorAll(`[${WRAP_ATTR}]`).forEach((wrapper) => {
      const parent = wrapper.parentNode
      if (!parent) return
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper)
      }
      parent.removeChild(wrapper)
    })
    scope.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) clearScope(el.shadowRoot)
    })
  }

  clearScope(root)
  root.removeAttribute(PROCESSED_ATTR)
  root.removeAttribute('data-imp-text')
  root.removeAttribute('data-imp-noop')
}

export { RESULT_CLASS, PROCESSED_ATTR, getVisibleText }
