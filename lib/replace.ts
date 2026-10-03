// In-place ("replace") display mode: the translation overwrites the page's
// own text instead of being appended next to it.
//
// The one hard rule, from testing React / Preact / Vue / Svelte / Solid / Lit /
// Angular: only ever write Text.data. No node is created, moved, removed,
// wrapped or normalize()d — wrapping text (Chrome-style <font>) blanks React
// pages (insertBefore reference node detached), makes Lit throw, and freezes
// dynamic text everywhere else, while plain nodeValue writes are invisible to
// all of them. Anything that cannot be mapped cleanly onto whole Text nodes is
// reported as non-replaceable so the caller falls back to bilingual mode.

import { getVisibleTextNodes, getVisibleTextNodesOf, type TranslatableBlock } from './dom'

export const LOADING_ATTR = 'data-imp-loading'

export interface ReplaceEntry {
  node: Text
  // node.data at collection time (may be our earlier translation when
  // collected with reuseOwned) — used to check the node is untouched.
  data: string
  // The page's text for this node: `data`, or the recorded original when
  // the node still shows our translation.
  source: string
  // Whitespace around the node's source text. Re-applied around the translation for
  // single-node blocks; for segment writes only a line break in a
  // newline-preserving context is kept (see applyReplacement).
  leading: string
  trailing: string
  // Text sent for translation: the node's source plus any whitespace-only nodes
  // that directly follow it, so the segments concatenate back to the
  // paragraph text.
  segment: string
}

interface Replacement {
  original: string
  translated: string
  // The block whose translation this is (see blockOwner).
  owner: Node
}

// Identity of a block for ownership: the block element, or for a virtual
// block (a run of nodes inside a mixed container, see TranslatableBlock.nodes)
// its first node — the container may hold several runs.
export function blockOwner(block: TranslatableBlock): Node {
  return block.nodes?.[0] ?? block.element
}

const replaced = new WeakMap<Text, Replacement>()
// Iterable registry (WeakMap can't be walked) used by restore; covers shadow
// roots naturally since it holds the owner nodes themselves.
const registry = new Map<Node, Set<Text>>()
const loading = new Set<HTMLElement>()

// Drop registry records for Text nodes the page has removed (SPA route
// changes, virtualized lists, a framework swapping the text nodes of a
// still-attached block), and owners left without any, so long sessions don't
// accumulate them. Walks the whole registry, so callers run it once per batch
// rather than per block.
export function pruneDisconnected() {
  for (const [owner, nodes] of registry) {
    for (const node of nodes) {
      if (node.isConnected) continue
      replaced.delete(node)
      nodes.delete(node)
    }
    if (nodes.size === 0) registry.delete(owner)
  }
  for (const el of loading) {
    if (!el.isConnected) loading.delete(el)
  }
}

export interface CollectOptions {
  // Retranslation of a block we already replaced: nodes still showing this
  // block's translation contribute their recorded original, so the old
  // translation can stay on screen until the new one arrives (no flash back
  // to the original). Nodes owned by a different block still disqualify.
  reuseOwned?: boolean
}

// Text nodes behind `block.text`, or null when the block can't be replaced
// in place: its text isn't exactly the concatenation of whole visible Text
// nodes (e.g. a pre-wrap block cut out of a larger text node), or a node
// still carries one of our translations (another block's, or — without
// reuseOwned — any).
export function collectReplaceableTextNodes(
  block: TranslatableBlock,
  skipSelectors?: string[],
  opts: CollectOptions = {},
): ReplaceEntry[] | null {
  const nodes = block.nodes
    ? getVisibleTextNodesOf(block.nodes, skipSelectors)
    : getVisibleTextNodes(block.element, skipSelectors)
  if (nodes.length === 0) return null
  const owner = blockOwner(block)

  const sources: string[] = []
  for (const node of nodes) {
    const rec = replaced.get(node)
    if (rec && node.data === rec.translated) {
      if (!opts.reuseOwned || rec.owner !== owner) return null
      sources.push(rec.original)
    } else {
      sources.push(node.data)
    }
  }
  if (sources.join('').trim() !== block.text) return null

  const entries: ReplaceEntry[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const source = sources[i]
    const rec = replaced.get(node)
    // The page rewrote it since we wrote it; the record is dead.
    if (rec && node.data !== rec.translated) replaced.delete(node)
    if (!source.trim()) {
      if (entries.length > 0) entries[entries.length - 1].segment += source
      continue
    }
    entries.push({
      node,
      data: node.data,
      source,
      leading: source.match(/^\s*/)![0],
      trailing: source.match(/\s*$/)![0],
      segment: source,
    })
  }
  return entries.length > 0 ? entries : null
}

// True when every entry's node is still attached and still holds the text it
// had at collection time — i.e. it's safe to apply a translation of it.
export function entriesIntact(entries: ReplaceEntry[]): boolean {
  return entries.every(
    (e) => e.node.isConnected && e.node.data === e.data,
  )
}

const GLUE_START_RE = /^[\p{Script=Latin}\p{N}]/u
const GLUE_END_RE = /[\p{Script=Latin}\p{N}]$/u

function preservesNewlines(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return false
  const style = getComputedStyle(parent)
  const ws = style.whiteSpace
  if (ws === 'pre' || ws === 'pre-wrap' || ws === 'pre-line' || ws === 'break-spaces') return true
  const collapse = (style as CSSStyleDeclaration & { whiteSpaceCollapse?: string }).whiteSpaceCollapse
  return collapse === 'preserve' || collapse === 'preserve-breaks' || collapse === 'break-spaces'
}

// Edge whitespace for a segment-mode write: the translation's own edge
// whitespace carries meaning (providers move inter-segment spaces and
// punctuation around when reordering), collapsed to one space — except a
// rendered line break in the original edge, which must survive or pre-wrap
// paragraphs get glued together.
function segmentEdge(original: string, translated: string, node: Text): string {
  if (original.includes('\n') && preservesNewlines(node)) return original
  return translated ? ' ' : ''
}

export interface ApplyOptions {
  // Single-node blocks: the translation is a whole-paragraph `translate`
  // result with no meaningful edge whitespace, so the node's own leading /
  // trailing whitespace is put back around the trimmed translation.
  keepNodeWhitespace?: boolean
}

// Write one translation per entry into its Text node. An empty translation
// for a non-empty source keeps the original (links/buttons must not go
// blank). All values are computed first (layout reads), then written.
// Returns the number of nodes written. `owner` is blockOwner(block).
export function applyReplacement(
  owner: Node,
  entries: ReplaceEntry[],
  translations: string[],
  opts: ApplyOptions = {},
): number {
  const next: (string | null)[] = entries.map((entry, i) => {
    const raw = translations[i] ?? ''
    const tr = raw.trim()
    if (!tr) return null
    if (opts.keepNodeWhitespace) return entry.leading + tr + entry.trailing
    const lead = segmentEdge(entry.leading, raw.match(/^\s*/)![0], entry.node)
    const trail = segmentEdge(entry.trailing, raw.match(/\s*$/)![0], entry.node)
    return lead + tr + trail
  })

  // Glue guard: reordering can leave two Latin words / numbers touching
  // across a node boundary ("Sienpm"). Only boundaries with no whitespace-
  // only node between them are checked; the space goes on a node we wrote.
  for (let i = 0; i + 1 < entries.length; i++) {
    if (entries[i].segment !== entries[i].source) continue
    if (next[i] === null && next[i + 1] === null) continue
    const a = next[i] ?? entries[i].data
    const b = next[i + 1] ?? entries[i + 1].data
    if (!GLUE_END_RE.test(a) || !GLUE_START_RE.test(b)) continue
    if (next[i] !== null) next[i] = a + ' '
    else next[i + 1] = ' ' + b
  }

  let written = 0
  let owned = registry.get(owner)
  for (let i = 0; i < entries.length; i++) {
    const value = next[i]
    const { node, source } = entries[i]
    if (value === null || value === node.data) continue
    // `source` is the page's text even when the node currently shows an
    // older translation of ours, so restore goes back to the page's text.
    replaced.set(node, { original: source, translated: value, owner })
    node.data = value
    if (!owned) {
      owned = new Set()
      registry.set(owner, owned)
    }
    owned.add(node)
    written++
  }
  return written
}

// The block's text as the page authored it: Text nodes still holding our
// translation contribute their original instead. Equal to getVisibleText
// when nothing was replaced, and unaffected by our own writes — so comparing
// it against data-imp-text detects page edits without reacting to ourselves.
// Takes an element, or a virtual block's nodes.
export function getSourceText(target: Element | Node[], skipSelectors?: string[]): string {
  const nodes = Array.isArray(target)
    ? getVisibleTextNodesOf(target, skipSelectors)
    : getVisibleTextNodes(target, skipSelectors)
  let text = ''
  for (const node of nodes) {
    const rec = replaced.get(node)
    text += rec && node.data === rec.translated ? rec.original : node.data
  }
  return text
}

export function markLoading(el: HTMLElement) {
  el.setAttribute(LOADING_ATTR, '')
  loading.add(el)
}

export function unmarkLoading(el: HTMLElement) {
  el.removeAttribute(LOADING_ATTR)
  loading.delete(el)
}

// Shadow-piercing containment: `root` contains `node` across shadow
// boundaries.
function containsComposed(root: Node, node: Node): boolean {
  let cur: Node | null = node
  while (cur) {
    if (cur === root) return true
    const parent: Node | null = cur.parentNode
    if (parent) {
      cur = parent
    } else if (cur instanceof ShadowRoot) {
      cur = cur.host
    } else {
      return false
    }
  }
  return false
}

// Put the page's text back for every replaced node under `root` (default:
// everything). A node is only written if it still holds our translation —
// if the page has written something newer, that value wins.
export function restoreReplacements(root?: Node) {
  pruneDisconnected()
  for (const [owner, nodes] of registry) {
    // A virtual block's owner (its first node) may have been removed by the
    // page while the rest of the run is still there.
    if (
      root &&
      !containsComposed(root, owner) &&
      ![...nodes].some((n) => containsComposed(root, n))
    ) {
      continue
    }
    restoreNodes(owner, nodes)
  }
  for (const el of loading) {
    if (root && !containsComposed(root, el)) continue
    unmarkLoading(el)
  }
}

function restoreNodes(owner: Node, nodes: Set<Text>) {
  for (const node of nodes) {
    const rec = replaced.get(node)
    if (!rec || rec.owner !== owner) continue
    if (node.data === rec.translated) node.data = rec.original
    replaced.delete(node)
  }
  registry.delete(owner)
}

// Restore exactly one block's replacements — for a virtual block, whose
// container may hold other runs (and element blocks) that must keep theirs.
export function restoreOwner(owner: Node) {
  const nodes = registry.get(owner)
  if (nodes) restoreNodes(owner, nodes)
}
