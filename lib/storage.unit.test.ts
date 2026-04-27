import { describe, it, expect, vi, beforeEach } from 'vitest'

const syncStore = new Map<string, unknown>()

vi.stubGlobal('browser', {
  storage: {
    sync: {
      get: async (key: string) => {
        const val = syncStore.get(key)
        return val !== undefined ? { [key]: val } : {}
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          syncStore.set(k, v)
        }
      },
    },
  },
})

describe('storage', () => {
  beforeEach(() => {
    syncStore.clear()
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
    const raw = syncStore.get('settings') as Record<string, unknown>
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
    const raw = syncStore.get('settings') as Record<string, unknown>
    expect(raw).toEqual({ targetLang: 'ja', provider: 'google' })
    const settings = await getSettings()
    expect(settings.targetLang).toBe('ja')
    expect(settings.provider).toBe('google')
  })

  it('saving nested openai config persists correctly', async () => {
    const { saveSettings, getSettings } = await import('./storage')
    const openai = {
      apiKey: 'sk-test',
      endpoint: 'https://custom.api/v1/chat/completions',
      model: 'gpt-4o',
      systemPrompt: 'Translate to {{targetLang}}.',
    }
    await saveSettings({ openai })
    const settings = await getSettings()
    expect(settings.openai).toEqual(openai)
    expect(settings.provider).toBe('microsoft')
  })
})
