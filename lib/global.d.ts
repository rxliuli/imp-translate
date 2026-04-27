interface LanguageDetectionResult {
  detectedLanguage: string
  confidence: number
}

interface LanguageDetector {
  detect(text: string): Promise<LanguageDetectionResult[]>
  destroy(): void
}

interface LanguageDetectorConstructor {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
  create(): Promise<LanguageDetector>
}

interface Window {
  LanguageDetector?: LanguageDetectorConstructor
}

declare var LanguageDetector: LanguageDetectorConstructor | undefined
