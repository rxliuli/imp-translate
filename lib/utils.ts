import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Dev-only timing markers for debugging latency issues.
// Usage:
//   const t = debugTime('my-label')
//   … async work …
//   t('phase 1 done')
//   … more async work …
//   t('done')
export function debugTime(label: string): (msg: string) => void {
  if (import.meta.env.PROD) {
    return () => {}
  }
  const start = performance.now()
  let prev = start
  const log = (msg: string) => {
    const now = performance.now()
    console.debug(
      `[imp-time] ${label} | ${msg} — Δ${(now - prev).toFixed(1)}ms | total ${(now - start).toFixed(1)}ms`,
    )
    prev = now
  }
  log('start')
  return log
}

// Dev-only diagnostics for the in-place ("replace") bookkeeping. Restore
// problems are invisible from the outside (the page simply keeps a
// translation), so every place that drops or skips a record logs its reason
// here — see "Replace mode: why Text.data" in COMPATIBILITY.md. Same gate as
// debugTime: dev builds only.
export function debugLog(scope: string, msg: string) {
  if (import.meta.env.PROD) return
  console.warn(`[imp-replace] ${scope} | ${msg}`)
}

const URL_ONLY_RE = /^https?:\/\/\S+$/

export function isUrlOnly(text: string): boolean {
  return URL_ONLY_RE.test(text)
}

// A .pdf URL, matched on the pathname (query strings and fragments don't
// change what the browser renders). Translated pages are plain HTML, so
// translation is skipped there.
export function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}
