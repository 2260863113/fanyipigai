/**
 * 调用批改接口。
 *
 * 前端永远不接触 API 密钥——请求发给同源的 /api/judge，
 * 由本地开发接口（将来是 Cloudflare Worker）在服务端补上密钥再转发。
 */

import type { CorrectionRequest } from './prompt'
import type { JudgeFailure, JudgeSuccess } from './ai'

export type JudgeResult = JudgeSuccess | JudgeFailure

export interface JudgeProgress {
  attempt: number
  problems: string[]
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

/**
 * 提交一次批改。
 * onProgress 只在客户端本地用于显示"第几次尝试"，服务端的重试对界面是透明的。
 */
export async function requestJudgment(request: CorrectionRequest): Promise<JudgeResult> {
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
