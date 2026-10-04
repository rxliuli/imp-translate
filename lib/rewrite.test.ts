import { afterEach, describe, expect, it } from 'vitest'
import { extractBlocks, getVisibleText, type TranslatableBlock } from './dom'
import {
  blockOwner,
  collectReplaceableTextNodes,
  getSourceText,
  pruneDisconnected,
  restoreOwner,
  restoreReplacements,
} from './replace'
import {
  getRewrite,
  MAX_REWRITES,
  noteRewrite,
  onRewriteStale,
  resetRewriteCounts,
  restoreRewrite,
  REWRITTEN_ATTR,
  rewriteBlock,
  rewriteIntact,
  type RewriteRecord,
} from './rewrite'
import { isPassthroughSegment } from './translate-service'

function blockOf(el: Element): TranslatableBlock {
  return { element: el as HTMLElement, text: getVisibleText(el).trim() }
}

function rewrite(block: TranslatableBlock, html: string, debugReason?: string) {
  const entries = collectReplaceableTextNodes(block)!
  const sent = entries.flatMap((e, i) => (isPassthroughSegment(e.segment) ? [] : [i]))
  return rewriteBlock(block, blockOwner(block), entries, sent, html, { debugReason })
}

function setup(html: string) {
  document.body.innerHTML = html
  const p = document.querySelector('p')!
  return { p, html: p.innerHTML, nodes: [...p.childNodes] }
}

describe('structural rewrite', () => {
  afterEach(() => {
    restoreReplacements()
    document.body.innerHTML = ''
  })

  it('rebuilds a reordered paragraph and restores the original nodes', () => {
    const { p, html, nodes } = setup(`<p>The <a href="/x" class="l">red</a> car</p>`)
    const a = p.querySelector('a')!
    const rec = rewrite(blockOf(p), '<i id="1">红色</i><i id="0">的</i><i id="2">汽车</i>')!
    expect(p.innerHTML).toBe('<a href="/x" class="l">红色</a>的汽车')
    expect(p.querySelector('a')).not.toBe(a)
    expect(rec.removedNodes).toEqual(nodes)
    expect(getSourceText(p)).toBe('The red car')

    restoreReplacements()
    expect(p.innerHTML).toBe(html)
    expect([...p.childNodes]).toEqual(nodes)
    expect(p.querySelector('a')).toBe(a)
    expect(getRewrite(p)).toBeUndefined()
  })

  it('moves untranslated content after the node it followed, exactly once', () => {
    const { p, html, nodes } = setup(
      `<p>Cats<sup><a href="#c1">[1]</a></sup> and <b>dogs</b><img src="data:,"> run.</p>`,
    )
    const sup = p.querySelector('sup')!
    const img = p.querySelector('img')!
    rewrite(blockOf(p), '<i id="2">狗</i><i id="0">猫</i><i id="1">和</i><i id="3">跑。</i>')
    expect(p.innerHTML).toBe(
      '<b>狗</b><img src="data:,">猫<sup><a href="#c1">[1]</a></sup>和跑。',
    )
    expect(p.querySelector('sup')).toBe(sup)
    expect(p.querySelector('img')).toBe(img)
    expect(p.querySelectorAll('sup, img')).toHaveLength(2)

    restoreReplacements()
    expect(p.innerHTML).toBe(html)
    expect([...p.childNodes]).toEqual(nodes)
    expect(p.querySelector('sup')).toBe(sup)
  })

  it('moves passthrough text nodes nested in a translated element', () => {
    const { p, html } = setup(`<p><a href="/w">Works<span>[</span>2<span>]</span></a> today</p>`)
    rewrite(blockOf(p), '<i id="1">今天</i><i id="0">作品</i>')
    expect(p.innerHTML).toBe('今天<a href="/w">作品<span>[</span>2<span>]</span></a>')
    restoreReplacements()
    expect(p.innerHTML).toBe(html)
  })

  it('puts outside text at block level and treats unknown ids as text', () => {
    const { p, html } = setup(`<p>Hello <em>big</em> world</p>`)
    rewrite(
      blockOf(p),
      '« <i id="0">你好</i><i id="9">X</i><i id="1">大</i> <i id="2">世界</i>»<i id="2">Y</i>',
    )
    // Whitespace stays in the open element; a duplicate id is plain text too.
    expect(p.innerHTML).toBe('« 你好X<em>大 </em>世界»Y')
    restoreReplacements()
    expect(p.innerHTML).toBe(html)
  })

  it('shares one clone across consecutive pieces and clones again when re-entered', () => {
    const { p } = setup(`<p><a href="/l">Read <b>the</b> docs</a> now</p>`)
    rewrite(
      blockOf(p),
      '<i id="0">阅读</i><i id="2">文档</i><i id="1">这个</i><i id="3">现在</i>',
    )
    expect(p.innerHTML).toBe('<a href="/l">阅读文档<b>这个</b></a>现在')
    restoreReplacements()

    rewrite(blockOf(p), '<i id="0">A</i><i id="3">N</i><i id="2">D</i>')
    // id 1 was dropped by the engine: its text is gone.
    expect(p.innerHTML).toBe('<a href="/l">A</a>N<a href="/l">D</a>')
  })

  it('puts a tagless output at block level and keeps the untranslated content', () => {
    const { p, html } = setup(
      `<p>Cats<sup>[1]</sup> and <a href="/d">dogs</a><img src="data:,"> run.</p>`,
    )
    const sup = p.querySelector('sup')!
    const img = p.querySelector('img')!
    rewrite(blockOf(p), '猫和狗&amp;跑。')
    expect(p.innerHTML).toBe('猫和狗&amp;跑。<sup>[1]</sup><img src="data:,">')
    expect(p.querySelector('sup')).toBe(sup)
    expect(p.querySelector('img')).toBe(img)
    restoreReplacements()
    expect(p.innerHTML).toBe(html)
  })

  it('detects page edits to the rewritten content', () => {
    const { p } = setup(`<p>The <a href="/x">red</a> car</p>`)
    const rec = rewrite(blockOf(p), '<i id="1">红色</i><i id="0">的</i><i id="2">汽车</i>')!
    expect(rewriteIntact(rec)).toBe(true)
    ;(p.lastChild as Text).data = 'changed'
    expect(rewriteIntact(rec)).toBe(false)
    // The source text is the originals', not what is on screen.
    expect(getSourceText(p)).toBe('The red car')
  })

  it('detects nodes the page added to the block or into a clone', () => {
    const { p } = setup(`<p>The <a href="/x">red</a> car</p>`)
    const rec = rewrite(blockOf(p), '<i id="1">红色</i><i id="0">的</i><i id="2">汽车</i>')!
    p.appendChild(document.createTextNode('!'))
    expect(rewriteIntact(rec)).toBe(false)
    p.lastChild!.remove()
    expect(rewriteIntact(rec)).toBe(true)
    p.querySelector('a')!.appendChild(document.createElement('span'))
    expect(rewriteIntact(rec)).toBe(false)
  })

  it('observes the detached originals: page edits there mark the rewrite stale', async () => {
    const { p, nodes } = setup(`<p>The <a href="/x">red</a> car</p>`)
    const stale: RewriteRecord[] = []
    onRewriteStale((r) => {
      stale.push(r)
      restoreRewrite(r.owner)
    })
    try {
      const rec = rewrite(blockOf(p), '<i id="1">红色</i><i id="0">的</i><i id="2">汽车</i>')!
      // A framework updating the text it rendered, now detached.
      ;((nodes[1] as Element).firstChild as Text).data = 'blue'
      expect(getSourceText(p)).toBe('The blue car')
      await new Promise((r) => setTimeout(r, 0))
      expect(stale).toEqual([rec])
      expect(rec.stale).toBe(true)
      // The handler undid it: the page's current content is back.
      expect(p.innerHTML).toBe('The <a href="/x">blue</a> car')
      expect(getRewrite(p)).toBeUndefined()
    } finally {
      onRewriteStale(null)
    }
  })

  it('does not report our own restore as a page edit', async () => {
    const { p } = setup(`<p>Cats<sup>[1]</sup> and <b>dogs</b> run.</p>`)
    let calls = 0
    onRewriteStale(() => calls++)
    try {
      rewrite(blockOf(p), '<i id="1">狗</i><i id="0">猫</i><i id="2">跑</i>')
      restoreReplacements()
      await new Promise((r) => setTimeout(r, 0))
      expect(calls).toBe(0)
    } finally {
      onRewriteStale(null)
    }
  })

  it('keeps the id on the first clone only', () => {
    const { p } = setup(`<p><a href="/l" id="lnk">Read <b>the</b> docs</a> now</p>`)
    rewrite(blockOf(p), '<i id="0">A</i><i id="3">N</i><i id="2">D</i><i id="1">B</i>')
    expect(p.innerHTML).toBe('<a href="/l" id="lnk">A</a>N<a href="/l">D<b>B</b></a>')
  })

  it('counts rewrites per owner', () => {
    resetRewriteCounts()
    const owner = document.createElement('p')
    const other = document.createElement('p')
    for (let i = 0; i < MAX_REWRITES; i++) expect(noteRewrite(owner)).toBe(true)
    expect(noteRewrite(owner)).toBe(false)
    expect(noteRewrite(other)).toBe(true)
    resetRewriteCounts()
    expect(noteRewrite(owner)).toBe(true)
  })

  it('pruning a disconnected rewrite drops its debug marker', () => {
    const { p } = setup(`<p>The <a href="/x">red</a> car</p>`)
    rewrite(blockOf(p), '<i id="1">红色</i><i id="0">的</i><i id="2">汽车</i>', 'why')
    p.remove()
    pruneDisconnected()
    expect(getRewrite(p)).toBeUndefined()
    expect(p.hasAttribute(REWRITTEN_ATTR)).toBe(false)
  })

  it('marks the block when asked (developer mode) and unmarks it on restore', () => {
    const { p } = setup(`<p>The <a href="/x">red</a> car</p>`)
    rewrite(blockOf(p), '<i id="1">红色</i><i id="0">的</i><i id="2">汽车</i>', 'missing ids 1')
    expect(p.getAttribute(REWRITTEN_ATTR)).toBe('missing ids 1')
    restoreReplacements()
    expect(p.hasAttribute(REWRITTEN_ATTR)).toBe(false)

    rewrite(blockOf(p), '<i id="1">红色</i><i id="0">的</i><i id="2">汽车</i>')
    expect(p.hasAttribute(REWRITTEN_ATTR)).toBe(false)
  })

  describe('virtual blocks', () => {
    function runsOf(container: Element) {
      const blocks = extractBlocks(document.body, { noStructuralWrites: true })
      return blocks.filter((b) => b.element === container && b.nodes)
    }

    it('rewrites one run in place and restores it, leaving the rest alone', () => {
      document.body.innerHTML =
        '<div id="c">Intro <em>text</em> here<p>Para graph</p>Tail <b>run</b> end</div>'
      const c = document.getElementById('c')!
      const html = c.innerHTML
      const children = [...c.childNodes]
      const [a, b] = runsOf(c)
      const owner = blockOwner(a)

      const rec = rewrite(a, '<i id="2">这里</i><i id="1">文本</i><i id="0">介绍</i>', 'why')!
      expect(c.innerHTML).toBe('这里<em>文本</em>介绍<p>Para graph</p>Tail <b>run</b> end')
      expect(rec.removedNodes).toEqual(a.nodes)
      expect(getSourceText(a.nodes!)).toBe('Intro text here')
      expect(c.getAttribute(REWRITTEN_ATTR)).toBe('why')

      rewrite(b, '<i id="1">运行</i><i id="0">尾部</i><i id="2">结束</i>', 'why')
      expect(c.innerHTML).toBe('这里<em>文本</em>介绍<p>Para graph</p><b>运行</b>尾部结束')

      restoreOwner(owner)
      expect(c.innerHTML).toBe('Intro <em>text</em> here<p>Para graph</p><b>运行</b>尾部结束')
      // The container still holds a rewritten run.
      expect(c.hasAttribute(REWRITTEN_ATTR)).toBe(true)

      restoreReplacements(c)
      expect(c.innerHTML).toBe(html)
      expect([...c.childNodes]).toEqual(children)
      expect(c.hasAttribute(REWRITTEN_ATTR)).toBe(false)
    })
  })
})
