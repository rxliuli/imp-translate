import { decodeHTML } from './translator'

// Encoding for translating one paragraph that is split on inline boundaries
// (e.g. ["Click ", "here", " for details"]) as a single unit, so the
// translator sees the full sentence but each piece can still be mapped back.
//
// Each segment is wrapped in a real inline tag carrying its index:
//
//   <i id=0>Click </i><i id=1>here</i><i id=2> for details</i>
//
// The id is unquoted: Bing's "smart quotes" turn id="0" into id=“0” (or
// id=”0“), which an exact parser no longer recognizes. The parser still
// accepts straight, single and curly quotes for engines that add them back.
//
// Real HTML tags (rather than custom ones) matter: Google's translateHtml
// endpoint moves `<i>`/`<a>`/`<b>` around to follow target-language word
// order, but leaves unknown tags like `<x>` in source order. The tag name is
// deliberately not `t`, which the OpenAI batch packing uses as its outer
// wrapper. Segment text is HTML-escaped so the string can be sent to an HTML
// endpoint verbatim; the tags themselves are not.
//
// Because the translator may reorder tags, decoding returns the pieces in
// OUTPUT order (reading order of the translation), not id order; the ids only
// validate that every piece came back exactly once. Callers write the pieces
// back into the paragraph's text nodes in DOM order.

export function escapeSegmentText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function unescapeSegmentText(text: string): string {
  return decodeHTML(text)
}

export function encodeSegments(segments: string[]): string {
  return segments.map((s, i) => `<i id=${i}>${escapeSegmentText(s)}</i>`).join('')
}

// Tolerates the attribute-quoting / spacing / case variations translators
// produce (unquoted, "…", '…', and curly quotes in any pairing — Bing's smart
// quotes give id=“0” or id=”0“), but the content may not contain another
// <i> or </i>. Group 1 is the id, group 2 the content.
const SEGMENT_RE =
  /<i\s+id\s*=\s*["'“”‘’]?(\d+)["'“”‘’]?\s*>((?:(?!<\/?i\b)[\s\S])*?)<\/i\s*>/gi

/**
 * Whether a segment translation may come back empty, clearing its node:
 * sources with at most 2 letters (punctuation, a possessive "s", an article
 * " a ") are often folded into a neighbour by the translator. Emptying a
 * longer word-bearing segment means the mapping failed.
 */
export function mayClearSegment(source: string): boolean {
  return (source.trim().match(/\p{L}/gu)?.length ?? 0) <= 2
}

/** Number of segment tags in an encoded string (no validation). */
export function countSegments(encoded: string): number {
  return [...encoded.matchAll(SEGMENT_RE)].length
}

const CODE_FENCE_RE = /^\s*```[\w-]*[^\S\n]*\n?([\s\S]*?)\s*```\s*$/

/** Strips a markdown code fence around the whole output (LLMs like to answer ```html … ```). */
export function stripCodeFence(text: string): string {
  const m = CODE_FENCE_RE.exec(text)
  return m ? m[1] : text
}

export interface SegmentToken {
  // The tag's id, or null for text outside the tags.
  id: number | null
  // Unescaped text; markup other than the segment tags is dropped.
  text: string
}

// Our input is escaped, so any raw tag left in the output is markup the
// translator added (or a stray/unmatched segment tag): drop it.
function stripMarkup(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, '')
}

/**
 * Splits a (translated) encoded string into its tags and the text between
 * them, in output order. Unlike decodeSegments this never fails: ids are
 * reported as found (the caller decides what unknown/duplicate ids mean), a
 * code fence around the whole output is stripped, and any other markup is
 * dropped. Empty outside text is omitted.
 */
export function parseSegmentTokens(encoded: string): SegmentToken[] {
  encoded = stripCodeFence(encoded)
  const tokens: SegmentToken[] = []
  const pushOutside = (raw: string) => {
    const text = unescapeSegmentText(stripMarkup(raw))
    if (text) tokens.push({ id: null, text })
  }
  let last = 0
  for (const m of encoded.matchAll(SEGMENT_RE)) {
    pushOutside(encoded.slice(last, m.index))
    last = m.index + m[0].length
    const id = Number(m[1])
    tokens.push({
      id: Number.isInteger(id) ? id : null,
      text: unescapeSegmentText(stripMarkup(m[2])),
    })
  }
  pushOutside(encoded.slice(last))
  return tokens
}

/**
 * Why decodeSegments rejects `encoded` (for logs): missing / duplicate /
 * unknown ids and nested or unclosed tags, joined with "; ".
 */
export function segmentMismatchReason(encoded: string, count: number): string {
  encoded = stripCodeFence(encoded)
  const ids = [...encoded.matchAll(SEGMENT_RE)].map((m) => Number(m[1]))
  const reasons: string[] = []
  const missing = [...Array(count).keys()].filter((i) => !ids.includes(i))
  const dup = [...new Set(ids.filter((id, k) => ids.indexOf(id) !== k))]
  const unknown = ids.filter((id) => !(id >= 0 && id < count))
  if (missing.length) reasons.push(`missing ids ${missing.join(',')}`)
  if (dup.length) reasons.push(`duplicate ids ${dup.join(',')}`)
  if (unknown.length) reasons.push(`unknown ids ${unknown.join(',')}`)
  if (/<\/?i\b/i.test(encoded.replace(SEGMENT_RE, ''))) reasons.push('nested tags')
  return reasons.join('; ') || 'unmappable output'
}

/**
 * Decodes a (translated) encoded string back into `count` segments, in OUTPUT
 * order: the k-th returned segment is the content of the k-th tag in the
 * output, regardless of its id. Translators like Google reorder the tags to
 * follow target-language word order, and the output's linear order is the
 * correct reading order — so callers write the k-th segment into the k-th
 * text node in DOM order. Ids are only used for validation: returns null
 * unless ids 0..count-1 each appear exactly once and there are no other ids.
 * Empty segments are returned as such; whether one is acceptable depends on
 * its source (see translateSegmentsVia).
 *
 * Translators often push text out of the tags (Google moves inter-segment
 * spaces and Japanese sentence-final "。" outside), so text outside the tags
 * is merged onto the end of the preceding segment (in output order) — or the
 * start of the first one when it precedes every tag. How much text ends up
 * outside the tags is not a failure signal: the merged linear output still
 * reads correctly, only the inline styling boundaries drift. A markdown code fence
 * around the whole output (LLMs like to answer ```html … ```) is stripped
 * first. Segment text is HTML-unescaped and NOT trimmed.
 */
export function decodeSegments(encoded: string, count: number): string[] | null {
  encoded = stripCodeFence(encoded)
  const seen = new Array<boolean>(count).fill(false)
  // Tag contents in output order, plus the outside text that follows each tag.
  const inside: string[] = []
  const after: string[] = []
  let leading = ''
  let last = 0
  for (const m of encoded.matchAll(SEGMENT_RE)) {
    const outside = encoded.slice(last, m.index)
    if (inside.length === 0) leading = outside
    else after[inside.length - 1] = outside
    last = m.index + m[0].length
    const id = Number(m[1])
    if (!Number.isInteger(id) || id < 0 || id >= count) return null
    if (seen[id]) return null
    seen[id] = true
    inside.push(m[2])
    after.push('')
  }
  const trailing = encoded.slice(last)
  if (inside.length !== count) return null
  if (count === 0) return trailing.trim() === '' ? [] : null
  after[count - 1] = trailing

  // A stray <i ...> or </i> outside the matched tags means broken structure.
  const outsideRaw = [leading, ...after].join('')
  if (/<\/?i\b/i.test(outsideRaw)) return null

  const segments = inside.map((r) => unescapeSegmentText(r))
  segments[0] = unescapeSegmentText(leading) + segments[0]
  after.forEach((text, k) => {
    segments[k] += unescapeSegmentText(text)
  })
  return segments
}
