export interface TranslateServiceConfig {
  getCached: (text: string, lang: string) => Promise<string | undefined>
  setCached: (text: string, lang: string, translated: string) => Promise<void>
  translator: (texts: string[], lang: string) => Promise<string[]>
  batchWindowMs: number
  maxBatchSize: number
  maxBatchChars?: number
  onAfterFlush?: () => void
}

export interface TranslateService {
  translate: (text: string, lang: string) => Promise<string>
}

interface PendingItem {
  text: string
  resolve: (translated: string) => void
  reject: (err: Error) => void
}

interface BatchQueue {
  pending: PendingItem[]
  pendingChars: number
  timer: ReturnType<typeof setTimeout> | null
}

export function createTranslateService(config: TranslateServiceConfig): TranslateService {
  const queues = new Map<string, BatchQueue>()

  async function flush(lang: string) {
    const q = queues.get(lang)
    if (!q || q.pending.length === 0) return
    if (q.timer) {
      clearTimeout(q.timer)
      q.timer = null
    }
    const batch = q.pending
    q.pending = []
    q.pendingChars = 0

    const textToItems = new Map<string, PendingItem[]>()
    for (const item of batch) {
      let arr = textToItems.get(item.text)
      if (!arr) {
        arr = []
        textToItems.set(item.text, arr)
      }
      arr.push(item)
    }

    const uniqueTexts = [...textToItems.keys()]

    try {
      const translated = await config.translator(uniqueTexts, lang)
      for (let i = 0; i < uniqueTexts.length; i++) {
        const text = uniqueTexts[i]
        const out = translated[i]
        config.setCached(text, lang, out)
        for (const item of textToItems.get(text)!) item.resolve(out)
      }
      config.onAfterFlush?.()
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      for (const item of batch) item.reject(e)
    }
  }

  function enqueue(text: string, lang: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let q = queues.get(lang)
      if (!q) {
        q = { pending: [], pendingChars: 0, timer: null }
        queues.set(lang, q)
      }
      if (
        config.maxBatchChars !== undefined &&
        q.pending.length > 0 &&
        q.pendingChars + text.length > config.maxBatchChars
      ) {
        flush(lang)
      }
      q.pending.push({ text, resolve, reject })
      q.pendingChars += text.length
      if (q.pending.length >= config.maxBatchSize) {
        flush(lang)
      } else if (!q.timer) {
        q.timer = setTimeout(() => flush(lang), config.batchWindowMs)
      }
    })
  }

  return {
    async translate(text, lang) {
      const cached = await config.getCached(text, lang)
      if (cached !== undefined) return cached
      return enqueue(text, lang)
    },
  }
}
