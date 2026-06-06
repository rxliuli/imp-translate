import { defineCustomEventMessaging } from '@webext-core/messaging/page'

export interface TranslateRpcProtocol {
  translate(data: {
    texts: string[]
    to: string
  }): string[]
  translateBatch(data: {
    texts: string[]
    to: string
  }): string[]
}

export const rpc = defineCustomEventMessaging<TranslateRpcProtocol>({
  namespace: 'imp-translate-rpc',
})
