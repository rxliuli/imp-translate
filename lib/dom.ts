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

export interface TranslatableBlock {
  element: HTMLElement
  text: string
}

export interface ExtractOptions {
  skipSelectors?: string[]
  includeSelectors?: string[]
}

function shouldSkip(el: Element, opts?: ExtractOptions): boolean {
  if (opts?.includeSelectors && opts.includeSelectors.length > 0) {
    const inside = opts.includeSelectors.some((s) => el.closest(s))
    if (!inside) {
      const contains = opts.includeSelectors.some((s) => el.querySelector(s))
      if (!contains) return true
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

function hasBlockChild(el: Element): boolean {
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase()
    if (isBlockTag(tag)) {
      if (tag.includes('-') && !child.textContent?.trim()) continue
      if (isDisplayInline(child)) continue
      return true
    }
    if (INLINE_TAGS.has(tag)) {
      for (const grandchild of child.children) {
        const gcTag = grandchild.tagName.toLowerCase()
        if (isBlockTag(gcTag)) {
          if (gcTag.includes('-') && !grandchild.textContent?.trim()) continue
          if (isDisplayInline(grandchild)) continue
          return true
        }
      }
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
  const blocks: TranslatableBlock[] = []

  function tryExtract(node: Element): boolean {
    if (isHidden(node as HTMLElement)) return false
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
    const children = Array.from(parent.childNodes)
    let run: Node[] = []

    const flush = () => {
      while (run.length > 0 && isWhitespaceText(run[0])) run.shift()
      while (run.length > 0 && isWhitespaceText(run[run.length - 1])) run.pop()
      if (run.length === 0) return

      if (run.length === 1 && run[0].nodeType === Node.ELEMENT_NODE) {
        walk(run[0] as Element)
        run = []
        return
      }

      const wrapper = parent.ownerDocument!.createElement('span')
      wrapper.setAttribute(WRAP_ATTR, 'true')
      parent.insertBefore(wrapper, run[0])
      for (const n of run) {
        wrapper.appendChild(n)
      }
      tryExtract(wrapper)
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
      return
    }

    if (hasBlockChild(node)) {
      walkMixed(node)
      return
    }

    if (tryExtract(node)) return

    for (const child of node.children) {
      walk(child)
    }
  }

  walk(root)
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
  root.querySelectorAll(`.${RESULT_CLASS}`).forEach((el) => el.remove())
  root.querySelectorAll('.imp-translate-br').forEach((el) => el.remove())
  root.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((el) => {
    el.removeAttribute(PROCESSED_ATTR)
    el.removeAttribute('data-imp-text')
    el.removeAttribute('data-imp-noop')
  })
  root.querySelectorAll(`[${WRAP_ATTR}]`).forEach((wrapper) => {
    const parent = wrapper.parentNode
    if (!parent) return
    while (wrapper.firstChild) {
      parent.insertBefore(wrapper.firstChild, wrapper)
    }
    parent.removeChild(wrapper)
  })
  root.removeAttribute(PROCESSED_ATTR)
  root.removeAttribute('data-imp-text')
  root.removeAttribute('data-imp-noop')
}

export { RESULT_CLASS, PROCESSED_ATTR, getVisibleText }
