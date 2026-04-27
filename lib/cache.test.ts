import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getCached, setCached, evictOldEntries, clearCache } from './cache'

describe('cache', () => {
  beforeEach(async () => {
    await clearCache()
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
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.now() + 8 * 24 * 60 * 60 * 1000,
    )
    expect(await getCached('hello', 'zh')).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('should not throw when evicting under limit', async () => {
    await setCached('a', 'zh', '甲')
    await setCached('b', 'zh', '乙')
    await evictOldEntries()
    expect(await getCached('a', 'zh')).toBe('甲')
    expect(await getCached('b', 'zh')).toBe('乙')
  })
})
