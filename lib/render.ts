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

export function repositionTranslation(element: HTMLElement, expectedText: string): void {
  const wrapper = element.querySelector(`.${RESULT_CLASS}`) as HTMLElement | null
  if (!wrapper) return

  const correctTarget = findInjectionPoint(element)
  if (wrapper.parentElement === correctTarget) return

  const prev = wrapper.previousSibling
  wrapper.remove()
  if (prev?.nodeType === Node.ELEMENT_NODE && (prev as Element).classList.contains(BR_CLASS)) {
    prev.parentElement?.removeChild(prev)
  } else if (prev?.nodeType === Node.TEXT_NODE && prev.textContent === ' ') {
    prev.parentElement?.removeChild(prev)
  }

  const isShort = expectedText.length <= SHORT_TEXT_THRESHOLD
  if (isShort) {
    correctTarget.appendChild(document.createTextNode(' '))
  } else {
    const br = document.createElement('br')
    br.className = BR_CLASS
    correctTarget.appendChild(br)
  }
  correctTarget.appendChild(wrapper)
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
      element.setAttribute('data-imp-noop', '')
      continue
    }

    wrapper.className = RESULT_CLASS
    wrapper.textContent = translated
  }
}

function collectAllErrorBlocks(): TranslatableBlock[] {
  const errorWrappers = document.querySelectorAll(`.${ERROR_CLASS}`)
  const blocks: TranslatableBlock[] = []
  for (const wrapper of errorWrappers) {
    const el = wrapper.closest('[data-imp-text]') as HTMLElement | null
    if (!el) continue
    const text = el.getAttribute('data-imp-text')
    if (!text) continue
    blocks.push({ element: el, text })
  }
  return blocks
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
      const allErrors = collectAllErrorBlocks()
      for (const { element: el } of allErrors) {
        const w = el.querySelector(`.${RESULT_CLASS}`)
        if (w) {
          w.className = `${RESULT_CLASS} ${LOADING_CLASS}`
          w.textContent = ''
        }
      }
      onRetry(allErrors)
    }, { once: true })
    wrapper.appendChild(retryBtn)
  }
}


export function removeStyles() {
  document.getElementById(STYLE_ID)?.remove()
}

const DEBUG_STYLE_ID = 'imp-translate-debug-style'

export function injectDebugStyles() {
  if (document.getElementById(DEBUG_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = DEBUG_STYLE_ID
  style.textContent = `
    [data-imp-noop] {
      outline: 2px dashed rgba(255, 80, 80, 0.7) !important;
      outline-offset: -2px !important;
      position: relative !important;
    }
    [data-imp-noop]::after {
      content: 'no-op';
      position: absolute;
      top: 0;
      right: 0;
      padding: 1px 4px;
      font: 10px/1.2 system-ui, sans-serif;
      background: rgba(255, 80, 80, 0.9);
      color: white;
      border-radius: 0 0 0 3px;
      z-index: 2147483647;
      pointer-events: none;
    }
  `
  document.head.appendChild(style)
}

export function removeDebugStyles() {
  document.getElementById(DEBUG_STYLE_ID)?.remove()
}

const TOAST_ID = 'imp-translate-toast'
const TOAST_STYLE_ID = 'imp-translate-toast-style'

function ensureToastStyles() {
  if (document.getElementById(TOAST_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = TOAST_STYLE_ID
  style.textContent = `
    @keyframes imp-toast-slide-in {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes imp-toast-slide-out {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(-100%); opacity: 0; }
    }
    #${TOAST_ID} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      font: 14px/1 system-ui, sans-serif;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      background: rgba(255, 255, 255, 0.85);
      color: #333;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      animation: imp-toast-slide-in 0.25s ease-out;
    }
    #${TOAST_ID}.imp-toast-out {
      animation: imp-toast-slide-out 0.2s ease-in forwards;
    }
    @media (prefers-color-scheme: dark) {
      #${TOAST_ID} {
        background: rgba(30, 30, 30, 0.85);
        color: #e0e0e0;
        border-bottom-color: rgba(255, 255, 255, 0.1);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      }
      #${TOAST_ID} .imp-toast-restore { color: #6ea8fe !important; }
      #${TOAST_ID} .imp-toast-settings { color: #aaa !important; }
    }
    #${TOAST_ID} .imp-toast-text { flex: 1; }
    #${TOAST_ID} button {
      background: none;
      border: none;
      cursor: pointer;
      font: inherit;
      padding: 4px 8px;
      border-radius: 4px;
    }
    #${TOAST_ID} button:active { opacity: 0.7; }
    #${TOAST_ID} .imp-toast-restore { color: #2563eb; }
    #${TOAST_ID} .imp-toast-settings { color: #666; font-size: 16px; }
  `
  document.head.appendChild(style)
}

export function showToastBar(onRestore: () => void, onSettings: () => void) {
  if (document.getElementById(TOAST_ID)) return
  ensureToastStyles()

  const bar = document.createElement('div')
  bar.id = TOAST_ID
  bar.setAttribute('translate', 'no')

  const text = document.createElement('span')
  text.className = 'imp-toast-text'
  text.textContent = 'Page translated'

  const restoreBtn = document.createElement('button')
  restoreBtn.className = 'imp-toast-restore'
  restoreBtn.textContent = 'Show original'
  restoreBtn.addEventListener('click', onRestore)

  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'imp-toast-settings'
  settingsBtn.textContent = '⚙'
  settingsBtn.addEventListener('click', onSettings)

  bar.append(text, restoreBtn, settingsBtn)
  document.body.appendChild(bar)
}

export function hideToastBar() {
  const bar = document.getElementById(TOAST_ID)
  if (!bar) return
  bar.classList.add('imp-toast-out')
  bar.addEventListener('animationend', () => {
    bar.remove()
    document.getElementById(TOAST_STYLE_ID)?.remove()
  }, { once: true })
}
