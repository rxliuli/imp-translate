import { describe, expect, it, beforeEach } from 'vitest'
import { extractBlocks } from './dom'

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
