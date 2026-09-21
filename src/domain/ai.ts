/**
 * DeepSeek 批改调用。
 *
 * 设计要点：
 * - 使用官方 JSON 输出模式（response_format = json_object），并要求提示词里出现 "json" 字样
 * - 解析失败时把**具体原因**回传给模型重试，最多 3 次；仍失败就如实报错，不猜不凑
 * - **按段调用**：长文本按段落拆分，每段一个请求并行发出。段落之间互不依赖，
 *   因此总耗时取决于最慢的那一段，而不是各段之和；同时每段的上下文更短、位置更不容易数错。
 * - 明确区分几类真实故障：密钥无效、余额不足、限流、返回被截断、返回不是 JSON，
 *   这些在页面上要给出不同的下一步动作，而不是笼统的一句"出错了"
 *
 * 这一段代码同时被两种运行环境使用：本地开发时的 Node 测试脚本，以及部署后的 Worker。
 */

import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  buildRefineRetryPrompt,
  buildRefineSystemPrompt,
  buildRefineUserPrompt,
  buildRetryPrompt,
  buildSectionNote,
  buildSystemPrompt,
  buildUserPrompt,
  type CorrectionRequest,
  type GenerationRequest,
} from './prompt'
import { parseCorrection, type ParseSuccess } from './parse'
import { parseRefine, type RefineResult } from './refine'
import { validateCorrection } from './validate'
import { FailureCollector } from './archive'
import { mergeSectionCorrections, rebuildFromSections, type Section } from './sections'
import { parseGenerated, toGeneratedExercise, type GeneratedExercise } from './generate'

export interface JudgeConfig {
  apiKey: string
  /** 模型名。DeepSeek 当前可用：deepseek-flash、deepseek-v4-pro */
  model: string
  baseUrl: string
  /** 单次批改最多试几次（含首次），按"每一段"计 */
  maxAttempts: number
  /** 单次请求的超时时间（毫秒） */
  timeoutMs: number
  /** 同时最多发几个请求。太高会触发限流（429），太低会让长文章变慢 */
  maxConcurrency: number
}

export const DEFAULT_JUDGE_CONFIG: Omit<JudgeConfig, 'apiKey'> = {
  model: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com',
  maxAttempts: 3,
  timeoutMs: 120_000,
  maxConcurrency: 4,
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
  /** 按段调用时，是哪一段出的问题（从 1 开始） */
  sectionIndex?: number
  sectionCount?: number
}

export interface JudgeSuccess extends ParseSuccess {
  /** 各段尝试次数中的最大值 */
  attempts: number
  /** 本次一共发了几段 */
  sectionCount: number
  /**
   * AI 原样返回的完整文本（未经解析、未经收窄）。
   * 多段批改时按段落拼在一起，便于用户核对"模型到底说了什么"。
   */
  raw: string
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
  'rate-limited': '调用过于频繁被限流。文章模式下会同时发多个请求，稍等几秒再提交即可。',
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

interface SectionOutcome {
  ok: true
  parsed: ParseSuccess
  attempts: number
  /**
   * 这一段 AI 原样返回的文本（没有经过任何解析与收窄）。
   * 界面上的「查看 AI 完整返回内容」看到的就是它。
   */
  raw: string
}

/**
 * 批改单个段落。重试在内部完成：每轮把上一轮的具体失败原因交给模型。
 * collector 收集每一次不合格的原始返回，供调用方存档。
 */
async function judgeOneSection(
  request: CorrectionRequest,
  sectionNote: string | undefined,
  config: JudgeConfig,
  collector: FailureCollector,
  sectionIndex: number,
  sectionCount: number,
  onRetry?: (info: { attempt: number; problems: string[] }) => void,
): Promise<SectionOutcome | JudgeFailure> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(request, sectionNote) },
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
      const kind = result.failure.kind
      // 这几类失败重试没有意义，直接返回，让用户去处理
      if (kind === 'unauthorized' || kind === 'insufficient-balance' || kind === 'missing-key') {
        return { ...result.failure, sectionIndex, sectionCount }
      }
      allProblems.push(...result.failure.problems)
      if (attempt === config.maxAttempts) return { ...result.failure, sectionIndex, sectionCount }
      continue
    }

    lastRaw = result.content

    // 被截断时返回的 JSON 一定是残缺的，重试时要求它把话说短
    if (result.finishReason === 'length') {
      const problems = ['上一次的返回因为太长被截断了，请精简每条 explanation 的文字，确保 JSON 完整闭合']
      allProblems.push(...problems)
      collector.record(attempt, lastRaw, result.finishReason, problems, sectionIndex)
      if (attempt === config.maxAttempts) {
        return { ...fail('truncated', problems, { rawExcerpt: lastRaw.slice(-400) }), sectionIndex, sectionCount }
      }
      onRetry?.({ attempt, problems })
      messages.push({ role: 'assistant', content: lastRaw })
      messages.push({ role: 'user', content: buildRetryPrompt(problems) })
      continue
    }

    const parsed = parseCorrection(result.content, request.answer, request.direction)
    if (parsed.ok) return { ok: true, parsed, attempts: attempt, raw: lastRaw }

    allProblems.push(...parsed.problems)
    collector.record(attempt, lastRaw, result.finishReason, parsed.problems, sectionIndex)
    if (attempt === config.maxAttempts) {
      return { ...fail('bad-output', parsed.problems, { rawExcerpt: lastRaw.slice(0, 400) }), sectionIndex, sectionCount }
    }

    onRetry?.({ attempt, problems: parsed.problems })
    messages.push({ role: 'assistant', content: lastRaw })
    messages.push({ role: 'user', content: buildRetryPrompt(parsed.problems) })
  }

  return { ...fail('bad-output', allProblems, { rawExcerpt: lastRaw.slice(0, 400) }), sectionIndex, sectionCount }
}

/** 带并发上限的 map，用来避免一次性发出太多请求被限流。 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) continue
      results[index] = await worker(item, index)
    }
  })

  await Promise.all(runners)
  return results
}

export interface JudgeSectionsInput {
  /** 除作答之外的题目信息 */
  request: Omit<CorrectionRequest, 'answer'>
  /**
   * 作答按段落切分后的结果，每项带它在全文中的起点。
   * 单段题只有一个元素。
   *
   * 起点由调用方给出而不是程序推断：合并后的批注序号全部基于这些起点，
   * 由调用方声明、并与它自己记录的一致，比事后猜测分隔符宽度可靠得多。
   */
  sections: Section[]
}

/**
 * 批改一次作答。
 *
 * 单段与多段走同一条路径：只有一段时就只有一个请求，行为与之前完全一致。
 * 多段时并行发出（受 maxConcurrency 限制），全部成功后把批注序号换算到全文坐标再合并。
 */
export async function judgeAnswer(
  input: JudgeSectionsInput,
  config: JudgeConfig,
  onRetry?: (info: { attempt: number; problems: string[]; sectionIndex: number }) => void,
  collector: FailureCollector = new FailureCollector(),
): Promise<JudgeOutcome> {
  if (!config.apiKey) return fail('missing-key', [])

  const { request, sections } = input
  if (sections.length === 0) {
    return {
      ok: true,
      correction: { errors: [], highlights: [] },
      validated: { errors: [], highlights: [], rejections: [] },
      repaired: [],
      attempts: 0,
      sectionCount: 0,
      raw: '',
    }
  }

  const total = sections.length
  const outcomes = await mapWithLimit(sections, config.maxConcurrency, (section, index) =>
    judgeOneSection(
      { ...request, answer: section.text },
      total > 1 ? buildSectionNote(index + 1, total) : undefined,
      config,
      collector,
      index + 1,
      total,
      onRetry ? (info) => onRetry({ ...info, sectionIndex: index + 1 }) : undefined,
    ),
  )

  const failures = outcomes.filter((outcome): outcome is JudgeFailure => 'ok' in outcome && outcome.ok === false)
  if (failures.length > 0) {
    // 只要有一段没成功，整次批改就如实报失败——半份批改比没有批改更误导人
    const first = failures[0]
    if (!first) return fail('bad-output', [])
    const label = total > 1 ? `第 ${first.sectionIndex}/${total} 段批改失败：` : ''
    return { ...first, message: `${label}${first.message}` }
  }

  const successes = outcomes as SectionOutcome[]
  const merged = mergeSectionCorrections(
    successes.map((outcome, index) => ({
      answerStart: sections[index]?.start ?? 0,
      correction: outcome.parsed.correction,
    })),
  )

  // 合并后的区间已经换算到全文坐标，这里在全文上再校验一次。
  // 这一步能挡住"段落起点算错"这类整篇错位的问题。
  //
  // 注意：不要走 parseCorrection 再解析一遍——那是旧的"让 AI 给序号"方案留下来的做法，
  // 而合并后的批注已经没有 oldText 可供重新定位了。位置此刻就在手上，直接校验区间。
  const mergedAnswer = rebuildFromSections(sections)
  const revalidated = validateCorrection(merged.errors, merged.highlights, mergedAnswer, request.direction)
  if (merged.errors.length > 0 && revalidated.errors.length === 0) {
    return fail('bad-output', [
      '合并后的批注在全文坐标下全部校验失败，说明段落起点的换算有问题',
      `重建的全文长 ${mergedAnswer.length} 字符，共 ${sections.length} 段`,
      ...revalidated.rejections.slice(0, 4).map((rejection) => `${rejection.id}：${rejection.message}`),
    ])
  }

  const repaired = successes.flatMap((outcome) => outcome.parsed.repaired)
  // 多段时把每段的原始返回拼起来并标出段号，用户才能把"模型说的话"与"哪一段"对上
  const raw = successes
    .map((outcome, index) => (total > 1 ? `── 第 ${index + 1}/${total} 段的返回 ──\n${outcome.raw}` : outcome.raw))
    .join('\n\n')
  return {
    ok: true,
    correction: merged,
    validated: revalidated,
    repaired,
    attempts: Math.max(...successes.map((outcome) => outcome.attempts)),
    sectionCount: total,
    raw,
  }
}

/* ── 精修档：整篇逐句重写 ────────────────────────────────── */

export interface RefineSuccess {
  ok: true
  refine: RefineResult
  /** 试了几次（含首次） */
  attempts: number
  /** AI 原样返回的文本，与批改一样留给「查看完整返回」 */
  raw: string
}

export type RefineOutcome = RefineSuccess | JudgeFailure

/**
 * 精修档：让模型把这一段译文**逐句重写**，并给一个总体分数与评语。
 *
 * 与润色档的关系：
 *   - 走**同一套模型调用、超时与失败分类**（密钥无效 / 余额不足 / 被截断这些提示两边完全一致）；
 *   - 但提示词、解析器、产物都不同（见 prompt.ts 的 buildRefineSystemPrompt 与 domain/refine.ts）。
 *
 * 一次请求：精修的产物是"整篇重写"，而逐页批改下**这一页本来就只有一个段落**，
 * 再按段拆开并行反而会把同一篇的上下文切断（改写要看全篇才知道语序怎么调）。
 */
export async function refineAnswer(
  request: CorrectionRequest,
  config: JudgeConfig,
  collector: FailureCollector = new FailureCollector(),
): Promise<RefineOutcome> {
  if (!config.apiKey) return fail('missing-key', [])

  const messages: ChatMessage[] = [
    { role: 'system', content: buildRefineSystemPrompt() },
    { role: 'user', content: buildRefineUserPrompt(request) },
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
      const { kind } = result.failure
      if (kind === 'unauthorized' || kind === 'insufficient-balance' || kind === 'missing-key') return result.failure
      allProblems.push(...result.failure.problems)
      if (attempt === config.maxAttempts) return result.failure
      continue
    }

    lastRaw = result.content

    if (result.finishReason === 'length') {
      const problems = ['上一次的返回因为太长被截断了，请把每一句的 explanation 写短一些，确保 JSON 完整闭合']
      allProblems.push(...problems)
      collector.record(attempt, lastRaw, result.finishReason, problems, 1)
      if (attempt === config.maxAttempts) {
        return fail('truncated', problems, { rawExcerpt: lastRaw.slice(-400) })
      }
      messages.push({ role: 'assistant', content: lastRaw })
      messages.push({ role: 'user', content: buildRefineRetryPrompt(problems) })
      continue
    }

    const parsed = parseRefine(result.content, request.answer)
    if (parsed.ok) return { ok: true, refine: parsed.refine, attempts: attempt, raw: lastRaw }

    allProblems.push(...parsed.problems)
    collector.record(attempt, lastRaw, result.finishReason, parsed.problems, 1)
    if (attempt === config.maxAttempts) {
      return fail('bad-output', parsed.problems, { rawExcerpt: lastRaw.slice(0, 400) })
    }
    messages.push({ role: 'assistant', content: lastRaw })
    messages.push({ role: 'user', content: buildRefineRetryPrompt(parsed.problems) })
  }

  return fail('bad-output', allProblems, { rawExcerpt: lastRaw.slice(0, 400) })
}

/* ── AI 出题 ──────────────────────────────────────────────── */

export interface GenerationSuccess {
  ok: true
  exercise: GeneratedExercise
  attempts: number
  /** AI 原样返回的文本，与批改一样留给「查看完整返回」 */
  raw: string
}

export type GenerationOutcome = GenerationSuccess | JudgeFailure

/**
 * 生成一道新题。
 *
 * 与批改共用同一套模型调用、超时与失败分类（这样"密钥无效/余额不足/被截断"
 * 在两条链路上的提示完全一致），差别只在提示词与校验：
 * 批改校验的是批注位置，出题校验的是**篇长**——不达标就拿原因重试。
 */
export async function generateExercise(
  request: GenerationRequest,
  config: JudgeConfig,
): Promise<GenerationOutcome> {
  if (!config.apiKey) return fail('missing-key', [])

  const messages: ChatMessage[] = [
    { role: 'system', content: buildGenerationSystemPrompt() },
    { role: 'user', content: buildGenerationUserPrompt(request) },
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
      const { kind } = result.failure
      if (kind === 'unauthorized' || kind === 'insufficient-balance' || kind === 'missing-key') return result.failure
      allProblems.push(...result.failure.problems)
      if (attempt === config.maxAttempts) return result.failure
      continue
    }

    lastRaw = result.content

    if (result.finishReason === 'length') {
      const problems = ['上一次的返回因为太长被截断了，请把段落写得紧凑一些，确保 JSON 完整闭合']
      allProblems.push(...problems)
      if (attempt === config.maxAttempts) {
        return fail('truncated', problems, { rawExcerpt: lastRaw.slice(-400) })
      }
      messages.push({ role: 'assistant', content: lastRaw })
      messages.push({ role: 'user', content: buildRetryPrompt(problems) })
      continue
    }

    const parsed = parseGenerated(result.content, request)
    if (parsed.ok) {
      return { ok: true, exercise: toGeneratedExercise(parsed.article, request.mode), attempts: attempt, raw: lastRaw }
    }

    allProblems.push(...parsed.problems)
    if (attempt === config.maxAttempts) {
      return fail('bad-output', allProblems, { rawExcerpt: lastRaw.slice(0, 400) })
    }
    messages.push({ role: 'assistant', content: lastRaw })
    messages.push({ role: 'user', content: buildRetryPrompt(parsed.problems) })
  }

  return fail('bad-output', allProblems, { rawExcerpt: lastRaw.slice(0, 400) })
}