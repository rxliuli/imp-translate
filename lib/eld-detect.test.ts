import { describe, expect, it } from 'vitest'
import { eldDetectLanguage } from './eld-detect'

describe('eldDetectLanguage', () => {
  describe('long text', () => {
    it.each([
      { text: 'This is a long paragraph that describes the feature in detail.', expected: 'en' },
      { text: '这是一段很长的中文文本，用于测试语言检测的准确性。', expected: 'zh' },
      { text: 'これは日本語のテスト文章です。言語検出の精度を確認します。', expected: 'ja' },
      { text: 'Bonjour le monde! Ceci est un test de détection de langue.', expected: 'fr' },
      { text: '이것은 한국어 테스트 문장입니다. 언어 감지 정확도를 확인합니다.', expected: 'ko' },
    ])('should detect "$expected"', ({ text, expected }) => {
      expect(eldDetectLanguage(text)).toBe(expected)
    })
  })

  describe('medium text (phrases)', () => {
    it.each([
      { text: 'Watch an interactive lesson', expected: 'en' },
      { text: 'Getting Started', expected: 'en' },
      { text: 'Learn more about this feature', expected: 'en' },
      { text: '查看更多详细信息', expected: 'zh' },
      { text: '使用 React 的 useState 来管理组件状态', expected: 'zh' },
      { text: 'Use the useState hook to manage React state', expected: 'en' },
    ])('should detect "$text" as $expected', ({ text, expected }) => {
      expect(eldDetectLanguage(text)).toBe(expected)
    })
  })

  describe('short text (single words)', () => {
    it.each([
      { text: 'Settings', expected: 'en' },
      { text: '设置', expected: 'zh' },
      { text: 'public', expected: 'en' },
      { text: '首页', expected: 'zh' },
      { text: 'Archive', expected: 'en' },
      { text: 'general', expected: 'en' },
    ])('$text => $expected', ({ text, expected }) => {
      expect(eldDetectLanguage(text)).toBe(expected)
    })
  })

  describe('mixed content', () => {
    it('English with code terms', () => {
      expect(eldDetectLanguage('Use the useState hook to manage React state')).toBe('en')
    })

    it('Chinese with English terms', () => {
      expect(eldDetectLanguage('使用 React 的 useState 来管理组件状态')).toBe('zh')
    })
  })
})
