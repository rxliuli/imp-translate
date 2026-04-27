import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Settings } from './storage'

const cacheStore = new Map<string, string>()
vi.mock('./cache', () => ({
  getCached: async (text: string, lang: string) => cacheStore.get(`${text}:${lang}`),
  setCached: async (text: string, lang: string, value: string) => {
    cacheStore.set(`${text}:${lang}`, value)
  },
  evictOldEntries: async () => {},
  clearCache: async () => cacheStore.clear(),
}))

const msSettings: Settings = {
  provider: 'microsoft',
  targetLang: 'zh',
  openai: {
    apiKey: '',
    endpoint: '',
    model: '',
    systemPrompt: '',
  },
}

function mockMsAuthResponse(delay = 50) {
  return async () => {
    await new Promise((r) => setTimeout(r, delay))
    return { ok: true, text: async () => 'mock-token' }
  }
}

function mockMsTranslateResponse(texts: string[]) {
  return {
    ok: true,
    json: async () =>
      texts.map((t) => ({
        translations: [{ text: `[翻译] ${t}` }],
        detectedLanguage: { language: 'en' },
      })),
  }
}

describe('getMicrosoftToken dedup', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('concurrent translate calls should fetch auth only once', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let authCallCount = 0
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u.includes('translate/auth')) {
        authCallCount++
        return mockMsAuthResponse(50)()
      }
      const body = JSON.parse(init?.body as string)
      const texts = body.map((b: { Text: string }) => b.Text)
      return mockMsTranslateResponse(texts)
    })

    const { translate } = await import('./translator')

    await Promise.all([
      translate(['hello'], 'zh', msSettings),
      translate(['world'], 'zh', msSettings),
      translate(['foo'], 'zh', msSettings),
      translate(['bar'], 'zh', msSettings),
    ])

    expect(authCallCount).toBe(1)
  })

  it('cached token skips auth entirely', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let authCallCount = 0
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u.includes('translate/auth')) {
        authCallCount++
        return mockMsAuthResponse(0)()
      }
      const body = JSON.parse(init?.body as string)
      const texts = body.map((b: { Text: string }) => b.Text)
      return mockMsTranslateResponse(texts)
    })

    const { translate } = await import('./translator')

    await translate(['first'], 'zh', msSettings)
    expect(authCallCount).toBe(1)

    await translate(['second'], 'zh', msSettings)
    expect(authCallCount).toBe(1)
  })

  it('auth failure rejects all waiters', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = url.toString()
      if (u.includes('translate/auth')) {
        await new Promise((r) => setTimeout(r, 30))
        return { ok: false, status: 500 }
      }
      return { ok: true, json: async () => [] }
    })

    const { translate } = await import('./translator')

    const results = await Promise.allSettled([
      translate(['a'], 'zh', msSettings),
      translate(['b'], 'zh', msSettings),
    ])

    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('rejected')
  })
})

describe('chunked concurrent translation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('large batch is split into chunks with correct results', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let maxConcurrent = 0
    let currentConcurrent = 0

    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u.includes('translate/auth')) {
        return { ok: true, text: async () => 'mock-token' }
      }
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      await new Promise((r) => setTimeout(r, 50))
      currentConcurrent--

      const body = JSON.parse(init?.body as string)
      const texts = body.map((b: { Text: string }) => b.Text)
      return mockMsTranslateResponse(texts)
    })

    const { translate } = await import('./translator')
    cacheStore.clear()

    const texts = Array.from({ length: 17 }, (_, i) => `text ${i}`)

    const results = new Array<string>(texts.length)
    const uncachedIndices = texts.map((_, i) => i)

    const CHUNK_SIZE = 5
    const MAX_CONCURRENCY = 4
    const chunks: number[][] = []
    for (let i = 0; i < uncachedIndices.length; i += CHUNK_SIZE) {
      chunks.push(uncachedIndices.slice(i, i + CHUNK_SIZE))
    }

    let next = 0
    async function worker() {
      while (next < chunks.length) {
        const chunkIndices = chunks[next++]
        const chunkTexts = chunkIndices.map((i) => texts[i])
        const translated = await translate(chunkTexts, 'zh', msSettings)
        for (let j = 0; j < chunkIndices.length; j++) {
          results[chunkIndices[j]] = translated.texts[j]
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENCY, chunks.length) }, () => worker()),
    )

    expect(chunks).toHaveLength(4)
    for (let i = 0; i < texts.length; i++) {
      expect(results[i]).toBe(`[翻译] text ${i}`)
    }
    expect(maxConcurrent).toBeLessThanOrEqual(MAX_CONCURRENCY)
    expect(maxConcurrent).toBeGreaterThan(1)
  })

  it('cached texts skip API calls', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u.includes('translate/auth')) {
        return { ok: true, text: async () => 'mock-token' }
      }
      const body = JSON.parse(init?.body as string)
      const texts = body.map((b: { Text: string }) => b.Text)
      return mockMsTranslateResponse(texts)
    })

    const { translate } = await import('./translator')
    const { getCached } = await import('./cache')
    cacheStore.clear()

    cacheStore.set('text 0:zh', '[缓存] text 0')
    cacheStore.set('text 2:zh', '[缓存] text 2')

    const texts = ['text 0', 'text 1', 'text 2', 'text 3']
    const results = new Array<string>(texts.length)
    const uncachedIndices: number[] = []

    await Promise.all(
      texts.map(async (text, i) => {
        const cached = await getCached(text, 'zh')
        if (cached !== undefined) {
          results[i] = cached
        } else {
          uncachedIndices.push(i)
        }
      }),
    )

    if (uncachedIndices.length > 0) {
      const chunkTexts = uncachedIndices.map((i) => texts[i])
      const translated = await translate(chunkTexts, 'zh', msSettings)
      for (let j = 0; j < uncachedIndices.length; j++) {
        results[uncachedIndices[j]] = translated.texts[j]
      }
    }

    expect(results[0]).toBe('[缓存] text 0')
    expect(results[1]).toBe('[翻译] text 1')
    expect(results[2]).toBe('[缓存] text 2')
    expect(results[3]).toBe('[翻译] text 3')

    const translateCalls = fetchMock.mock.calls.filter(
      (c) => c[0].toString().includes('microsofttranslator'),
    )
    expect(translateCalls).toHaveLength(1)
    const body = JSON.parse(translateCalls[0][1]?.body as string)
    expect(body).toHaveLength(2)
  })
})
