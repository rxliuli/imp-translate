import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chatCompletionsUrl, decodeHTML } from './translator'
import type { Settings } from './storage'

describe('chatCompletionsUrl', () => {
  it('appends /chat/completions to the base URL', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })

  it('works with bare domains (DeepSeek style)', () => {
    expect(chatCompletionsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/chat/completions',
    )
  })

  it('ignores trailing slashes', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })
})

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
  displayMode: 'bilingual',
  developerMode: false,
  customRules: '',
  openai: {
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
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
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.com/v1/chat/completions',
    )
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
  displayMode: 'bilingual',
  developerMode: false,
  customRules: '',
  openai: {
    apiKey: '',
    baseUrl: '',
    model: '',
    systemPrompt: '',
  },
}

const BING_PAGE = `
<html><body data-iid="translator.5023"><script>
var params_AbusePreventionHelper = [123456,"test-token",3600000];
_G={IG:"TESTIG123"};
</script></body></html>
`

function mockBingPageResponse(delay = 0) {
  return async () => {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    return { ok: true, text: async () => BING_PAGE }
  }
}

// Echo mock: translates each newline-joined line of the request text
function mockBingTranslateResponse(text: string) {
  return {
    ok: true,
    json: async () => [
      {
        translations: [
          {
            text: text
              .split('\n')
              .map((l) => `[翻译] ${l}`)
              .join('\n'),
          },
        ],
        detectedLanguage: { language: 'en' },
      },
    ],
  }
}

describe('Bing session dedup', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('concurrent translate calls should fetch the session page only once', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let pageCallCount = 0
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u === 'https://www.bing.com/translator') {
        pageCallCount++
        return mockBingPageResponse(50)()
      }
      const body = new URLSearchParams(init?.body as string)
      return mockBingTranslateResponse(body.get('text')!)
    })

    const { translate } = await import('./translator')

    await Promise.all([
      translate(['hello'], 'zh', msSettings),
      translate(['world'], 'zh', msSettings),
      translate(['foo'], 'zh', msSettings),
      translate(['bar'], 'zh', msSettings),
    ])

    expect(pageCallCount).toBe(1)
  })

  it('cached session skips the page fetch entirely', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let pageCallCount = 0
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u === 'https://www.bing.com/translator') {
        pageCallCount++
        return mockBingPageResponse(0)()
      }
      const body = new URLSearchParams(init?.body as string)
      return mockBingTranslateResponse(body.get('text')!)
    })

    const { translate } = await import('./translator')

    await translate(['first'], 'zh', msSettings)
    expect(pageCallCount).toBe(1)

    await translate(['second'], 'zh', msSettings)
    expect(pageCallCount).toBe(1)
  })

  it('session page failure rejects all waiters', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = url.toString()
      if (u === 'https://www.bing.com/translator') {
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

  it('maps the bare zh code to zh-Hans for Bing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let seenTo = ''
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u === 'https://www.bing.com/translator') {
        return mockBingPageResponse(0)()
      }
      const body = new URLSearchParams(init?.body as string)
      seenTo = body.get('to')!
      return mockBingTranslateResponse(body.get('text')!)
    })

    const { translate } = await import('./translator')
    await translate(['hello'], 'zh', msSettings)

    expect(seenTo).toBe('zh-Hans')
  })

  it('splits a text over the request limit on sentence boundaries', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const sentTexts: string[] = []
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u === 'https://www.bing.com/translator') {
        return mockBingPageResponse(0)()
      }
      const body = new URLSearchParams(init?.body as string)
      sentTexts.push(body.get('text')!)
      return mockBingTranslateResponse(body.get('text')!)
    })

    const { translate } = await import('./translator')
    const sentence = 'This is a fairly long sentence used for testing purposes. '
    const longText = sentence.repeat(30).trim() // ~1700 chars
    const result = await translate([longText], 'zh', msSettings)

    expect(sentTexts.length).toBeGreaterThan(1)
    for (const t of sentTexts) {
      expect(t.length).toBeLessThanOrEqual(950)
    }
    expect(result.texts[0]).toContain('[翻译]')
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
      if (u === 'https://www.bing.com/translator') {
        return mockBingPageResponse(0)()
      }
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      await new Promise((r) => setTimeout(r, 50))
      currentConcurrent--

      const body = new URLSearchParams(init?.body as string)
      return mockBingTranslateResponse(body.get('text')!)
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
      if (u === 'https://www.bing.com/translator') {
        return mockBingPageResponse(0)()
      }
      const body = new URLSearchParams(init?.body as string)
      return mockBingTranslateResponse(body.get('text')!)
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
      (c) => c[0].toString().includes('ttranslatev3'),
    )
    expect(translateCalls).toHaveLength(1)
    const body = new URLSearchParams(translateCalls[0][1]?.body as string)
    expect(body.get('text')!.split('\n')).toHaveLength(2)
  })
})

const impSettings: Settings = {
  provider: 'imp',
  targetLang: 'zh',
  displayMode: 'bilingual',
  developerMode: false,
  customRules: '',
  openai: {
    apiKey: '',
    baseUrl: '',
    model: '',
    systemPrompt: '',
  },
  imp: {
    apiKey: 'imp-key',
    baseUrl: 'https://imp.rxliuli.com/api/v1',
    model: 'imp-standard',
  },
}

function mockImpResponse(texts: string[], from = 'en') {
  return {
    ok: true,
    json: async () => ({
      texts,
      from,
      usage: { inputTokens: 40, outputTokens: 30, upstreamRequests: 1 },
    }),
  }
}

describe('Imp Credits translate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('POSTs {to, from, texts} to {baseUrl}/translate and returns 1:1 texts', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(mockImpResponse(['你好', '世界']))

    const { translate } = await import('./translator')
    const result = await translate(['Hello', 'World'], 'zh', impSettings)

    expect(result.texts).toEqual(['你好', '世界'])
    expect(result.detectedLang).toBe('en')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://imp.rxliuli.com/api/v1/translate',
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ to: 'zh', from: 'auto', texts: ['Hello', 'World'] })
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer imp-key')
  })

  it('throws when the Imp api key is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { translate } = await import('./translator')
    const noKey = { ...impSettings, imp: { ...impSettings.imp!, apiKey: '' } }
    await expect(translate(['Hello'], 'zh', noKey)).rejects.toThrow(
      'Connect your Imp account',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on cardinality mismatch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(mockImpResponse(['only one']))

    const { translate } = await import('./translator')
    await expect(
      translate(['Hello', 'World'], 'zh', impSettings),
    ).rejects.toThrow(/mismatched number/)
  })

  it('maps 402 to a plain message with NO external link (App Store 3.1.1)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // The real imp-credits server embeds an external top-up URL in the 402
    // body — that must never reach the user.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        error: 'insufficient balance — top up at https://imp.rxliuli.com/buy',
      }),
    })

    const { translate } = await import('./translator')
    await expect(translate(['Hello'], 'zh', impSettings)).rejects.toThrow(
      'Insufficient credits — top up on the Imp website',
    )
    const caught = await translate(['Hello'], 'zh', impSettings).catch((e: Error) => e)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).not.toMatch(/http|\/buy|imp\.rxliuli\.com/)
  })

  it('maps 401 to a reconnect message', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })

    const { translate } = await import('./translator')
    await expect(translate(['Hello'], 'zh', impSettings)).rejects.toThrow(
      'connection has expired',
    )
  })

  it('maps 429 to a rate-limit message', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'rate limit' }) })

    const { translate } = await import('./translator')
    await expect(translate(['Hello'], 'zh', impSettings)).rejects.toThrow(
      'Rate limited',
    )
  })
})

describe('segment translation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  const SEGMENTS = ['Click ', 'here', ' for <new> details & more']
  const ENCODED =
    '<i id="0">Click </i><i id="1">here</i><i id="2"> for &lt;new&gt; details &amp; more</i>'

  async function setup(settings: Settings) {
    const { translate } = await import('./translator')
    const { translateSegmentsVia, guardSegmentTranslator } = await import(
      './translate-service'
    )
    const translator = guardSegmentTranslator(async (texts, lang) => {
      const result = await translate(texts, lang, settings, { segments: true })
      return result.texts
    })
    const full = (segments: string[]) =>
      translateSegmentsVia(segments, 'zh', async (encoded, lang) => {
        const [out] = await translator([encoded], lang)
        return out
      })
    const run = async (segments: string[]) => (await full(segments)).segments
    return Object.assign(run, { full })
  }

  function mockGoogleResponse(texts: string[]) {
    return { ok: true, json: async () => [texts, ['en']] }
  }

  const googleSettings: Settings = { ...openaiSettings, provider: 'google' }

  it('google: sends the encoded HTML unescaped and keeps reordered tags in output order', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockGoogleResponse([
        '<i id="2">有关&lt;新&gt;详情&amp;更多，</i> <i id="0">点击</i><i id="1">这里</i>。',
      ]),
    )
    const run = await setup(googleSettings)
    // Segments come back in output (reading) order; text outside the tags
    // (space, trailing 。) merges onto the preceding segment.
    expect(await run(SEGMENTS)).toEqual(['有关<新>详情&更多， ', '点击', '这里。'])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body[0][0]).toEqual([ENCODED])
  })

  it('google: keeps citation markers verbatim and does not send them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockGoogleResponse(['<i id="0">创造性作品</i><i id="1">，例如</i><i id="2">艺术作品</i>']),
    )
    const run = await setup(googleSettings)
    const segments = ['creative work', '[', '1', ']', ', such as a ', 'work of art', '[', '12', ']']
    expect(await run(segments)).toEqual([
      '创造性作品', '[', '1', ']', '，例如', '艺术作品', '[', '12', ']',
    ])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body[0][0]).toEqual([
      '<i id="0">creative work</i><i id="1">, such as a </i><i id="2">work of art</i>',
    ])
  })

  it('google: decodes a well-formed response', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockGoogleResponse([
        '<i id="0">点击</i><i id="1">这里</i> <i id="2">查看&lt;新&gt;详情&amp;更多</i>',
      ]),
    )
    const run = await setup(googleSettings)
    expect(await run(SEGMENTS)).toEqual(['点击', '这里 ', '查看<新>详情&更多'])
  })

  it('google: plain translate path still escapes and decodes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(mockGoogleResponse(['&lt;b&gt; 你好']))
    const { translate } = await import('./translator')
    const result = await translate(['<b> hi'], 'zh', googleSettings)
    expect(result.texts).toEqual(['<b> 你好'])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body[0][0]).toEqual(['&lt;b&gt; hi'])
  })

  it('blank segments are passed through and left out of the request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockGoogleResponse(['<i id="0">你好</i><i id="1">世界</i>']),
    )
    const run = await setup(googleSettings)
    expect(await run(['Hello', ' ', 'world', ''])).toEqual(['你好', ' ', '世界', ''])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body[0][0]).toEqual(['<i id="0">Hello</i><i id="1">world</i>'])
  })

  it('all-blank segments return without a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const run = await setup(googleSettings)
    expect(await run([' ', ''])).toEqual([' ', ''])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('openai: appends the segment instructions and decodes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse('<i id="1">这里</i><i id="0">点击</i><i id="2">查看详情</i>'),
    )
    const run = await setup(openaiSettings)
    expect(await run(SEGMENTS)).toEqual(['这里', '点击', '查看详情'])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toContain('<i id="N">')
    expect(body.messages[1].content).toBe(ENCODED)
  })

  it('openai: batched segment texts survive the outer <t> packing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse(
        '<t id="0"><i id="0">你好</i><i id="1">世界</i></t>\n<t id="1"><i id="0">再见</i></t>',
      ),
    )
    const { translate } = await import('./translator')
    const result = await translate(
      ['<i id="0">Hello</i><i id="1">world</i>', '<i id="0">Bye</i>'],
      'zh',
      openaiSettings,
      { segments: true },
    )
    expect(result.texts).toEqual([
      '<i id="0">你好</i><i id="1">世界</i>',
      '<i id="0">再见</i>',
    ])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toContain('<t id="N">')
    expect(body.messages[0].content).toContain('<i id="N">')
  })

  it('openai: merged tags return null segments but keep the raw output', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse('```html\n<i id="0">点击这里</i><i id="2">查看详情</i>\n```'),
    )
    const run = await setup(openaiSettings)
    expect(await run.full(SEGMENTS)).toEqual({
      segments: null,
      html: '<i id="0">点击这里</i><i id="2">查看详情</i>',
      sentIndices: [0, 1, 2],
      reason: 'missing ids 1',
    })
  })

  it('openai: untranslated (echoed) input returns no segments and no html', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(mockOpenAIResponse(ENCODED))
    const run = await setup(openaiSettings)
    expect(await run.full(SEGMENTS)).toEqual({
      segments: null,
      html: null,
      sentIndices: [0, 1, 2],
      reason: 'translation declined (output unchanged)',
    })
  })

  it('openai: a tagless translation is kept as html for a plain-text rewrite', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(mockOpenAIResponse('点击这里查看&lt;新&gt;详情'))
    const run = await setup(openaiSettings)
    expect(await run.full(SEGMENTS)).toEqual({
      segments: null,
      html: '点击这里查看&lt;新&gt;详情',
      sentIndices: [0, 1, 2],
      reason: 'engine dropped all tags',
    })
  })

  it('openai: a tagless output over 3x a long source is treated as declined', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Source text is 34 characters: the length check applies at any length.
    fetchMock.mockResolvedValue(mockOpenAIResponse('x'.repeat(110)))
    const run = await setup(openaiSettings)
    expect((await run.full(SEGMENTS)).html).toBeNull()
  })

  it('openai: a tagless explanation of a short source is treated as declined', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockOpenAIResponse('This text is a short UI label and cannot be translated meaningfully.'),
    )
    const run = await setup(openaiSettings)
    expect(await run.full(['Go ', 'home'])).toEqual({
      segments: null,
      html: null,
      sentIndices: [0, 1],
      reason: 'translation declined (output unchanged)',
    })
  })

  it('an emptied word-bearing segment rejects the mapping; an emptied punctuation one clears', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(
      mockGoogleResponse(['<i id="0">苹果</i><i id="1"></i><i id="2">梨</i>']),
    )
    const run = await setup(googleSettings)
    // ", " has no letters: its node is cleared.
    expect(await run.full(['Apples', ', ', 'pears'])).toEqual({
      segments: ['苹果', '', '梨'],
      html: '<i id="0">苹果</i><i id="1"></i><i id="2">梨</i>',
      sentIndices: [0, 1, 2],
      reason: null,
    })
    fetchMock.mockResolvedValueOnce(
      mockGoogleResponse(['<i id="1">红色的</i><i id="2">汽车</i><i id="0"></i>']),
    )
    // Pieces are written back by position, so the third node (" car", which
    // has letters) would go blank: the output can't be poured into the nodes.
    // The reason names the source of the tag that came back empty (id 0).
    expect(await run.full(['The ', 'red', ' car'])).toEqual({
      segments: null,
      html: '<i id="1">红色的</i><i id="2">汽车</i><i id="0"></i>',
      sentIndices: [0, 1, 2],
      reason: "empty segment for 'The'",
    })
  })

  it('imp: sends the encoded string as-is and decodes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockImpResponse(['<i id="0">点击</i><i id="1">这里</i><i id="2">查看详情</i>']),
    )
    const run = await setup(impSettings)
    expect(await run(SEGMENTS)).toEqual(['点击', '这里', '查看详情'])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.texts).toEqual([ENCODED])
  })

  it('imp: duplicate ids return null segments', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockImpResponse(['<i id="0">点击</i><i id="0">这里</i><i id="2">查看详情</i>']),
    )
    const run = await setup(impSettings)
    expect(await run(SEGMENTS)).toBeNull()
  })

  // The background's segment pipeline: translate service (with a cache) over
  // the guarded provider translator, fed by translateSegmentsVia.
  async function setupCached(settings: Settings) {
    const { translate } = await import('./translator')
    const { createTranslateService, translateSegmentsVia, guardSegmentTranslator } =
      await import('./translate-service')
    const cache = new Map<string, string>()
    const service = createTranslateService({
      getCached: async (text, lang) => cache.get(`${lang}:${text}`),
      setCached: async (text, lang, out) => void cache.set(`${lang}:${text}`, out),
      translator: guardSegmentTranslator(
        async (texts, lang) => (await translate(texts, lang, settings, { segments: true })).texts,
      ),
      batchWindowMs: 1,
      maxBatchSize: 20,
    })
    return {
      cache,
      run: (segments: string[]) =>
        translateSegmentsVia(segments, 'zh', (encoded, lang) => service.translate(encoded, lang)),
    }
  }

  const PARA = ['The ', 'red', ' car']
  const PARA_ENCODED = '<i id="0">The </i><i id="1">red</i><i id="2"> car</i>'
  // Outputs that need the structural rewrite must be cached too: a reload
  // would otherwise re-request every such paragraph.
  const REWRITE_OUTPUTS: [string, string][] = [
    ['emptied piece', '<i id="1">红色的</i><i id="2">汽车</i><i id="0"></i>'],
    ['missing id', '<i id="1">红色的</i><i id="2">汽车</i>'],
    ['no tags', '红色的汽车'],
  ]

  for (const [label, output] of REWRITE_OUTPUTS) {
    for (const provider of ['google', 'microsoft', 'imp'] as const) {
      it(`${provider}: a rewrite-bound output (${label}) is cached and replays identically`, async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        let requests = 0
        fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
          const u = url.toString()
          if (u === 'https://www.bing.com/translator') return mockBingPageResponse()()
          requests++
          if (provider === 'google') {
            expect(JSON.parse(init!.body as string)[0][0]).toEqual([PARA_ENCODED])
            return mockGoogleResponse([output])
          }
          if (provider === 'imp') {
            expect(JSON.parse(init!.body as string).texts).toEqual([PARA_ENCODED])
            return mockImpResponse([output])
          }
          expect(new URLSearchParams(init!.body as string).get('text')).toBe(PARA_ENCODED)
          return { ok: true, json: async () => [{ translations: [{ text: output }] }] }
        })
        const settings =
          provider === 'google' ? googleSettings : provider === 'imp' ? impSettings : msSettings
        const { cache, run } = await setupCached(settings)
        const first = await run(PARA)
        expect(first.segments).toBeNull()
        expect(first.html).toBe(output)
        expect(cache.get(`zh:${PARA_ENCODED}`)).toBe(output)
        const second = await run(PARA)
        expect(requests).toBe(1)
        expect(second).toEqual(first)
      })
    }
  }

  it('a mappable output is cached and replays identically', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      mockGoogleResponse(['<i id="1">红色的</i><i id="0">那</i><i id="2">汽车</i>']),
    )
    const { run } = await setupCached(googleSettings)
    const first = await run(PARA)
    expect(first.segments).toEqual(['红色的', '那', '汽车'])
    expect(await run(PARA)).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an echoed or explanation output is not cached', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(mockGoogleResponse([PARA_ENCODED]))
      .mockResolvedValueOnce(mockGoogleResponse(['This is a phrase about a car that is red.']))
      .mockResolvedValueOnce(mockGoogleResponse(['红色的汽车']))
    const { cache, run } = await setupCached(googleSettings)
    expect((await run(PARA)).html).toBeNull()
    expect((await run(PARA)).html).toBeNull()
    expect(cache.size).toBe(0)
    expect((await run(PARA)).html).toBe('红色的汽车')
    expect(cache.size).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  function mockBing(reply: (text: string) => string) {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const sent: string[] = []
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (url.toString() === 'https://www.bing.com/translator') return mockBingPageResponse()()
      const text = new URLSearchParams(init?.body as string).get('text')!
      sent.push(text)
      return {
        ok: true,
        json: async () => [{ translations: [{ text: reply(text) }] }],
      }
    })
    return sent
  }

  it('microsoft: supports segments, one request per text, no newline packing', async () => {
    const { PROVIDER_CAPABILITIES } = await import('./translator')
    expect(PROVIDER_CAPABILITIES.microsoft.supportsSegments).toBe(true)
    expect(PROVIDER_CAPABILITIES.google.supportsSegments).toBe(true)
    expect(PROVIDER_CAPABILITIES.openai.supportsSegments).toBe(true)
    expect(PROVIDER_CAPABILITIES.imp.supportsSegments).toBe(true)
    // Real ttranslatev3 output for this input: tags refilled in source order.
    const sent = mockBing((text) =>
      text === '<i id="0">The </i><i id="1">red</i><i id="2"> car of my friend is fast.</i>'
        ? '<i id="0">我朋友的</i><i id="1">红色</i><i id="2">汽车很快。</i>'
        : text,
    )
    const run = await setup(msSettings)
    expect(await run(['The ', 'red', ' car of my friend is fast.'])).toEqual([
      '我朋友的',
      '红色',
      '汽车很快。',
    ])
    const { translate } = await import('./translator')
    const multi = ['<i id="0">a\nb</i>', '<i id="0">c</i>']
    expect((await translate(multi, 'zh', msSettings, { segments: true })).texts).toEqual(multi)
    expect(sent.slice(1)).toEqual(multi)
  })

  it('microsoft: at most 4 segment requests in flight', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (url.toString() === 'https://www.bing.com/translator') return mockBingPageResponse()()
      calls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      const text = new URLSearchParams(init?.body as string).get('text')!
      return { ok: true, json: async () => [{ translations: [{ text }] }] }
    })
    const { translate } = await import('./translator')
    const texts = Array.from({ length: 10 }, (_, i) => `<i id="0">t${i}</i>`)
    const long = Array.from({ length: 6 }, (_, i) => `<i id="${i}">${'x'.repeat(400)}</i>`).join('')
    const [a, b] = await Promise.all([
      translate(texts, 'zh', msSettings, { segments: true }),
      translate([long], 'zh', msSettings, { segments: true }),
    ])
    expect(a.texts).toEqual(texts)
    expect(b.texts).toEqual([long])
    expect(calls).toBe(13)
    expect(maxInFlight).toBe(4)
  })

  it('microsoft: splits an over-limit segment text between whole tags', async () => {
    const sent = mockBing((text) => text.replace(/<i id="(\d+)">/g, '<i id="$1">译'))
    const { translate } = await import('./translator')
    const long = Array.from({ length: 4 }, (_, i) => `<i id="${i}">${'x'.repeat(400)}</i>`).join('')
    const result = await translate([long], 'zh', msSettings, { segments: true })
    expect(sent).toHaveLength(2)
    expect(sent.every((t) => t.length <= 950 && /^(<i id="\d+">x+<\/i>)+$/.test(t))).toBe(true)
    expect(result.texts[0]).toBe(long.replace(/<i id="(\d+)">/g, '<i id="$1">译'))
    // A single tag over the limit can't be split: declined (input returned).
    const huge = `<i id="0">${'y'.repeat(1000)}</i>`
    expect((await translate([huge], 'zh', msSettings, { segments: true })).texts).toEqual([huge])
    expect(sent).toHaveLength(2)
  })
})
