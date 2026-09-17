import { defineExtensionMessaging } from '@webext-core/messaging'
import type { SiteRule } from './rules'

export interface TranslateRequest {
  text: string
  targetLang: string
}

export interface TranslateBatchRequest {
  texts: string[]
  targetLang: string
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
  // connect content script (imp-connect.content.ts) => background: exchanges
  // the one-time code read off the success page's <meta> tag for a persistent
  // Imp Credits api key (see imp-credits docs/extension-integration.md).
  impConnect(code: string): Promise<{ ok: boolean; error?: string }>
  // options page (on mount, when an Imp connection is stored) => background:
  // zero-cost check that the stored Imp api key is still valid (401 == revoked)
  // so the "Connected" badge reflects reality rather than just local state.
  checkConnection(): Promise<{ ok: true } | { ok: false; error: string }>
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
    showToast?: boolean
    rules: SiteRule[]
  }): void
  stopTranslation(): void
  // Re-open the mobile panel without touching translation state: the icon
  // click must not stop a translation the user may want to keep.
  showToast(): void
  getState(): boolean
}>()
