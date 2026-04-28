import { describe, expect, it, vi } from 'vitest'
import { injectLoading, replaceWithError, replaceWithTranslation, repositionTranslation } from './render'
import type { TranslatableBlock } from './dom'

describe('render', () => {
  it('should inject inside innermost inline element', () => {
    document.body.innerHTML = `
      <ul>
        <li><b><a href="/wiki/test">Archive</a></b></li>
      </ul>
    `
    const li = document.querySelector('li')!
    const blocks: TranslatableBlock[] = [
      { element: li as HTMLElement, text: 'Archive' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['档案'])

    const a = li.querySelector('a')!
    const font = a.querySelector('font.imp-translate-result')
    expect(font).not.toBeNull()
    expect(font!.textContent).toBe('档案')
  })

  it('should inject directly in block element when multiple children', () => {
    document.body.innerHTML = `<p>Hello <strong>world</strong></p>`
    const p = document.querySelector('p')!
    const blocks: TranslatableBlock[] = [
      { element: p as HTMLElement, text: 'Hello world' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['你好世界'])

    const font = p.querySelector(':scope > font.imp-translate-result')
    expect(font).not.toBeNull()
    expect(font!.textContent).toBe('你好世界')
  })

  it('should use inline space for short text instead of br', () => {
    document.body.innerHTML = `<li><a href="#">Archive</a></li>`
    const li = document.querySelector('li')!
    const blocks: TranslatableBlock[] = [
      { element: li as HTMLElement, text: 'Archive' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['档案'])

    const br = li.querySelector('br.imp-translate-br')
    expect(br).toBeNull()
  })

  it('should use br for long text', () => {
    document.body.innerHTML = `<p>This is a long paragraph that exceeds the short text threshold limit.</p>`
    const p = document.querySelector('p')!
    const blocks: TranslatableBlock[] = [
      { element: p as HTMLElement, text: 'This is a long paragraph that exceeds the short text threshold limit.' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['这是一段很长的文本，超过了短文本的阈值限制。'])

    const br = p.querySelector('br.imp-translate-br')
    expect(br).not.toBeNull()
  })

  it('should skip empty icon elements and inject into text-containing child', () => {
    document.body.innerHTML = `
      <div class="scrimba">
        <span class="play-button"><span class="play-icon"></span></span>
        <a href="#">Watch an interactive lesson</a>
      </div>
    `
    const div = document.querySelector('.scrimba')!
    const blocks: TranslatableBlock[] = [
      { element: div as HTMLElement, text: 'Watch an interactive lesson' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['观看互动课程'])

    const a = div.querySelector('a')!
    const font = a.querySelector('font.imp-translate-result')
    expect(font).not.toBeNull()
    expect(font!.textContent).toBe('观看互动课程')
  })

  it('should drill through block elements to find text-containing child', () => {
    document.body.innerHTML = `
      <div class="channel">
        <a href="/channel/general">
          <div class="link-top">
            <div class="name">general</div>
          </div>
        </a>
      </div>
    `
    const div = document.querySelector('.channel')!
    const blocks: TranslatableBlock[] = [
      { element: div as HTMLElement, text: 'general' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['概述'])

    const nameDiv = div.querySelector('.name')!
    const font = nameDiv.querySelector('font.imp-translate-result')
    expect(font).not.toBeNull()
    expect(font!.textContent).toBe('概述')
  })

  it('should clear line-clamp on injected elements', () => {
    document.body.innerHTML = `
      <div class="snippet" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
        This is a search result snippet that gets clamped to two lines.
      </div>
    `
    const div = document.querySelector('.snippet')! as HTMLElement
    const blocks: TranslatableBlock[] = [
      { element: div, text: 'This is a search result snippet that gets clamped to two lines.' },
    ]
    injectLoading(blocks)

    expect(div.style.webkitLineClamp).toBe('unset')
    expect(div.style.overflow).toBe('visible')
  })

  it('should remove translation when result matches original text (case-insensitive)', () => {
    document.body.innerHTML = `<p>src</p>`
    const p = document.querySelector('p')!
    const blocks: TranslatableBlock[] = [
      { element: p as HTMLElement, text: 'src' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['SRC'])

    const font = p.querySelector('font.imp-translate-result')
    expect(font).toBeNull()
    expect(p.hasAttribute('data-imp-noop')).toBe(true)
  })

  it('should not mark data-imp-noop when translation differs from source', () => {
    document.body.innerHTML = `<p>hello</p>`
    const p = document.querySelector('p')!
    const blocks: TranslatableBlock[] = [
      { element: p as HTMLElement, text: 'hello' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, ['你好'])

    expect(p.hasAttribute('data-imp-noop')).toBe(false)
  })

  it('should remove translation and separator when translation is empty', () => {
    document.body.innerHTML = `<p>Hello world</p>`
    const p = document.querySelector('p')!
    const blocks: TranslatableBlock[] = [
      { element: p as HTMLElement, text: 'Hello world' },
    ]
    injectLoading(blocks)
    replaceWithTranslation(blocks, [''])

    const font = p.querySelector('font.imp-translate-result')
    expect(font).toBeNull()
    const br = p.querySelector('br.imp-translate-br')
    expect(br).toBeNull()
  })

  // Twitter timeline: tweet initially has one <span> child, so findInjectionPoint
  // drills into it and the <font> ends up inside the span. When "Show more" later
  // appends a sibling div (e.g. an @mention link), the translation gets stuck
  // before the new sibling instead of after it. repositionTranslation must move
  // the wrapper to the parent so the original text comes first, translation last.
  // Example: https://x.com/MarioNawfal/status/2049040672083345418
  it('moves wrapper to block element when a new sibling is added after translation', () => {
    document.body.innerHTML = `
      <div id="block"><span id="text">This is a long sentence that triggers translation injection.</span></div>
    `
    const block = document.getElementById('block')! as HTMLElement
    const text = 'This is a long sentence that triggers translation injection.'

    injectLoading([{ element: block, text }])
    replaceWithTranslation([{ element: block, text }], ['翻译'])

    const fontBefore = block.querySelector('font.imp-translate-result')!
    expect(fontBefore.parentElement?.id).toBe('text')

    // Simulate "Show more" appending a sibling
    const sibling = document.createElement('div')
    sibling.id = 'mention'
    sibling.innerHTML = '<a href="#">@user</a>'
    block.appendChild(sibling)

    repositionTranslation(block, text + ' @user')

    const fontAfter = block.querySelector('font.imp-translate-result')!
    expect(fontAfter).toBe(fontBefore)
    expect(fontAfter.parentElement).toBe(block)
    // <font> must come after the new sibling
    const br = fontAfter.previousElementSibling!
    expect(br.tagName).toBe('BR')
    expect(br.previousElementSibling?.id).toBe('mention')
    // No leftover separator inside the original span
    expect(document.getElementById('text')!.querySelector('br.imp-translate-br')).toBeNull()
  })

  it('is a no-op when injection point has not changed', () => {
    document.body.innerHTML = `<p>Hello world this is long enough to trigger br separator.</p>`
    const p = document.querySelector('p')!
    const text = 'Hello world this is long enough to trigger br separator.'

    injectLoading([{ element: p as HTMLElement, text }])
    replaceWithTranslation([{ element: p as HTMLElement, text }], ['你好世界'])

    const fontBefore = p.querySelector('font.imp-translate-result')!
    const parentBefore = fontBefore.parentElement
    const brBefore = p.querySelector('br.imp-translate-br')!

    repositionTranslation(p as HTMLElement, text)

    const fontAfter = p.querySelector('font.imp-translate-result')!
    expect(fontAfter).toBe(fontBefore)
    expect(fontAfter.parentElement).toBe(parentBefore)
    // Did not create a duplicate separator
    expect(p.querySelectorAll('br.imp-translate-br')).toHaveLength(1)
    expect(p.querySelector('br.imp-translate-br')).toBe(brBefore)
  })

  it('clicking any retry button retries all currently-errored blocks globally', () => {
    document.body.innerHTML = `
      <p id="a">Hello world this is long enough to trigger br separator.</p>
      <p id="b">Goodbye world this is also long enough.</p>
      <p id="c">Foo bar baz qux this needs translating.</p>
    `
    const a = document.getElementById('a') as HTMLElement
    const b = document.getElementById('b') as HTMLElement
    const c = document.getElementById('c') as HTMLElement

    const blocks: TranslatableBlock[] = [
      { element: a, text: 'Hello world this is long enough to trigger br separator.' },
      { element: b, text: 'Goodbye world this is also long enough.' },
      { element: c, text: 'Foo bar baz qux this needs translating.' },
    ]
    for (const blk of blocks) {
      blk.element.setAttribute('data-imp-text', blk.text)
    }

    injectLoading(blocks)

    const onRetry = vi.fn()
    // simulate two separate failed flushes attaching errors at different times
    replaceWithError([blocks[0], blocks[1]], onRetry)
    replaceWithError([blocks[2]], onRetry)

    expect(document.querySelectorAll('.imp-translate-retry')).toHaveLength(3)
    expect(document.querySelectorAll('.imp-translate-error')).toHaveLength(3)

    const firstBtn = document.querySelector<HTMLButtonElement>('.imp-translate-retry')!
    firstBtn.click()

    expect(onRetry).toHaveBeenCalledOnce()
    const retried = onRetry.mock.calls[0][0] as TranslatableBlock[]
    expect(retried).toHaveLength(3)
    expect(retried.map((blk) => blk.text).sort()).toEqual([
      'Foo bar baz qux this needs translating.',
      'Goodbye world this is also long enough.',
      'Hello world this is long enough to trigger br separator.',
    ])

    expect(document.querySelectorAll('.imp-translate-error')).toHaveLength(0)
    expect(document.querySelectorAll('.imp-translate-retry')).toHaveLength(0)
    expect(document.querySelectorAll('.imp-translate-loading')).toHaveLength(3)
  })

  it('uses inline space separator when moved text is short', () => {
    document.body.innerHTML = `<div id="block"><span id="text">Hi</span></div>`
    const block = document.getElementById('block')! as HTMLElement

    injectLoading([{ element: block, text: 'Hi' }])
    replaceWithTranslation([{ element: block, text: 'Hi' }], ['你好'])

    // Initial injection used a space (short text)
    expect(block.querySelector('br.imp-translate-br')).toBeNull()

    const sibling = document.createElement('a')
    sibling.id = 'link'
    sibling.textContent = '@user'
    block.appendChild(sibling)

    repositionTranslation(block, 'Hi @user')

    const font = block.querySelector('font.imp-translate-result')!
    expect(font.parentElement).toBe(block)
    // Still short text → still uses space, not br
    expect(block.querySelector('br.imp-translate-br')).toBeNull()
    expect(font.previousSibling?.nodeType).toBe(Node.TEXT_NODE)
    expect(font.previousSibling?.textContent).toBe(' ')
  })
})
