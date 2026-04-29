import { describe, expect, it, beforeEach } from 'vitest'
import { extractBlocks } from './dom'
import npmVistaReadme from './__fixtures__/npm-vista-readme.html?raw'

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
})
