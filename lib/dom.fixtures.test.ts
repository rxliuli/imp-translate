import { describe, expect, it, beforeEach } from 'vitest'
import { extractBlocks } from './dom'
import npmVistaReadme from './__fixtures__/npm-vista-readme.html?raw'
import appleRejectionBr from './__fixtures__/apple-rejection-br.html?raw'
import appleRejectionNewlines from './__fixtures__/apple-rejection-newlines.html?raw'

// Count net Elements inserted into a subtree by running fn().
// Catches "extractBlocks created 100x more nodes than blocks" regressions —
// the failure mode that turns into runaway mutation observer loops on real
// pages. We assert mutation count is bounded by block count.
function nodeCountDelta(root: Element, fn: () => void): number {
  const before = root.querySelectorAll('*').length
  fn()
  const after = root.querySelectorAll('*').length
  return after - before
}

// Count getComputedStyle calls during fn(). Each call may force a sync style
// recalc when DOM mutations are pending — the exact mechanism that pinned
// CPU at 100% on Twitter when newline preprocessing was naive. This counter
// catches any new code path that introduces O(N) getComputedStyle calls in
// the walker hot path.
//
// Note: only valid in vitest browser mode (no isolated world). In a real
// extension build, our content script would have its own getComputedStyle
// in the isolated world's globals, but the same code path runs.
function withGcsCounter<T>(fn: () => T): { result: T; calls: number } {
  let calls = 0
  const orig = window.getComputedStyle
  window.getComputedStyle = function (
    this: Window,
    ...args: Parameters<typeof orig>
  ) {
    calls++
    return orig.apply(this, args)
  } as typeof window.getComputedStyle
  try {
    const result = fn()
    return { result, calls }
  } finally {
    window.getComputedStyle = orig
  }
}

// Real-world DOM regression fixtures captured from live sites.
// When a bug is found in production, copy the offending outerHTML here
// rather than hand-writing a simplified case — production DOMs have
// shapes our imagination doesn't.

describe('npm.com /package/vista', () => {
  // Captured from https://www.npmjs.com/package/vista on 2026-04-29.
  // The bug: outer <div._6620a4fd> contains two <span> siblings,
  // first span wraps <section #tabpanel-readme> with the entire readme
  // inside. walkMixed grouped both spans into one inline run, wrapped
  // them in a synthesized <span data-imp-wrap>, and extracted the
  // entire 10k-char readme as a single translation block.
  const npmOuterStructure = `
    <div class="_6620a4fd mw8-l mw-100 w-100 w-two-thirds-l ph3-m pt2 pl0-ns pl2">
      <span>
        <section class="e22ba268" id="tabpanel-readme">
          <div><article>${npmVistaReadme}</article></div>
        </section>
        <section id="tabpanel-explore"></section>
        <section id="tabpanel-admin"></section>
        <section id="tabpanel-dependencies"></section>
        <section id="tabpanel-dependents"></section>
        <section id="tabpanel-versions"></section>
      </span>
      <span aria-live="polite"></span>
    </div>
  `

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('extracts readme as many small blocks, not one wrapped megablock', () => {
    document.body.innerHTML = npmOuterStructure
    const blocks = extractBlocks(document.body)

    expect(blocks.length).toBeGreaterThan(30)

    const maxBlockChars = Math.max(...blocks.map((b) => b.text.length))
    expect(maxBlockChars).toBeLessThan(2000)

    const wrappers = document.querySelectorAll('[data-imp-wrap]')
    for (const w of wrappers) {
      expect(w.textContent!.length).toBeLessThan(2000)
    }
  })

  it('extracts representative readme content', () => {
    document.body.innerHTML = npmOuterStructure
    const blocks = extractBlocks(document.body)
    const allText = blocks.map((b) => b.text).join('\n')

    expect(allText).toContain('Vista uses generated CSS')
    expect(allText).toContain('A Quick Example')
    expect(allText).toContain('Getting Started')
  })

  it('mutation count is bounded by block count', () => {
    document.body.innerHTML = npmOuterStructure
    let blockCount = 0
    const inserted = nodeCountDelta(document.body, () => {
      blockCount = extractBlocks(document.body).length
    })
    // We synthesize at most one wrapper per block. Anything more would mean
    // we're inserting nodes that aren't translation containers — likely a bug.
    expect(inserted).toBeLessThanOrEqual(blockCount)
  })

  it('getComputedStyle calls stay within budget', () => {
    // Baseline at the time of writing: 786 elements, 195 gcs calls. The bound
    // is set ~30% above that. A regression that adds gcs to the walker hot
    // path (e.g. one call per walk()) would push this well past 700 calls,
    // failing immediately. Update only when an intentional perf change moves
    // the baseline.
    document.body.innerHTML = npmOuterStructure
    const { calls } = withGcsCounter(() => extractBlocks(document.body))
    expect(calls).toBeLessThan(260)
  })
})

// Apple App Store Connect rejection emails. Two forms in the wild:
//   1. <br><br>-separated paragraphs (older style, br-br segmenter handles)
//   2. \n\n-separated paragraphs in white-space: pre-wrap container (newer
//      style, no <br> elements; current walker treats it as one giant block)
// Document both shapes so we notice when behavior changes.
describe('App Store Connect rejection emails', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('br-paragraph form: segments into per-paragraph blocks', () => {
    document.body.innerHTML = appleRejectionBr
    const blocks = extractBlocks(document.body)

    // 1 h3 + ~3 <b> headers as single-element blocks + ~7 prose paragraphs
    expect(blocks.length).toBeGreaterThanOrEqual(8)
    expect(blocks.length).toBeLessThan(20)

    // No paragraph block should approach the size of the whole rejection
    const maxLen = Math.max(...blocks.map((b) => b.text.length))
    expect(maxLen).toBeLessThan(800)

    // Block headers should land as their own blocks (not merged into prose)
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain('Issue Description')
    expect(texts).toContain('Next Steps')
    expect(texts).toContain('Resources')
  })

  it('br-paragraph form: mutation count is bounded by block count', () => {
    document.body.innerHTML = appleRejectionBr
    let blockCount = 0
    const inserted = nodeCountDelta(document.body, () => {
      blockCount = extractBlocks(document.body).length
    })
    expect(inserted).toBeLessThanOrEqual(blockCount)
  })

  it('newline-paragraph form: extracts without crashing (current behavior)', () => {
    // No <br> elements, no preprocessing — the body collapses into a single
    // large block (after the leading <h3>). This documents the current state;
    // when we revisit \n\n preprocessing, this assertion will need updating.
    document.body.innerHTML = appleRejectionNewlines
    const blocks = extractBlocks(document.body)
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    // Should at least extract the heading
    const texts = blocks.map((b) => b.text)
    expect(
      texts.some((t) => t.includes('Guideline 2.1 - Information Needed')),
    ).toBe(true)
  })

  it('newline-paragraph form: mutation count is bounded by block count', () => {
    document.body.innerHTML = appleRejectionNewlines
    let blockCount = 0
    const inserted = nodeCountDelta(document.body, () => {
      blockCount = extractBlocks(document.body).length
    })
    expect(inserted).toBeLessThanOrEqual(blockCount)
  })

  it('br-paragraph form: getComputedStyle calls stay within budget', () => {
    // Baseline: 31 elements, 19 gcs calls. Bound set with ~30% headroom.
    document.body.innerHTML = appleRejectionBr
    const { calls } = withGcsCounter(() => extractBlocks(document.body))
    expect(calls).toBeLessThan(25)
  })

  it('newline-paragraph form: getComputedStyle calls stay within budget', () => {
    // Baseline: 12 elements, 16 gcs calls. The high ratio (~1.3) is normal
    // for this shape — the outer div with no block children triggers
    // hasBlockChild's grandchild peek across most descendants.
    document.body.innerHTML = appleRejectionNewlines
    const { calls } = withGcsCounter(() => extractBlocks(document.body))
    expect(calls).toBeLessThan(22)
  })
})

// Quora answer body. The container <div class="q-text"> wraps content in
// TWO levels of <span> before reaching the actual <p> paragraphs. With the
// previous 1-level grandchild peek, hasBlockChild missed the <p>s entirely
// and the walker extracted the whole answer (4 paragraphs) as a single
// translation block. Fix: hasBlockChild now recurses through inline-tag
// chains, so any depth of inline wrapping still surfaces block descendants.
describe('Quora answer with nested inline wrappers', () => {
  const quoraAnswer = `
    <div class="q-text">
      <span>
        <span class="q-box qu-userSelect--text">
          <p class="q-text">
            <span>I suppose that foul language is found elsewhere in the world, but since we are speaking about Britain I wouldn't disagree with you on this point.</span>
          </p>
          <p class="q-text">
            <span>Why is it there? Because the society as a whole has been induced to tolerate, not only foul language, but often a general lack of respect as well.</span>
          </p>
          <p class="q-text">
            <span>Little is censured or disapproved of today, probably in the name of a (too?) liberal democracy.</span>
          </p>
          <p class="q-text">
            <span>But I often feel that ours may be just a passing phase.</span>
          </p>
        </span>
      </span>
    </div>
  `

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('extracts each <p> as its own block, not the whole answer as one', () => {
    document.body.innerHTML = quoraAnswer
    const blocks = extractBlocks(document.body)

    expect(blocks.length).toBe(4)

    const texts = blocks.map((b) => b.text)
    expect(texts[0]).toContain('foul language is found elsewhere')
    expect(texts[3]).toContain('passing phase')

    // No block should hold more than one paragraph
    for (const t of texts) {
      expect(t).not.toContain('passing phase' + 'I suppose')
    }
  })
})
