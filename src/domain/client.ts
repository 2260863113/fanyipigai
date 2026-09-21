/**
 * 调用批改接口。
 *
 * 前端永远不接触 API 密钥——请求发给同源的 /api/judge，
 * 由本地开发接口（将来是 Cloudflare Worker）在服务端补上密钥再转发。
 *
 * 请求按「段」组织：每段带它在全文中的起点，**原文分段与作答分段必须一一对应**
 * （服务端就是这么校验的）。多段时会并行批改，单段时就只有一个请求。
 *
 * ⚠️ 逐页批改之后，一次请求只发**正在批的那一页**：`sourceSections[i]` 是这一页的原文、
 * `answerSections[i]` 是这一页的译文，两边长度相同（通常都是 1）。
 * 不要"发整篇原文分段 + 只发一页作答"——长度对不上，服务端会直接 400
 * "请求缺少必要字段或字段取值不合法"（真实踩过，一页都批不了）。
 */

import type { Direction, Genre, Mode, PolishLevel } from './types'
import type { JudgeFailure, JudgeFailureKind, JudgeSuccess } from './ai'
import type { GeneratedExercise } from './generate'
import type { RefineResult } from './refine'

export type JudgeResult = JudgeSuccess | JudgeFailure

export interface JudgeSectionInput {
  /** 该段在**它自己那一篇文本**里的起始字符序号 */
  start: number
  text: string
}

export interface JudgeRequest {
  source: string
  direction: Direction
  genre: Genre
  level: PolishLevel
  /** 正在批的那一页的原文分段 */
  sourceSections: JudgeSectionInput[]
  /** 作答按同样的切分，**长度必须与 sourceSections 相同** */
  answerSections: JudgeSectionInput[]
}

interface JudgeApiSuccess extends JudgeSuccess {
  ok: true
}

interface JudgeApiFailure extends JudgeFailure {
  ok: false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function requestJudgment(request: JudgeRequest): Promise<JudgeResult> {
  let response: Response
  try {
    response = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch (error) {
    return {
      ok: false,
      kind: 'network',
      message: `无法连接批改接口：${error instanceof Error ? error.message : String(error)}`,
      problems: [],
    }
  }

  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return {
      ok: false,
      kind: 'bad-output',
      message: `批改接口返回了无法解析的内容（HTTP ${response.status}）`,
      rawExcerpt: text.slice(0, 300),
      problems: [],
    }
  }

  if (!isRecord(body) || typeof body.ok !== 'boolean') {
    return { ok: false, kind: 'bad-output', message: '批改接口返回的数据结构不符合预期', problems: [] }
  }

  if (body.ok) return body as unknown as JudgeApiSuccess

  const failure = body as unknown as JudgeApiFailure
  return {
    ok: false,
    kind: failure.kind ?? 'bad-output',
    message: failure.message ?? '批改未能完成',
    rawExcerpt: failure.rawExcerpt,
    problems: failure.problems ?? [],
  }
}

/* ── 大改档：整篇逐句重写 ────────────────────────────────── */

export type RefineResultPayload =
  | { ok: true; refine: RefineResult; attempts: number; raw: string }
  | { ok: false; kind: JudgeFailureKind | 'bad-request'; message: string; rawExcerpt?: string }

/**
 * 大改档：把这一段译文交给模型逐句重写。
 *
 * 请求形状与批改**完全一样**（同一份 JudgeRequest），只是打到另一条路径上——
 * 服务端据此换一套提示词与解析器（见 vite-plugin-judge-api.ts 的 /api/refine）。
 * 形状相同是有意的：逐页批改、分段校验、失败分类这些下游代码一行都不用改。
 */
export async function requestRefine(request: JudgeRequest): Promise<RefineResultPayload> {
  let response: Response
  try {
    response = await fetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch (error) {
    return {
      ok: false,
      kind: 'network',
      message: `无法连接批改接口：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return {
      ok: false,
      kind: 'bad-output',
      message: `批改接口返回了无法解析的内容（HTTP ${response.status}）`,
      rawExcerpt: text.slice(0, 300),
    }
  }

  if (!isRecord(body) || typeof body.ok !== 'boolean') {
    return { ok: false, kind: 'bad-output', message: '批改接口返回的数据结构不符合预期' }
  }
  if (body.ok) {
    const success = body as unknown as { refine: RefineResult; attempts: number; raw: string }
    return { ok: true, refine: success.refine, attempts: success.attempts ?? 1, raw: success.raw ?? '' }
  }
  const failure = body as unknown as { kind?: JudgeFailureKind; message?: string; rawExcerpt?: string }
  return {
    ok: false,
    kind: failure.kind ?? 'bad-output',
    message: failure.message ?? '大改未能完成',
    ...(failure.rawExcerpt !== undefined ? { rawExcerpt: failure.rawExcerpt } : null),
  }
}

/* ── AI 出题 ──────────────────────────────────────────────── */

export type GenerationResult =
  | { ok: true; exercise: GeneratedExercise; attempts: number; raw: string }
  | { ok: false; kind: JudgeFailureKind | 'bad-request'; message: string }

/** 按「领域 + 文体 + 方向」让 AI 现出一篇题。与批改走同一套错误分类。 */
export async function requestGeneration(request: {
  direction: Direction
  genre: Genre
  topic: string
  mode: Mode
}): Promise<GenerationResult> {
  let response: Response
  try {
    response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch (error) {
    return {
      ok: false,
      kind: 'network',
      message: `无法连接出题接口：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, kind: 'bad-output', message: `出题接口返回了无法解析的内容（HTTP ${response.status}）` }
  }
  if (!isRecord(body) || typeof body.ok !== 'boolean') {
    return { ok: false, kind: 'bad-output', message: '出题接口返回的数据结构不符合预期' }
  }
  if (body.ok) {
    const success = body as unknown as { exercise: GeneratedExercise; attempts: number; raw: string }
    return { ok: true, exercise: success.exercise, attempts: success.attempts ?? 1, raw: success.raw ?? '' }
  }
  const failure = body as unknown as { kind?: JudgeFailureKind; message?: string }
  return { ok: false, kind: failure.kind ?? 'bad-output', message: failure.message ?? '出题未能完成' }
}