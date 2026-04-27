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

  it('should not treat div with form controls as a leaf block', () => {
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
    expect(blocks).toHaveLength(0)
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
