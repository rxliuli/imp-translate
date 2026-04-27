const INLINE_TAGS = new Set([
  '#text', 'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'br',
  'cite', 'code', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd',
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
  '.DraftEditor-root',
  '[data-lexical-editor]',
  '.ProseMirror',
  '[data-slate-editor]',
  '.ql-editor',
  '.ck-editor',
  '.tox-editor-container',
  '.cm-editor',
  '.monaco-editor',
].join(',')

const RESULT_CLASS = 'imp-translate-result'
const PROCESSED_ATTR = 'data-imp-translated'

export interface TranslatableBlock {
  element: HTMLElement
  text: string
}

function shouldSkip(el: Element): boolean {
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
  return el.offsetWidth <= 1 || el.offsetHeight <= 1
}

function getVisibleText(el: Element): string {
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
      text += getVisibleText(childEl)
    }
  }
  return text
}

function hasBlockChild(el: Element): boolean {
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase()
    if (!INLINE_TAGS.has(tag) && !SKIP_TAGS.has(tag)) {
      if (tag.includes('-') && !child.textContent?.trim()) continue
      return true
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

export function extractBlocks(root: Element = document.body): TranslatableBlock[] {
  const blocks: TranslatableBlock[] = []

  function tryExtract(node: Element): boolean {
    if (isHidden(node as HTMLElement)) return false
    const text = getVisibleText(node).trim()
    if (text && !NO_LETTER_RE.test(text)) {
      blocks.push({ element: node as HTMLElement, text })
      return true
    }
    return false
  }

  function canExtract(node: Element): boolean {
    const tag = node.tagName.toLowerCase()
    if (!INLINE_TAGS.has(tag)) return true
    const display = getComputedStyle(node).display
    return display === 'block' || display === 'flex' || display === 'grid' || display === 'list-item'
  }

  function walk(node: Element) {
    if (shouldSkip(node)) return

    const tag = node.tagName.toLowerCase()

    if (SKIP_CONTAINERS.has(tag)) return

    if (isLeafBlock(node)) {
      tryExtract(node)
      return
    }

    if (CONTAINER_TAGS.has(tag)) {
      if (!hasBlockChild(node)) {
        if (tryExtract(node)) return
      }
      for (const child of node.children) {
        walk(child)
      }
      return
    }

    if (!hasBlockChild(node) && canExtract(node)) {
      if (tryExtract(node)) return
    }

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
    return rect.bottom > 0 && rect.top < viewportHeight
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
  })
}

export { RESULT_CLASS, PROCESSED_ATTR }
