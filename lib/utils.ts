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

const URL_ONLY_RE = /^https?:\/\/\S+$/

export function isUrlOnly(text: string): boolean {
  return URL_ONLY_RE.test(text)
}
