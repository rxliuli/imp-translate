import { describe, it, expect } from 'vitest'
import { isUrlOnly } from './utils'

describe('isUrlOnly', () => {
  it.each([
    'https://ismy.blue/',
    'http://example.com',
    'https://example.com/path?q=1&x=2#hash',
    'https://sub.domain.example.co.uk/a/b',
  ])('matches pure URL: %s', (text) => {
    expect(isUrlOnly(text)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['bare domain (no protocol)', 'ismy.blue'],
    ['URL inside sentence', 'Check out https://example.com for details'],
    ['URL with trailing text', 'https://example.com extra'],
    ['URL with leading text', 'See https://example.com'],
    ['plain text', 'Hello world'],
    ['unsupported scheme', 'ftp://example.com'],
    ['mailto', 'mailto:foo@example.com'],
    ['internal whitespace', 'https://example.com /foo'],
    ['leading whitespace', '  https://example.com'],
  ])('rejects %s', (_label, text) => {
    expect(isUrlOnly(text)).toBe(false)
  })
})
