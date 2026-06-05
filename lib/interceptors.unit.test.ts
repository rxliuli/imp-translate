import { describe, it, expect } from 'vitest'
import { applyRequestInterceptors, type OpenAIRequest } from './interceptors'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const LOCAL_ENDPOINT = 'http://localhost:11434/v1/chat/completions'

function makeReq(model: string, endpoint = OPENAI_ENDPOINT): OpenAIRequest {
  return {
    endpoint,
    model,
    headers: { 'Content-Type': 'application/json' },
    body: { model, messages: [] },
  }
}

describe('disableOpenAIReasoning', () => {
  it('adds reasoning_effort for o3-mini', () => {
    const req = makeReq('o3-mini')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('adds reasoning_effort for o4-mini', () => {
    const req = makeReq('o4-mini')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('adds reasoning_effort for prefixed model like openai/o3-mini', () => {
    const req = makeReq('openai/o3-mini')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('does NOT add for gpt-4o on OpenAI endpoint', () => {
    const req = makeReq('gpt-4o')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for gpt-4o-mini on OpenAI endpoint', () => {
    const req = makeReq('gpt-4o-mini')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for o3-mini on DeepSeek endpoint', () => {
    const req = makeReq('o3-mini', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for o1 on local endpoint', () => {
    const req = makeReq('o1', LOCAL_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for deepseek-chat on DeepSeek endpoint', () => {
    const req = makeReq('deepseek-chat', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })
})

describe('disableDeepSeekThinking', () => {
  it('adds reasoning_effort for deepseek-v4-flash on DeepSeek endpoint', () => {
    const req = makeReq('deepseek-v4-flash', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('adds reasoning_effort for deepseek-v4-pro on DeepSeek endpoint', () => {
    const req = makeReq('deepseek-v4-pro', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('does NOT add for deepseek-chat on DeepSeek endpoint', () => {
    const req = makeReq('deepseek-chat', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for deepseek-v4-flash on OpenAI endpoint', () => {
    const req = makeReq('deepseek-v4-flash', OPENAI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for deepseek-v4-pro on local endpoint', () => {
    const req = makeReq('deepseek-v4-pro', LOCAL_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })
})

describe('disableGeminiThinking', () => {
  it('adds reasoning_effort for gemini-2.5-flash on Gemini endpoint', () => {
    const req = makeReq('gemini-2.5-flash', GEMINI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('adds reasoning_effort for gemini-2.5-pro on Gemini endpoint', () => {
    const req = makeReq('gemini-2.5-pro', GEMINI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('adds reasoning_effort for gemini-3-flash on Gemini endpoint', () => {
    const req = makeReq('gemini-3-flash', GEMINI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('does NOT add for gemini-2.0-flash on Gemini endpoint', () => {
    const req = makeReq('gemini-2.0-flash', GEMINI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for gemini-2.5-flash on OpenAI endpoint', () => {
    const req = makeReq('gemini-2.5-flash', OPENAI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for gemini-2.5-flash on local endpoint', () => {
    const req = makeReq('gemini-2.5-flash', LOCAL_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })
})
