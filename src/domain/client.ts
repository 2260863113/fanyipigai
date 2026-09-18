/**
 * 调用批改接口。
 *
 * 前端永远不接触 API 密钥——请求发给同源的 /api/judge，
 * 由本地开发接口（将来是 Cloudflare Worker）在服务端补上密钥再转发。
 *
 * 请求按「段」组织：每段带它在全文中的起点。文章题因此会被拆成多个段落并行批改，
 * 单段题只会有一个元素，行为与不分段完全一致。
 */

import type { Direction, Genre, PolishLevel } from './types'
import type { JudgeFailure, JudgeSuccess } from './ai'

export type JudgeResult = JudgeSuccess | JudgeFailure

export interface JudgeSectionInput {
  /** 该段在全文中的起始字符序号 */
  start: number
  text: string
}

export interface JudgeRequest {
  source: string
  referenceTranslation: string
  direction: Direction
  genre: Genre
  level: PolishLevel
  /** 原文按段落切分 */
  sourceSections: JudgeSectionInput[]
  /** 作答按同样的段落切分 */
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
