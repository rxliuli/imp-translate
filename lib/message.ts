import { defineExtensionMessaging } from '@webext-core/messaging'
import type { SiteRule } from './rules'
import type { DisplayMode } from './storage'

export interface TranslateRequest {
  text: string
  targetLang: string
}

export interface TranslateBatchRequest {
  texts: string[]
  targetLang: string
}

// One paragraph split on inline boundaries (e.g. ["Click ", "here", " for
// details"]), translated as a single unit for context.
export interface TranslateSegmentsRequest {
  segments: string[]
  targetLang: string
}

export interface TranslateSegmentsResult {
  segments: string[] | null
  html: string | null
  sentIndices: number[]
  // Why `segments` is null, for logs; null when it isn't.
  reason: string | null
}

// One protocol for both directions: extension page/content script → background
// with no target (runtime messaging), and background → content script with an
// explicit target. `@webext-core/messaging` picks the API from the send
// arguments, so the four entries at the bottom are addressed as
// `messager.sendMessage('stopTranslation', undefined, { tabId })` and are the
// only ones the content script (inject.ts) handles — everything above them is
// a background handler.
export const messager = defineExtensionMessaging<{
  translate(req: TranslateRequest): string
  translateBatch(req: TranslateBatchRequest): string[]
  // `segments`: the translations aligned 1:1 by position with the input (not
  // trimmed — whitespace handling is the caller's job; '' means "clear this
  // node", only for punctuation-only sources), or null when the output can't
  // be poured into the existing nodes. `html`: the engine's raw tagged output
  // (unescaped tags, escaped text) for the structural rewrite; null when there
  // is none (provider without segment support, declined translation).
  // `sentIndices`: input positions that were sent — tag id j is segment
  // sentIndices[j]. `reason`: why segments is null (logged by the content
  // script). Provider request failures reject.
  translateSegments(req: TranslateSegmentsRequest): TranslateSegmentsResult
  // connect content script (imp-connect.content.ts) => background: exchanges
  // the one-time code read off the success page's <meta> tag for a persistent
  // Imp Credits api key (see imp-credits docs/extension-integration.md).
  impConnect(code: string): Promise<{ ok: boolean; error?: string }>
  // options page (on mount, when an Imp connection is stored) => background:
  // zero-cost check that the given Imp api key is still valid (401 == revoked)
  // so the "Connected" badge reflects reality rather than just local state.
  // The caller passes the key explicitly: the options page updates its state
  // before the storage write lands, so reading storage here would race.
  checkConnection(data: {
    baseUrl: string
    apiKey: string
  }): Promise<{ ok: true } | { ok: false; error: string }>
  getMatchedRulesForHostname(data: { hostname: string }): SiteRule[]
  startTab(data: { tabId: number; targetLang: string }): void
  stopTab(data: { tabId: number }): void
  getTabState(data: { tabId: number }): string | null
  getSelfTabState(): string | null
  stopSelfTab(): void
  startSelfTab(data: { targetLang: string }): void
  isMobile(): boolean
  openOptionsPage(): void
  detectLanguageBatch(data: { texts: string[] }): string[]
  refreshRemoteRules(): void

  // Background → content script (entrypoints/inject.ts). Omitting frameId
  // broadcasts to every frame in the tab; passing it drives a single frame
  // (dynamically added iframes) without re-waking the already-translating
  // ones. The content script receives the full host-matched rule set
  // (including each rule's pathPattern) — path filtering happens client-side
  // at walk time, so SPA navigation needs no extra round-trip.
  startTranslation(data: {
    targetLang: string
    displayMode: DisplayMode
    showToast?: boolean
    rules: SiteRule[]
  }): void
  stopTranslation(): void
  getState(): boolean
}>()
