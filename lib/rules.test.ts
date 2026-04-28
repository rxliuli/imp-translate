import { describe, expect, it } from 'vitest'
import { parseRules, matchRulesForDomain } from './rules'

describe('parseRules', () => {
  it('parses exclude rules', () => {
    const rules = parseRules('reddit.com##[id="expand-search-button"]')
    expect(rules).toEqual([
      { domain: 'reddit.com', selector: '[id="expand-search-button"]', type: 'exclude' },
    ])
  })

  it('parses include rules', () => {
    const rules = parseRules('x.com#+#[data-testid="tweetText"]')
    expect(rules).toEqual([
      { domain: 'x.com', selector: '[data-testid="tweetText"]', type: 'include' },
    ])
  })

  it('parses mixed include and exclude rules', () => {
    const raw = `
reddit.com##.search-btn
reddit.com#+#[slot="text-body"]
`
    const rules = parseRules(raw)
    expect(rules).toHaveLength(2)
    expect(rules[0].type).toBe('exclude')
    expect(rules[1].type).toBe('include')
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

  it('ignores lines without separator', () => {
    const rules = parseRules('not a valid rule\nreddit.com##.btn')
    expect(rules).toHaveLength(1)
  })
})

describe('matchRulesForDomain', () => {
  const rules = parseRules(`
reddit.com##.search-btn
reddit.com#+#[slot="text-body"]
reddit.com#+#[slot="title"]
twitter.com##.tweet-btn
`)

  it('separates skip and include selectors', () => {
    const matched = matchRulesForDomain(rules, 'reddit.com')
    expect(matched.skipSelectors).toEqual(['.search-btn'])
    expect(matched.includeSelectors).toEqual(['[slot="text-body"]', '[slot="title"]'])
  })

  it('matches subdomain', () => {
    const matched = matchRulesForDomain(rules, 'www.reddit.com')
    expect(matched.skipSelectors).toEqual(['.search-btn'])
    expect(matched.includeSelectors).toEqual(['[slot="text-body"]', '[slot="title"]'])
  })

  it('returns empty arrays for unmatched domain', () => {
    const matched = matchRulesForDomain(rules, 'example.com')
    expect(matched.skipSelectors).toHaveLength(0)
    expect(matched.includeSelectors).toHaveLength(0)
  })

  it('does not match different TLD when rule is exact', () => {
    const matched = matchRulesForDomain(rules, 'reddit.com.hk')
    expect(matched.skipSelectors).toHaveLength(0)
  })
})

describe('entity matching with .*', () => {
  const rules = parseRules(`
google.*##[role="navigation"]
google.*#+#[id="rcnt"]
mail.google.*##.gmail-toolbar
`)

  it('matches the same entity across TLDs', () => {
    expect(matchRulesForDomain(rules, 'google.com').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForDomain(rules, 'google.com.hk').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForDomain(rules, 'google.co.uk').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForDomain(rules, 'google.de').skipSelectors).toContain('[role="navigation"]')
  })

  it('matches subdomains of entity-pattern hostnames', () => {
    expect(matchRulesForDomain(rules, 'www.google.com').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForDomain(rules, 'www.google.com.hk').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForDomain(rules, 'mail.google.de').skipSelectors).toContain('[role="navigation"]')
  })

  it('does not match unrelated entity that contains the same name', () => {
    expect(matchRulesForDomain(rules, 'google.evil.com').skipSelectors).toHaveLength(0)
    expect(matchRulesForDomain(rules, 'evilgoogle.com').skipSelectors).toHaveLength(0)
  })

  it('respects subdomain prefix in pattern', () => {
    expect(matchRulesForDomain(rules, 'mail.google.com').skipSelectors).toContain('.gmail-toolbar')
    expect(matchRulesForDomain(rules, 'mail.google.com.hk').skipSelectors).toContain('.gmail-toolbar')
    expect(matchRulesForDomain(rules, 'www.google.com').skipSelectors).not.toContain('.gmail-toolbar')
    // Deeper subdomain ending in "mail" still matches
    expect(matchRulesForDomain(rules, 'inbox.mail.google.com').skipSelectors).toContain('.gmail-toolbar')
  })

  it('combines include and exclude rules from entity patterns', () => {
    const matched = matchRulesForDomain(rules, 'google.com.hk')
    expect(matched.skipSelectors).toEqual(['[role="navigation"]'])
    expect(matched.includeSelectors).toEqual(['[id="rcnt"]'])
  })

  // Without the www. prefix, search-specific include rules would fire on
  // Gmail / Drive / Docs and (because they lack #rcnt) suppress translation
  // of the entire page. www.google.* scopes the rules to Search only.
  it('www.google.* does not leak to other Google products', () => {
    const searchRules = parseRules(`www.google.*#+#[id="rcnt"]`)
    expect(matchRulesForDomain(searchRules, 'www.google.com').includeSelectors).toEqual(['[id="rcnt"]'])
    expect(matchRulesForDomain(searchRules, 'www.google.com.hk').includeSelectors).toEqual(['[id="rcnt"]'])
    expect(matchRulesForDomain(searchRules, 'mail.google.com').includeSelectors).toHaveLength(0)
    expect(matchRulesForDomain(searchRules, 'drive.google.com').includeSelectors).toHaveLength(0)
    expect(matchRulesForDomain(searchRules, 'docs.google.com').includeSelectors).toHaveLength(0)
  })
})
