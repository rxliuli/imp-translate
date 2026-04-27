export interface SiteRule {
  domain: string
  selector: string
}

export function parseRules(raw: string): SiteRule[] {
  const rules: SiteRule[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('!')) continue

    const match = trimmed.match(/^(.+?)##(.+)$/)
    if (match) {
      rules.push({ domain: match[1], selector: match[2].trim() })
    }
  }
  return rules
}

export function matchRulesForDomain(rules: SiteRule[], hostname: string): string[] {
  return rules
    .filter((r) => r.domain === hostname || hostname.endsWith('.' + r.domain))
    .map((r) => r.selector)
}

