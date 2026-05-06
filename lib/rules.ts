import { parse } from 'tldts'

export interface SiteRule {
  domain: string
  selector: string
  type: 'exclude' | 'include'
  pathPattern: string | null
}

export interface MatchedRules {
  skipSelectors: string[]
  includeSelectors: string[]
}

const MATCHES_PATH_PREFIX = ':matches-path('

function extractMatchesPath(rawSelector: string): {
  pathPattern: string | null
  selector: string
} {
  if (!rawSelector.startsWith(MATCHES_PATH_PREFIX)) {
    return { pathPattern: null, selector: rawSelector }
  }
  let depth = 1
  let i = MATCHES_PATH_PREFIX.length
  while (i < rawSelector.length) {
    const c = rawSelector[i]
    if (c === '\\' && i + 1 < rawSelector.length) {
      i += 2
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) break
    }
    i++
  }
  if (depth !== 0) return { pathPattern: null, selector: rawSelector }
  const inner = rawSelector.slice(MATCHES_PATH_PREFIX.length, i)
  const rest = rawSelector.slice(i + 1).trim()
  return { pathPattern: inner, selector: rest === '' ? '*' : rest }
}

function pathMatches(pattern: string, pathname: string): boolean {
  if (
    pattern.length >= 2 &&
    pattern.startsWith('/') &&
    pattern.endsWith('/')
  ) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(pathname)
    } catch {
      return false
    }
  }
  return pathname.includes(pattern)
}

export function parseRules(raw: string): SiteRule[] {
  const rules: SiteRule[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('!')) continue

    const includeMatch = trimmed.match(/^(.+?)#\+#(.+)$/)
    if (includeMatch) {
      const { pathPattern, selector } = extractMatchesPath(includeMatch[2].trim())
      rules.push({
        domain: includeMatch[1],
        selector,
        type: 'include',
        pathPattern,
      })
      continue
    }

    const excludeMatch = trimmed.match(/^(.+?)##(.+)$/)
    if (excludeMatch) {
      const { pathPattern, selector } = extractMatchesPath(excludeMatch[2].trim())
      rules.push({
        domain: excludeMatch[1],
        selector,
        type: 'exclude',
        pathPattern,
      })
    }
  }
  return rules
}

interface ParsedPattern {
  entity: string
  subdomain: string
  publicSuffix: string | null
}

function parsePattern(pattern: string): ParsedPattern | null {
  if (pattern.endsWith('.*')) {
    const head = pattern.slice(0, -2)
    const parts = head.split('.')
    const entity = parts.pop()
    if (!entity) return null
    return { entity, subdomain: parts.join('.'), publicSuffix: null }
  }
  const parsed = parse(pattern)
  if (!parsed.domainWithoutSuffix || !parsed.publicSuffix) return null
  return {
    entity: parsed.domainWithoutSuffix,
    subdomain: parsed.subdomain ?? '',
    publicSuffix: parsed.publicSuffix,
  }
}

function matchesDomain(pattern: string, hostname: string): boolean {
  const p = parsePattern(pattern)
  if (!p) return false
  const h = parse(hostname)
  if (!h.domainWithoutSuffix) return false
  if (h.domainWithoutSuffix !== p.entity) return false
  if (p.publicSuffix !== null && h.publicSuffix !== p.publicSuffix) return false
  if (!p.subdomain) return true
  const hSub = h.subdomain ?? ''
  return hSub === p.subdomain || hSub.endsWith('.' + p.subdomain)
}

export function matchRulesForUrl(
  rules: SiteRule[],
  hostname: string,
  pathname: string = '/',
): MatchedRules {
  const matched = rules.filter(
    (r) =>
      matchesDomain(r.domain, hostname) &&
      (r.pathPattern === null || pathMatches(r.pathPattern, pathname)),
  )
  return {
    skipSelectors: matched.filter((r) => r.type === 'exclude').map((r) => r.selector),
    includeSelectors: matched.filter((r) => r.type === 'include').map((r) => r.selector),
  }
}
