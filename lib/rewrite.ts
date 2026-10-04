// Structural rewrite: the replace display mode's last resort for a paragraph
// whose segment translation can't be poured into its existing Text nodes
// (tags dropped/merged, a word-bearing piece left empty). Instead of falling
// back to a bilingual append, the block's content is rebuilt from the
// engine's tagged output — the approach of Google's translate element and
// WebKit's TextManipulationController:
//
// - The block's original top-level nodes are detached and kept as-is (never
//   cloned or edited), so restore puts the page's own nodes back.
// - Each tag's text becomes a new Text node inside shallow clones of the
//   inline ancestors its source node had (an <a> keeps its href/class). Runs
//   of output that share an ancestor share its clone, so a link isn't split
//   needlessly; an ancestor needed again later is cloned again.
// - Content that wasn't translated (citation markers, <sup>, <img>, <br>,
//   hidden elements…) is moved — not cloned — to follow the translation of
//   the sent node it followed in the source.
//
// This breaks the replace mode's "only write Text.data" rule, so frameworks
// that own the block lose track of it: their updates land in the detached
// originals. Those are observed (a MutationObserver works on detached
// nodes), and any change there marks the rewrite stale so the caller can
// undo it and translate the page's new content. It is accepted for this
// rare path; exclude rules cover sites where it misbehaves.

import { getVisibleTextNodes, getVisibleTextNodesOf, type TranslatableBlock } from './dom'
import type { ReplaceEntry } from './replace'
import { parseSegmentTokens } from './segments'

export interface RewriteRecord {
  // blockOwner of the rewritten block (the element, or a run's first node).
  owner: Node
  container: Node
  // The block's original top-level nodes, detached, in order.
  removedNodes: Node[]
  // Top-level nodes of the new content (including moved originals placed at
  // block level), in order.
  insertedNodes: Node[]
  // Every node we created (clones and Text nodes), to detect page edits.
  created: Node[]
  createdText: Map<Text, string>
  // Moved originals with their original position, in document order.
  moved: { node: Node; parent: Node; next: Node | null }[]
  // For a virtual block: the node that followed the run (restore anchor).
  after: Node | null
  // The block's visible Text nodes at rewrite time (now mostly detached):
  // the block's source text is computed live from them, since detached
  // nodes have no layout to re-run the visibility rules on.
  sourceNodes: Text[]
  // Child lists as we left them: the element block's own children, and every
  // clone's. A virtual block's container is shared with other content, so
  // there only the run's own nodes are checked (they must stay consecutive).
  childSnapshot: Map<Node, Node[]>
  // The page changed the detached originals (see onRewriteStale).
  stale: boolean
  observer: MutationObserver | null
  // Element carrying REWRITTEN_ATTR (developer mode only).
  marked: Element | null
}

// Developer mode marker (value: why the rewrite happened), outlined by the
// debug styles (lib/render.ts). Set on the block
// element, or on a virtual block's container (shared with its other runs —
// removed once none of them is rewritten any more).
export const REWRITTEN_ATTR = 'data-imp-rewritten'

const records = new Map<Node, RewriteRecord>()

let staleHandler: ((rec: RewriteRecord) => void) | null = null

/**
 * Called (once per rewrite) when the page changes the detached original
 * nodes of a rewritten block — e.g. a framework updating text it rendered.
 * The record is already marked stale (rewriteIntact is false).
 */
export function onRewriteStale(handler: ((rec: RewriteRecord) => void) | null) {
  staleHandler = handler
}

// The block's source text: the current data of the Text nodes it was
// rewritten from.
export function rewriteSourceText(rec: RewriteRecord): string {
  return rec.sourceNodes.map((n) => n.data).join('')
}

/** The plain text a rewrite from `html` would show (tags dropped). */
export function rewriteText(html: string): string {
  return parseSegmentTokens(html)
    .map((t) => t.text)
    .join('')
}

function sameChildren(parent: Node, expected: Node[]): boolean {
  const now = parent.childNodes
  if (now.length !== expected.length) return false
  for (let i = 0; i < expected.length; i++) if (now[i] !== expected[i]) return false
  return true
}

function unmark(rec: RewriteRecord) {
  if (rec.marked && ![...records.values()].some((r) => r.marked === rec.marked)) {
    rec.marked.removeAttribute(REWRITTEN_ATTR)
  }
}

function stopObserving(rec: RewriteRecord) {
  rec.observer?.takeRecords()
  rec.observer?.disconnect()
  rec.observer = null
}

// Rewrites per owner, to stop a page that keeps undoing our clones (each
// undo triggers a retranslation and a new rewrite) from looping forever.
export const MAX_REWRITES = 3
let rewriteCounts = new WeakMap<Node, number>()

/** Counts a rewrite of `owner`; false once it exceeds MAX_REWRITES. */
export function noteRewrite(owner: Node): boolean {
  const n = (rewriteCounts.get(owner) ?? 0) + 1
  rewriteCounts.set(owner, n)
  return n <= MAX_REWRITES
}

export function resetRewriteCounts() {
  rewriteCounts = new WeakMap()
}

export function getRewrite(owner: Node): RewriteRecord | undefined {
  return records.get(owner)
}

export function rewriteRecords(): IterableIterator<RewriteRecord> {
  return records.values()
}

// The rewritten content is still the way we left it, and the page hasn't
// touched the detached originals.
export function rewriteIntact(rec: RewriteRecord): boolean {
  if (rec.stale) return false
  for (const n of rec.insertedNodes) {
    if (n.parentNode !== rec.container) return false
  }
  for (let i = 1; i < rec.insertedNodes.length; i++) {
    if (rec.insertedNodes[i - 1].nextSibling !== rec.insertedNodes[i]) return false
  }
  for (const [parent, children] of rec.childSnapshot) {
    if (!sameChildren(parent, children)) return false
  }
  for (const n of rec.created) {
    if (!n.isConnected) return false
  }
  for (const [t, data] of rec.createdText) {
    if (t.data !== data) return false
  }
  return true
}

export function pruneRewrites() {
  for (const [owner, rec] of records) {
    if (rec.container.isConnected) continue
    records.delete(owner)
    stopObserving(rec)
    unmark(rec)
  }
}

type Item =
  | { kind: 'sent'; id: number; chain: Element[] }
  | { kind: 'attach'; node: Node; chain: Element[] }

/**
 * Rebuilds the block from the engine's tagged output. `entries` are the
 * block's collected text nodes, `sentIndices` the entry positions that were
 * sent (tag id j is entries[sentIndices[j]]), `html` the raw output. The
 * caller must have restored any Text.data writes of ours in the block first.
 * Returns null (nothing changed) when the block's structure no longer
 * matches (a virtual block's nodes were moved).
 */
export function rewriteBlock(
  block: TranslatableBlock,
  owner: Node,
  entries: ReplaceEntry[],
  sentIndices: number[],
  html: string,
  opts: {
    // Set the developer mode marker with this reason.
    debugReason?: string
    // Same as for collectReplaceableTextNodes (defines the source text).
    skipSelectors?: string[]
  } = {},
): RewriteRecord | null {
  const container: Node = block.element
  const top: Node[] = block.nodes ? [...block.nodes] : [...block.element.childNodes]
  if (top.length === 0 || top.some((n) => n.parentNode !== container)) return null
  const sourceNodes = block.nodes
    ? getVisibleTextNodesOf(block.nodes, opts.skipSelectors)
    : getVisibleTextNodes(block.element, opts.skipSelectors)
  const anchor = top[top.length - 1].nextSibling

  const sentId = new Map<Node, number>()
  sentIndices.forEach((idx, j) => {
    const node = entries[idx]?.node
    if (node) sentId.set(node, j)
  })
  // Elements with a sent text node below them: walked into and cloned.
  // Everything else is moved as a unit.
  const hasSent = new Set<Node>()
  for (const node of sentId.keys()) {
    for (let cur = node.parentNode; cur && cur !== container; cur = cur.parentNode) {
      if (hasSent.has(cur)) break
      hasSent.add(cur)
    }
  }

  const items: Item[] = []
  const walk = (node: Node, chain: Element[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const id = sentId.get(node)
      if (id !== undefined) items.push({ kind: 'sent', id, chain })
      // Whitespace-only nodes were folded into a sent segment.
      else if ((node as Text).data.trim() !== '') items.push({ kind: 'attach', node, chain })
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE && hasSent.has(node)) {
      const next = [...chain, node as Element]
      for (const child of [...node.childNodes]) walk(child, next)
      return
    }
    items.push({ kind: 'attach', node, chain })
  }
  for (const n of top) walk(n, [])

  // Moved nodes, bucketed after the sent node that precedes them (-1: before
  // every sent node).
  const chains = new Map<number, Element[]>()
  const after = new Map<number, { node: Node; chain: Element[] }[]>()
  let last = -1
  for (const item of items) {
    if (item.kind === 'sent') {
      chains.set(item.id, item.chain)
      last = item.id
      continue
    }
    let list = after.get(last)
    if (!list) after.set(last, (list = []))
    list.push({ node: item.node, chain: item.chain })
  }

  const topSet = new Set(top)
  const moved: RewriteRecord['moved'] = []
  for (const item of items) {
    if (item.kind !== 'attach' || topSet.has(item.node)) continue
    moved.push({ node: item.node, parent: item.node.parentNode!, next: item.node.nextSibling })
  }

  const doc = container.ownerDocument ?? document
  const frag = doc.createDocumentFragment()
  const created: Node[] = []
  const createdText = new Map<Text, string>()
  // Currently open clones: path[i].orig is the i-th element of the chain.
  let path: { orig: Element; clone: Element }[] = []
  // Elements cloned before: later clones drop the id (no duplicate ids).
  const cloned = new Set<Element>()

  const open = (chain: Element[]): Node => {
    let k = 0
    while (k < path.length && k < chain.length && path[k].orig === chain[k]) k++
    path = path.slice(0, k)
    for (let i = k; i < chain.length; i++) {
      const clone = chain[i].cloneNode(false) as Element
      if (cloned.has(chain[i])) clone.removeAttribute('id')
      cloned.add(chain[i])
      created.push(clone)
      ;(path.length ? path[path.length - 1].clone : frag).appendChild(clone)
      path.push({ orig: chain[i], clone })
    }
    return path.length ? path[path.length - 1].clone : frag
  }
  const addText = (parent: Node, text: string) => {
    const t = doc.createTextNode(text)
    created.push(t)
    createdText.set(t, text)
    parent.appendChild(t)
  }
  const emitMoved = (id: number) => {
    for (const { node, chain } of after.get(id) ?? []) open(chain).appendChild(node)
    after.delete(id)
  }

  emitMoved(-1)
  const used = new Set<number>()
  for (const token of parseSegmentTokens(html)) {
    const id = token.id
    if (id !== null && chains.has(id) && !used.has(id)) {
      used.add(id)
      if (token.text) addText(open(chains.get(id)!), token.text)
      emitMoved(id)
      continue
    }
    // Outside text (or a tag we can't bind) goes at block level — except
    // whitespace, which stays where it is so a link isn't split by a space.
    if (token.text.trim() === '') {
      addText(path.length ? path[path.length - 1].clone : frag, token.text)
    } else {
      addText(open([]), token.text)
    }
  }
  // Sent nodes the engine dropped: their text is gone, but whatever followed
  // them must not be.
  for (const id of [...after.keys()].sort((a, b) => a - b)) emitMoved(id)

  const insertedNodes: Node[] = [...frag.childNodes]
  // Top-level moved nodes already left the container.
  container.insertBefore(frag, top.find((n) => n.parentNode === container) ?? anchor)
  for (const n of top) {
    // Top-level moved nodes are already part of the new content.
    if (n.parentNode === container && !insertedNodes.includes(n)) container.removeChild(n)
  }

  const rec: RewriteRecord = {
    owner,
    container,
    removedNodes: top,
    insertedNodes,
    created,
    createdText,
    moved,
    after: block.nodes ? anchor : null,
    sourceNodes,
    childSnapshot: new Map(),
    stale: false,
    observer: null,
    marked: null,
  }
  if (!block.nodes) rec.childSnapshot.set(container, [...container.childNodes])
  for (const n of created) {
    if (n.nodeType === Node.ELEMENT_NODE) rec.childSnapshot.set(n, [...n.childNodes])
  }
  const observer = new MutationObserver(() => {
    if (records.get(owner) !== rec) return
    rec.stale = true
    stopObserving(rec)
    staleHandler?.(rec)
  })
  for (const n of top) {
    // Top-level moved nodes are live (in our content), observed as usual.
    if (insertedNodes.includes(n)) continue
    observer.observe(n, { subtree: true, childList: true, characterData: true })
  }
  rec.observer = observer
  if (opts.debugReason !== undefined) {
    block.element.setAttribute(REWRITTEN_ATTR, opts.debugReason)
    rec.marked = block.element
  }
  records.set(owner, rec)
  return rec
}

/**
 * Puts the block's original nodes back (best effort: the page may have
 * changed the container meanwhile). Returns whether a rewrite was undone.
 */
export function restoreRewrite(owner: Node): boolean {
  const rec = records.get(owner)
  if (!rec) return false
  records.delete(owner)
  // Before putting anything back: our own moves must not look like page edits.
  stopObserving(rec)
  const { container } = rec
  unmark(rec)
  const inserted = new Set(rec.insertedNodes)
  try {
    let ref: Node | null = null
    const live = rec.insertedNodes.filter((n) => n.parentNode === container)
    if (live.length > 0) {
      ref = live[live.length - 1].nextSibling
      while (ref && inserted.has(ref)) ref = ref.nextSibling
    } else if (rec.after && rec.after.parentNode === container) {
      ref = rec.after
    }
    for (const n of rec.insertedNodes) {
      try {
        n.parentNode?.removeChild(n)
      } catch {}
    }
    // Reverse document order: a moved node's next sibling, if it was moved
    // too, is already back.
    for (let i = rec.moved.length - 1; i >= 0; i--) {
      const { node, parent, next } = rec.moved[i]
      try {
        if (next && next.parentNode === parent) parent.insertBefore(node, next)
        else parent.appendChild(node)
      } catch {}
    }
    if (ref && ref.parentNode !== container) ref = null
    for (const n of rec.removedNodes) {
      try {
        container.insertBefore(n, ref)
      } catch {}
    }
  } catch {}
  return true
}
