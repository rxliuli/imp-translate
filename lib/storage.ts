export type TranslationProvider = 'microsoft' | 'google' | 'openai'

export interface OpenAIConfig {
  apiKey: string
  baseUrl: string
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
  provider: 'google',
  targetLang: navigator.language.split('-')[0] || 'zh',
  developerMode: false,
  debugMode: false,
  customRules: '',
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    systemPrompt:
      'You are a translator. Translate the following text to {{targetLang}}. Return only the translation, no explanations. If the text cannot be translated, return it unchanged.',
  },
}

// Versions ≤0.0.51 stored a full URL (".../v1/chat/completions") under
// openai.endpoint; baseUrl replaced it and /chat/completions is now appended
// at request time. Returns the input object unchanged when no legacy key.
function migrateLegacyEndpoint(raw: Partial<Settings>): Partial<Settings> {
  const openai = raw.openai as
    | (OpenAIConfig & { endpoint?: string })
    | undefined
  if (!openai || openai.endpoint === undefined) return raw
  const { endpoint, ...rest } = openai
  const baseUrl =
    rest.baseUrl ??
    endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '')
  return { ...raw, openai: { ...rest, baseUrl } }
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings')
  if (!stored.settings) return { ...DEFAULT_SETTINGS }
  const raw = stored.settings as Partial<Settings>
  const migrated = migrateLegacyEndpoint(raw)
  if (migrated !== raw) await browser.storage.local.set({ settings: migrated })
  return { ...DEFAULT_SETTINGS, ...migrated }
}

export async function saveSettings(
  settings: Partial<Settings>,
): Promise<Settings> {
  const stored = await browser.storage.local.get('settings')
  const raw = migrateLegacyEndpoint((stored.settings ?? {}) as Partial<Settings>)
  const merged = { ...raw, ...settings }
  await browser.storage.local.set({ settings: merged })
  return { ...DEFAULT_SETTINGS, ...merged }
}
