import { describe, it, expect } from 'vitest'
import { isPdfUrl, isUrlOnly } from './utils'

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

describe('isPdfUrl', () => {
  it.each([
    'https://example.com/paper.pdf',
    'https://example.com/dir/Paper.PDF',
    'https://example.com/paper.pdf?download=1',
    'http://example.com/paper.pdf#page=2',
  ])('matches %s', (url) => {
    expect(isPdfUrl(url)).toBe(true)
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['html page', 'https://example.com/'],
    ['pdf in a query string', 'https://example.com/view?file=paper.pdf'],
    ['pdf as a directory', 'https://example.com/paper.pdf/'],
    ['not a URL', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(isPdfUrl(url as string | undefined)).toBe(false)
  })
})
