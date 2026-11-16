import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MAX_CHARS_PER_TEXT,
  createTranslateService,
  splitTextForRequest,
  translateBatchTexts,
} from './translate-service'

interface Harness {
  cache: Map<string, string>
  translator: ReturnType<typeof vi.fn>
  setCached: ReturnType<typeof vi.fn>
  service: ReturnType<typeof createTranslateService>
}

function createHarness(opts?: {
  batchWindowMs?: number
  maxBatchSize?: number
  maxBatchChars?: number
  translator?: (texts: string[], lang: string) => Promise<string[]>
}): Harness {
  const cache = new Map<string, string>()
  const setCached = vi.fn(async (text: string, lang: string, translated: string) => {
    cache.set(`${lang}::${text}`, translated)
  })
  const translator = vi.fn(
    opts?.translator ?? (async (texts: string[]) => texts.map((t) => `[${t}]`)),
  )
  const service = createTranslateService({
    getCached: async (text, lang) => cache.get(`${lang}::${text}`),
    setCached,
    translator,
    batchWindowMs: opts?.batchWindowMs ?? 50,
    maxBatchSize: opts?.maxBatchSize ?? 10,
    maxBatchChars: opts?.maxBatchChars,
  })
  return { cache, translator, setCached, service }
}

describe('translate-service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cache hit resolves without advancing the batch window timer', async () => {
    const h = createHarness()
    h.cache.set('en::hello', 'CACHED')

    const result = await h.service.translate('hello', 'en')

    expect(result).toBe('CACHED')
    expect(h.translator).not.toHaveBeenCalled()
  })

  it('uncached request does not resolve before the batch window elapses', async () => {
    const h = createHarness({ batchWindowMs: 50 })
    let resolved = false
    const promise = h.service.translate('hello', 'en').then((v) => {
      resolved = true
      return v
    })

    await vi.advanceTimersByTimeAsync(49)
    expect(resolved).toBe(false)
    expect(h.translator).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toBe('[hello]')
    expect(h.translator).toHaveBeenCalledOnce()
  })

  it('cache hit short-circuits even when an uncached request is pending in the same window', async () => {
    const h = createHarness({ batchWindowMs: 50 })
    h.cache.set('en::cached-text', 'CACHED')

    const uncachedPromise = h.service.translate('uncached-text', 'en')
    const cachedPromise = h.service.translate('cached-text', 'en')

    await expect(cachedPromise).resolves.toBe('CACHED')
    expect(h.translator).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(50)
    await expect(uncachedPromise).resolves.toBe('[uncached-text]')
    expect(h.translator).toHaveBeenCalledOnce()
    expect(h.translator).toHaveBeenCalledWith(['uncached-text'], 'en')
  })

  it('batches multiple uncached requests within the window into one translator call', async () => {
    const h = createHarness({ batchWindowMs: 50 })

    const p1 = h.service.translate('a', 'en')
    const p2 = h.service.translate('b', 'en')
    const p3 = h.service.translate('c', 'en')

    await vi.advanceTimersByTimeAsync(50)

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(['[a]', '[b]', '[c]'])
    expect(h.translator).toHaveBeenCalledOnce()
    expect(h.translator).toHaveBeenCalledWith(['a', 'b', 'c'], 'en')
  })

  it('dedupes identical texts within the same batch', async () => {
    const h = createHarness({ batchWindowMs: 50 })

    const p1 = h.service.translate('same', 'en')
    const p2 = h.service.translate('same', 'en')
    const p3 = h.service.translate('other', 'en')

    await vi.advanceTimersByTimeAsync(50)

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(['[same]', '[same]', '[other]'])
    expect(h.translator).toHaveBeenCalledOnce()
    expect(h.translator).toHaveBeenCalledWith(['same', 'other'], 'en')
  })

  it('flushes immediately when maxBatchSize is reached', async () => {
    const h = createHarness({ batchWindowMs: 50, maxBatchSize: 3 })

    const p1 = h.service.translate('a', 'en')
    const p2 = h.service.translate('b', 'en')
    const p3 = h.service.translate('c', 'en')

    await vi.advanceTimersByTimeAsync(0)
    expect(h.translator).toHaveBeenCalledOnce()

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(['[a]', '[b]', '[c]'])
  })

  it('flushes existing batch when next item would exceed maxBatchChars', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      maxBatchSize: 100,
      maxBatchChars: 10,
    })

    const p1 = h.service.translate('hello', 'en')
    const p2 = h.service.translate('world', 'en')
    const p3 = h.service.translate('foo', 'en')

    await vi.advanceTimersByTimeAsync(0)
    expect(h.translator).toHaveBeenCalledOnce()
    expect(h.translator).toHaveBeenCalledWith(['hello', 'world'], 'en')

    await vi.advanceTimersByTimeAsync(50)
    expect(h.translator).toHaveBeenCalledTimes(2)
    expect(h.translator).toHaveBeenNthCalledWith(2, ['foo'], 'en')

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([
      '[hello]',
      '[world]',
      '[foo]',
    ])
  })

  it('never emits a batch over maxBatchChars for a text that alone exceeds it', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      maxBatchSize: 500,
      maxBatchChars: 20000,
      // Echo, so the rejoined pieces have to reproduce the input exactly.
      translator: async (texts) => texts.map((t) => t),
    })
    const sentence = 'This is a sentence used to build a very long text for testing. '
    const huge = sentence.repeat(500)
    expect(huge.length).toBeGreaterThan(30000)

    const p = h.service.translate(huge, 'en')
    await vi.advanceTimersByTimeAsync(50)

    await expect(p).resolves.toBe(huge)
    expect(h.translator.mock.calls.length).toBeGreaterThan(1)
    for (const call of h.translator.mock.calls) {
      const texts = call[0] as string[]
      expect(texts.length).toBeLessThanOrEqual(500)
      expect(texts.reduce((n, t) => n + t.length, 0)).toBeLessThanOrEqual(20000)
      for (const text of texts) expect(text.length).toBeLessThanOrEqual(MAX_CHARS_PER_TEXT)
    }
  })

  it('caches a split text as a whole so a repeat does not re-request the pieces', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      maxBatchSize: 500,
      maxBatchChars: 20000,
    })
    const sentence = 'This is a sentence used to build a very long text for testing. '
    const huge = sentence.repeat(200)
    expect(huge.length).toBeGreaterThan(MAX_CHARS_PER_TEXT)

    const p = h.service.translate(huge, 'en')
    await vi.advanceTimersByTimeAsync(50)
    const out = await p
    expect(h.cache.get(`en::${huge}`)).toBe(out)

    const calls = h.translator.mock.calls.length
    await expect(h.service.translate(huge, 'en')).resolves.toBe(out)
    expect(h.translator.mock.calls.length).toBe(calls)
  })

  it('a second request for the same text while the first is in flight joins it', async () => {
    vi.useRealTimers()
    const calls: string[][] = []
    const h = createHarness({
      batchWindowMs: 10,
      translator: async (texts) => {
        calls.push(texts)
        await new Promise((r) => setTimeout(r, 30))
        return texts.map((t) => `[${t}]`)
      },
    })

    const first = h.service.translate('hello', 'en')
    // Long enough for the first flush to have started and still be running.
    await new Promise((r) => setTimeout(r, 15))
    expect(calls).toHaveLength(1)

    const second = h.service.translate('hello', 'en')

    await expect(Promise.all([first, second])).resolves.toEqual(['[hello]', '[hello]'])
    expect(calls).toHaveLength(1)
  })

  it('drops a failed in-flight entry so a retry reaches the translator again', async () => {
    vi.useRealTimers()
    let attempts = 0
    const h = createHarness({
      batchWindowMs: 5,
      translator: async (texts) => {
        attempts++
        if (attempts === 1) throw new Error('upstream down')
        return texts.map((t) => `[${t}]`)
      },
    })

    await expect(h.service.translate('hello', 'en')).rejects.toThrow('upstream down')
    // The failure is not cached as a result.
    expect(h.setCached).not.toHaveBeenCalled()

    await expect(h.service.translate('hello', 'en')).resolves.toBe('[hello]')
    expect(attempts).toBe(2)
  })

  it('separate languages flush independently', async () => {
    const h = createHarness({ batchWindowMs: 50 })

    const en = h.service.translate('hi', 'en')
    const ja = h.service.translate('hi', 'ja')

    await vi.advanceTimersByTimeAsync(50)

    await expect(en).resolves.toBe('[hi]')
    await expect(ja).resolves.toBe('[hi]')
    expect(h.translator).toHaveBeenCalledTimes(2)
    expect(h.translator).toHaveBeenCalledWith(['hi'], 'en')
    expect(h.translator).toHaveBeenCalledWith(['hi'], 'ja')
  })

  it('writes results to cache via setCached after a successful flush', async () => {
    const h = createHarness({ batchWindowMs: 50 })

    const p = h.service.translate('hello', 'en')
    await vi.advanceTimersByTimeAsync(50)
    await p

    expect(h.setCached).toHaveBeenCalledWith('hello', 'en', '[hello]')
    expect(h.cache.get('en::hello')).toBe('[hello]')
  })

  it('subsequent identical request is served from cache without translator call', async () => {
    const h = createHarness({ batchWindowMs: 50 })

    const p1 = h.service.translate('hello', 'en')
    await vi.advanceTimersByTimeAsync(50)
    await p1
    expect(h.translator).toHaveBeenCalledOnce()

    const second = await h.service.translate('hello', 'en')
    expect(second).toBe('[hello]')
    expect(h.translator).toHaveBeenCalledOnce()
  })

  it('rejects all pending in the batch when translator throws', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      translator: async () => {
        throw new Error('upstream down')
      },
    })

    const p1 = h.service.translate('a', 'en')
    const p2 = h.service.translate('b', 'en')
    const r1 = expect(p1).rejects.toThrow('upstream down')
    const r2 = expect(p2).rejects.toThrow('upstream down')

    await vi.advanceTimersByTimeAsync(50)

    await r1
    await r2
  })

  it('does not cache result when translation equals original text', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      translator: async (texts) => texts.map((t) => t),
    })

    const p = h.service.translate('hello', 'en')
    await vi.advanceTimersByTimeAsync(50)
    await p

    expect(h.setCached).not.toHaveBeenCalled()
    expect(h.cache.has('en::hello')).toBe(false)
  })

  it('does not cache empty or whitespace-only translation results', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      translator: async (texts) => texts.map(() => ''),
    })

    const p = h.service.translate('hello', 'en')
    await vi.advanceTimersByTimeAsync(50)
    await p

    expect(h.setCached).not.toHaveBeenCalled()
    expect(h.cache.has('en::hello')).toBe(false)
  })

  it('does not cache result when translation differs only in case', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      translator: async (texts) => texts.map((t) => t.toUpperCase()),
    })

    const p = h.service.translate('hello', 'en')
    await vi.advanceTimersByTimeAsync(50)
    await p

    expect(h.setCached).not.toHaveBeenCalled()
  })

  it('requests arriving after a flush form a new batch', async () => {
    const h = createHarness({ batchWindowMs: 50 })

    const p1 = h.service.translate('first', 'en')
    await vi.advanceTimersByTimeAsync(50)
    await p1

    const p2 = h.service.translate('second', 'en')
    await vi.advanceTimersByTimeAsync(50)
    await p2

    expect(h.translator).toHaveBeenCalledTimes(2)
    expect(h.translator).toHaveBeenNthCalledWith(1, ['first'], 'en')
    expect(h.translator).toHaveBeenNthCalledWith(2, ['second'], 'en')
  })
})

describe('splitTextForRequest', () => {
  const sentence = 'This is a sentence used to build a very long text for testing. '

  it('cuts a 30,000-char text into pieces within MAX_CHARS_PER_TEXT that round-trip', () => {
    const text = sentence.repeat(500)
    expect(text.length).toBeGreaterThan(30000)

    const pieces = splitTextForRequest(text)

    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX_CHARS_PER_TEXT)
    // Every non-final piece keeps the separators that followed it, so the
    // pieces concatenate back to the input.
    expect(pieces.join('')).toBe(text)
    // Boundaries land after whitespace: no word is cut in half.
    for (const piece of pieces.slice(0, -1)) expect(piece).toMatch(/\s$/)
  })

  it('cuts a run with no whitespace at the character limit, never between a surrogate pair', () => {
    const emoji = 'x' + '😀'.repeat(3000)
    const pieces = splitTextForRequest(emoji)

    expect(pieces.join('')).toBe(emoji)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_CHARS_PER_TEXT)
      expect(piece).not.toMatch(/[\uD800-\uDBFF]$/)
    }
  })

  it('leaves a text within the limit untouched', () => {
    expect(splitTextForRequest('short text')).toEqual(['short text'])
  })
})

describe('translateBatchTexts', () => {
  const sentence = 'This is a sentence used to build a very long text for testing. '

  function createBatchHarness(opts?: {
    maxBatchSize?: number
    maxBatchChars?: number
    translator?: (texts: string[], lang: string) => Promise<string[]>
  }) {
    const cache = new Map<string, string>()
    const translate = vi.fn(opts?.translator ?? (async (texts: string[]) => texts.map((t) => `[${t}]`)))
    const setCached = vi.fn(async (text: string, lang: string, translated: string) => {
      cache.set(`${lang}::${text}`, translated)
    })
    return {
      cache,
      translate,
      setCached,
      config: {
        getCached: async (text: string, lang: string) => cache.get(`${lang}::${text}`),
        setCached,
        translate,
        maxBatchSize: opts?.maxBatchSize ?? 500,
        maxBatchChars: opts?.maxBatchChars ?? 20000,
      },
    }
  }

  it('keeps results 1:1 with the input for a mixed array of short and oversized texts', async () => {
    const h = createBatchHarness({ translator: async (texts) => texts.map((t) => t) })
    const longText = sentence.repeat(500)
    expect(longText.length).toBeGreaterThan(30000)

    const results = await translateBatchTexts(['short', longText, 'tail'], 'en', h.config)

    expect(results).toHaveLength(3)
    expect(results[0]).toBe('short')
    // Echo translator: the rejoined pieces must reproduce the original text.
    expect(results[1]).toBe(longText)
    expect(results[2]).toBe('tail')
    expect(h.translate.mock.calls.length).toBeGreaterThan(1)
    for (const call of h.translate.mock.calls) {
      const texts = call[0] as string[]
      expect(texts.length).toBeLessThanOrEqual(500)
      expect(texts.reduce((n, t) => n + t.length, 0)).toBeLessThanOrEqual(20000)
      for (const text of texts) expect(text.length).toBeLessThanOrEqual(MAX_CHARS_PER_TEXT)
    }
  })

  it('bounds each request by item count as well as characters', async () => {
    const h = createBatchHarness({ maxBatchSize: 3, maxBatchChars: 20000 })
    const texts = Array.from({ length: 7 }, (_, i) => `${i}: `.padEnd(2400, 'x'))

    const results = await translateBatchTexts(texts, 'en', h.config)

    expect(results).toEqual(texts.map((t) => `[${t}]`))
    for (const call of h.translate.mock.calls) {
      expect((call[0] as string[]).length).toBeLessThanOrEqual(3)
    }
  })

  it('reuses a text that is already in flight instead of sending it twice', async () => {
    vi.useRealTimers()
    const service = createTranslateService({
      getCached: async () => undefined,
      setCached: async () => {},
      translator: async (texts) => {
        await new Promise((r) => setTimeout(r, 30))
        return texts.map((t) => `svc:${t}`)
      },
      batchWindowMs: 10,
      maxBatchSize: 10,
    })
    const first = service.translate('hello', 'en')
    await new Promise((r) => setTimeout(r, 15))

    const h = createBatchHarness()
    const results = await translateBatchTexts(['hello'], 'en', h.config)

    expect(results).toEqual(['svc:hello'])
    expect(h.translate).not.toHaveBeenCalled()
    await first
  })

  it('rejects with the translator error, caches nothing, and drops the in-flight entries', async () => {
    const failing = createBatchHarness({
      translator: async () => {
        throw new Error('boom')
      },
    })
    await expect(translateBatchTexts(['a', 'b'], 'en', failing.config)).rejects.toThrow('boom')
    expect(failing.setCached).not.toHaveBeenCalled()

    const retry = createBatchHarness()
    await expect(translateBatchTexts(['a'], 'en', retry.config)).resolves.toEqual(['[a]'])
    expect(retry.translate).toHaveBeenCalledOnce()
  })
})
