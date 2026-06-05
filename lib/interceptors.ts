export interface OpenAIRequest {
  endpoint: string
  model: string
  body: Record<string, any>
  headers: Record<string, string>
}

export type RequestInterceptor = (req: OpenAIRequest) => void

function disableOpenAIReasoning(req: OpenAIRequest): void {
  if (new URL(req.endpoint).hostname === 'api.openai.com' && /\bo[0-9]/.test(req.model)) {
    req.body.reasoning_effort = 'low'
  }
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
