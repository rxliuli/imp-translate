import type { Settings } from './storage'
import { applyRequestInterceptors, type OpenAIRequest } from './interceptors'

const SHORT_TEXT_LIMIT = 20
const EXPANSION_RATIO = 3

function looksLikeExplanation(source: string, translated: string): boolean {
  return source.length < SHORT_TEXT_LIMIT && translated.length > source.length * EXPANSION_RATIO
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

export function decodeHTML(input: string): string {
  return input.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return NAMED_ENTITIES[body] ?? match
    },
  )
}

export interface TranslationResult {
  texts: string[]
  detectedLang?: string
}

// Microsoft retired the legacy Edge translation pipeline
// (edge.microsoft.com/translate/auth) on 2026-07-30, so this now goes through
// the Bing web translator: scrape a session from the translator page, then
// call ttranslatev3. The token is valid for one hour; each request accepts at
// most 1000 characters of text.
interface BingSession {
  ig: string
  iid: string
  key: number
  token: string
  expires: number
}

let bingSession: BingSession | null = null
let bingSessionInflight: Promise<BingSession> | null = null

async function getBingSession(): Promise<BingSession> {
  if (bingSession && Date.now() < bingSession.expires) {
    return bingSession
  }
  if (bingSessionInflight) return bingSessionInflight
  bingSessionInflight = (async () => {
    try {
      const resp = await fetch('https://www.bing.com/translator')
      if (!resp.ok) throw new Error(`Bing session failed: ${resp.status}`)
      const html = await resp.text()
      const ig = /IG:"([^"]+)"/.exec(html)?.[1]
      const iid = /data-iid="([^"]+)"/.exec(html)?.[1] ?? 'translator.5023'
      const helper = /params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/.exec(html)?.[1]
      if (!ig || !helper) {
        throw new Error('Bing session failed: page layout changed')
      }
      const [key, token, duration] = JSON.parse(helper) as [number, string, number]
      bingSession = {
        ig,
        iid,
        key,
        token,
        expires: Date.now() + Math.min(duration || 3600000, 3600000) - 60000,
      }
      return bingSession
    } finally {
      bingSessionInflight = null
    }
  })()
  return bingSessionInflight
}

// Map Google-style/bare codes to the codes Bing expects.
const BING_LANG_MAP: Record<string, string> = {
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-TW': 'zh-Hant',
  tl: 'fil',
  iw: 'he',
  no: 'nb',
  sr: 'sr-Cyrl',
  mn: 'mn-Cyrl',
  hmn: 'mww',
  ku: 'kmr',
}

const BING_TEXT_LIMIT = 950

async function bingTranslateOne(text: string, to: string, retried = false): Promise<string> {
  const s = await getBingSession()
  const resp = await fetch(
    `https://www.bing.com/ttranslatev3?isVertical=1&IG=${s.ig}&IID=${s.iid}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        fromLang: 'auto-detect',
        to,
        text,
        token: s.token,
        key: String(s.key),
      }),
    },
  )
  if (!resp.ok) {
    bingSession = null
    if (!retried) return bingTranslateOne(text, to, true)
    throw new Error(`Microsoft translate failed: ${resp.status}`)
  }
  const data = await resp.json()
  const first = Array.isArray(data) ? data[0] : null
  if (!first?.translations?.[0]?.text) {
    // An expired token or a captcha challenge comes back as an object
    // (e.g. {"statusCode":400}) instead of the translations array.
    bingSession = null
    if (!retried) return bingTranslateOne(text, to, true)
    throw new Error(`Microsoft translate failed: ${JSON.stringify(data).slice(0, 200)}`)
  }
  return first.translations[0].text
}

// Translate a single text longer than the request limit by splitting it on
// sentence boundaries and rejoining the translated pieces.
async function bingTranslateLong(text: string, to: string): Promise<string> {
  const segments = text.match(/[^.!?。！？]*[.!?。！？]+["')\]]*\s*|[^.!?。！？]+$/g) ?? [text]
  const parts: string[] = []
  let current = ''
  for (let seg of segments) {
    while (seg.length > BING_TEXT_LIMIT) {
      if (current) {
        parts.push(current)
        current = ''
      }
      parts.push(seg.slice(0, BING_TEXT_LIMIT))
      seg = seg.slice(BING_TEXT_LIMIT)
    }
    if (current.length + seg.length > BING_TEXT_LIMIT) {
      parts.push(current)
      current = seg
    } else {
      current += seg
    }
  }
  if (current) parts.push(current)
  const translated = await Promise.all(parts.map((p) => bingTranslateOne(p, to)))
  return translated.join(' ')
}

async function translateMicrosoft(
  texts: string[],
  targetLang: string,
): Promise<TranslationResult> {
  const to = BING_LANG_MAP[targetLang] ?? targetLang
  // ttranslatev3 takes one text per request, so pack the batch into
  // newline-joined groups within the request limit (Bing preserves newlines)
  // and split each result back. Text-internal newlines are flattened so they
  // cannot break the alignment.
  const cleaned = texts.map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
  const groups: number[][] = []
  let group: number[] = []
  let groupChars = 0
  for (let i = 0; i < cleaned.length; i++) {
    const len = cleaned[i].length + 1
    if (group.length > 0 && groupChars + len > BING_TEXT_LIMIT) {
      groups.push(group)
      group = []
      groupChars = 0
    }
    group.push(i)
    groupChars += len
  }
  if (group.length > 0) groups.push(group)

  const results = new Array<string>(cleaned.length)
  await Promise.all(
    groups.map(async (indices) => {
      const groupTexts = indices.map((i) => cleaned[i])
      if (indices.length === 1) {
        const text = groupTexts[0]
        if (text === '') {
          results[indices[0]] = text
        } else if (text.length > BING_TEXT_LIMIT) {
          results[indices[0]] = await bingTranslateLong(text, to)
        } else {
          results[indices[0]] = await bingTranslateOne(text, to)
        }
        return
      }
      if (groupTexts.every((t) => t !== '')) {
        const lines = (await bingTranslateOne(groupTexts.join('\n'), to)).split('\n')
        if (lines.length === groupTexts.length) {
          indices.forEach((idx, j) => {
            results[idx] = lines[j].trim()
          })
          return
        }
        // The translator merged or split lines — redo this group per text.
      }
      await Promise.all(
        indices.map(async (idx) => {
          const text = cleaned[idx]
          results[idx] = text === '' ? text : await bingTranslateOne(text, to)
        }),
      )
    }),
  )
  return { texts: results }
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

export function chatCompletionsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions'
}

async function translateOpenAI(
  texts: string[],
  targetLang: string,
  settings: Settings,
): Promise<TranslationResult> {
  const { apiKey, baseUrl, model, systemPrompt } = settings.openai
  if (!apiKey) throw new Error('OpenAI API key is not configured')
  if (!baseUrl) throw new Error('Base URL is not configured')

  const prompt = systemPrompt.replace('{{targetLang}}', targetLang)
  const single = texts.length === 1
  const userContent = single
    ? texts[0]
    : texts.map((t, i) => `<t id="${i}">${t}</t>`).join('\n')
  const sysContent = single
    ? prompt
    : prompt + '\nThe input contains multiple texts wrapped in <t id="N"> tags. Return translations in the same format with matching ids. Keep the XML tags intact.'

  const req: OpenAIRequest = {
    endpoint: chatCompletionsUrl(baseUrl),
    model,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      messages: [
        { role: 'system', content: sysContent },
        { role: 'user', content: userContent },
      ],
    },
  }
  applyRequestInterceptors(req)

  const resp = await fetch(req.endpoint, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenAI API failed: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  const content: string = data.choices[0]?.message?.content || ''

  if (single) {
    const trimmed = content.trim()
    return { texts: [looksLikeExplanation(texts[0], trimmed) ? texts[0] : trimmed] }
  }

  const results = new Array<string>(texts.length).fill('')
  const regex = /<t id="(\d+)">([\s\S]*?)<\/t>/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const idx = parseInt(match[1])
    if (idx >= 0 && idx < texts.length) {
      results[idx] = match[2].trim()
    }
  }

  // Capture trailing <t> without closing </t> (LLMs often drop the last tag)
  const unclosed = /[\s\S]*<t id="(\d+)">([\s\S]+)$/.exec(content)
  if (unclosed) {
    const idx = parseInt(unclosed[1])
    if (idx >= 0 && idx < texts.length && !results[idx]) {
      results[idx] = unclosed[2].trim()
    }
  }

  for (let i = 0; i < results.length; i++) {
    if (!results[i] || looksLikeExplanation(texts[i], results[i])) results[i] = texts[i]
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
