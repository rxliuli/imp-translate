const LANGUAGES_UNSORTED: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
  uk: 'Українська',
  cs: 'Čeština',
  sv: 'Svenska',
}

export const LANGUAGES_SORTED = Object.entries(LANGUAGES_UNSORTED)
  .sort(([, a], [, b]) => a.localeCompare(b))
