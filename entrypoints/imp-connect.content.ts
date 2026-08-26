import { isForExtension } from '@rxliuli/imp-credits-sdk'
import { IMP_SRC } from '@/lib/imp'
import { messager } from '@/lib/message'

// The Imp Credits Worker serves this success page at /api/connect/success
// (the SPA's /connect page hard-navigates there via a real form POST), so
// the content script must match that exact path — see imp-credits
// apps/api/src/routes/connect.ts's `route.post('/success')`.
// Deliberately NOT /connect/success (no /api/ prefix): that path is never
// served, so matching it would silently break the connect flow.
const PROD_MATCH = 'https://imp.rxliuli.com/api/connect/success*'
// Match patterns can't carry a port number (Chrome/Firefox reject the
// pattern outright if one is present) — omitting the port matches the host
// on any port, which is exactly what we want against `wrangler dev`'s
// http://localhost:8787.
const DEV_MATCHES = [
  'http://localhost/api/connect/success*',
  'http://127.0.0.1/api/connect/success*',
]

export default defineContentScript({
  // Deliberately its own narrowly-matched script, never folded into the main
  // content script's matches (it only ever needs to run on the Imp Credits
  // connect success page). `pnpm dev` builds (`import.meta.env.COMMAND ===
  // 'serve'`) add the local wrangler dev origins so the connect flow can be
  // tested end to end; production builds only ever match the real domain.
  matches:
    import.meta.env.COMMAND === 'serve'
      ? [PROD_MATCH, ...DEV_MATCHES]
      : [PROD_MATCH],
  main: async () => {
    // The one-time code lives only in this meta tag, never in the URL — see
    // imp-credits docs/extension-integration.md. If it's missing, this isn't
    // the page state we expect (e.g. loaded before the user finished
    // connecting); stay silent.
    const code = document
      .querySelector('meta[name="imp-connect-code"]')
      ?.getAttribute('content')
    if (!code) return

    // Only the extension that opened this connect page may exchange the
    // one-time code. Every Imp-family extension injects on this URL — without
    // this gate they'd all race to redeem the same single-use code (and all
    // but one get a 400). See the SDK's `isForExtension` doc comment.
    if (!isForExtension({ src: IMP_SRC, url: location.href })) return

    try {
      const result = await messager.sendMessage('impConnect', code)
      // On success the success page itself already says "you can close this
      // tab" — nothing else to do here.
      if (!result.ok) {
        showConnectError(result.error ?? 'Unknown error')
      }
    } catch (err) {
      showConnectError(err instanceof Error ? err.message : String(err))
    }
  },
})

function showConnectError(error: string): void {
  const banner = document.createElement('div')
  banner.textContent = `Connect failed: ${error} — please retry from the extension settings`
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '2147483647',
    padding: '8px 16px',
    background: '#b91c1c',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'sans-serif',
    textAlign: 'center',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.prepend(banner)
}
