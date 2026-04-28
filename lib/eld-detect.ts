import { eld } from 'eld/large'

export function eldDetectLanguage(text: string): string {
  return eld.detect(text).language
}
