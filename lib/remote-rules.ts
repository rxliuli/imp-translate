import { parseRules, type SiteRule } from './rules'
import builtinRulesRaw from '@/lib/rules.txt?raw'

const RULES_URL =
  'https://raw.githubusercontent.com/rxliuli/imp-translate/main/lib/rules.txt'
const FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000
const ALARM_NAME = 'fetch-remote-rules'

const builtinRules = parseRules(builtinRulesRaw)

async function getRemoteRulesRaw(): Promise<string | null> {
  const result = await browser.storage.local.get('remoteRules')
  return (result.remoteRules as string) ?? null
}

async function getLastFetchTime(): Promise<number> {
  const result = await browser.storage.local.get('lastRulesFetchTime')
  const stored = result.lastRulesFetchTime as string | undefined
  return stored ? new Date(stored).getTime() : 0
}

export async function fetchRemoteRulesIfNeeded(
  force = false,
): Promise<void> {
  const doFetch = async () => {
    if (!force) {
      const last = await getLastFetchTime()
      if (Date.now() - last < FETCH_INTERVAL_MS) return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const resp = await fetch(RULES_URL, { signal: controller.signal })
    clearTimeout(timer)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const text = await resp.text()
    if (parseRules(text).length === 0) throw new Error('No valid rules in response')
    await browser.storage.local.set({
      remoteRules: text,
      lastRulesFetchTime: new Date().toISOString(),
    })
  }
  if (force) {
    await doFetch()
  } else {
    try { await doFetch() } catch {}
  }
}

export async function getEffectiveRules(): Promise<SiteRule[]> {
  try {
    const raw = await getRemoteRulesRaw()
    if (raw) {
      const parsed = parseRules(raw)
      if (parsed.length > 0) return parsed
    }
  } catch {}
  return builtinRules
}

export function setupRemoteRulesAlarm() {
  fetchRemoteRulesIfNeeded()
  browser.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      fetchRemoteRulesIfNeeded()
    }
  })
}
