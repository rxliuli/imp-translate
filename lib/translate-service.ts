import {
  decodeSegments,
  parseSegmentTokens,
  encodeSegments,
  mayClearSegment,
  segmentMismatchReason,
  stripCodeFence,
  unescapeSegmentText,
} from './segments'
import { EXPANSION_RATIO } from './translator'

export interface TranslateServiceConfig {
  getCached: (text: string, lang: string) => Promise<string | undefined>
  setCached: (text: string, lang: string, translated: string) => Promise<void>
  translator: (texts: string[], lang: string) => Promise<string[]>
  batchWindowMs: number
  maxBatchSize: number
  maxBatchChars?: number
  onAfterFlush?: () => void
}

export interface TranslateService {
  translate: (text: string, lang: string) => Promise<string>
}

interface PendingItem {
  text: string
  resolve: (translated: string) => void
  reject: (err: Error) => void
}

interface BatchQueue {
  pending: PendingItem[]
  pendingChars: number
  timer: ReturnType<typeof setTimeout> | null
}

function svcDebugTime(label: string): (msg: string) => void {
  const start = performance.now()
  let prev = start
  const log = (msg: string) => {
    const now = performance.now()
    console.debug(
      `[imp-time] ${label} | ${msg} — Δ${(now - prev).toFixed(1)}ms | total ${(now - start).toFixed(1)}ms`,
    )
    prev = now
  }
  log('start')
  return log
}

export function createTranslateService(config: TranslateServiceConfig): TranslateService {
  const queues = new Map<string, BatchQueue>()

  async function flush(lang: string) {
    const q = queues.get(lang)
    if (!q || q.pending.length === 0) return
    if (q.timer) {
      clearTimeout(q.timer)
      q.timer = null
    }
    const batch = q.pending
    q.pending = []
    q.pendingChars = 0

    const textToItems = new Map<string, PendingItem[]>()
    for (const item of batch) {
      let arr = textToItems.get(item.text)
      if (!arr) {
        arr = []
        textToItems.set(item.text, arr)
      }
      arr.push(item)
    }

    const uniqueTexts = [...textToItems.keys()]

    const t = svcDebugTime(`svc:flush(${lang}, n=${uniqueTexts.length})`)
    try {
      const translated = await config.translator(uniqueTexts, lang)
      if (translated.length < uniqueTexts.length) {
        throw new Error(
          `Translator returned ${translated.length} results for ${uniqueTexts.length} inputs`,
        )
      }
      t('translator returned')
      for (let i = 0; i < uniqueTexts.length; i++) {
        const text = uniqueTexts[i]
        const out = translated[i]
        if (out === undefined || out === null) {
          throw new Error(`Translator returned null/undefined for index ${i}: "${text.slice(0, 50)}"`)
        }
        if (out.trim() && out.toLowerCase() !== text.toLowerCase()) {
          config.setCached(text, lang, out)
        }
        for (const item of textToItems.get(text)!) item.resolve(out)
      }
      config.onAfterFlush?.()
      t('done')
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      for (const item of batch) item.reject(e)
      t(`error: ${e.message}`)
    }
  }

  function enqueue(text: string, lang: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let q = queues.get(lang)
      if (!q) {
        q = { pending: [], pendingChars: 0, timer: null }
        queues.set(lang, q)
      }
      if (
        config.maxBatchChars !== undefined &&
        q.pending.length > 0 &&
        q.pendingChars + text.length > config.maxBatchChars
      ) {
        flush(lang)
      }
      q.pending.push({ text, resolve, reject })
      q.pendingChars += text.length
      if (q.pending.length >= config.maxBatchSize) {
        flush(lang)
      } else if (!q.timer) {
        q.timer = setTimeout(() => flush(lang), config.batchWindowMs)
      }
    })
  }

  return {
    async translate(text, lang) {
      const cached = await config.getCached(text, lang)
      if (cached !== undefined) return cached
      return enqueue(text, lang)
    },
  }
}

/**
 * Segments that carry no translatable content and are kept verbatim: whitespace
 * citation-style markers such as "[", "12", "]", and bare quote marks.
 * Wikipedia-like pages split every reference into three Text nodes; sending
 * dozens of these as tagged segments makes Google misalign the ids of the
 * real words around them. Quote-only nodes (a link wrapped in “…”) give the
 * translator nothing to translate and tend to come back moved or dropped.
 */
export function isPassthroughSegment(s: string): boolean {
  return /^[\s\[\]\d"'“”‘’]*$/.test(s)
}

export interface SegmentsResult {
  // Translations aligned 1:1 by position with the input segments (in the
  // translation's reading order, see below), or null when the output can't
  // be poured into the existing nodes.
  segments: string[] | null
  // The engine's raw tagged output (code fence stripped, still escaped), for
  // the structural rewrite fallback; null when there is none to use.
  html: string | null
  // Input positions that were sent: tag id j is segments[sentIndices[j]].
  sentIndices: number[]
  // Why `segments` is null (for logs), e.g. "missing ids 3,7",
  // "empty segment for 'fair use'"; null when it isn't.
  reason: string | null
}

/**
 * Translates one paragraph's inline segments as a single unit. Passthrough
 * segments (see isPassthroughSegment) are kept untouched and left out of the
 * request (translators tend to push neighbouring text out of empty tags).
 * `translateEncoded` receives the segment-encoded string and must return the
 * raw encoded translation.
 *
 * Decoded pieces are in the translation's reading order (translators may
 * reorder tags), so they are written back into the non-passthrough positions
 * in DOM order rather than by tag id. `segments` is null when that mapping
 * fails: ids missing/duplicated, or a piece came back empty although its
 * source has 3+ letters (its node would go blank). A piece left empty whose
 * source has at most 2 letters (punctuation, "s", " a ") stays '' — the
 * caller clears that node (see mayClearSegment). The raw
 * output is returned as `html` either way, unless the translation came back
 * unchanged (a failed/declined translation, see guardSegmentTranslator). An
 * output without any tag (the engine dropped them all but did translate) is
 * returned as `html` too: the rewrite puts it at block level as plain text.
 */
export async function translateSegmentsVia(
  segments: string[],
  lang: string,
  translateEncoded: (encoded: string, lang: string) => Promise<string>,
): Promise<SegmentsResult> {
  const indices: number[] = []
  segments.forEach((s, i) => {
    if (!isPassthroughSegment(s)) indices.push(i)
  })
  if (indices.length === 0) {
    return { segments: [...segments], html: null, sentIndices: [], reason: null }
  }
  const encoded = encodeSegments(indices.map((i) => segments[i]))
  const translated = await translateEncoded(encoded, lang)
  if (translated === encoded) {
    return {
      segments: null,
      html: null,
      sentIndices: indices,
      reason: 'translation declined (output unchanged)',
    }
  }
  const html = stripCodeFence(translated)
  if (!/<i\s+id\b/i.test(html)) {
    return { segments: null, html, sentIndices: indices, reason: 'engine dropped all tags' }
  }
  const decoded = decodeSegments(translated, indices.length)
  if (!decoded) {
    return {
      segments: null,
      html,
      sentIndices: indices,
      reason: segmentMismatchReason(translated, indices.length),
    }
  }
  const lost = emptiedPiece(decoded, indices.map((i) => segments[i]))
  if (lost !== -1) {
    // Pieces are written back by position, but the piece that came back
    // empty belongs to the k-th tag of the output: report that tag's source.
    const tagIds = parseSegmentTokens(html).flatMap((t) => (t.id === null ? [] : [t.id]))
    const source = (segments[indices[tagIds[lost] ?? lost]] ?? '').trim().slice(0, 40)
    return { segments: null, html, sentIndices: indices, reason: `empty segment for '${source}'` }
  }
  const result = [...segments]
  indices.forEach((idx, j) => {
    result[idx] = decoded[j].trim() === '' ? '' : decoded[j]
  })
  return { segments: result, html, sentIndices: indices, reason: null }
}

// Position of a decoded piece that came back empty although the source piece
// written to that position has 3+ letters (its node would go blank), or -1.
// See mayClearSegment.
function emptiedPiece(decoded: string[], sources: string[]): number {
  return decoded.findIndex((d, k) => d.trim() === '' && !mayClearSegment(sources[k]))
}

/**
 * Wraps a segment translator so tagless outputs that look like an
 * explanation rather than a translation (over 3x the source length, at any
 * length) are replaced by their input — an output equal to its input counts
 * as declined (see translateSegmentsVia) and is never cached. Everything
 * else is returned and cached: decodable output is written into the
 * existing nodes, the rest drives the structural rewrite — and a cached
 * output yields exactly the same result, so a reload doesn't re-request
 * paragraphs that needed a rewrite.
 */
export function guardSegmentTranslator(
  translator: (texts: string[], lang: string) => Promise<string[]>,
): (texts: string[], lang: string) => Promise<string[]> {
  return async (texts, lang) => {
    const out = await translator(texts, lang)
    return out.map((t, i) => {
      if (typeof t !== 'string' || !t.trim()) return texts[i]
      if (/<i\s+id\b/i.test(t)) return t
      // Tagless: accept a translation, not an explanation of the text (at
      // over 3x the source length, see looksLikeExplanation).
      const source = unescapeSegmentText(texts[i].replace(/<\/?i\b[^>]*>/gi, ''))
      return t.trim().length > source.length * EXPANSION_RATIO ? texts[i] : t
    })
  }
}
