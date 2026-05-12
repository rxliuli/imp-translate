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

  it('should skip when a skip-matched ancestor is above the walk root', () => {
    // Repro: YouTube comment engagement bar. When YouTube lazily expands a reply
    // thread, MutationObserver fires extractBlocks(addedNode) where addedNode is
    // already deep inside an existing ytd-comment-engagement-bar. With the old
    // matches()-only check, the walker couldn't see the ancestor skip selector
    // and translated the "Reply" button label.
    document.body.innerHTML = `
      <ytd-comment-engagement-bar>
        <div id="toolbar">
          <div id="reply-button-end">
            <span>Reply</span>
          </div>
        </div>
      </ytd-comment-engagement-bar>
    `
    const replyButton = document.querySelector('#reply-button-end')!
    const blocks = extractBlocks(replyButton, {
      skipSelectors: ['ytd-comment-engagement-bar'],
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
    // The wrapper element should be a synthesized <font> with data-imp-wrap.
    // <font> over <span> because site CSS/JS rarely targets the near-deprecated
    // <font> tag, keeping the wrapper transparent to the host page.
    expect(blocks[1].element.tagName).toBe('FONT')
    expect(blocks[1].element.hasAttribute('data-imp-wrap')).toBe(true)
  })

  it('segments inline runs at <br><br> boundaries (App Store-style email layout)', () => {
    // Repro: App Store Connect rejection emails render as a flat <div> with
    // text/anchor/<b> nodes separated by <br><br> "fake paragraphs". Without
    // segmentation the entire div became one giant translation block whose
    // result was a single run-on paragraph, losing all visual structure.
    document.body.innerHTML =
      '<div>' +
      'Hello,<br><br>' +
      'Thank you for your message.<br><br>' +
      '<b>Issue Description</b><br><br>' +
      'The app metadata includes references that are not relevant.<br><br>' +
      'Best regards,<br>' +
      '</div>'
    const blocks = extractBlocks(document.body)
    expect(blocks.map((b) => b.text)).toEqual([
      'Hello,',
      'Thank you for your message.',
      'Issue Description',
      'The app metadata includes references that are not relevant.',
      'Best regards,',
    ])
    // <b> stays as its own block (single inline element, no wrap)
    const bBlock = blocks.find((b) => b.text === 'Issue Description')!
    expect(bBlock.element.tagName).toBe('B')
    // Trailing single <br> is trimmed off the last segment
    const lastBlock = blocks[blocks.length - 1]
    expect(lastBlock.text).toBe('Best regards,')
  })

  it('keeps a single <br> as a soft line break inside one segment', () => {
    // A solo <br> between text means "soft wrap", not "paragraph break".
    // Both halves stay in the same translation block.
    document.body.innerHTML =
      '<div>' +
      'first part<br>second part<br><br>' +
      'next paragraph' +
      '</div>'
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toContain('first part')
    expect(blocks[0].text).toContain('second part')
    expect(blocks[1].text).toBe('next paragraph')
  })

  it('treats 3+ consecutive <br> as one paragraph boundary', () => {
    // Pathological author markup: triple <br>. Should still be one separator,
    // not produce empty segments.
    document.body.innerHTML =
      '<div>alpha<br><br><br>beta</div>'
    const blocks = extractBlocks(document.body)
    expect(blocks.map((b) => b.text)).toEqual(['alpha', 'beta'])
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

  it('does not synthesize a wrap around inline runs that contain a stateful interactive element', () => {
    // Regression: Discord renders message content as a flat list of React
    // components — mention, anchors, spoiler — directly inside the message div.
    // Wrapping the run reparents the spoiler (aria-expanded) into our synthesized
    // span; when the user clicks to reveal, React's reconciliation calls
    // removeChild on a node whose parent has changed and crashes the page.
    document.body.innerHTML = `
      <div id="msg">
        <span class="mention"><span>@everyone</span></span>
        <a href="https://example.com"><span>https://example.com</span></a>
        <span class="spoiler" aria-expanded="false" role="button" tabindex="0">hidden text</span>
      </div>
    `
    const msg = document.getElementById('msg')!
    extractBlocks(document.body)
    // No synthesized wrap should be inserted — the spoiler must remain a direct
    // child of the message div so React's fiber-tree parent matches the DOM.
    expect(msg.querySelector('[data-imp-wrap]')).toBe(null)
    expect(document.querySelector('.spoiler')!.parentElement).toBe(msg)
  })

  it('extracts a Discord-style URL-only message as one block whose text is the URL', () => {
    // The container div holds a single <a> wrapping a <span> with the URL.
    // This is the input shape inject.ts's URL filter relies on — if extractBlocks
    // ever split or trimmed the URL, the noop fast-path would silently miss it.
    document.body.innerHTML =
      '<div id="msg" class="messageContent"><a href="https://ismy.blue/" target="_blank"><span>https://ismy.blue/</span></a></div>'
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('https://ismy.blue/')
    expect(blocks[0].element.id).toBe('msg')
  })

  it('extracts a paragraph containing an inline link as one block including link text', () => {
    // A URL embedded in a sentence must NOT be classified as URL-only: the block
    // text contains the surrounding prose, so isUrlOnly() returns false and the
    // sentence is translated normally.
    document.body.innerHTML =
      '<p>Check out <a href="https://example.com">this site</a> for more info</p>'
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Check out this site for more info')
    expect(blocks[0].element.tagName).toBe('P')
  })

  it('extracts a paragraph where the link text is the URL itself as one mixed block', () => {
    // Same shape but the anchor's visible text is the URL — still not URL-only
    // because the surrounding sentence is part of the same block.
    document.body.innerHTML =
      '<p>See <a href="https://example.com">https://example.com</a> today</p>'
    const blocks = extractBlocks(document.body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('See https://example.com today')
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

  it('extracts shadow content matching include selector through light-DOM ancestors', () => {
    // Regression: include-mode fast-path used querySelector(), which doesn't pierce
    // shadow boundaries. Light-DOM ancestors of shadow hosts were skipped before
    // walkShadow could run, hiding all shadow content from the include matcher.
    document.body.innerHTML = '<div id="outer"><div id="mid"><div id="host"></div></div></div>'
    const host = document.getElementById('host')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p class="target">Shadow target</p><p class="other">Shadow other</p>'
    const blocks = extractBlocks(document.body, { includeSelectors: ['.target'] })
    expect(blocks.map((b) => b.text)).toEqual(['Shadow target'])
  })

  it('include selector matches a shadow host from inside its own shadow root', () => {
    // Regression: closest() doesn't cross shadow boundaries upward.
    // Without closestThroughShadow, include 'my-card' matches the host element
    // itself, but content inside its shadow root would be skipped because
    // closest('my-card') returns null from inside the host's own shadow.
    document.body.innerHTML = '<my-card></my-card>'
    const card = document.body.firstElementChild!
    card.attachShadow({ mode: 'open' }).innerHTML =
      '<div><p>Card title</p><p>Card description</p></div>'
    const blocks = extractBlocks(document.body, { includeSelectors: ['my-card'] })
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain('Card title')
    expect(texts).toContain('Card description')
  })

  it('does not over-extract sibling content when shadow descendants force walker to descend', () => {
    // Regression: hasShadowDescendant lets the walker into a subtree even if
    // that subtree itself isn't inside an include match. tryExtract must still
    // gate on closestThroughShadow include check so unrelated inline content
    // (e.g. a username row + timestamp on Reddit Chat) doesn't leak as a block.
    document.body.innerHTML = `
      <div id="root">
        <div class="header">
          <my-hovercard></my-hovercard>
          <span>Sibling label</span>
        </div>
        <p class="target">Real content</p>
      </div>
    `
    const hovercard = document.querySelector('my-hovercard')!
    hovercard.attachShadow({ mode: 'open' }).innerHTML = '<span>username</span>'
    const blocks = extractBlocks(document.body, { includeSelectors: ['.target'] })
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain('Real content')
    // Sibling header (which contains a shadow host) must NOT be extracted
    expect(texts.some((t) => t.includes('Sibling label'))).toBe(false)
    expect(texts.some((t) => t.includes('username'))).toBe(false)
  })

  it('does not wrap slotted children of a custom element (would break slot distribution)', () => {
    // Regression: walkMixed used to wrap inline-ish sibling children into a
    // <span data-imp-wrap>. For a custom element like <shreddit-post>, that
    // <span> becomes the new direct child, so slot="title" / slot="post-flair"
    // children are no longer direct children of the host and slot distribution
    // breaks (title repositions to the default slot).
    document.body.innerHTML = `
      <style>my-card { display: block; } my-flair, my-loader { display: inline; }</style>
      <my-card>
        <div slot="header"></div>
        <a slot="title">Card title</a>
        <my-flair slot="flair"></my-flair>
        <my-loader></my-loader>
        <div slot="media">media</div>
      </my-card>
    `
    const card = document.querySelector('my-card')!
    const titleA = card.querySelector('a[slot="title"]')!
    const blocks = extractBlocks(document.body)
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain('Card title')
    // The <a slot="title"> must remain a direct child of <my-card>
    expect(titleA.parentElement).toBe(card)
    // No wrapper span should have been inserted as a direct child
    expect(card.querySelector(':scope > [data-imp-wrap]')).toBe(null)
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

  it('should treat span with display:block as a block boundary (React Native for Web)', () => {
    document.body.innerHTML = `
      <div>
        <span style="display:block">First paragraph.</span>
        <span style="display:block">Second paragraph.</span>
        <ul><li>List item</li></ul>
        <span style="display:block">Third paragraph.</span>
      </div>
    `
    const blocks = extractBlocks(document.body)
    expect(blocks.map((b) => b.text)).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'List item',
      'Third paragraph.',
    ])
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
