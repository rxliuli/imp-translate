import { describe, it, expect, vi, beforeEach } from 'vitest'

const localStore = new Map<string, unknown>()

vi.stubGlobal('browser', {
  storage: {
    local: {
      get: async (key: string) => {
        const val = localStore.get(key)
        return val !== undefined ? { [key]: val } : {}
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          localStore.set(k, v)
        }
      },
    },
  },
})

describe('storage', () => {
  beforeEach(() => {
    localStore.clear()
    vi.resetModules()
  })

  it('getSettings returns defaults when nothing stored', async () => {
    const { getSettings } = await import('./storage')
    const settings = await getSettings()
    expect(settings.provider).toBe('microsoft')
    expect(settings.targetLang).toBeTruthy()
    expect(settings.openai.model).toBe('gpt-4o-mini')
  })

  it('saveSettings only persists provided fields', async () => {
    const { saveSettings } = await import('./storage')
    await saveSettings({ targetLang: 'ja' })
    const raw = localStore.get('settings') as Record<string, unknown>
    expect(raw).toEqual({ targetLang: 'ja' })
  })

  it('unmodified fields still fallback to defaults', async () => {
    const { saveSettings, getSettings } = await import('./storage')
    await saveSettings({ targetLang: 'ja' })
    const settings = await getSettings()
    expect(settings.targetLang).toBe('ja')
    expect(settings.provider).toBe('microsoft')
    expect(settings.openai.model).toBe('gpt-4o-mini')
  })

  it('multiple partial saves accumulate without overwriting', async () => {
    const { saveSettings, getSettings } = await import('./storage')
    await saveSettings({ targetLang: 'ja' })
    await saveSettings({ provider: 'google' })
    const raw = localStore.get('settings') as Record<string, unknown>
    expect(raw).toEqual({ targetLang: 'ja', provider: 'google' })
    const settings = await getSettings()
    expect(settings.targetLang).toBe('ja')
    expect(settings.provider).toBe('google')
  })

  it('saving nested openai config persists correctly', async () => {
    const { saveSettings, getSettings } = await import('./storage')
    const openai = {
      apiKey: 'sk-test',
      baseUrl: 'https://custom.api/v1',
      model: 'gpt-4o',
      systemPrompt: 'Translate to {{targetLang}}.',
    }
    await saveSettings({ openai })
    const settings = await getSettings()
    expect(settings.openai).toEqual(openai)
    expect(settings.provider).toBe('microsoft')
  })
})

describe('legacy endpoint migration', () => {
  beforeEach(() => {
    localStore.clear()
    vi.resetModules()
  })

  const legacyOpenAI = {
    apiKey: 'sk-test',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    systemPrompt: 'Translate.',
  }

  it('getSettings strips /chat/completions into baseUrl and persists', async () => {
    localStore.set('settings', { openai: legacyOpenAI })
    const { getSettings } = await import('./storage')
    const settings = await getSettings()
    expect(settings.openai.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(settings.openai).not.toHaveProperty('endpoint')
    const raw = localStore.get('settings') as { openai: Record<string, unknown> }
    expect(raw.openai.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(raw.openai).not.toHaveProperty('endpoint')
  })

  it('keeps a legacy endpoint without the standard suffix verbatim', async () => {
    localStore.set('settings', {
      openai: { ...legacyOpenAI, endpoint: 'https://gateway.local/openai' },
    })
    const { getSettings } = await import('./storage')
    const settings = await getSettings()
    expect(settings.openai.baseUrl).toBe('https://gateway.local/openai')
  })

  it('strips trailing slash left after removing the suffix', async () => {
    localStore.set('settings', {
      openai: { ...legacyOpenAI, endpoint: 'https://api.example.com/v1/chat/completions/' },
    })
    const { getSettings } = await import('./storage')
    const settings = await getSettings()
    expect(settings.openai.baseUrl).toBe('https://api.example.com/v1')
  })

  it('saveSettings migrates the stored legacy value before merging', async () => {
    localStore.set('settings', { openai: legacyOpenAI })
    const { saveSettings } = await import('./storage')
    await saveSettings({ targetLang: 'ja' })
    const raw = localStore.get('settings') as { openai: Record<string, unknown> }
    expect(raw.openai.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(raw.openai).not.toHaveProperty('endpoint')
  })

  it('does not rewrite storage when nothing to migrate', async () => {
    const setSpy = vi.fn()
    localStore.set('settings', {
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://a.b/v1',
        model: 'gpt-4o',
        systemPrompt: 'Translate.',
      },
    })
    const { getSettings } = await import('./storage')
    const orig = (globalThis as any).browser.storage.local.set
    ;(globalThis as any).browser.storage.local.set = setSpy
    try {
      await getSettings()
    } finally {
      ;(globalThis as any).browser.storage.local.set = orig
    }
    expect(setSpy).not.toHaveBeenCalled()
  })
})
