import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const URL_ONLY_RE = /^https?:\/\/\S+$/

export function isUrlOnly(text: string): boolean {
  return URL_ONLY_RE.test(text)
}
