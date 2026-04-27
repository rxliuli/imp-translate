import { RESULT_CLASS, type TranslatableBlock } from './dom'

function hasVisibleText(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return !!node.textContent?.trim()
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement
    if (el.offsetWidth <= 1 || el.offsetHeight <= 1) return false
    for (const child of node.childNodes) {
      if (hasVisibleText(child)) return true
    }
  }
  return false
}

function findInjectionPoint(element: HTMLElement): HTMLElement {
  let current = element
  while (true) {
    const children = Array.from(current.childNodes).filter((n) => {
      if (n.nodeType === Node.TEXT_NODE) return n.textContent?.trim()
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element
        if (el.classList.contains(RESULT_CLASS) || el.classList.contains(BR_CLASS)) return false
        if (el.classList.contains('notranslate') || el.getAttribute('translate') === 'no') return false
        return hasVisibleText(el)
      }
      return false
    })
    if (children.length === 1 && children[0].nodeType === Node.ELEMENT_NODE) {
      current = children[0] as HTMLElement
      continue
    }
    break
  }
  return current
}

const STYLE_ID = 'imp-translate-style'
const BR_CLASS = 'imp-translate-br'
const LOADING_CLASS = 'imp-translate-loading'
const ERROR_CLASS = 'imp-translate-error'
const RETRY_CLASS = 'imp-translate-retry'
const SHORT_TEXT_THRESHOLD = 40

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .${RESULT_CLASS} {
      font-style: normal;
      font-weight: inherit;
    }
    *:has(.${RESULT_CLASS}) {
      -webkit-line-clamp: unset !important;
    }
    .${LOADING_CLASS} {
      display: inline-block;
      font-size: 0.75em;
      opacity: 0.5;
      vertical-align: middle;
    }
    @keyframes imp-translate-spin {
      to { transform: rotate(360deg); }
    }
    .${LOADING_CLASS}::before {
      content: '';
      display: inline-block;
      width: 0.8em;
      height: 0.8em;
      border: 1.5px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: imp-translate-spin 0.6s linear infinite;
      vertical-align: middle;
    }
    .${ERROR_CLASS} {
      font-size: 0.75em;
      opacity: 0.7;
    }
    .${RETRY_CLASS} {
      cursor: pointer;
      text-decoration: underline;
      color: inherit;
      background: none;
      border: none;
      font: inherit;
      font-size: inherit;
      padding: 0;
      opacity: 0.7;
    }
    .${RETRY_CLASS}:hover {
      opacity: 1;
    }
  `
  document.head.appendChild(style)
}

function clearLineClamp(el: HTMLElement) {
  const style = getComputedStyle(el)
  if (style.webkitLineClamp && style.webkitLineClamp !== 'none') {
    el.style.webkitLineClamp = 'unset'
    el.style.overflow = 'visible'
  }
}

export function injectLoading(blocks: TranslatableBlock[]) {
  ensureStyles()
  for (const { element, text } of blocks) {
    if (element.querySelector(`.${RESULT_CLASS}`)) continue

    const target = findInjectionPoint(element)
    clearLineClamp(element)
    if (target !== element) clearLineClamp(target)
    const isShort = text.length <= SHORT_TEXT_THRESHOLD

    const wrapper = document.createElement('font')
    wrapper.className = `${RESULT_CLASS} ${LOADING_CLASS}`
    wrapper.setAttribute('translate', 'no')

    if (isShort) {
      target.appendChild(document.createTextNode(' '))
      target.appendChild(wrapper)
    } else {
      const br = document.createElement('br')
      br.className = BR_CLASS
      target.appendChild(br)
      target.appendChild(wrapper)
    }
  }
}

export function replaceWithTranslation(blocks: TranslatableBlock[], translations: string[]) {
  for (let i = 0; i < blocks.length; i++) {
    const { element } = blocks[i]
    const translated = translations[i]
    const wrapper = element.querySelector(`.${RESULT_CLASS}`)
    if (!wrapper) continue

    if (!translated || translated.toLowerCase() === blocks[i].text.toLowerCase()) {
      const prev = wrapper.previousSibling
      if (prev?.nodeType === Node.ELEMENT_NODE && (prev as Element).classList.contains(BR_CLASS)) {
        prev.remove()
      } else if (prev?.nodeType === Node.TEXT_NODE && prev.textContent === ' ') {
        prev.remove()
      }
      wrapper.remove()
      continue
    }

    wrapper.className = RESULT_CLASS
    wrapper.textContent = translated
  }
}

export function replaceWithError(
  blocks: TranslatableBlock[],
  onRetry: (blocks: TranslatableBlock[]) => void,
) {
  for (const { element } of blocks) {
    const wrapper = element.querySelector(`.${RESULT_CLASS}`)
    if (!wrapper) continue

    wrapper.className = `${RESULT_CLASS} ${ERROR_CLASS}`
    wrapper.textContent = ''

    const retryBtn = document.createElement('button')
    retryBtn.className = RETRY_CLASS
    retryBtn.textContent = '⟳ Retry'
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      for (const { element: el } of blocks) {
        const w = el.querySelector(`.${RESULT_CLASS}`)
        if (w) {
          w.className = `${RESULT_CLASS} ${LOADING_CLASS}`
          w.textContent = ''
        }
      }
      onRetry(blocks)
    }, { once: true })
    wrapper.appendChild(retryBtn)
  }
}


export function removeStyles() {
  document.getElementById(STYLE_ID)?.remove()
}
