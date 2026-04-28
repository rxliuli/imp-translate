import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTranslateService } from './translate-service'

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

  it('single oversized text still goes through alone', async () => {
    const h = createHarness({
      batchWindowMs: 50,
      maxBatchSize: 100,
      maxBatchChars: 5,
    })

    const huge = 'x'.repeat(50)
    const p = h.service.translate(huge, 'en')

    await vi.advanceTimersByTimeAsync(50)
    await expect(p).resolves.toBe(`[${huge}]`)
    expect(h.translator).toHaveBeenCalledOnce()
    expect(h.translator).toHaveBeenCalledWith([huge], 'en')
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
