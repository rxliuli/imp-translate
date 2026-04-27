import { get, set, keys, del, clear, createStore } from 'idb-keyval'

const store = createStore('imp-translate-cache', 'translations')

interface CacheEntry {
  text: string
  ts: number
}

const MAX_ENTRIES = 10000
const MAX_AGE = 7 * 24 * 60 * 60 * 1000

function cacheKey(text: string, targetLang: string): string {
  return `${targetLang}:${text}`
}

export async function getCached(text: string, targetLang: string): Promise<string | undefined> {
  const entry = await get<CacheEntry>(cacheKey(text, targetLang), store)
  if (!entry) return undefined
  if (Date.now() - entry.ts > MAX_AGE) {
    await del(cacheKey(text, targetLang), store)
    return undefined
  }
  return entry.text
}

export async function setCached(text: string, targetLang: string, translated: string): Promise<void> {
  await set(cacheKey(text, targetLang), { text: translated, ts: Date.now() } satisfies CacheEntry, store)
}

export async function clearCache(): Promise<void> {
  await clear(store)
}

export async function evictOldEntries(): Promise<void> {
  const allKeys = await keys<string>(store)
  if (allKeys.length <= MAX_ENTRIES) return
  const toDelete = allKeys.slice(0, allKeys.length - MAX_ENTRIES)
  await Promise.all(toDelete.map((k) => del(k, store)))
}
