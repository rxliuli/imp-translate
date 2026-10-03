import { decodeHTML } from './translator'

// Encoding for translating one paragraph that is split on inline boundaries
// (e.g. ["Click ", "here", " for details"]) as a single unit, so the
// translator sees the full sentence but each piece can still be mapped back.
//
// Each segment is wrapped in a real inline tag carrying its index:
//
//   <i id="0">Click </i><i id="1">here</i><i id="2"> for details</i>
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
  return segments.map((s, i) => `<i id="${i}">${escapeSegmentText(s)}</i>`).join('')
}

// Tolerates the attribute-quoting / spacing / case variations translators
// (mostly LLMs) produce, but the content may not contain another <i> or </i>.
const SEGMENT_RE = /<i\s+id\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*>((?:(?!<\/?i\b)[\s\S])*?)<\/i\s*>/gi

/** Number of segment tags in an encoded string (no validation). */
export function countSegments(encoded: string): number {
  return [...encoded.matchAll(SEGMENT_RE)].length
}

const CODE_FENCE_RE = /^\s*```[\w-]*[^\S\n]*\n?([\s\S]*?)\s*```\s*$/

function stripCodeFence(text: string): string {
  const m = CODE_FENCE_RE.exec(text)
  return m ? m[1] : text
}

/**
 * Decodes a (translated) encoded string back into `count` segments, in OUTPUT
 * order: the k-th returned segment is the content of the k-th tag in the
 * output, regardless of its id. Translators like Google reorder the tags to
 * follow target-language word order, and the output's linear order is the
 * correct reading order — so callers write the k-th segment into the k-th
 * text node in DOM order. Ids are only used for validation: returns null
 * unless ids 0..count-1 each appear exactly once and there are no other ids.
 *
 * Translators often push text out of the tags (Google moves inter-segment
 * spaces and Japanese sentence-final "。" outside), so text outside the tags
 * is merged onto the end of the preceding segment (in output order) — or the
 * start of the first one when it precedes every tag. As a safety valve, if
 * the non-whitespace text outside the tags exceeds half the total segment
 * length, the translator likely pushed the content out of the tags and the
 * output is rejected (null). A markdown code fence around the whole output
 * (LLMs like to answer ```html … ```) is stripped first.
 * Segment text is HTML-unescaped and NOT trimmed.
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
    const id = Number(m[1] ?? m[2] ?? m[3])
    if (!Number.isInteger(id) || id < 0 || id >= count) return null
    if (seen[id]) return null
    seen[id] = true
    inside.push(m[4])
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
  const outsideText = unescapeSegmentText(outsideRaw).replace(/\s+/g, '')
  const insideLength = segments.reduce((n, s) => n + s.length, 0)
  if (outsideText.length > insideLength * 0.5) return null

  segments[0] = unescapeSegmentText(leading) + segments[0]
  after.forEach((text, k) => {
    segments[k] += unescapeSegmentText(text)
  })
  return segments
}
