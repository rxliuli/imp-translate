import { afterEach, describe, expect, it } from 'vitest'
import { extractBlocks, getVisibleText, type TranslatableBlock } from './dom'
import {
  applyReplacement,
  blockOwner,
  collectReplaceableTextNodes,
  restoreOwner,
  entriesIntact,
  getSourceText,
  LOADING_ATTR,
  markLoading,
  pruneDisconnected,
  restoreReplacements,
} from './replace'

function blockOf(el: Element, skipSelectors?: string[]): TranslatableBlock {
  return { element: el as HTMLElement, text: getVisibleText(el, skipSelectors).trim() }
}

describe('replace mode', () => {
  afterEach(() => {
    restoreReplacements()
    document.body.innerHTML = ''
  })

  it('replaces a single text node and restores it', () => {
    document.body.innerHTML = `<p>Hello world</p>`
    const p = document.querySelector('p')!
    const node = p.firstChild as Text
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries).toHaveLength(1)
    expect(entries[0].segment).toBe('Hello world')

    applyReplacement(p, entries, ['你好世界'])
    expect(p.textContent).toBe('你好世界')
    expect(p.firstChild).toBe(node)
    expect(getSourceText(p)).toBe('Hello world')

    restoreReplacements()
    expect(p.textContent).toBe('Hello world')
    expect(p.firstChild).toBe(node)
  })

  it('writes per-node segments into a mixed paragraph, keeping elements intact', () => {
    document.body.innerHTML = `<p>Read <a href="/docs">the docs</a> and <strong>enjoy</strong>.</p>`
    const p = document.querySelector('p')!
    const a = p.querySelector('a')!
    const strong = p.querySelector('strong')!
    const childrenBefore = Array.from(p.childNodes)

    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => e.segment)).toEqual(['Read ', 'the docs', ' and ', 'enjoy', '.'])

    applyReplacement(p, entries, ['阅读', '文档', '并', '享受', '。'])
    expect(p.querySelector('a')).toBe(a)
    expect(p.querySelector('strong')).toBe(strong)
    expect(a.getAttribute('href')).toBe('/docs')
    expect(a.textContent).toBe('文档')
    expect(strong.textContent).toBe('享受')
    expect(Array.from(p.childNodes)).toEqual(childrenBefore)

    restoreReplacements()
    expect(p.innerHTML).toBe(`Read <a href="/docs">the docs</a> and <strong>enjoy</strong>.`)
    expect(p.querySelector('a')).toBe(a)
  })

  it('single-node writes keep the node whitespace around the trimmed translation', () => {
    document.body.innerHTML = `<p>  Hello world\n</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => [e.leading, e.trailing])).toEqual([['  ', '\n']])
    applyReplacement(p, entries, [' 你好世界 '], { keepNodeWhitespace: true })
    expect(p.firstChild!.textContent).toBe('  你好世界\n')
  })

  it('segment writes take edge whitespace from the translation, collapsed to one space', () => {
    document.body.innerHTML = `<p>  Hello <b>world</b>\n</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => [e.leading, e.trailing])).toEqual([
      ['  ', ' '],
      ['', ''],
    ])
    applyReplacement(p, entries, ['\t Hallo  ', '  Welt'])
    expect(p.firstChild!.textContent).toBe(' Hallo ')
    expect(p.querySelector('b')!.textContent).toBe(' Welt')
  })

  it('separates Latin words left touching across a node boundary', () => {
    document.body.innerHTML = `<p>Use <code>npm install</code> to install it.</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => e.segment)).toEqual(['Use ', 'npm install', ' to install it.'])
    // Segment whitespace as a provider may return it after reordering: the
    // space before the tag was lost.
    applyReplacement(p, entries, ['Verwenden Sie', 'npm install', ', um es zu installieren.'])
    expect(p.textContent).toBe('Verwenden Sie npm install, um es zu installieren.')
    expect(p.firstChild!.textContent).toBe('Verwenden Sie ')
  })

  it('does not pad CJK translations with the source spacing', () => {
    document.body.innerHTML = `<p>Click <a href="#">here</a> for details</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    applyReplacement(p, entries, ['点击', '这里', '查看详情'])
    expect(p.textContent).toBe('点击这里查看详情')
  })

  it('keeps line breaks at node edges in a newline-preserving context', () => {
    document.body.innerHTML = `<div style="white-space: pre-wrap"><span>First line</span>\n<b>Second</b> line</div>`
    const div = document.querySelector('div')!
    const entries = collectReplaceableTextNodes(blockOf(div))!
    // '\n' alone is a whitespace-only node folded into the first segment.
    expect(entries.map((e) => e.segment)).toEqual(['First line\n', 'Second', ' line'])
    applyReplacement(div, entries, ['第一行', '第二', '行'])
    expect(div.textContent).toBe('第一行\n第二行')

    document.body.innerHTML = `<div style="white-space: pre-wrap">Intro\n<b>bold</b> end</div>`
    const div2 = document.querySelector('div')!
    const entries2 = collectReplaceableTextNodes(blockOf(div2))!
    expect(entries2[0].trailing).toBe('\n')
    applyReplacement(div2, entries2, ['介绍', '粗体', '结束'])
    expect(div2.firstChild!.textContent).toBe('介绍\n')
    expect(div2.textContent).toBe('介绍\n粗体结束')
  })

  it('collapses edge line breaks outside newline-preserving contexts', () => {
    document.body.innerHTML = `<p>Intro\n<b>bold</b> end</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    applyReplacement(p, entries, ['介绍', '粗体', '结束'])
    expect(p.textContent).toBe('介绍粗体结束')
  })

  it('folds whitespace-only nodes into the preceding segment', () => {
    document.body.innerHTML = `<p><a href="#">One</a> <a href="#">two</a></p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => e.segment)).toEqual(['One ', 'two'])
    applyReplacement(p, entries, ['一', '二'])
    expect(p.textContent).toBe('一 二')
  })

  it('keeps the original when a segment translation of a word-bearing source is empty', () => {
    document.body.innerHTML = `<p>Click <a href="#">here</a> now</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    applyReplacement(p, entries, ['点击', '  ', '现在'])
    expect(p.querySelector('a')!.textContent).toBe('here')
    expect(p.textContent).toBe('点击here现在')
  })

  it('clears a punctuation-only node whose segment translation is empty, and restores it', () => {
    document.body.innerHTML = `<p><a href="#">Apples</a>, <a href="#">pears</a></p>`
    const p = document.querySelector('p')!
    const comma = p.childNodes[1] as Text
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => e.segment)).toEqual(['Apples', ', ', 'pears'])
    applyReplacement(p, entries, ['苹果', '', '和梨'])
    expect(comma.data).toBe('')
    expect(p.textContent).toBe('苹果和梨')
    expect(getSourceText(p)).toBe('Apples, pears')
    restoreReplacements()
    expect(comma.data).toBe(', ')
    expect(p.innerHTML).toBe(`<a href="#">Apples</a>, <a href="#">pears</a>`)
  })

  it('clears a node with at most 2 letters, keeps one with 3+', () => {
    document.body.innerHTML = `<p><a href="#">John</a>s <b>a</b> big <i>cat</i></p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => e.segment)).toEqual(['John', 's ', 'a', ' big ', 'cat'])
    applyReplacement(p, entries, ['约翰的', '', '', '', '猫'])
    expect(p.childNodes[1].textContent).toBe('')
    expect(p.querySelector('b')!.textContent).toBe('')
    // " big " has 3 letters: never blanked.
    expect(p.childNodes[3].textContent).toBe(' big ')
    restoreReplacements()
    expect(p.innerHTML).toBe(`<a href="#">John</a>s <b>a</b> big <i>cat</i>`)
  })

  it('never clears a single-node block', () => {
    document.body.innerHTML = `<p>...</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes({ element: p, text: '...' })!
    applyReplacement(p, entries, [''], { keepNodeWhitespace: true })
    expect(p.textContent).toBe('...')
  })

  it('does not overwrite a node the page rewrote after translation', () => {
    document.body.innerHTML = `<p>Count: <span>3 items</span></p>`
    const p = document.querySelector('p')!
    const span = p.querySelector('span')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    applyReplacement(p, entries, ['计数：', '3 项'])
    // The framework updates the dynamic part in place.
    ;(span.firstChild as Text).data = '4 items'
    expect(getSourceText(p)).toBe('Count: 4 items')
    expect(entriesIntact(entries)).toBe(false)

    restoreReplacements()
    expect(span.textContent).toBe('4 items')
    expect(p.firstChild!.textContent).toBe('Count: ')
  })

  it('rejects a block whose text is only part of a text node (pre-wrap split)', () => {
    document.body.innerHTML = `<div style="white-space: pre-wrap">Para one\n\nPara two</div>`
    const div = document.querySelector('div')!
    expect(collectReplaceableTextNodes({ element: div, text: 'Para one' })).toBeNull()
    expect(collectReplaceableTextNodes({ element: div, text: 'Para two' })).toBeNull()
  })

  it('rejects a node that still carries another block translation', () => {
    document.body.innerHTML = `<div><p>Hello</p></div>`
    const div = document.querySelector('div')!
    const p = div.querySelector('p')!
    applyReplacement(p, collectReplaceableTextNodes(blockOf(p))!, ['你好'])
    expect(collectReplaceableTextNodes({ element: div, text: '你好' })).toBeNull()
  })

  it('maps text of extracted blocks with inline wrappers', () => {
    document.body.innerHTML = `<div>Intro <em>text</em> here<p>Paragraph</p></div>`
    const blocks = extractBlocks(document.body)
    for (const b of blocks) {
      expect(collectReplaceableTextNodes(b)).not.toBeNull()
    }
  })

  it('skips notranslate descendants consistently with getVisibleText', () => {
    document.body.innerHTML = `<p>Run <code class="notranslate">npm i</code> first</p>`
    const p = document.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    expect(entries.map((e) => e.segment)).toEqual(['Run ', ' first'])
    applyReplacement(p, entries, ['运行', '先'])
    expect(p.querySelector('code')!.textContent).toBe('npm i')
  })

  it('replaces and restores inside a shadow root', () => {
    document.body.innerHTML = `<div id="host"></div>`
    const host = document.getElementById('host')!
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<p>Shadow <a href="#x">text</a></p>`
    const p = root.querySelector('p')!
    const entries = collectReplaceableTextNodes(blockOf(p))!
    applyReplacement(p, entries, ['影子', '文本'])
    expect(p.textContent).toBe('影子文本')

    // Scoped restore from an ancestor in the light DOM pierces the shadow.
    restoreReplacements(document.body)
    expect(p.textContent).toBe('Shadow text')
  })

  it('scoped restore leaves replacements outside the scope alone', () => {
    document.body.innerHTML = `<p id="a">Alpha</p><p id="b">Beta</p>`
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    applyReplacement(a, collectReplaceableTextNodes(blockOf(a))!, ['甲'])
    applyReplacement(b, collectReplaceableTextNodes(blockOf(b))!, ['乙'])
    markLoading(b)
    restoreReplacements(a)
    expect(a.textContent).toBe('Alpha')
    expect(b.textContent).toBe('乙')
    expect(b.hasAttribute(LOADING_ATTR)).toBe(true)
    restoreReplacements()
    expect(b.textContent).toBe('Beta')
    expect(b.hasAttribute(LOADING_ATTR)).toBe(false)
  })

  it('prunes registry entries for removed elements', () => {
    document.body.innerHTML = `<p id="a">Alpha</p>`
    const a = document.getElementById('a')!
    const node = a.firstChild as Text
    applyReplacement(a, collectReplaceableTextNodes(blockOf(a))!, ['甲'])
    a.remove()
    pruneDisconnected()
    // Pruned: even back in the document, a full restore no longer touches it.
    document.body.append(a)
    restoreReplacements()
    expect(node.data).toBe('甲')
  })

  it('does not prune while collecting (pruning is once per batch)', () => {
    document.body.innerHTML = `<p id="a">Alpha</p>`
    const a = document.getElementById('a')!
    applyReplacement(a, collectReplaceableTextNodes(blockOf(a))!, ['甲'])
    a.remove()
    document.body.innerHTML = `<p id="b">Beta</p>`
    collectReplaceableTextNodes(blockOf(document.getElementById('b')!))
    document.body.append(a)
    restoreReplacements()
    expect(a.textContent).toBe('Alpha')
  })

  it('reuseOwned collects original + page-rewritten text, keeping our translation on screen', () => {
    document.body.innerHTML = `<p>Status: <span>Online</span> end</p>`
    const p = document.querySelector('p')!
    const span = p.querySelector('span')!
    applyReplacement(p, collectReplaceableTextNodes(blockOf(p))!, ['状态：', '在线', '结束'])
    expect(p.textContent).toBe('状态：在线结束')

    // The page updates the dynamic part only.
    ;(span.firstChild as Text).data = 'Away'
    const source = getSourceText(p).trim()
    expect(source).toBe('Status: Away end')

    // Without reuseOwned the block's own translated nodes disqualify it.
    expect(collectReplaceableTextNodes({ element: p, text: source })).toBeNull()

    const entries = collectReplaceableTextNodes(
      { element: p, text: source },
      undefined,
      { reuseOwned: true },
    )!
    expect(entries.map((e) => e.segment)).toEqual(['Status: ', 'Away', ' end'])
    // Collecting wrote nothing: the untouched nodes still show the old translation.
    expect(p.textContent).toBe('状态：Away结束')
    expect(entriesIntact(entries)).toBe(true)
  })

  it('overwriting a retranslation updates the record so restore returns the new original', () => {
    document.body.innerHTML = `<p>Status: <span>Online</span> end</p>`
    const p = document.querySelector('p')!
    const span = p.querySelector('span')!
    applyReplacement(p, collectReplaceableTextNodes(blockOf(p))!, ['状态：', '在线', '结束'])
    ;(span.firstChild as Text).data = 'Away'

    const source = getSourceText(p).trim()
    const entries = collectReplaceableTextNodes(
      { element: p, text: source },
      undefined,
      { reuseOwned: true },
    )!
    applyReplacement(p, entries, ['状态：', '离开', '完'])
    expect(p.textContent).toBe('状态：离开完')
    expect(getSourceText(p)).toBe('Status: Away end')

    restoreReplacements()
    expect(p.textContent).toBe('Status: Away end')
  })

  it('reuseOwned still rejects nodes owned by another block', () => {
    document.body.innerHTML = `<div><p>Hello</p></div>`
    const div = document.querySelector('div')!
    const p = div.querySelector('p')!
    applyReplacement(p, collectReplaceableTextNodes(blockOf(p))!, ['你好'])
    expect(
      collectReplaceableTextNodes({ element: div, text: 'Hello' }, undefined, { reuseOwned: true }),
    ).toBeNull()
    // The owner itself can reuse it.
    const own = collectReplaceableTextNodes({ element: p, text: 'Hello' }, undefined, {
      reuseOwned: true,
    })!
    expect(own.map((e) => e.segment)).toEqual(['Hello'])
  })

  it('produces only characterData mutations when replacing and restoring', async () => {
    document.body.innerHTML = `<p>Read <a href="/docs">the docs</a> and <strong>enjoy</strong>.</p>`
    const p = document.querySelector('p')!
    const records: MutationRecord[] = []
    const obs = new MutationObserver((r) => records.push(...r))
    obs.observe(document.body, { childList: true, subtree: true, characterData: true })

    const entries = collectReplaceableTextNodes(blockOf(p))!
    applyReplacement(p, entries, ['阅读', '文档', '并', '享受', '。'])
    restoreReplacements()
    records.push(...obs.takeRecords())
    obs.disconnect()

    expect(records.length).toBeGreaterThan(0)
    expect(records.every((r) => r.type === 'characterData')).toBe(true)
  })

  it('prunes records of text nodes the page swapped under a still-attached owner', () => {
    document.body.innerHTML = `<p>Hello world</p>`
    const p = document.querySelector('p')!
    const old = p.firstChild as Text
    applyReplacement(p, collectReplaceableTextNodes(blockOf(p))!, ['你好世界'])
    // The page replaces the text node (framework re-render); the owner stays.
    p.replaceChild(document.createTextNode('Fresh text'), old)
    pruneDisconnected()
    // The dead node is not written back on restore.
    restoreReplacements()
    expect(old.data).toBe('你好世界')
    expect(p.textContent).toBe('Fresh text')
  })

  describe('virtual blocks', () => {
    function runOf(container: Element) {
      const blocks = extractBlocks(document.body, { noStructuralWrites: true })
      return blocks.filter((b) => b.element === container && b.nodes)
    }

    it('collects only the text nodes of the run', () => {
      document.body.innerHTML =
        '<div id="c">Intro <em>text</em> here<p>Para graph</p>Tail <b>run</b> end</div>'
      const c = document.getElementById('c')!
      const [a, b] = runOf(c)
      expect(a.nodes).toHaveLength(3)
      expect(collectReplaceableTextNodes(a)!.map((e) => e.segment)).toEqual([
        'Intro ',
        'text',
        ' here',
      ])
      expect(collectReplaceableTextNodes(b)!.map((e) => e.segment)).toEqual([
        'Tail ',
        'run',
        ' end',
      ])
      expect(blockOwner(a)).toBe(a.nodes![0])
      expect(blockOwner(b)).toBe(b.nodes![0])
    })

    it('applies, computes source text and restores per run', () => {
      document.body.innerHTML =
        '<div id="c">Intro <em>text</em> here<p>Para graph</p>Tail <b>run</b> end</div>'
      const c = document.getElementById('c')!
      const html = c.innerHTML
      const children = Array.from(c.childNodes)
      const [a, b] = runOf(c)
      const records: MutationRecord[] = []
      const obs = new MutationObserver((r) => records.push(...r))
      obs.observe(document.body, { childList: true, subtree: true, characterData: true })

      applyReplacement(blockOwner(a), collectReplaceableTextNodes(a)!, ['介绍', '文本', '这里'])
      applyReplacement(blockOwner(b), collectReplaceableTextNodes(b)!, ['尾部', '运行', '结束'])
      expect(c.querySelector('em')!.textContent).toBe('文本')
      expect(c.querySelector('b')!.textContent).toBe('运行')
      expect(c.querySelector('p')!.textContent).toBe('Para graph')
      expect(getSourceText(a.nodes!).trim()).toBe('Intro text here')
      expect(getSourceText(b.nodes!).trim()).toBe('Tail run end')

      // Another run's nodes disqualify; the run itself can reuse its own.
      expect(collectReplaceableTextNodes({ ...a, nodes: [...a.nodes!, ...b.nodes!] })).toBeNull()
      expect(
        collectReplaceableTextNodes(a, undefined, { reuseOwned: true })!.map((e) => e.source),
      ).toEqual(['Intro ', 'text', ' here'])

      // Restoring one run leaves the other translated.
      restoreOwner(blockOwner(a))
      expect(c.querySelector('em')!.textContent).toBe('text')
      expect(c.querySelector('b')!.textContent).toBe('运行')

      restoreReplacements(c)
      records.push(...obs.takeRecords())
      obs.disconnect()
      expect(c.innerHTML).toBe(html)
      expect(Array.from(c.childNodes)).toEqual(children)
      expect(records.length).toBeGreaterThan(0)
      expect(records.every((r) => r.type === 'characterData')).toBe(true)
    })

    it('restores a run whose first node the page removed', () => {
      document.body.innerHTML = '<div id="c">Intro <em>text</em> here<p>Para graph</p></div>'
      const c = document.getElementById('c')!
      const [a] = runOf(c)
      applyReplacement(blockOwner(a), collectReplaceableTextNodes(a)!, ['介绍', '文本', '这里'])
      a.nodes![0].parentNode!.removeChild(a.nodes![0])
      restoreReplacements(c)
      expect(c.querySelector('em')!.textContent).toBe('text')
      expect(c.textContent).toBe('text herePara graph')
    })
  })
})
