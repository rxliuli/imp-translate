import { defineExtensionMessaging } from '@webext-core/messaging'
import type { Settings } from './storage'

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
  getRulesForUrl(data: { url: string }): {
    skipSelectors: string[]
    includeSelectors: string[]
  }
}>()

// Background/Popup → Content (via browser.tabs.sendMessage)
export type ContentAction =
  | {
      action: 'startTranslation'
      targetLang: string
      showToast?: boolean
      skipSelectors?: string[]
      includeSelectors?: string[]
    }
  | { action: 'stopTranslation' }
  | { action: 'getState' }

export type ContentResponse =
  | { isTranslating: boolean }
  | void

export function sendToTab(tabId: number, message: ContentAction): Promise<ContentResponse> {
  return browser.tabs.sendMessage(tabId, message)
}
