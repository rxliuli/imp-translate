import { describe, expect, it } from 'vitest'
import { parseRules, matchRulesForUrl } from './rules'

describe('parseRules', () => {
  it('parses exclude rules', () => {
    const rules = parseRules('reddit.com##[id="expand-search-button"]')
    expect(rules).toEqual([
      {
        domain: 'reddit.com',
        selector: '[id="expand-search-button"]',
        type: 'exclude',
        pathPattern: null,
      },
    ])
  })

  it('parses include rules', () => {
    const rules = parseRules('x.com#+#[data-testid="tweetText"]')
    expect(rules).toEqual([
      {
        domain: 'x.com',
        selector: '[data-testid="tweetText"]',
        type: 'include',
        pathPattern: null,
      },
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

describe('matchRulesForUrl', () => {
  const rules = parseRules(`
reddit.com##.search-btn
reddit.com#+#[slot="text-body"]
reddit.com#+#[slot="title"]
twitter.com##.tweet-btn
`)

  it('separates skip and include selectors', () => {
    const matched = matchRulesForUrl(rules, 'reddit.com')
    expect(matched.skipSelectors).toEqual(['.search-btn'])
    expect(matched.includeSelectors).toEqual(['[slot="text-body"]', '[slot="title"]'])
  })

  it('matches subdomain', () => {
    const matched = matchRulesForUrl(rules, 'www.reddit.com')
    expect(matched.skipSelectors).toEqual(['.search-btn'])
    expect(matched.includeSelectors).toEqual(['[slot="text-body"]', '[slot="title"]'])
  })

  it('returns empty arrays for unmatched domain', () => {
    const matched = matchRulesForUrl(rules, 'example.com')
    expect(matched.skipSelectors).toHaveLength(0)
    expect(matched.includeSelectors).toHaveLength(0)
  })

  it('does not match different TLD when rule is exact', () => {
    const matched = matchRulesForUrl(rules, 'reddit.com.hk')
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
    expect(matchRulesForUrl(rules, 'google.com').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForUrl(rules, 'google.com.hk').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForUrl(rules, 'google.co.uk').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForUrl(rules, 'google.de').skipSelectors).toContain('[role="navigation"]')
  })

  it('matches subdomains of entity-pattern hostnames', () => {
    expect(matchRulesForUrl(rules, 'www.google.com').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForUrl(rules, 'www.google.com.hk').skipSelectors).toContain('[role="navigation"]')
    expect(matchRulesForUrl(rules, 'mail.google.de').skipSelectors).toContain('[role="navigation"]')
  })

  it('does not match unrelated entity that contains the same name', () => {
    expect(matchRulesForUrl(rules, 'google.evil.com').skipSelectors).toHaveLength(0)
    expect(matchRulesForUrl(rules, 'evilgoogle.com').skipSelectors).toHaveLength(0)
  })

  it('respects subdomain prefix in pattern', () => {
    expect(matchRulesForUrl(rules, 'mail.google.com').skipSelectors).toContain('.gmail-toolbar')
    expect(matchRulesForUrl(rules, 'mail.google.com.hk').skipSelectors).toContain('.gmail-toolbar')
    expect(matchRulesForUrl(rules, 'www.google.com').skipSelectors).not.toContain('.gmail-toolbar')
    // Deeper subdomain ending in "mail" still matches
    expect(matchRulesForUrl(rules, 'inbox.mail.google.com').skipSelectors).toContain('.gmail-toolbar')
  })

  it('combines include and exclude rules from entity patterns', () => {
    const matched = matchRulesForUrl(rules, 'google.com.hk')
    expect(matched.skipSelectors).toEqual(['[role="navigation"]'])
    expect(matched.includeSelectors).toEqual(['[id="rcnt"]'])
  })

  // Without the www. prefix, search-specific include rules would fire on
  // Gmail / Drive / Docs and (because they lack #rcnt) suppress translation
  // of the entire page. www.google.* scopes the rules to Search only.
  it('www.google.* does not leak to other Google products', () => {
    const searchRules = parseRules(`www.google.*#+#[id="rcnt"]`)
    expect(matchRulesForUrl(searchRules, 'www.google.com').includeSelectors).toEqual(['[id="rcnt"]'])
    expect(matchRulesForUrl(searchRules, 'www.google.com.hk').includeSelectors).toEqual(['[id="rcnt"]'])
    expect(matchRulesForUrl(searchRules, 'mail.google.com').includeSelectors).toHaveLength(0)
    expect(matchRulesForUrl(searchRules, 'drive.google.com').includeSelectors).toHaveLength(0)
    expect(matchRulesForUrl(searchRules, 'docs.google.com').includeSelectors).toHaveLength(0)
  })
})

describe(':matches-path()', () => {
  it('parses the path pattern off the front of an include selector', () => {
    const rules = parseRules('chatgpt.com#+#:matches-path(/^\\/c\\//) [data-message-author-role]')
    expect(rules).toEqual([
      {
        domain: 'chatgpt.com',
        selector: '[data-message-author-role]',
        type: 'include',
        pathPattern: '/^\\/c\\//',
      },
    ])
  })

  it('parses the path pattern off the front of an exclude selector', () => {
    const rules = parseRules('x.com##:matches-path(/explore) .ad')
    expect(rules[0]).toMatchObject({
      type: 'exclude',
      selector: '.ad',
      pathPattern: '/explore',
    })
  })

  it('treats a bare :matches-path() with no trailing selector as universal', () => {
    const rules = parseRules('example.com##:matches-path(/login)')
    expect(rules[0]).toMatchObject({
      selector: '*',
      pathPattern: '/login',
    })
  })

  it('handles parentheses inside the path pattern (regex with alternations)', () => {
    const rules = parseRules('example.com#+#:matches-path(/^\\/(a|b)\\//) main')
    expect(rules[0].pathPattern).toBe('/^\\/(a|b)\\//')
    expect(rules[0].selector).toBe('main')
  })

  it('regex form (slash-delimited) tests against pathname', () => {
    const rules = parseRules('chatgpt.com#+#:matches-path(/^\\/c\\//) [data-message-author-role]')
    expect(matchRulesForUrl(rules, 'chatgpt.com', '/c/abc-123').includeSelectors).toEqual([
      '[data-message-author-role]',
    ])
    expect(matchRulesForUrl(rules, 'chatgpt.com', '/library').includeSelectors).toHaveLength(0)
    expect(matchRulesForUrl(rules, 'chatgpt.com', '/').includeSelectors).toHaveLength(0)
  })

  it('plain form (no slash delimiters) does substring match', () => {
    const rules = parseRules('web.telegram.org#+#:matches-path(/k/) .bubble .message')
    expect(matchRulesForUrl(rules, 'web.telegram.org', '/k/').includeSelectors).toEqual([
      '.bubble .message',
    ])
    expect(matchRulesForUrl(rules, 'web.telegram.org', '/k/#chat=123').includeSelectors).toEqual([
      '.bubble .message',
    ])
    expect(matchRulesForUrl(rules, 'web.telegram.org', '/a/').includeSelectors).toHaveLength(0)
  })

  it('rules without :matches-path() match any pathname', () => {
    const rules = parseRules('reddit.com#+#[slot="title"]')
    expect(matchRulesForUrl(rules, 'reddit.com', '/').includeSelectors).toEqual(['[slot="title"]'])
    expect(matchRulesForUrl(rules, 'reddit.com', '/r/x/comments/y').includeSelectors).toEqual([
      '[slot="title"]',
    ])
  })

  it('combines path-gated and ungated rules under the same hostname', () => {
    const rules = parseRules(`
chatgpt.com#+#:matches-path(/^\\/c\\//) [data-message-author-role]
chatgpt.com##header
`)
    const onConv = matchRulesForUrl(rules, 'chatgpt.com', '/c/abc')
    expect(onConv.includeSelectors).toEqual(['[data-message-author-role]'])
    expect(onConv.skipSelectors).toEqual(['header'])

    const onLibrary = matchRulesForUrl(rules, 'chatgpt.com', '/library')
    expect(onLibrary.includeSelectors).toHaveLength(0)
    expect(onLibrary.skipSelectors).toEqual(['header'])
  })

  it('invalid regex pattern fails closed (rule does not match)', () => {
    const rules = parseRules('example.com#+#:matches-path(/[unclosed/) main')
    expect(matchRulesForUrl(rules, 'example.com', '/anything').includeSelectors).toHaveLength(0)
  })

  it('defaults pathname to "/" when omitted', () => {
    const rules = parseRules('example.com#+#:matches-path(/^\\/$/) main')
    expect(matchRulesForUrl(rules, 'example.com').includeSelectors).toEqual(['main'])
  })
})
