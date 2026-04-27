import { describe, expect, it } from 'vitest'
import { parseRules, matchRulesForDomain } from './rules'

describe('parseRules', () => {
  it('parses skip rules', () => {
    const rules = parseRules('reddit.com##[id="expand-search-button"]')
    expect(rules).toEqual([
      { domain: 'reddit.com', selector: '[id="expand-search-button"]' },
    ])
  })

  it('ignores comments and empty lines', () => {
    const raw = `
! This is a comment
reddit.com##.search-btn

! Another comment
twitter.com##[data-testid="tweetButton"]
`
    const rules = parseRules(raw)
    expect(rules).toHaveLength(2)
    expect(rules[0].domain).toBe('reddit.com')
    expect(rules[1].domain).toBe('twitter.com')
  })

  it('ignores lines without ## separator', () => {
    const rules = parseRules('not a valid rule\nreddit.com##.btn')
    expect(rules).toHaveLength(1)
  })
})

describe('matchRulesForDomain', () => {
  const rules = parseRules(`
reddit.com##.search-btn
twitter.com##.tweet-btn
youtube.com##.ad
`)

  it('matches exact domain', () => {
    const matched = matchRulesForDomain(rules, 'reddit.com')
    expect(matched).toEqual(['.search-btn'])
  })

  it('matches subdomain', () => {
    const matched = matchRulesForDomain(rules, 'www.reddit.com')
    expect(matched).toEqual(['.search-btn'])
  })

  it('returns empty for unmatched domain', () => {
    const matched = matchRulesForDomain(rules, 'example.com')
    expect(matched).toHaveLength(0)
  })
})
