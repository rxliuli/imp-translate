export type TranslationProvider = 'microsoft' | 'google' | 'openai' | 'imp'

// bilingual: append the translation below the original text.
// replace: swap the original text for the translation in place.
export type DisplayMode = 'bilingual' | 'replace'

export interface ImpProvider {
  apiKey: string
  baseUrl: string
  model: string
}

export interface OpenAIConfig {
  apiKey: string
  baseUrl: string
  model: string
  systemPrompt: string
}

export interface Settings {
  provider: TranslationProvider
  targetLang: string
  displayMode: DisplayMode
  openai: OpenAIConfig
  imp?: ImpProvider // filled in automatically by the connect flow
  developerMode: boolean
  customRules: string
}

const DEFAULT_SETTINGS: Settings = {
  provider: 'google',
  targetLang: navigator.language.split('-')[0] || 'zh',
  displayMode: 'bilingual',
  developerMode: false,
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

// Fields older versions stored that no longer exist (debugMode was merged
// into developerMode): dropped from what callers see, and from storage on
// the next save. No migration — the old value is simply discarded.
const REMOVED_KEYS = ['debugMode']

function dropRemoved<T extends object>(raw: T): T {
  if (!REMOVED_KEYS.some((k) => k in raw)) return raw
  const out = { ...raw } as Record<string, unknown>
  for (const k of REMOVED_KEYS) delete out[k]
  return out as T
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings')
  if (!stored.settings) return { ...DEFAULT_SETTINGS }
  const raw = stored.settings as Partial<Settings>
  const migrated = migrateLegacyEndpoint(raw)
  if (migrated !== raw) await browser.storage.local.set({ settings: migrated })
  return { ...DEFAULT_SETTINGS, ...dropRemoved(migrated) }
}

export async function saveSettings(
  settings: Partial<Settings>,
): Promise<Settings> {
  const stored = await browser.storage.local.get('settings')
  const raw = migrateLegacyEndpoint((stored.settings ?? {}) as Partial<Settings>)
  const merged = dropRemoved({ ...raw, ...settings })
  await browser.storage.local.set({ settings: merged })
  return { ...DEFAULT_SETTINGS, ...merged }
}
