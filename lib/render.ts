import { RESULT_CLASS, PROCESSED_ATTR, type TranslatableBlock } from './dom'
import { LANGUAGES_SORTED } from './languages'

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

const STYLES_TEXT = `
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

let sharedSheet: CSSStyleSheet | null = null

function getSharedSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === 'undefined') return null
  if (sharedSheet) return sharedSheet
  try {
    sharedSheet = new CSSStyleSheet()
    sharedSheet.replaceSync(STYLES_TEXT)
    return sharedSheet
  } catch {
    return null
  }
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLES_TEXT
  document.head.appendChild(style)
}

export function ensureShadowStyles(root: ShadowRoot) {
  const sheet = getSharedSheet()
  if (sheet) {
    if (root.adoptedStyleSheets.includes(sheet)) return
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
    return
  }
  // Fallback for environments without constructable stylesheets
  if (root.querySelector(`#${STYLE_ID}`)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLES_TEXT
  root.appendChild(style)
}

function clearLineClamp(el: HTMLElement) {
  const style = getComputedStyle(el)
  if (style.webkitLineClamp && style.webkitLineClamp !== 'none') {
    el.style.webkitLineClamp = 'unset'
    el.style.overflow = 'visible'
  }
}

// If the last visible child of the target already creates a visual line break
// — its computed display is non-inline — then injecting a <br> before the
// translation produces a redundant blank line. This catches:
//   - flex-column / grid parents (children get blockified to computed `block`)
//   - block parents whose last meaningful child is itself a block element (p,
//     div, etc.)
// Inline last children (text nodes, <a>, <span> with default display) still
// need the <br> to push the translation onto its own line.
function lastVisibleChildIsBlockLike(target: HTMLElement): boolean {
  for (let i = target.childNodes.length - 1; i >= 0; i--) {
    const n = target.childNodes[i]
    if (n.nodeType === Node.TEXT_NODE) {
      if (!n.textContent?.trim()) continue
      return false
    }
    if (n.nodeType !== Node.ELEMENT_NODE) continue
    const el = n as HTMLElement
    // Skip our own injections so a re-injection doesn't read its previous br.
    if (el.classList.contains(BR_CLASS) || el.classList.contains(RESULT_CLASS)) continue
    const display = getComputedStyle(el).display
    if (display === 'none' || display === 'contents') continue
    return !display.startsWith('inline')
  }
  return false
}

export function injectLoading(blocks: TranslatableBlock[]) {
  ensureStyles()
  for (const { element, text } of blocks) {
    if (element.querySelector(`.${RESULT_CLASS}`)) continue
    if (element.parentElement?.closest(`[${PROCESSED_ATTR}]`)) continue

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
    } else if (lastVisibleChildIsBlockLike(target)) {
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
  } else if (!lastVisibleChildIsBlockLike(correctTarget)) {
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
    #${TOAST_ID} .imp-toast-lang {
      appearance: none;
      -webkit-appearance: none;
      background: rgba(0, 0, 0, 0.06);
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 4px;
      padding: 4px 20px 4px 8px;
      font: inherit;
      font-size: 13px;
      color: inherit;
      cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 6px center;
      flex-shrink: 0;
    }
    @media (prefers-color-scheme: dark) {
      #${TOAST_ID} .imp-toast-lang {
        background-color: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.15);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23aaa'/%3E%3C/svg%3E");
      }
    }
  `
  document.head.appendChild(style)
}

export interface ToastBarOptions {
  currentLang: string
  onRestore: () => void
  onSettings: () => void
  onLangChange: (lang: string) => void
  onResetTimer?: (delayMs: number) => void
}

export function showToastBar(options: ToastBarOptions) {
  if (document.getElementById(TOAST_ID)) return
  ensureToastStyles()

  const bar = document.createElement('div')
  bar.id = TOAST_ID
  bar.setAttribute('translate', 'no')

  const langSelect = document.createElement('select')
  langSelect.className = 'imp-toast-lang'
  for (const [code, name] of LANGUAGES_SORTED) {
    const opt = document.createElement('option')
    opt.value = code
    opt.textContent = name
    if (code === options.currentLang) opt.selected = true
    langSelect.appendChild(opt)
  }
  let justChanged = false
  langSelect.addEventListener('change', () => {
    justChanged = true
    setTimeout(() => { justChanged = false }, 100)
    options.onLangChange(langSelect.value)
    options.onResetTimer?.(5000)
  })
  langSelect.addEventListener('focus', () => options.onResetTimer?.(15000))
  langSelect.addEventListener('click', () => {
    if (!justChanged) options.onResetTimer?.(15000)
  })

  const spacer = document.createElement('span')
  spacer.className = 'imp-toast-text'

  const restoreBtn = document.createElement('button')
  restoreBtn.className = 'imp-toast-restore'
  restoreBtn.textContent = 'Show original'
  restoreBtn.addEventListener('click', options.onRestore)

  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'imp-toast-settings'
  settingsBtn.textContent = '⚙'
  settingsBtn.addEventListener('click', options.onSettings)

  bar.append(langSelect, spacer, restoreBtn, settingsBtn)
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
