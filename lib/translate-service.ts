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

/**
 * Upper bound on one text in a request. Matches the server's
 * SUB_BATCH_MAX_CHARS (imp-credits apps/api/src/routes/translate.ts): each
 * piece becomes exactly one upstream call, and the whole request (all
 * `texts` plus `context`) is hard-rejected above 20,000 characters. Both
 * failure modes were reproduced in production — a 30,000-char block made the
 * single POST 413, and a 19,000-char text (under the cap) died after 42s
 * upstream with "expected 1 translations, got none".
 */
export const MAX_CHARS_PER_TEXT = 4000

export interface TranslateServiceConfig {
  getCached: (text: string, lang: string) => Promise<string | undefined>
  setCached: (text: string, lang: string, translated: string) => Promise<void>
  translator: (texts: string[], lang: string) => Promise<string[]>
  batchWindowMs: number
  maxBatchSize: number
  maxBatchChars?: number
  // Whether a text longer than MAX_CHARS_PER_TEXT is cut into request-sized
  // pieces (see splitTextForRequest). Segment-encoded texts (lib/segments.ts)
  // opt out: a cut inside an <i> tag makes decodeSegments drop the paragraph.
  splitLongTexts?: boolean
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

/**
 * Largest piece one request may carry: the server's per-text chunk size, but
 * never more than the provider's own request budget (openai: 1,000 chars).
 */
function pieceCharLimit(maxBatchChars?: number): number {
  return Math.min(MAX_CHARS_PER_TEXT, maxBatchChars ?? MAX_CHARS_PER_TEXT)
}

/**
 * Cuts `text` into pieces of at most `maxChars` characters, on sentence
 * boundaries first and word boundaries second, so `pieces.join('') === text`:
 * every piece keeps the separators that followed it, which makes rejoining the
 * pieces (or their translations) reproduce the input exactly. A raw character
 * cut only happens inside a run with no whitespace at all (CJK, URLs, base64),
 * and never between the halves of a surrogate pair.
 */
export function splitTextForRequest(
  text: string,
  maxChars: number = MAX_CHARS_PER_TEXT,
): string[] {
  if (maxChars <= 0 || text.length <= maxChars) return [text]
  // Same sentence split as bingTranslateLong (lib/translator.ts); the pieces
  // include the trailing terminator, closing quotes and whitespace.
  const sentences = text.match(/[^.!?。！？]*[.!?。！？]+["')\]]*\s*|[^.!?。！？]+$/g) ?? [text]
  const pieces: string[] = []
  let current = ''
  const flushCurrent = () => {
    if (current) {
      pieces.push(current)
      current = ''
    }
  }
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flushCurrent()
      pieces.push(...splitUnbrokenRun(sentence, maxChars))
      continue
    }
    if (current.length + sentence.length > maxChars) flushCurrent()
    current += sentence
  }
  flushCurrent()
  return pieces
}

// Cuts a sentence that is itself over the limit at its last whitespace, so a
// word is only ever split when the window holds no boundary at all.
function splitUnbrokenRun(run: string, maxChars: number): string[] {
  const pieces: string[] = []
  let rest = run
  while (rest.length > maxChars) {
    let cut = maxChars
    for (let i = maxChars - 1; i > 0; i--) {
      if (/\s/.test(rest[i])) {
        cut = i + 1
        break
      }
    }
    const high = rest.charCodeAt(cut - 1)
    if (cut > 1 && high >= 0xd800 && high <= 0xdbff) cut--
    pieces.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  pieces.push(rest)
  return pieces
}

// Re-attaches the whitespace a piece ended with when the translator dropped it
// (most trim): the pieces are concatenated back, so a lost trailing space would
// glue two sentences together.
function joinTranslatedPieces(pieces: string[], translated: string[]): string {
  return translated
    .map((out, i) => {
      if (i === translated.length - 1) return out
      if (/\s$/.test(out)) return out
      return out + (/\s+$/.exec(pieces[i])?.[0] ?? '')
    })
    .join('')
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Translations currently being fetched, keyed by language + text, so a second
 * request for the same text joins the first one's POST instead of paying for a
 * duplicate: two identical bodies were billed 71 ms apart in production, the
 * cache only being written once the response arrives. Shared by the batch
 * queue and the background's translateBatch handler, which hit the same
 * endpoint. Entries are removed when the promise settles, failure included, so
 * a retry after an error still goes out; failures are never cached as results.
 */
const inFlight = new Map<string, Promise<string>>()

function inFlightKey(lang: string, text: string): string {
  return `${lang}\u0000${text}`
}

function getInFlight(lang: string, text: string): Promise<string> | undefined {
  return inFlight.get(inFlightKey(lang, text))
}

function shareInFlight(
  lang: string,
  text: string,
  pending: Promise<string>,
): Promise<string> {
  const key = inFlightKey(lang, text)
  const existing = inFlight.get(key)
  if (existing) return existing
  inFlight.set(key, pending)
  const clear = () => {
    // Only drop our own entry: a settled request may already have been
    // replaced by a newer one for the same text.
    if (inFlight.get(key) === pending) inFlight.delete(key)
  }
  pending.then(clear, clear)
  return pending
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

  // A piece must fit one request on its own: config.maxBatchChars is what the
  // whole POST is charged against, and the old check only flushed when the
  // queue was non-empty, so an oversized text went out alone, unbounded.
  const pieceLimit =
    config.splitLongTexts === false
      ? Number.POSITIVE_INFINITY
      : pieceCharLimit(config.maxBatchChars)

  function enqueuePiece(text: string, lang: string): Promise<string> {
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

  async function enqueueText(text: string, lang: string): Promise<string> {
    const pieces = splitTextForRequest(text, pieceLimit)
    if (pieces.length === 1) return enqueuePiece(pieces[0], lang)
    const translated = await Promise.all(pieces.map((piece) => enqueuePiece(piece, lang)))
    const joined = joinTranslatedPieces(pieces, translated)
    // flush caches the pieces individually; cache the joined result as well so
    // a repeat of the original text doesn't re-request every piece.
    if (joined.trim() && joined.toLowerCase() !== text.toLowerCase()) {
      config.setCached(text, lang, joined)
    }
    return joined
  }

  return {
    async translate(text, lang) {
      const cached = await config.getCached(text, lang)
      if (cached !== undefined) return cached
      // Keyed on the whole text, not a piece: a second enqueue while the first
      // is running has to join it, since the cache is only written on success.
      const existing = getInFlight(lang, text)
      if (existing) return existing
      return shareInFlight(lang, text, enqueueText(text, lang))
    },
  }
}

export interface BatchTranslateConfig {
  getCached: (text: string, lang: string) => Promise<string | undefined>
  setCached: (text: string, lang: string, translated: string) => Promise<void>
  translate: (texts: string[], lang: string) => Promise<string[]>
  maxBatchSize: number
  maxBatchChars?: number
}

/**
 * The background's translateBatch path (the page-facing RPC): translates
 * `texts` 1:1 by array position, bounding every request by both item count and
 * characters. Callers batch by COUNT — the web app sends 20 texts at a time,
 * which a single text of 7,000 chars turns into 140,000 characters, far over
 * the server's 20,000 cap (413) — and one text can be over the cap alone, so
 * each is cut with splitTextForRequest first. In-flight texts share the queue's
 * map, so re-submitting the same body while the first request runs costs
 * nothing.
 */
export async function translateBatchTexts(
  texts: string[],
  lang: string,
  config: BatchTranslateConfig,
): Promise<string[]> {
  const results: string[] = new Array(texts.length)
  const uncached: number[] = []
  for (let i = 0; i < texts.length; i++) {
    const cached = await config.getCached(texts[i], lang)
    if (cached !== undefined) results[i] = cached
    else uncached.push(i)
  }
  if (uncached.length === 0) return results

  interface PendingText {
    index: number
    text: string
    promise: Promise<string>
  }
  interface SentText {
    index: number
    text: string
    pieces: string[]
    translated: string[]
    resolve: (translated: string) => void
    reject: (err: Error) => void
  }

  const pending: PendingText[] = []
  const sent: SentText[] = []
  for (const index of uncached) {
    const text = texts[index]
    const existing = getInFlight(lang, text)
    if (existing) {
      pending.push({ index, text, promise: existing })
      continue
    }
    const deferred = createDeferred<string>()
    pending.push({ index, text, promise: shareInFlight(lang, text, deferred.promise) })
    sent.push({
      index,
      text,
      pieces: [],
      translated: [],
      resolve: deferred.resolve,
      reject: deferred.reject,
    })
  }

  const pieceLimit = pieceCharLimit(config.maxBatchChars)
  const groups: { texts: string[]; slots: { sent: number; piece: number }[] }[] = []
  let group: { texts: string[]; slots: { sent: number; piece: number }[] } = {
    texts: [],
    slots: [],
  }
  let groupChars = 0
  sent.forEach((item, slot) => {
    item.pieces = splitTextForRequest(item.text, pieceLimit)
    item.translated = new Array(item.pieces.length)
    item.pieces.forEach((piece, pieceIndex) => {
      const overCount = group.texts.length >= config.maxBatchSize
      const overChars =
        config.maxBatchChars !== undefined && groupChars + piece.length > config.maxBatchChars
      if (group.texts.length > 0 && (overCount || overChars)) {
        groups.push(group)
        group = { texts: [], slots: [] }
        groupChars = 0
      }
      group.texts.push(piece)
      group.slots.push({ sent: slot, piece: pieceIndex })
      groupChars += piece.length
    })
  })
  if (group.texts.length > 0) groups.push(group)

  try {
    // Sequential: imp-credits runs its own upstream chunks serially, so
    // parallel groups would only add rate-limit pressure.
    for (const current of groups) {
      const translated = await config.translate(current.texts, lang)
      if (translated.length < current.texts.length) {
        throw new Error(
          `Translator returned ${translated.length} results for ${current.texts.length} inputs`,
        )
      }
      current.slots.forEach((slot, j) => {
        const out = translated[j]
        if (typeof out !== 'string') {
          throw new Error(
            `Translator returned no result for "${current.texts[j].slice(0, 50)}"`,
          )
        }
        sent[slot.sent].translated[slot.piece] = out
      })
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    for (const item of sent) item.reject(e)
    throw e
  }

  for (const item of sent) {
    item.resolve(joinTranslatedPieces(item.pieces, item.translated))
  }

  for (const item of pending) {
    const out = await item.promise
    results[item.index] = out
    if (out.trim() && out.toLowerCase() !== item.text.toLowerCase()) {
      await config.setCached(item.text, lang, out)
    }
  }
  return results
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
