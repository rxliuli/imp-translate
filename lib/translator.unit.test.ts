import { describe, it, expect, vi, beforeEach } from 'vitest'
import { decodeHTML } from './translator'
import type { Settings } from './storage'

describe('decodeHTML', () => {
  it('decodes the named entities Google Translate emits', () => {
    expect(decodeHTML('Tom &amp; Jerry')).toBe('Tom & Jerry')
    expect(decodeHTML('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>')
    expect(decodeHTML('&quot;hi&quot;')).toBe('"hi"')
    expect(decodeHTML('it&apos;s')).toBe("it's")
    expect(decodeHTML('a&nbsp;b')).toBe('a b')
  })

  it('decodes decimal numeric entities', () => {
    expect(decodeHTML('it&#39;s')).toBe("it's")
    expect(decodeHTML('&#8364;')).toBe('€')
  })

  it('decodes hex numeric entities (lower and upper case)', () => {
    expect(decodeHTML('&#x27;')).toBe("'")
    expect(decodeHTML('&#X27;')).toBe("'")
    expect(decodeHTML('&#x1F600;')).toBe('😀')
  })

  it('leaves unknown named entities untouched', () => {
    expect(decodeHTML('&nosuch;')).toBe('&nosuch;')
  })

  it('leaves out-of-range numeric entities untouched', () => {
    expect(decodeHTML('&#9999999;')).toBe('&#9999999;')
  })

  it('handles mixed content', () => {
    expect(decodeHTML('A &amp; B &lt; C &#8364; D')).toBe('A & B < C € D')
  })

  it('returns input unchanged when no entities present', () => {
    expect(decodeHTML('plain text 中文')).toBe('plain text 中文')
  })
})

const openaiSettings: Settings = {
  provider: 'openai',
  targetLang: 'zh',
  developerMode: false,
  debugMode: false,
  customRules: '',
  openai: {
    apiKey: 'test-key',
    endpoint: 'https://api.example.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    systemPrompt: 'You are a translator. Translate the following text to {{targetLang}}. Return only the translation, no explanations.',
  },
}

function mockOpenAIResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  }
}

describe('OpenAI response parsing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('single text skips XML tags', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(mockOpenAIResponse('你好世界'))

    const { translate } = await import('./translator')
    const result = await translate(['Hello world'], 'zh', openaiSettings)

    expect(result.texts).toEqual(['你好世界'])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[1].content).toBe('Hello world')
    expect(body.messages[0].content).not.toContain('<t id=')
  })

  it('batch with all tags closed parses correctly', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse('<t id="0">你好</t>\n<t id="1">世界</t>'),
    )

    const { translate } = await import('./translator')
    const result = await translate(['Hello', 'World'], 'zh', openaiSettings)

    expect(result.texts).toEqual(['你好', '世界'])
  })

  it('batch with missing closing tag on last item', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse('<t id="0">你好</t>\n<t id="1">世界'),
    )

    const { translate } = await import('./translator')
    const result = await translate(['Hello', 'World'], 'zh', openaiSettings)

    expect(result.texts).toEqual(['你好', '世界'])
  })

  it('batch with missing closing tag on long translation', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse(
        '<t id="0">架构与PPA</t>\n<t id="1">麒麟9030属于进化级迭代，并非全新架构设计。',
      ),
    )

    const { translate } = await import('./translator')
    const result = await translate(
      ['Architecture and PPA', 'The Kirin 9030 is an evolutionary step.'],
      'zh',
      openaiSettings,
    )

    expect(result.texts).toEqual([
      '架构与PPA',
      '麒麟9030属于进化级迭代，并非全新架构设计。',
    ])
  })
})

describe('LLM explanation detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('single text: returns original when LLM explains instead of translating', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse('抱歉，您提供的信息 "rxliuli" 似乎是一个用户名或特定标识，无法直接翻译为中文。'),
    )

    const { translate } = await import('./translator')
    const result = await translate(['rxliuli'], 'zh', openaiSettings)
    expect(result.texts).toEqual(['rxliuli'])
  })

  it('single text: keeps valid translation for short text', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(mockOpenAIResponse('你好'))

    const { translate } = await import('./translator')
    const result = await translate(['Hello'], 'zh', openaiSettings)
    expect(result.texts).toEqual(['你好'])
  })

  it('batch: returns original for explained items', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse(
        '<t id="0">抱歉，rxliuli 是一个用户名，无法翻译为中文。如果您有其他需要翻译的内容，请告诉我。</t>\n<t id="1">你好世界</t>',
      ),
    )

    const { translate } = await import('./translator')
    const result = await translate(['rxliuli', 'Hello world'], 'zh', openaiSettings)
    expect(result.texts).toEqual(['rxliuli', '你好世界'])
  })
})

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
  developerMode: false,
  debugMode: false,
  customRules: '',
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
