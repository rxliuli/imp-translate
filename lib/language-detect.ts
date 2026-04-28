import { messager } from './message'

let nativeDetector: LanguageDetector | null = null
let nativeUnavailable = false

async function getNativeDetector(): Promise<LanguageDetector | null> {
  if (nativeUnavailable) return null
  if (nativeDetector) return nativeDetector
  if (typeof globalThis.LanguageDetector === 'undefined') {
    nativeUnavailable = true
    return null
  }
  try {
    const availability = await globalThis.LanguageDetector.availability()
    if (availability === 'unavailable') {
      nativeUnavailable = true
      return null
    }
    nativeDetector = await globalThis.LanguageDetector.create()
    return nativeDetector
  } catch {
    nativeUnavailable = true
    return null
  }
}

export async function detectLanguage(text: string): Promise<string> {
  const detector = await getNativeDetector()
  if (detector) {
    const results = await detector.detect(text)
    if (results.length > 0) return results[0].detectedLanguage
  }
  return await messager.sendMessage('detectLanguage', { text })
}
