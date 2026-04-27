import { describe, expect, it } from 'vitest'
import { injectLoading, replaceWithTranslation } from './render'
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
})
