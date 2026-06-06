import { rpc } from '@/lib/rpc'
import { messager } from '@/lib/message'

const ALLOWED_HOSTS = ['https://imp-translate.rxliuli.com/*']
if (import.meta.env.DEV) {
  ALLOWED_HOSTS.push('*://localhost/*')
}

export default defineContentScript({
  matches: ALLOWED_HOSTS,
  runAt: 'document_start',
  main() {
    document.documentElement.dataset.impTranslateInstalled = 'true'

    rpc.onMessage('translate', async ({ data }) => {
      const results = await Promise.all(
        data.texts.map((text) =>
          messager.sendMessage('translate', {
            text,
            targetLang: data.to,
          }),
        ),
      )
      return results
    })

    rpc.onMessage('translateBatch', async ({ data }) => {
      return messager.sendMessage('translateBatch', {
        texts: data.texts,
        targetLang: data.to,
      })
    })
  },
})
