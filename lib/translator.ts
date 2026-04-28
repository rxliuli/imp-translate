import { decodeHTML } from 'entities'
import type { Settings } from './storage'

export interface TranslationResult {
  texts: string[]
  detectedLang?: string
}

let msTokenCache: { token: string; expires: number } | null = null
let msTokenInflight: Promise<string> | null = null

async function getMicrosoftToken(): Promise<string> {
  if (msTokenCache && Date.now() < msTokenCache.expires) {
    return msTokenCache.token
  }
  if (msTokenInflight) return msTokenInflight
  msTokenInflight = (async () => {
    try {
      const resp = await fetch('https://edge.microsoft.com/translate/auth', {
        method: 'GET',
      })
      if (!resp.ok) throw new Error(`Microsoft auth failed: ${resp.status}`)
      const token = await resp.text()
      msTokenCache = { token, expires: Date.now() + 8 * 60 * 1000 }
      return token
    } finally {
      msTokenInflight = null
    }
  })()
  return msTokenInflight
}

async function translateMicrosoft(
  texts: string[],
  targetLang: string,
): Promise<TranslationResult> {
  const token = await getMicrosoftToken()
  const url = new URL('https://api-edge.cognitive.microsofttranslator.com/translate')
  url.searchParams.set('api-version', '3.0')
  url.searchParams.set('to', targetLang)

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(texts.map((t) => ({ Text: t }))),
  })

  if (!resp.ok) {
    msTokenCache = null
    throw new Error(`Microsoft translate failed: ${resp.status}`)
  }

  const data = await resp.json()
  return {
    texts: data.map((item: any) => item.translations[0].text),
    detectedLang: data[0]?.detectedLanguage?.language,
  }
}

const GOOGLE_TRANSLATE_HTML_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function translateGoogle(
  texts: string[],
  targetLang: string,
): Promise<TranslationResult> {
  const escaped = texts.map(escapeHtml)
  const resp = await fetch(
    'https://translate-pa.googleapis.com/v1/translateHtml',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-API-Key': GOOGLE_TRANSLATE_HTML_KEY,
      },
      body: JSON.stringify([[escaped, 'auto', targetLang], 'te_lib']),
    },
  )

  if (!resp.ok) throw new Error(`Google translate failed: ${resp.status}`)

  const data = await resp.json()
  const translated = data[0] as string[]
  const detectedLangs = data[1] as string[] | undefined

  return {
    texts: translated.map((t) => decodeHTML(t)),
    detectedLang: detectedLangs?.[0],
  }
}

async function translateOpenAI(
  texts: string[],
  targetLang: string,
  settings: Settings,
): Promise<TranslationResult> {
  const { apiKey, endpoint, model, systemPrompt } = settings.openai
  if (!apiKey) throw new Error('OpenAI API key is not configured')

  const prompt = systemPrompt.replace('{{targetLang}}', targetLang)
  const userContent = texts
    .map((t, i) => `<t id="${i}">${t}</t>`)
    .join('\n')

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: prompt + '\nThe input contains multiple texts wrapped in <t id="N"> tags. Return translations in the same format with matching ids. Keep the XML tags intact.' },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenAI API failed: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  const content: string = data.choices[0]?.message?.content || ''

  const results = new Array<string>(texts.length).fill('')
  const regex = /<t id="(\d+)">([\s\S]*?)<\/t>/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const idx = parseInt(match[1])
    if (idx >= 0 && idx < texts.length) {
      results[idx] = match[2].trim()
    }
  }

  for (let i = 0; i < results.length; i++) {
    if (!results[i]) results[i] = texts[i]
  }

  return { texts: results }
}

export async function translate(
  texts: string[],
  targetLang: string,
  settings: Settings,
): Promise<TranslationResult> {
  if (texts.length === 0) return { texts: [] }

  switch (settings.provider) {
    case 'microsoft':
      return translateMicrosoft(texts, targetLang)
    case 'google':
      return translateGoogle(texts, targetLang)
    case 'openai':
      return translateOpenAI(texts, targetLang, settings)
    default:
      throw new Error(`Unknown provider: ${settings.provider}`)
  }
}
