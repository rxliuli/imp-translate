import { defineExtensionMessaging } from '@webext-core/messaging'
import type { TranslationResult } from './translator'
import type { Settings } from './storage'

export interface TranslateRequest {
  texts: string[]
  targetLang: string
}

// Content/Popup → Background
export const messager = defineExtensionMessaging<{
  translate(req: TranslateRequest): TranslationResult
  getSettings(): Settings
  startTab(data: { tabId: number; targetLang: string }): void
  stopTab(data: { tabId: number }): void
  getTabState(data: { tabId: number }): string | null
  getSelfTabState(): string | null
}>()

// Background/Popup → Content (via browser.tabs.sendMessage)
export type ContentAction =
  | { action: 'startTranslation'; targetLang: string }
  | { action: 'stopTranslation' }
  | { action: 'getState' }

export type ContentResponse =
  | { isTranslating: boolean }
  | void

export function sendToTab(tabId: number, message: ContentAction): Promise<ContentResponse> {
  return browser.tabs.sendMessage(tabId, message)
}
