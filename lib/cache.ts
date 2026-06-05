import { type DBSchema, openDB, deleteDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'imp-translate'
const DB_VERSION = 1

const MAX_ENTRIES = 10000
const MAX_AGE = 30 * 24 * 60 * 60 * 1000

interface CacheSchema extends DBSchema {
  translations: {
    key: string
    value: {
      key: string
      text: string
      ts: number
    }
    indexes: { ts: number }
  }
}

let dbPromise: Promise<IDBPDatabase<CacheSchema>> | undefined

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<CacheSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('translations', { keyPath: 'key' })
        store.createIndex('ts', 'ts')
      },
    })
  }
  return dbPromise
}

function cacheKey(text: string, targetLang: string): string {
  return `${targetLang}:${text}`
}

export async function getCached(
  text: string,
  targetLang: string,
): Promise<string | undefined> {
  const db = await getDB()
  const entry = await db.get('translations', cacheKey(text, targetLang))
  if (!entry) return undefined
  if (Date.now() - entry.ts > MAX_AGE) return undefined
  return entry.text
}

export async function setCached(
  text: string,
  targetLang: string,
  translated: string,
): Promise<void> {
  const db = await getDB()
  await db.put('translations', {
    key: cacheKey(text, targetLang),
    text: translated,
    ts: Date.now(),
  })
}

export async function clearCache(): Promise<void> {
  const db = await getDB()
  await db.clear('translations')
}

export async function evictOldEntries(): Promise<void> {
  const db = await getDB()
  const cutoff = Date.now() - MAX_AGE
  const tx = db.transaction('translations', 'readwrite')
  const index = tx.store.index('ts')
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }

  const count = await tx.store.count()
  if (count > MAX_ENTRIES) {
    let excess = count - MAX_ENTRIES
    let oldest = await index.openCursor()
    while (oldest && excess > 0) {
      await oldest.delete()
      excess--
      oldest = await oldest.continue()
    }
  }

  await tx.done
  // Legacy DB from idb-keyval era; safe to remove once most users have upgraded
  await deleteDB('imp-translate-cache')
}
