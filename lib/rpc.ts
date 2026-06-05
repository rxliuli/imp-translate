import { defineCustomEventMessaging } from '@webext-core/messaging/page'

export interface TranslateRpcProtocol {
  translateBatch(data: {
    texts: string[]
    from?: string
    to: string
  }): string[]
}

export const rpc = defineCustomEventMessaging<TranslateRpcProtocol>({
  namespace: 'imp-translate-rpc',
})
