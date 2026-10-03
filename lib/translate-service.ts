import { countSegments, decodeSegments, encodeSegments } from './segments'

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
 * and citation-style markers such as "[", "12", "]". Wikipedia-like pages split
 * every reference into three Text nodes; sending dozens of these as tagged
 * segments makes Google misalign the ids of the real words around them.
 */
export function isPassthroughSegment(s: string): boolean {
  return /^[\s\[\]\d]*$/.test(s)
}

/**
 * Translates one paragraph's inline segments as a single unit. Blank segments
 * are passed through untouched and left out of the request (translators tend
 * to push neighbouring text out of empty tags). `translateEncoded` receives
 * the segment-encoded string and must return the raw encoded translation;
 * returns null when that translation can't be mapped back onto the segments,
 * including when it comes back unchanged (a failed/declined translation).
 * Decoded pieces are in the translation's reading order (translators may
 * reorder tags), so they are written back into the non-passthrough positions
 * in DOM order rather than by tag id.
 */
export async function translateSegmentsVia(
  segments: string[],
  lang: string,
  translateEncoded: (encoded: string, lang: string) => Promise<string>,
): Promise<string[] | null> {
  const indices: number[] = []
  segments.forEach((s, i) => {
    if (!isPassthroughSegment(s)) indices.push(i)
  })
  if (indices.length === 0) return [...segments]
  const encoded = encodeSegments(indices.map((i) => segments[i]))
  const translated = await translateEncoded(encoded, lang)
  if (translated === encoded) return null
  const decoded = decodeSegments(translated, indices.length)
  if (!decoded) return null
  const result = [...segments]
  indices.forEach((idx, j) => {
    result[idx] = decoded[j]
  })
  return result
}

/**
 * Wraps a segment translator so outputs that can't be decoded are replaced by
 * their input. The translate service never caches an output equal to its
 * input, so a bad translation isn't cached, and translateSegmentsVia turns
 * it into null.
 */
export function guardSegmentTranslator(
  translator: (texts: string[], lang: string) => Promise<string[]>,
): (texts: string[], lang: string) => Promise<string[]> {
  return async (texts, lang) => {
    const out = await translator(texts, lang)
    return out.map((t, i) =>
      typeof t === 'string' && decodeSegments(t, countSegments(texts[i])) ? t : texts[i],
    )
  }
}
