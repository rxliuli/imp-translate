// Source of e2e/static/react-app.js — a React 19 page whose text keeps
// changing under the translator (replace-mode regression: writing anything
// but Text.data blanks React pages). Rebuild from the repo root:
//   node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild e2e/static/react-app.src.jsx \
//     --bundle --minify --format=iife --jsx=automatic \
//     --define:process.env.NODE_ENV='"production"' --outfile=e2e/static/react-app.js
import { useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

window.__errors = []
const record = (e) => window.__errors.push(String(e?.stack ?? e?.message ?? e))
window.addEventListener('error', (e) => record(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => record(e.reason))

function useInterval(fn, ms) {
  useEffect(() => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  }, [])
}

const WORDS5 = ['apple', 'banana', 'cherry', 'durian']
const WORDS6 = ['mountains', 'rivers', 'forests', 'deserts', 'oceans']

// Counts childList records under #s5/#s6 that don't involve our bilingual
// result elements. React only ever updates Text.data there (each dynamic
// value is the sole child of its element), so every counted record was made
// by the translator. Installed after the first commit, before translation.
function installChildListObserver() {
  window.__childListMutations = 0
  window.__childListLog = []
  const isOurs = (n) =>
    n.nodeType === 1 &&
    (n.classList.contains('imp-translate-result') || n.classList.contains('imp-translate-br'))
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target.nodeType === 1 && r.target.closest('.imp-translate-result')) continue
      const changed = [...r.addedNodes, ...r.removedNodes]
      if (changed.length > 0 && changed.every(isOurs)) continue
      window.__childListMutations++
      window.__childListLog.push(
        `${r.target.nodeName}#${r.target.id}: +${r.addedNodes.length} -${r.removedNodes.length}`,
      )
    }
  })
  for (const id of ['s5', 's6']) {
    obs.observe(document.getElementById(id), { childList: true, subtree: true })
  }
}

function App() {
  const [count, setCount] = useState(0)
  const [visible, setVisible] = useState(false)
  const [items, setItems] = useState([1, 2])
  const [w5, setW5] = useState(0)
  const [w6, setW6] = useState(0)

  useInterval(() => setCount((c) => c + 1), 500)
  useInterval(() => setVisible((v) => !v), 700)
  useInterval(() => {
    setItems((list) => {
      if (list.length >= 4) return list.slice(1)
      return [...list, list.length ? list[list.length - 1] + 1 : 1]
    })
  }, 900)
  useInterval(() => setW5((i) => (i + 1) % WORDS5.length), 600)
  useInterval(() => setW6((i) => (i + 1) % WORDS6.length), 800)

  useEffect(() => {
    const s5 = document.getElementById('s5')
    window.__s5refs = { em: s5.querySelector('em'), a: s5.querySelector('a') }
    installChildListObserver()
  }, [])

  // Published after commit, so it always matches what is in the DOM.
  useLayoutEffect(() => {
    window.__state = { count, visible, items, word5: WORDS5[w5], word6: WORDS6[w6] }
  })

  return (
    <main>
      <h1>Framework translation test page</h1>
      <p id="s1">There are {count} lights in the room tonight</p>
      <p id="s2">{`The counter has been incremented ${count} times so far`}</p>
      <p id="s3">
        The server status is {visible && <span>Online</span>} for every connected client
      </p>
      <ul id="s4">
        {items.map((i) => (
          <li key={i}>This list item number {i} was rendered by React</li>
        ))}
      </ul>
      {/* S5: mixed container — inline runs next to a block child. */}
      <div id="s5">
        Intro <em>{WORDS5[w5]}</em> here <a href="#">link</a> tail<p>Para</p>
      </div>
      {/* S6: pre-wrap paragraph whose paragraphs are blank lines in one text. */}
      <p id="s6" style={{ whiteSpace: 'pre-wrap' }}>
        {`The first paragraph talks about ${WORDS6[w6]} in detail.\n\nThe second paragraph never changes at all.\n\nThe third paragraph is static as well.`}
      </p>
    </main>
  )
}

createRoot(document.getElementById('root'), {
  onUncaughtError: record,
  onCaughtError: record,
  onRecoverableError: record,
}).render(<App />)
