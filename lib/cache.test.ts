import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { getCached, setCached, evictOldEntries, clearCache } from './cache'

describe('cache', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))
    await clearCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return undefined for uncached text', async () => {
    expect(await getCached('hello', 'zh')).toBeUndefined()
  })

  it('should return cached translation', async () => {
    await setCached('hello', 'zh', '你好')
    expect(await getCached('hello', 'zh')).toBe('你好')
  })

  it('should separate cache by target language', async () => {
    await setCached('hello', 'zh', '你好')
    await setCached('hello', 'ja', 'こんにちは')
    expect(await getCached('hello', 'zh')).toBe('你好')
    expect(await getCached('hello', 'ja')).toBe('こんにちは')
  })

  it('should return undefined for expired entries', async () => {
    await setCached('hello', 'zh', '你好')
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)
    expect(await getCached('hello', 'zh')).toBeUndefined()
  })

  it('should evict expired entries by timestamp index', async () => {
    await setCached('old1', 'zh', '旧1')
    await setCached('old2', 'zh', '旧2')

    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)
    await setCached('new1', 'zh', '新1')

    await evictOldEntries()

    expect(await getCached('old1', 'zh')).toBeUndefined()
    expect(await getCached('old2', 'zh')).toBeUndefined()
    expect(await getCached('new1', 'zh')).toBe('新1')
  })

  it('should keep fresh entries when evicting', async () => {
    await setCached('a', 'zh', '甲')
    await setCached('b', 'zh', '乙')
    await evictOldEntries()
    expect(await getCached('a', 'zh')).toBe('甲')
    expect(await getCached('b', 'zh')).toBe('乙')
  })
})
