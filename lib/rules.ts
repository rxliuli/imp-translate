import { parse } from 'tldts'

export interface SiteRule {
  domain: string
  selector: string
  type: 'exclude' | 'include'
}

export interface MatchedRules {
  skipSelectors: string[]
  includeSelectors: string[]
}

export function parseRules(raw: string): SiteRule[] {
  const rules: SiteRule[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('!')) continue

    const includeMatch = trimmed.match(/^(.+?)#\+#(.+)$/)
    if (includeMatch) {
      rules.push({ domain: includeMatch[1], selector: includeMatch[2].trim(), type: 'include' })
      continue
    }

    const excludeMatch = trimmed.match(/^(.+?)##(.+)$/)
    if (excludeMatch) {
      rules.push({ domain: excludeMatch[1], selector: excludeMatch[2].trim(), type: 'exclude' })
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

export function matchRulesForDomain(rules: SiteRule[], hostname: string): MatchedRules {
  const matched = rules.filter((r) => matchesDomain(r.domain, hostname))
  return {
    skipSelectors: matched.filter((r) => r.type === 'exclude').map((r) => r.selector),
    includeSelectors: matched.filter((r) => r.type === 'include').map((r) => r.selector),
  }
}
