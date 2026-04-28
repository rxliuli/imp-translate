export type TranslationProvider = 'microsoft' | 'google' | 'openai'

export interface OpenAIConfig {
  apiKey: string
  endpoint: string
  model: string
  systemPrompt: string
}

export interface Settings {
  provider: TranslationProvider
  targetLang: string
  openai: OpenAIConfig
  developerMode: boolean
  customRules: string
  debugMode: boolean
}

const DEFAULT_SETTINGS: Settings = {
  provider: 'microsoft',
  targetLang: navigator.language.split('-')[0] || 'zh',
  developerMode: false,
  debugMode: false,
  customRules: '',
  openai: {
    apiKey: '',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    systemPrompt:
      'You are a translator. Translate the following text to {{targetLang}}. Return only the translation, no explanations.',
  },
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get('settings')
  if (!stored.settings) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...stored.settings }
}

export async function saveSettings(
  settings: Partial<Settings>,
): Promise<Settings> {
  const stored = await browser.storage.sync.get('settings')
  const raw = (stored.settings ?? {}) as Partial<Settings>
  const merged = { ...raw, ...settings }
  await browser.storage.sync.set({ settings: merged })
  return { ...DEFAULT_SETTINGS, ...merged }
}
