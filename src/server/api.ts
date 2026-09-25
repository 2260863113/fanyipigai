/**
 * 三个 AI 接口的**共用实现**：`/api/judge`（批改）、`/api/refine`（大改）、`/api/generate`（出题）。
 *
 * 为什么要有这个文件：这三条链路原先只存在于 `vite-plugin-judge-api.ts`——那是一个
 * **Vite 开发服务器的插件**，只在本机 `npm run dev` 时存在。于是"线上怎么批改"这件事
 * 一直空着（README 的「尚未开始」里写着它）。补上线上那一半时最怕的不是写不出来，
 * 而是**写成两份**：本地一份、线上另一份，改提示词时只改了一边，线上悄悄跑着旧逻辑——
 * 这个项目已经吃过一次这种亏（改 `src/domain/prompt.ts` 后本地不生效，见那个插件里的长注释）。
 *
 * 因此这里按"**一次实现，两个宿主**"来切：
 * - 本文件：请求校验、编排、日志文案、失败归档的**时机与内容**。不碰文件、不碰 `process`、
 *   不 import `node:*`，因此 Node 与 workerd 都能跑。
 * - 宿主（`vite-plugin-judge-api.ts` / `functions/`）：只提供"我这边怎么拿到密钥、日志往哪写、
 *   失败记录往哪存"。两边唯一的差别就是这几件事，而且都被 `ApiHost` 摆在明面上。
 *
 * 还有一处**故意的不对称**：宿主自己拿领域模块，而不是由本文件 `import`。
 * 因为本地开发要按请求重新加载 `src/domain/ai.ts`（改提示词立刻见效），
 * 而 workerd 里没有"按请求重载"这回事，用静态 import 就行。
 */

import {
  buildFailureRecord,
  FailureCollector,
  type FailureKind,
  type FailureRecord,
} from '../domain/failure-collector'
import { rebuildFromSections, type Section } from '../domain/sections'
import {
  PROBLEM_JSON_PARSE_FAILED,
  PROBLEM_NO_ANCHOR_MATCH,
  PROBLEM_NO_JSON_OBJECT,
} from '../domain/parse'
import { PROBLEM_ANCHOR_NOT_FOUND } from '../domain/locate'
import { ANCHOR_MISMATCH_MARKER } from '../domain/validate'
import type { Direction, Genre, Mode, PolishLevel } from '../domain/types'

/**
 * 宿主必须提供的领域模块。
 *
 * 用 `typeof import(...)` 而不是手抄一遍签名：抄一遍就会漂移，
 * 而这里漂移的后果是"线上调到的函数签名和本地不一样"，属于最难查的一类。
 */
export type ServerDomain = Pick<
  typeof import('../domain/ai'),
  'judgeAnswer' | 'refineAnswer' | 'generateExercise' | 'DEFAULT_JUDGE_CONFIG'
>

export type ApiKind = 'judge' | 'refine' | 'generate'

export interface ApiLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** 宿主契约：本文件里凡是"两边不一样"的地方，都在这里。 */
export interface ApiHost {
  /** 领域模块。本地按请求重新加载，线上静态 import。 */
  domain: ServerDomain
  /** DeepSeek 密钥。本地来自 `.dev.vars`，线上来自 Cloudflare 的 Secret。 */
  apiKey: string
  /** 覆盖模型名（`.dev.vars` / 环境变量里的 DEEPSEEK_MODEL）。不给就用领域层的默认值。 */
  modelOverride?: string
  /** 日志前缀：本地 `[judge-api]`，线上 `[api]`，这样一眼能看出这条日志是哪边打的。 */
  tag: string
  /** 出错时的自称：`本地接口` / `服务端`。 */
  deploymentLabel: string
  /** 没有密钥时那句提示的后半截——两边该去哪儿填密钥是不同的。 */
  missingKeyHint: string
  /** 失败详情去了哪儿（拼进日志）：本地是 `.ai-failures/`，线上是服务端日志。 */
  archiveNote: string
  log: ApiLogger
  /**
   * 归档一条失败记录。返回错误信息（成功时为空）。
   *
   * 本地写 `.ai-failures/` 的 json；线上没有文件系统，只能打进服务端日志——
   * 但**记录的内容必须一模一样**，否则从线上日志里读到的证据会比本地的少一块。
   */
  archive(record: FailureRecord): string | undefined | Promise<string | undefined>
}

/** 一个接口调用的结果。宿主把它变成一个 HTTP 响应，不再加工。 */
export interface ApiResult {
  status: number
  payload: unknown
}

const VALID_DIRECTIONS: readonly Direction[] = ['zh-to-en', 'en-to-zh']
const VALID_GENRES: readonly Genre[] = ['political', 'news', 'literature', 'expository']
const VALID_LEVELS: readonly PolishLevel[] = ['polish', 'refine']
const VALID_MODES: readonly Mode[] = ['article', 'paragraph', 'sentence', 'term']

function isPlainSection(value: unknown): value is { start: number; text: string } {
  if (typeof value !== 'object' || value === null) return false
  const section = value as Record<string, unknown>
  return (
    typeof section.start === 'number' &&
    typeof section.text === 'string' &&
    section.text.trim().length > 0
  )
}

function isGenerationRequest(value: unknown): value is {
  direction: Direction
  genre: Genre
  topic: string
  mode: Mode
} {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    VALID_DIRECTIONS.includes(body.direction as Direction) &&
    VALID_GENRES.includes(body.genre as Genre) &&
    VALID_MODES.includes(body.mode as Mode) &&
    typeof body.topic === 'string' &&
    body.topic.trim().length > 0 &&
    body.topic.length <= 40
  )
}

/**
 * 批改请求的合法性判据。
 *
 * ⚠️ 导出是为了让**验证脚本用它自己这道判据**去检查捕获到的请求
 * （见 scripts/verify-per-page.mjs）：接口桩只记录请求、不做校验，
 * 因此"两次请求的段数对不上"这类错误只有在真服务器的这道门里才会露头。
 * 曾经就有过一次真实故障：逐页批改时发的是"整篇原文分段（N）+ 一页作答（1）"，
 * 长度对不上 → 每次提交都 400"请求缺少必要字段或字段取值不合法"，一页都批不了。
 * 把判据本身交给测试，才不会又靠人记得。
 */
export function isCorrectionRequest(value: unknown): value is {
  source: string
  direction: Direction
  genre: Genre
  level: PolishLevel
  sourceSections: Array<{ start: number; text: string }>
  answerSections: Array<{ start: number; text: string }>
} {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.source === 'string' &&
    VALID_DIRECTIONS.includes(body.direction as Direction) &&
    VALID_GENRES.includes(body.genre as Genre) &&
    VALID_LEVELS.includes(body.level as PolishLevel) &&
    Array.isArray(body.sourceSections) &&
    body.sourceSections.length > 0 &&
    body.sourceSections.every(isPlainSection) &&
    Array.isArray(body.answerSections) &&
    body.answerSections.length === body.sourceSections.length &&
    body.answerSections.every(isPlainSection)
  )
}

/** 把请求里声明的段落还原成领域层的 Section（补上 end）。 */
export function toSections(items: Array<{ start: number; text: string }>): Section[] {
  return items.map((item) => ({
    start: item.start,
    end: item.start + item.text.length,
    text: item.text,
  }))
}

/**
 * 判断这次失败该归到哪一类存档。
 *
 * 归类会直接影响后续怎么看这些记录，所以规则写清楚：
 * - 返回被截断：输出太长，属于提示词里要求写太细
 * - 位置全部对不上：模型没按"逐字复制片段"的要求做 —— 最该看见的一类
 * - 重试次数用尽仍不合格：提示词约束不够
 * - 其余（JSON 解析不了、字段结构不合法）：格式约束问题
 *
 * 判据取自 **parse.ts / validate.ts 导出的常量**，不再内嵌散文。
 * 这里曾经写死一句 `'位置都与学生译文对不上'`——那是更早版本的文案，早已被改掉，
 * 于是这条分支**永远不可能命中**，实测 178 份存档里 `anchor-mismatch` 一个都没有，
 * 真正的定位失败全被误归成"格式不合法"，把维护者送去修 JSON 格式。
 */
export function classifyFailure(
  outcome: { kind: string; problems: string[] },
  maxAttempts: number,
): FailureKind {
  if (outcome.kind === 'truncated') return 'truncated'
  if (outcome.kind !== 'bad-output') return 'bad-json'
  const hit = (marker: string): boolean => outcome.problems.some((problem) => problem.includes(marker))
  // 先判"位置对不上"：它比"格式不对"更具体，也更需要被单独看见。
  // 真实文案有两条：parse.ts 直接转发 locate.ts 的「译文里找不到片段…」，
  // 以及 validate.ts 的拒绝说明「…与你译文中的文字对不上」。
  if (hit(PROBLEM_NO_ANCHOR_MATCH) || hit(ANCHOR_MISMATCH_MARKER) || hit(PROBLEM_ANCHOR_NOT_FOUND)) {
    return 'anchor-mismatch'
  }
  if (hit(PROBLEM_JSON_PARSE_FAILED) || hit(PROBLEM_NO_JSON_OBJECT)) return 'bad-json'
  return maxAttempts > 1 ? 'exhausted' : 'bad-json'
}

function badRequest(message: string): ApiResult {
  return { status: 400, payload: { ok: false, kind: 'bad-request', message } }
}

function missingKey(host: ApiHost, withGoal: boolean): ApiResult {
  return {
    status: 503,
    payload: {
      ok: false,
      kind: 'missing-key',
      message: withGoal
        ? `没有配置 DeepSeek API 密钥，无法出题。${host.missingKeyHint}`
        : `没有配置 DeepSeek API 密钥。${host.missingKeyHint}`,
    },
  }
}

/** 日志里那句"失败详情去了哪儿"：归档失败就报失败原因，没收集到东西就什么都不说。 */
function archiveSuffix(
  collector: FailureCollector,
  saved: string | undefined,
  host: ApiHost,
): string {
  if (collector.isEmpty) return ''
  return saved ? `（存档失败：${saved}）` : `（${host.archiveNote}）`
}

function secondsSince(started: number): string {
  return ((Date.now() - started) / 1000).toFixed(1)
}

/** 领域层的模型名：宿主给了覆盖就用它，没给就用领域层默认值（`deepseek-flash`）。 */
function modelOf(host: ApiHost): string {
  return host.modelOverride ?? host.domain.DEFAULT_JUDGE_CONFIG.model
}

/**
 * 处理一次接口调用。
 *
 * `body` 是**已经解析好的 JSON**（解析失败是宿主的事：本地读的是 Node 流，线上是 `request.json()`），
 * 这样本文件就不必知道请求是怎么来的。
 *
 * 约定与之前完全一致：**只要走到了业务逻辑，HTTP 状态一律 200**，
 * 失败写在 `payload.ok = false` 里——因为"批改失败"对前端来说不是网络错误，
 * 界面要用 `message` 把原因原样显示出来。只有请求本身不合法（400）、没配密钥（503）、
 * 以及未预期的异常（500）才用非 200。
 */
export async function handleApi(kind: ApiKind, body: unknown, host: ApiHost): Promise<ApiResult> {
  try {
    return kind === 'generate' ? await runGenerate(body, host) : await runCorrection(kind, body, host)
  } catch (error: unknown) {
    host.log.error(
      `${host.tag} 未预期的错误：${error instanceof Error ? error.stack : String(error)}`,
    )
    return {
      status: 500,
      payload: {
        ok: false,
        kind: 'server-error',
        message: `${host.deploymentLabel}出错：${error instanceof Error ? error.message : String(error)}`,
      },
    }
  }
}

/** 出题：同一条路径、同一把密钥，只是提示词与校验不同。 */
async function runGenerate(body: unknown, host: ApiHost): Promise<ApiResult> {
  if (!isGenerationRequest(body)) return badRequest('出题请求缺少必要字段或字段取值不合法')
  if (!host.apiKey) return missingKey(host, true)

  const started = Date.now()
  const outcome = await host.domain.generateExercise(body, {
    ...host.domain.DEFAULT_JUDGE_CONFIG,
    apiKey: host.apiKey,
    model: modelOf(host),
  })
  host.log.info(
    `${host.tag} 出题${outcome.ok ? '完成' : '失败'}，用时 ${secondsSince(started)}s` +
      (outcome.ok ? `，${body.mode} · ${body.topic} · 原文已留存` : `：${outcome.message}`),
  )
  return { status: 200, payload: outcome }
}

/**
 * 批改与大改。
 *
 * 两条链路共用请求形状与校验（都是 `isCorrectionRequest`），差别只有三处：
 * 调哪个领域函数、成功时怎么记日志、以及**大改的产物是整篇逐句重写**（因此没有错误列表可数）。
 * 单独两条路径而不是在一个处理器里分支，是因为两边的提示词、解析器、产物都不同，
 * 混在一起只会让两条链路互相牵制。
 */
async function runCorrection(
  kind: 'judge' | 'refine',
  body: unknown,
  host: ApiHost,
): Promise<ApiResult> {
  if (!isCorrectionRequest(body)) return badRequest('请求缺少必要字段或字段取值不合法')
  if (!host.apiKey) return missingKey(host, false)

  const started = Date.now()
  const collector = new FailureCollector()
  const answerSections = toSections(body.answerSections)
  const fullAnswer = rebuildFromSections(answerSections)
  const config = { ...host.domain.DEFAULT_JUDGE_CONFIG, apiKey: host.apiKey, model: modelOf(host) }

  if (kind === 'judge') {
    const judgeInput = {
      request: {
        source: body.source,
        direction: body.direction,
        genre: body.genre,
        level: body.level,
      },
      sections: answerSections,
    }
    const outcome = await host.domain.judgeAnswer(judgeInput, config, undefined, collector)
    const elapsed = secondsSince(started)
    const sectionNote = answerSections.length > 1 ? `，共 ${answerSections.length} 段并行批改` : ''

    if (outcome.ok) {
      /*
       * 成功时理论上不会留下记录；万一有（前几次不合格、最后一次通过），也存下来，
       * 因为"重试后才成功"同样是提示词需要改进的信号。
       */
      if (!collector.isEmpty) {
        const saved = await host.archive(
          buildFailureRecord(body, config.model, 'exhausted', collector, fullAnswer, '最终成功，但过程中有不合格的返回'),
        )
        host.log.info(
          `${host.tag} 本次批改经过多次尝试才成功，失败过程已存档${saved ? `（存档失败：${saved}）` : ''}`,
        )
      }
      host.log.info(
        `${host.tag} 批改完成，用时 ${elapsed}s${sectionNote}，` +
          `错误 ${outcome.validated.errors.length} 处，亮点 ${outcome.validated.highlights.length} 处，` +
          `丢弃 ${outcome.repaired.length} 处`,
      )
      return { status: 200, payload: outcome }
    }

    // 失败存档：这是后续优化提示词的主要依据
    const saved = collector.isEmpty
      ? undefined
      : await host.archive(
          buildFailureRecord(body, config.model, classifyFailure(outcome, 3), collector, fullAnswer, outcome.message),
        )
    host.log.warn(
      `${host.tag} 批改失败（${outcome.kind}，用时 ${elapsed}s${sectionNote}）：${outcome.message}` +
        archiveSuffix(collector, saved, host),
    )
    return { status: 200, payload: outcome }
  }

  const outcome = await host.domain.refineAnswer(
    {
      source: body.source,
      direction: body.direction,
      genre: body.genre,
      level: body.level,
      answer: fullAnswer,
    },
    config,
    collector,
  )
  const elapsed = secondsSince(started)

  if (outcome.ok) {
    // 大改档**不打分**了（用户拍板），因此日志里只报逐句条数
    host.log.info(
      `${host.tag} 大改完成，用时 ${elapsed}s，逐句 ${outcome.refine.sentences.length} 条（这一档不打分）`,
    )
    return { status: 200, payload: outcome }
  }

  const saved = collector.isEmpty
    ? undefined
    : await host.archive(
        buildFailureRecord(body, config.model, classifyFailure(outcome, 3), collector, fullAnswer, outcome.message),
      )
  host.log.warn(
    `${host.tag} 精修失败（${outcome.kind}，用时 ${elapsed}s）：${outcome.message}` +
      archiveSuffix(collector, saved, host),
  )
  return { status: 200, payload: outcome }
}
