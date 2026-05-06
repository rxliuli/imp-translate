import { defineExtensionMessaging } from '@webext-core/messaging'
import type { Settings } from './storage'
import type { SiteRule } from './rules'

export interface TranslateRequest {
  text: string
  targetLang: string
}

// Content/Popup → Background
export const messager = defineExtensionMessaging<{
  translate(req: TranslateRequest): string
  getSettings(): Settings
  startTab(data: { tabId: number; targetLang: string }): void
  stopTab(data: { tabId: number }): void
  getTabState(data: { tabId: number }): string | null
  getSelfTabState(): string | null
  stopSelfTab(): void
  isMobile(): boolean
  openOptionsPage(): void
  detectLanguage(data: { text: string }): string
}>()

// Background/Popup → Content (via browser.tabs.sendMessage). The content
// script receives the full host-matched rule set (including each rule's
// pathPattern). Path filtering happens client-side at walk time, so SPA
// navigation doesn't require a round-trip to refresh the rule set.
export type ContentAction =
  | {
      action: 'startTranslation'
      targetLang: string
      showToast?: boolean
      rules?: SiteRule[]
    }
  | { action: 'stopTranslation' }
  | { action: 'getState' }

export type ContentResponse =
  | { isTranslating: boolean }
  | void

export function sendToTab(tabId: number, message: ContentAction): Promise<ContentResponse> {
  return browser.tabs.sendMessage(tabId, message)
}
