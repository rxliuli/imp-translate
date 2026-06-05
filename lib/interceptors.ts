export interface OpenAIRequest {
  endpoint: string
  model: string
  body: Record<string, any>
  headers: Record<string, string>
}

export type RequestInterceptor = (req: OpenAIRequest) => void

const OPENAI_LEGACY_MODELS = /\bgpt-(3|4)/
const OPENAI_GPT5_BASE = /\bgpt-5\b$/

function disableOpenAIReasoning(req: OpenAIRequest): void {
  if (new URL(req.endpoint).hostname !== 'api.openai.com') return
  if (OPENAI_LEGACY_MODELS.test(req.model)) return
  if (OPENAI_GPT5_BASE.test(req.model)) {
    req.body.reasoning_effort = 'minimal'
    return
  }
  req.body.reasoning_effort = 'none'
}

function disableDeepSeekThinking(req: OpenAIRequest): void {
  if (new URL(req.endpoint).hostname === 'api.deepseek.com' && /\bdeepseek-v4\b/.test(req.model)) {
    req.body.reasoning_effort = 'low'
  }
}

function disableGeminiThinking(req: OpenAIRequest): void {
  if (new URL(req.endpoint).hostname === 'generativelanguage.googleapis.com' && /\bgemini-(2\.5|3)/.test(req.model)) {
    req.body.reasoning_effort = 'low'
  }
}

export const requestInterceptors: RequestInterceptor[] = [
  disableOpenAIReasoning,
  disableDeepSeekThinking,
  disableGeminiThinking,
]

export function applyRequestInterceptors(req: OpenAIRequest): void {
  for (const interceptor of requestInterceptors) {
    interceptor(req)
  }
}
