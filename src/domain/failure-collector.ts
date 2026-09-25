/**
 * 批改失败的**收集器与记录形状**——纯内存、纯计算，不碰任何宿主特有的东西。
 *
 * 为什么要从 `archive.ts` 里拆出来：线上那一半（Cloudflare Pages Functions）跑在 workerd 里，
 * **没有文件系统**。而 `archive.ts` 里那句 `await import('node:fs')` 虽然在运行时被 try/catch
 * 兜住了（那边现在就是这么写的，见它的注释），但**打包器在构建期**解析不到 `node:fs` 会直接失败——
 * 也就是说，只要线上那份代码 import 到 archive.ts，"能不能跑"就不由我们决定了。
 *
 * 于是按"谁能用"切一刀：
 * - 这里放**两边都能用**的：失败记录的字段、收集器、把收集到的东西拼成一条记录。
 * - `archive.ts` 只留**只有本地能用**的：把记录写进 `.ai-failures/`。
 *   它在文件末尾把这里的东西原样再导出一次，因此老调用点一行都不用改。
 */

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
  /** 第几次尝试，从 1 开始（按段计时） */
  attempt: number
  /** 按段调用时是第几段，单段题为 1 */
  sectionIndex: number
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
  record(attempt: number, raw: string, finishReason: string, problems: string[], sectionIndex = 1): void {
    this.attempts.push({ attempt, sectionIndex, raw, finishReason, problems })
  }

  get isEmpty(): boolean {
    return this.attempts.length === 0
  }
}

/**
 * 把收集到的东西拼成一条失败记录。
 *
 * 之所以把"拼记录"和"写记录"分开：本地写文件、线上只能打日志，
 * 但**记录里该有什么**两边必须完全一致，否则从线上日志里读到的证据会比本地的少一块，
 * 拿它改提示词就会得出不一样的结论。
 *
 * `now` 可注入，测试才不用等真实的墙钟。
 */
export function buildFailureRecord(
  request: { source: string; direction: string; genre: string; level: string },
  model: string,
  kind: FailureKind,
  collector: FailureCollector,
  fullAnswer: string,
  extraNote?: string,
  now: Date = new Date(),
): FailureRecord {
  return {
    id: `${now.toISOString().replace(/[:.]/g, '-')}-${kind}`,
    at: now.toISOString(),
    kind,
    attempts: collector.attempts.length,
    model,
    request: {
      direction: request.direction,
      genre: request.genre,
      level: request.level,
      answerLength: fullAnswer.length,
      source: request.source,
      answer: fullAnswer,
    },
    history: collector.attempts,
    note: extraNote,
  }
}

/**
 * 一行摘要：只放一眼能看出问题类型的信息，完整记录在记录本身里。
 *
 * 线上没有"同目录的 json 文件"可以翻，这一行就是失败与成功之间唯一的抓手，
 * 因此线上也必须打它——不能只在本地拼。
 */
export function summarizeFailureRecord(record: FailureRecord): string {
  const first = record.history[0]?.problems[0] ?? ''
  const last = record.history[record.history.length - 1]?.problems[0] ?? ''
  return (
    `${record.at}  ${record.kind}  attempts=${record.attempts}  ` +
    `${record.request.direction}/${record.request.genre}/${record.request.level}  ` +
    `首次问题: ${first.slice(0, 120)}  |  末次问题: ${last.slice(0, 120)}`
  )
}
