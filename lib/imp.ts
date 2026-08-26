import { connectUrl } from '@rxliuli/imp-credits-sdk'

// Imp Credits (imp.rxliuli.com) — the hosted, metered translation service.
// Production talks to the real service; for local iteration against the
// imp-credits repo's `wrangler dev` (http://localhost:8787) temporarily swap
// the constant below (same trick as imp-write's lib/imp.ts).
export const IMP_ORIGIN = 'https://imp.rxliuli.com'
// export const IMP_ORIGIN = 'http://localhost:8787'

// `src` is the extension's identifier — imp-credits records it as connection
// provenance and uses it (via the api key's `src`) to pick a per-extension
// model/pricing tier. Keep it in sync with the value the server expects. The
// SDK's `isForExtension` gates the connect-success content script on this id.
export const IMP_SRC = 'imp-translate'

export const IMP_CONNECT_URL = connectUrl(IMP_SRC, IMP_ORIGIN)
