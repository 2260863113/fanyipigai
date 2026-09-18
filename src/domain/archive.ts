/**
 * AI 返回结果的失败存档。
 *
 * 为什么需要它：批改失败的原始返回是最有价值的调试材料，但它只存在于那一次调用里。
 * 没有存档，想优化提示词就只能靠回忆"它当时好像是返回了坏 JSON"。
 *
 * 存什么：每一次失败尝试的原始返回全文、finish_reason、失败原因、以及这一次请求的完整上下文
 *        （原文、参考译文、学生作答、方向、文体、风格、模型名）。
 *        原始返回是排查提示词问题的唯一直接证据，所以必须完整保留、不做截断。
 *
 * 不存什么：API 密钥。这条是硬性的——存档目录会被频繁查看和分享。
 *
 * 存在哪：项目根目录的 .ai-failures/，已被 .gitignore 忽略。
 *        文件形式而不是数据库，是为了能直接用编辑器打开、也能用 git diff 观察趋势。
 *
 * 运行环境：本地开发用 Node 写文件。部署到 Cloudflare Workers 后没有文件系统，
 *          写入会失败，此时只记录一条调试日志，不影响批改本身。
 */

import type { CorrectionRequest } from './prompt'

export type FailureKind =
  /** JSON 解析不了，或字段结构不合法 */
  | 'bad-json'
  /** 位置校验全部不通过，一处都标不出来 */
  | 'anchor-mismatch'
  /** 输出被单次上限截断 */
  | 'truncated'
  /** 重试用完仍不合格 */
  | 'exhausted'

export interface FailureAttempt {
  /** 第几次尝试，从 1 开始 */
  attempt: number
  /** 这一次的原始返回全文 */
  raw: string
  /** 结束原因，例如 stop / length */
  finishReason: string
  /** 这一次被判定出来的问题，会被回传给模型作为重试提示 */
  problems: string[]
}

export interface FailureRecord {
  id: string
  /** ISO 时间戳 */
  at: string
  kind: FailureKind
  /** 一共尝试了几次 */
  attempts: number
  model: string
  request: {
    direction: string
    genre: string
    level: string
    answerLength: number
    source: string
    referenceTranslation: string
    answer: string
  }
  history: FailureAttempt[]
  /** 收集过程中的备注，例如存档本身写失败了 */
  note?: string
}

/** 供 ai.ts 在调用过程中逐步收集失败信息。 */
export class FailureCollector {
  readonly attempts: FailureAttempt[] = []

  /** 记录一次不合格的返回。raw 保留全文，不做截断。 */
  record(attempt: number, raw: string, finishReason: string, problems: string[]): void {
    this.attempts.push({ attempt, raw, finishReason, problems })
  }

  get isEmpty(): boolean {
    return this.attempts.length === 0
  }
}

/** 把收集到的信息落盘。返回实际的错误信息（成功时为空）。 */
export async function archiveFailure(
  request: CorrectionRequest,
  model: string,
  kind: FailureKind,
  collector: FailureCollector,
  extraNote?: string,
): Promise<string | undefined> {
  const now = new Date()
  const record: FailureRecord = {
    id: `${now.toISOString().replace(/[:.]/g, '-')}-${kind}`,
    at: now.toISOString(),
    kind,
    attempts: collector.attempts.length,
    model,
    request: {
      direction: request.direction,
      genre: request.genre,
      level: request.level,
      answerLength: request.answer.length,
      source: request.source,
      referenceTranslation: request.referenceTranslation,
      answer: request.answer,
    },
    history: collector.attempts,
    note: extraNote,
  }

  // 摘要行：只放一眼能看出问题类型的信息，完整记录在同目录的 json 里
  const firstProblem = collector.attempts[0]?.problems[0] ?? ''
  const lastProblem = collector.attempts[collector.attempts.length - 1]?.problems[0] ?? ''
  const summaryLine =
    `${record.at}  ${kind}  attempts=${collector.attempts.length}  ` +
    `${request.direction}/${request.genre}/${request.level}  ` +
    `首次问题: ${firstProblem.slice(0, 120)}  |  末次问题: ${lastProblem.slice(0, 120)}`

  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.resolve(process.cwd(), '.ai-failures')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, `${record.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    )
    fs.appendFileSync(path.join(dir, 'summary.log'), `${summaryLine}\n`, 'utf8')
    return undefined
  } catch (error) {
    // 部署到没有文件系统的运行环境时走到这里。批改本身不受影响。
    return error instanceof Error ? error.message : String(error)
  }
}
