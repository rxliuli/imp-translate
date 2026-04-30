const INLINE_TAGS = new Set([
  '#text', 'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'br',
  'cite', 'code', 'del', 'dfn', 'em', 'font', 'i', 'input', 'ins', 'kbd',
  'label', 'mark', 'nobr', 'q', 'rp', 'rt', 'ruby', 's',
  'samp', 'small', 'span', 'strong', 'sub', 'sup', 'tt',
  'u', 'var', 'wbr', 'img',
])

const NO_LETTER_RE = /^\P{L}+$/u

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
  if (INLINE_TAGS.has(tag)) return true
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

// Split a run of inline-ish siblings on <br>{2,}* boundaries (allowing whitespace
// text nodes between the brs). A single <br> is a soft line break and stays in
// the segment. Two or more consecutive brs act as a "fake paragraph" separator
// — the pattern App Store / old webmail / Discord embed style emails use.
function segmentRunByBrBr(run: Node[]): Node[][] {
  const segments: Node[][] = []
  let current: Node[] = []
  let i = 0
  while (i < run.length) {
    if (!isBr(run[i])) {
      current.push(run[i])
      i++
      continue
    }
    let j = i
    let brCount = 0
    while (j < run.length && (isBr(run[j]) || isWhitespaceText(run[j]))) {
      if (isBr(run[j])) brCount++
      j++
    }
    if (brCount >= 2) {
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
  if (el.getAttribute('aria-hidden') === 'true') return true
  if ((el as HTMLElement).isContentEditable) return true
  if (el.closest(EDITOR_SELECTOR)) return true
  if (el.classList.contains(RESULT_CLASS)) return true
  if (el.hasAttribute(PROCESSED_ATTR)) return true
  return false
}

function isHidden(el: HTMLElement): boolean {
  if (el.offsetWidth <= 1 || el.offsetHeight <= 1) return true
  return getComputedStyle(el).visibility === 'hidden'
}

function getVisibleText(el: Element, skipSelectors?: string[]): string {
  let text = ''
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement
      if (SKIP_TAGS.has(childEl.tagName.toLowerCase())) continue
      if (childEl.classList.contains(RESULT_CLASS)) continue
      if (childEl.classList.contains('notranslate')) continue
      if (childEl.getAttribute('translate') === 'no') continue
      if (childEl.isContentEditable) continue
      if (isHidden(childEl)) continue
      if (skipSelectors && skipSelectors.some((s) => childEl.matches(s))) continue
      text += getVisibleText(childEl, skipSelectors)
    }
  }
  return text
}

function isBlockTag(tag: string): boolean {
  return !INLINE_TAGS.has(tag) && !SKIP_TAGS.has(tag)
}

function isDisplayInline(el: Element): boolean {
  const display = getComputedStyle(el).display
  return display.startsWith('inline')
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

  function tryExtract(node: Element): boolean {
    if (isHidden(node as HTMLElement)) return false
    if (opts?.includeSelectors && opts.includeSelectors.length > 0) {
      const inside = opts.includeSelectors.some((s) => closestThroughShadow(node, s))
      if (!inside) return false
    }
    const text = getVisibleText(node, opts?.skipSelectors).trim()
    if (text && !NO_LETTER_RE.test(text)) {
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

  function walkMixed(parent: Element) {
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
      // host page. Same tag as our translation result element.
      const wrapper = parent.ownerDocument!.createElement('font')
      wrapper.setAttribute(WRAP_ATTR, 'true')
      parent.insertBefore(wrapper, seg[0])
      for (const n of seg) {
        wrapper.appendChild(n)
      }
      tryExtract(wrapper)
    }

    const flush = () => {
      if (run.length === 0) return
      const segments = segmentRunByBrBr(run)
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
    opts?.onShadowRoot?.(root)
    for (const child of root.children) {
      walk(child)
    }
  }

  walk(root)
  if (root instanceof Element) walkShadow(root)
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
