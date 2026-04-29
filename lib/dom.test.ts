import { describe, expect, it, beforeEach } from 'vitest'
import { extractBlocks, clearTranslations } from './dom'

describe('extractBlocks', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('should skip pre elements (code blocks)', () => {
    document.body.innerHTML = `
      <div>
        <p>Some text</p>
        <pre class="shiki"><code><span class="line">npm create vite@latest</span></code></pre>
        <p>More text</p>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe('Some text')
    expect(blocks[1].text).toBe('More text')
  })

  it('should extract text from div with form controls as inline', () => {
    document.body.innerHTML = `
      <div class="tabs">
        <input type="radio" name="group" id="tab-1" checked>
        <label for="tab-1">npm</label>
        <input type="radio" name="group" id="tab-2">
        <label for="tab-2">Yarn</label>
        <input type="radio" name="group" id="tab-3">
        <label for="tab-3">pnpm</label>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toContain('npm')
  })

  it('should not translate nav or footer', () => {
    document.body.innerHTML = `
      <nav><a href="/">Home</a></nav>
      <p>Main content</p>
      <footer><p>Copyright 2024</p></footer>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Main content')
  })

  it('should extract text from leaf blocks inside containers', () => {
    document.body.innerHTML = `
      <div>
        <h1>Title</h1>
        <p>Paragraph with <strong>bold</strong> text</p>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe('Title')
    expect(blocks[1].text).toBe('Paragraph with bold text')
  })

  it('should treat container div with only inline text as a leaf', () => {
    document.body.innerHTML = `
      <div>Hello world</div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Hello world')
  })

  it('should skip text with no letters (punctuation only)', () => {
    document.body.innerHTML = `
      <div>
        <span>·</span>
        <span>...</span>
        <span>—</span>
        <p>Real text</p>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Real text')
  })

  it('should exclude notranslate elements from visible text', () => {
    document.body.innerHTML = `
      <div>
        <a href="#">
          <h3>Learn JavaScript Online</h3>
          <div class="notranslate">
            <span>javascript.com</span>
            <cite>https://www.javascript.com</cite>
          </div>
        </a>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Learn JavaScript Online')
  })

  it('should ignore empty custom elements when checking block children', () => {
    document.body.innerHTML = `
      <div>
        <a href="#">
          Resetting feed/algorithm <faceplate-perfmark name="first-post-meaningful-paint"></faceplate-perfmark>
        </a>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Resetting feed/algorithm')
  })

  // npmjs.com wraps README in <div> → <span> → <section> → <article> → <div#readme>
  // The <span> is inline, so hasBlockChild must look through it to find the block content
  // Example: https://www.npmjs.com/package/vista
  it('should walk through inline wrappers containing block content', () => {
    document.body.innerHTML = `
      <div>
        <span>
          <section>
            <article>
              <div>
                <p>First paragraph</p>
                <p>Second paragraph</p>
              </div>
            </article>
          </section>
        </span>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe('First paragraph')
    expect(blocks[1].text).toBe('Second paragraph')
  })

  // Twitter/X wraps @mentions in <div style="display:inline"> inside the tweet text container.
  // hasBlockChild must check computed display to avoid splitting the tweet into fragments.
  // Example: https://x.com/itsstock/status/2048817860261425541
  it('should extract tweet with inline-displayed div children as one block', () => {
    document.body.innerHTML = `
      <div data-testid="tweetText">
        <span>Just migrated to </span>
        <div style="display:inline-flex"><span><a>@heliumbrowser</a></span></div>
        <span> and this works great.</span>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toContain('Just migrated to')
    expect(blocks[0].text).toContain('@heliumbrowser')
    expect(blocks[0].text).toContain('this works great')
  })

  // Discord wraps message paragraphs in <span> siblings of <ol> list blocks.
  // The walker must extract inline siblings when their parent has block children.
  // Example: https://discord.com/channels/1371251680787824650/1470342586031145040/1478845063504068638
  it('should extract inline siblings of block elements in mixed content', () => {
    document.body.innerHTML = `
      <div>
        <span>First paragraph of the message.</span>
        <ol><li>List item one</li></ol>
        <span>Second paragraph of the message.</span>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].text).toBe('First paragraph of the message.')
    expect(blocks[1].text).toBe('List item one')
    expect(blocks[2].text).toBe('Second paragraph of the message.')
  })

  it('should only translate inside include selectors', () => {
    document.body.innerHTML = `
      <div>
        <div class="sidebar"><p>Sidebar content</p></div>
        <div class="main-content"><p>Main content to translate</p></div>
      </div>
    `
    const blocks = extractBlocks(document.body, { includeSelectors: ['.main-content'] })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Main content to translate')
  })

  it('should not pull text from a skip-matched descendant up into an ancestor block', () => {
    // Repro: x.com trend metadata. The skip rule targets the inner span,
    // but its parent div was still picked up as a block and slurped the text back in.
    document.body.innerHTML = `
      <div data-testid="trend">
        <div dir="ltr">
          <span dir="ltr">
            <span>21 hours ago · Entertainment · 115K posts</span>
          </span>
        </div>
      </div>
    `
    const blocks = extractBlocks(document.body, {
      skipSelectors: ['[data-testid="trend"] span[dir="ltr"]'],
    })
    expect(blocks).toHaveLength(0)
  })

  it('should apply both include and skip rules together', () => {
    document.body.innerHTML = `
      <div class="post">
        <p>Translate this</p>
        <p class="metadata">Skip this</p>
      </div>
    `
    const blocks = extractBlocks(document.body, {
      includeSelectors: ['.post'],
      skipSelectors: ['.metadata'],
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Translate this')
  })

  it('should skip editable rich text editors', () => {
    document.body.innerHTML = `
      <div>
        <p>Normal text</p>
        <div class="DraftEditor-root">
          <div contenteditable="true">
            <p>Editable draft content</p>
          </div>
        </div>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Normal text')
  })

  it('should translate read-only rich text renderers', () => {
    document.body.innerHTML = `
      <div>
        <p>Normal text</p>
        <div class="DraftEditor-root">
          <div>
            <p>Read-only draft content</p>
          </div>
        </div>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe('Normal text')
    expect(blocks[1].text).toBe('Read-only draft content')
  })

  it('should extract loose text nodes interleaved with block and inline siblings', () => {
    // Repro: Apple's app review page — div contains h3 + bare text + b + bare text...
    document.body.innerHTML =
      '<div>' +
      '<h3>Guideline 2.1</h3>' +
      'We need additional information to continue the review.' +
      '<b>Next Steps</b>' +
      'Reply with the following.' +
      '</div>'
    const blocks = extractBlocks(document.body)
    // h3 + one wrapped run for the rest of the inline content
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe('Guideline 2.1')
    expect(blocks[1].text).toContain('We need additional information')
    expect(blocks[1].text).toContain('Next Steps')
    expect(blocks[1].text).toContain('Reply with the following')
    // The wrapper element should be a synthesized span with data-imp-wrap
    expect(blocks[1].element.tagName).toBe('SPAN')
    expect(blocks[1].element.hasAttribute('data-imp-wrap')).toBe(true)
  })

  it('should not wrap a single inline element that is already a translation block', () => {
    document.body.innerHTML =
      '<div><h3>Title</h3><b>Subtitle</b></div>'
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].element.tagName).toBe('H3')
    // <b> alone in its run should not get wrapped
    expect(blocks[1].element.tagName).toBe('B')
  })

  it('should not wrap when container has no block children (existing leaf path)', () => {
    document.body.innerHTML = '<div>Hello world</div>'
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].element.tagName).toBe('DIV')
    expect(blocks[0].element.hasAttribute('data-imp-wrap')).toBe(false)
  })

  it('clearTranslations unwraps synthesized wrappers, restoring DOM', () => {
    document.body.innerHTML =
      '<div id="root">' +
      '<h3>Heading</h3>' +
      'loose text' +
      '<b>Bold</b>' +
      ' more text' +
      '</div>'
    const root = document.getElementById('root')!
    const before = root.innerHTML
    extractBlocks(root)
    expect(root.querySelectorAll('[data-imp-wrap]').length).toBe(1)
    clearTranslations(root)
    expect(root.querySelectorAll('[data-imp-wrap]').length).toBe(0)
    expect(root.innerHTML).toBe(before)
  })

  it('should not wrap sibling inline elements that contain block-level content', () => {
    // Repro: npm.com readme structure — outer div has two span siblings,
    // first span contains the entire readme body inside <section>/<h1>/<p>...
    document.body.innerHTML =
      '<div>' +
      '<span>' +
      '<section><h1>Title</h1><p>Paragraph 1</p><p>Paragraph 2</p></section>' +
      '</span>' +
      '<span></span>' +
      '</div>'
    const blocks = extractBlocks(document.body)
    // Should produce 3 separate blocks (h1 + 2x p), NOT one wrapped span
    expect(blocks.map((b) => b.text)).toEqual([
      'Title',
      'Paragraph 1',
      'Paragraph 2',
    ])
    expect(document.querySelectorAll('[data-imp-wrap]').length).toBe(0)
  })

  it('skipSelectors filter content inside synthesized wrappers', () => {
    document.body.innerHTML =
      '<div>' +
      '<h3>Title</h3>' +
      'Visible text ' +
      '<span class="meta">hidden meta</span>' +
      ' more visible text' +
      '</div>'
    const blocks = extractBlocks(document.body, {
      skipSelectors: ['.meta'],
    })
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe('Title')
    expect(blocks[1].text).not.toContain('hidden meta')
    expect(blocks[1].text).toContain('Visible text')
    expect(blocks[1].text).toContain('more visible text')
  })

  it('walks into open shadow root and extracts text', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const host = document.getElementById('host')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>Shadow paragraph</p><h2>Shadow heading</h2>'
    const blocks = extractBlocks(document.body)
    expect(blocks.map((b) => b.text)).toEqual(['Shadow paragraph', 'Shadow heading'])
  })

  it('walks into nested shadow roots', () => {
    document.body.innerHTML = '<div id="outer"></div>'
    const outer = document.getElementById('outer')!
    const outerShadow = outer.attachShadow({ mode: 'open' })
    outerShadow.innerHTML = '<div id="inner"></div>'
    const inner = outerShadow.getElementById('inner')!
    const innerShadow = inner.attachShadow({ mode: 'open' })
    innerShadow.innerHTML = '<p>Deeply nested text</p>'
    const blocks = extractBlocks(document.body)
    expect(blocks.map((b) => b.text)).toEqual(['Deeply nested text'])
  })

  it('extracts both light children (via slot) and shadow content', () => {
    // Real-world web components project light children through <slot>.
    // Without a slot, light children are unrendered and isHidden filters them.
    document.body.innerHTML = '<div id="host"><p>Light paragraph</p></div>'
    const host = document.getElementById('host')!
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<h2>Shadow heading</h2><slot></slot>'
    const blocks = extractBlocks(document.body)
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain('Light paragraph')
    expect(texts).toContain('Shadow heading')
  })

  it('onShadowRoot callback fires for each shadow root encountered', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    const aRoot = a.attachShadow({ mode: 'open' })
    const bRoot = b.attachShadow({ mode: 'open' })
    aRoot.innerHTML = '<p>a</p>'
    bRoot.innerHTML = '<p>b</p>'
    const seen: ShadowRoot[] = []
    extractBlocks(document.body, { onShadowRoot: (r) => seen.push(r) })
    expect(seen).toHaveLength(2)
    expect(seen).toContain(aRoot)
    expect(seen).toContain(bRoot)
  })

  it('clearTranslations recurses into shadow roots', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const host = document.getElementById('host')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>Shadow text</p>'
    extractBlocks(document.body)
    // Simulate translation: mark the shadow <p> as translated and add result
    const p = shadow.querySelector('p')!
    p.setAttribute('data-imp-translated', 'true')
    p.setAttribute('data-imp-text', 'Shadow text')
    const result = document.createElement('font')
    result.className = 'imp-translate-result'
    result.textContent = 'Translated'
    p.appendChild(result)

    clearTranslations(document.body)
    expect(p.hasAttribute('data-imp-translated')).toBe(false)
    expect(shadow.querySelector('.imp-translate-result')).toBe(null)
  })

  it('walks shadow even when host element is also a leaf block', () => {
    // A leaf-block tag like <h2> attaching a shadow is unusual but legal
    document.body.innerHTML = '<h2 id="host">light heading</h2>'
    const host = document.getElementById('host')!
    host.attachShadow({ mode: 'open' }).innerHTML = '<span>shadow span</span>'
    const blocks = extractBlocks(document.body)
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain('light heading')
    expect(texts).toContain('shadow span')
  })

  it('should skip time elements', () => {
    document.body.innerHTML = `
      <div>
        <p>Some text</p>
        <time datetime="2026-04-26T09:04:31.000Z">6h</time>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Some text')
  })
})
