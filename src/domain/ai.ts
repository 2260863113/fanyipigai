/**
 * DeepSeek 批改调用。
 *
 * 设计要点：
 * - 使用官方 JSON 输出模式（response_format = json_object），并要求提示词里出现 "json" 字样
 * - 解析失败时把**具体原因**回传给模型重试，最多 3 次；仍失败就如实报错，不猜不凑
 * - 明确区分几类真实故障：密钥无效、余额不足、限流、返回被截断、返回不是 JSON
 *   这些在页面上要给出不同的下一步动作，而不是笼统的一句"出错了"
 *
 * 这一段代码同时被两种运行环境使用：本地开发时的 Node 测试脚本，以及部署后的 Worker。
 */

import { buildRetryPrompt, buildSystemPrompt, buildUserPrompt, type CorrectionRequest } from './prompt'
import { parseCorrection, type ParseSuccess } from './parse'

export interface JudgeConfig {
  apiKey: string
  /** 模型名。DeepSeek 当前可用：deepseek-flash、deepseek-v4-pro */
  model: string
  baseUrl: string
  /** 单次批改最多试几次（含首次） */
  maxAttempts: number
  /** 单次请求的超时时间（毫秒） */
  timeoutMs: number
}

export const DEFAULT_JUDGE_CONFIG: Omit<JudgeConfig, 'apiKey'> = {
  model: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com',
  maxAttempts: 3,
  timeoutMs: 120_000,
}

export type JudgeFailureKind =
  | 'missing-key'
  | 'unauthorized'
  | 'insufficient-balance'
  | 'rate-limited'
  | 'server-error'
  | 'timeout'
  | 'network'
  | 'truncated'
  | 'bad-output'

export interface JudgeFailure {
  ok: false
  kind: JudgeFailureKind
  /** 给用户看的一句话 */
  message: string
  /** 出问题时 AI 上一次返回的原始内容（截断），便于排查 */
  rawExcerpt?: string
  /** 每次尝试的失败原因，用于诊断提示词问题 */
  problems: string[]
}

export interface JudgeSuccess extends ParseSuccess {
  attempts: number
  /** 位置对不上而被丢弃的批注说明 */
  repaired: string[]
}

export type JudgeOutcome = JudgeSuccess | JudgeFailure

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string | null
  }>
  error?: { message?: string; type?: string; code?: string }
}

const KIND_MESSAGE: Record<JudgeFailureKind, string> = {
  'missing-key': '没有配置 DeepSeek API 密钥，无法批改。',
  unauthorized: 'API 密钥无效或已被吊销。请到 platform.deepseek.com 重新生成一个。',
  'insufficient-balance': 'DeepSeek 账户余额不足，请先充值。',
  'rate-limited': '调用过于频繁被限流，稍等几秒再提交即可。',
  'server-error': 'DeepSeek 服务端暂时故障，稍后重试即可。',
  timeout: '等待超时。译文较长时批改会慢一些，可以再试一次。',
  network: '网络连接失败，请检查网络后重试。',
  truncated: 'AI 的返回被截断了（内容超出单次输出上限），因此不是完整的批改结果。',
  'bad-output': 'AI 连续几次返回的结果都无法通过校验，本次批改未完成。',
}

function fail(kind: JudgeFailureKind, problems: string[], extra?: Partial<JudgeFailure>): JudgeFailure {
  const detail = problems.filter(Boolean).join('；')
  return {
    ok: false,
    kind,
    message: detail ? `${KIND_MESSAGE[kind]}（${detail}）` : KIND_MESSAGE[kind],
    problems,
    ...extra,
  }
}

function classifyHttpError(status: number, body: DeepSeekResponse | undefined): JudgeFailureKind {
  const code = body?.error?.code ?? ''
  const message = body?.error?.message ?? ''
  if (status === 401) return 'unauthorized'
  if (status === 402 || /insufficient|balance/i.test(`${code}${message}`)) return 'insufficient-balance'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server-error'
  if (status === 400 && /auth/i.test(`${code}${message}`)) return 'unauthorized'
  return 'server-error'
}

async function callDeepSeek(
  config: JudgeConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<{ ok: true; content: string; finishReason: string } | { ok: false; failure: JudgeFailure }> {
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        // 官方 JSON 输出模式：配合提示词里出现的 json 字样，强制返回合法 JSON
        response_format: { type: 'json_object' },
        temperature: 0.2,
        stream: false,
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, failure: fail('timeout', []) }
    return { ok: false, failure: fail('network', [error instanceof Error ? error.message : String(error)]) }
  }

  const text = await response.text()
  let body: DeepSeekResponse | undefined
  try {
    body = JSON.parse(text) as DeepSeekResponse
  } catch {
    body = undefined
  }

  if (!response.ok) {
    const kind = classifyHttpError(response.status, body)
    const detail = body?.error?.message ?? text.slice(0, 200)
    return { ok: false, failure: fail(kind, [`HTTP ${response.status}：${detail}`]) }
  }

  const choice = body?.choices?.[0]
  const content = choice?.message?.content ?? ''
  const finishReason = choice?.finish_reason ?? ''
  if (!content) {
    return { ok: false, failure: fail('bad-output', ['返回内容为空', text.slice(0, 200)]) }
  }
  return { ok: true, content, finishReason }
}

/**
 * 执行一次批改。重试在内部完成：每轮把上一轮的具体失败原因交给模型。
 * onRetry 会收到每一轮的进展，便于界面显示"正在重试（第 2 次）"。
 */
export async function judgeAnswer(
  request: CorrectionRequest,
  config: JudgeConfig,
  onRetry?: (info: { attempt: number; problems: string[] }) => void,
): Promise<JudgeOutcome> {
  if (!config.apiKey) return fail('missing-key', [])

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(request) },
  ]

  const allProblems: string[] = []
  let lastRaw = ''

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)

    let result: Awaited<ReturnType<typeof callDeepSeek>>
    try {
      result = await callDeepSeek(config, messages, controller.signal)
    } finally {
      clearTimeout(timer)
    }

    if (!result.ok) {
      // 这几类失败重试没有意义，直接返回，让用户去处理
      const kind = result.failure.kind
      if (kind === 'unauthorized' || kind === 'insufficient-balance' || kind === 'missing-key') return result.failure
      allProblems.push(...result.failure.problems)
      if (attempt === config.maxAttempts) return result.failure
      continue
    }

    lastRaw = result.content

    // 被截断时返回的 JSON 一定是残缺的，重试时要求它把话说短
    if (result.finishReason === 'length') {
      const problems = ['上一次的返回因为太长被截断了，请精简每条 explanation 与评语的文字，确保 JSON 完整闭合']
      allProblems.push(...problems)
      if (attempt === config.maxAttempts) {
        return fail('truncated', problems, { rawExcerpt: lastRaw.slice(-400) })
      }
      onRetry?.({ attempt, problems })
      messages.push({ role: 'assistant', content: lastRaw })
      messages.push({ role: 'user', content: buildRetryPrompt(problems) })
      continue
    }

    const parsed = parseCorrection(result.content, request.answer)
    if (parsed.ok) {
      return { ...parsed, attempts: attempt }
    }

    allProblems.push(...parsed.problems)
    if (attempt === config.maxAttempts) {
      return fail('bad-output', parsed.problems, { rawExcerpt: lastRaw.slice(0, 400) })
    }

    onRetry?.({ attempt, problems: parsed.problems })
    messages.push({ role: 'assistant', content: lastRaw })
    messages.push({ role: 'user', content: buildRetryPrompt(parsed.problems) })
  }

  return fail('bad-output', allProblems, { rawExcerpt: lastRaw.slice(0, 400) })
}
