/**
 * 本地开发用的 API 通道。
 *
 * 为什么需要它：浏览器的代码里绝不能出现 API 密钥——任何人按 F12 就能抄走。
 * 因此批改请求先发给本地这个接口，由它在服务端补上密钥再转发给 DeepSeek。
 * 部署到 Cloudflare Workers 后，同一路径由 Worker 承担，前端代码不需要改动。
 *
 * 密钥来源：项目根目录的 .dev.vars（已在 .gitignore 里，不会进仓库）。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin } from 'vite'
import { DEFAULT_JUDGE_CONFIG, generateExercise, judgeAnswer } from './src/domain/ai'
import { FailureCollector, archiveFailure, type FailureKind } from './src/domain/archive'
import { rebuildFromSections, type Section } from './src/domain/sections'
import { PROBLEM_JSON_PARSE_FAILED, PROBLEM_NO_ANCHOR_MATCH, PROBLEM_NO_JSON_OBJECT } from './src/domain/parse'
import { PROBLEM_ANCHOR_NOT_FOUND } from './src/domain/locate'
import { ANCHOR_MISMATCH_MARKER } from './src/domain/validate'
import type { Direction, Genre, Mode, PolishLevel } from './src/domain/types'

const VALID_DIRECTIONS: readonly Direction[] = ['zh-to-en', 'en-to-zh']
const VALID_GENRES: readonly Genre[] = ['political', 'news', 'literature', 'expository']
const VALID_LEVELS: readonly PolishLevel[] = ['polish', 'refine']
const VALID_MODES: readonly Mode[] = ['article', 'paragraph', 'sentence', 'term']

/** 解析 .dev.vars（形如 KEY=value 的纯文本）。文件不存在时返回空表。 */
function readDevVars(root: string): Record<string, string> {
  const file = path.join(root, '.dev.vars')
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return {}
  }

  const values: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    // 去掉可能存在的引号
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    values[key] = value
  }
  return values
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

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function isPlainSection(value: unknown): value is { start: number; text: string } {
  if (typeof value !== 'object' || value === null) return false
  const section = value as Record<string, unknown>
  return typeof section.start === 'number' && typeof section.text === 'string' && section.text.trim().length > 0
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
function isCorrectionRequest(value: unknown): value is {
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
function toSections(items: Array<{ start: number; text: string }>): Section[] {
  return items.map((item) => ({ start: item.start, end: item.start + item.text.length, text: item.text }))
}

function json(res: Parameters<Connect.NextHandleFunction>[1], status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export function judgeApiPlugin(): Plugin {
  return {
    name: 'judge-api',
    configureServer(server) {
      const root = server.config.root
      const devVars = readDevVars(root)
      const apiKey = devVars.DEEPSEEK_API_KEY ?? ''
      const model = devVars.DEEPSEEK_MODEL ?? DEFAULT_JUDGE_CONFIG.model

      if (!apiKey) {
        server.config.logger.warn(
          '[judge-api] 没有在 .dev.vars 里找到 DEEPSEEK_API_KEY，提交批改会返回明确错误。\n' +
            '            要先用内置示例看批注效果，可以点界面上的「查看内置示例批改」。',
        )
      } else {
        server.config.logger.info(`[judge-api] 已就绪，模型 ${model}`)
      }

      /*
       * AI 出题：同一条路径、同一把密钥，只是提示词与校验不同。
       * 校验失败（篇长不达标、JSON 坏掉）会带着原因重试，与批改一致。
       */
      server.middlewares.use('/api/generate', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        void (async () => {
          let body: unknown
          try {
            body = JSON.parse(await readBody(req))
          } catch {
            json(res, 400, { ok: false, kind: 'bad-request', message: '请求体不是合法的 JSON' })
            return
          }

          if (!isGenerationRequest(body)) {
            json(res, 400, { ok: false, kind: 'bad-request', message: '出题请求缺少必要字段或字段取值不合法' })
            return
          }

          if (!apiKey) {
            json(res, 503, {
              ok: false,
              kind: 'missing-key',
              message: '没有配置 DeepSeek API 密钥，无法出题。请在 .dev.vars 里填入 DEEPSEEK_API_KEY。',
            })
            return
          }

          const started = Date.now()
          const outcome = await generateExercise(body, { ...DEFAULT_JUDGE_CONFIG, apiKey, model })
          const elapsed = ((Date.now() - started) / 1000).toFixed(1)
          server.config.logger.info(
            `[judge-api] 出题${outcome.ok ? '完成' : '失败'}，用时 ${elapsed}s` +
              (outcome.ok ? `，${body.mode} · ${body.topic} · 原文已留存` : `：${outcome.message}`),
          )
          json(res, 200, outcome)
        })().catch((error: unknown) => {
          server.config.logger.error(`[judge-api] 出题时未预期的错误：${error instanceof Error ? error.stack : String(error)}`)
          if (!res.writableEnded) {
            json(res, 500, {
              ok: false,
              kind: 'server-error',
              message: `本地接口出错：${error instanceof Error ? error.message : String(error)}`,
            })
          }
        })
      })
      server.middlewares.use('/api/judge', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        void (async () => {
          let body: unknown
          try {
            body = JSON.parse(await readBody(req))
          } catch {
            json(res, 400, { ok: false, kind: 'bad-request', message: '请求体不是合法的 JSON' })
            return
          }

          if (!isCorrectionRequest(body)) {
            json(res, 400, { ok: false, kind: 'bad-request', message: '请求缺少必要字段或字段取值不合法' })
            return
          }

          if (!apiKey) {
            json(res, 503, {
              ok: false,
              kind: 'missing-key',
              message:
                '没有配置 DeepSeek API 密钥。请把 .dev.vars.example 复制成 .dev.vars 并填入 DEEPSEEK_API_KEY，然后重启开发服务。',
            })
            return
          }

          const started = Date.now()
          const collector = new FailureCollector()
          const answerSections = toSections(body.answerSections)
          const fullAnswer = rebuildFromSections(answerSections)
          const judgeInput = {
            request: {
              source: body.source,
              direction: body.direction,
              genre: body.genre,
              level: body.level,
            },
            sections: answerSections,
          }
          const outcome = await judgeAnswer(judgeInput, { ...DEFAULT_JUDGE_CONFIG, apiKey, model }, undefined, collector)
          const elapsed = ((Date.now() - started) / 1000).toFixed(1)
          const sectionNote = answerSections.length > 1 ? `，共 ${answerSections.length} 段并行批改` : ''

          if (outcome.ok) {
            // 成功时理论上不会留下记录；万一有（前几次不合格、最后一次通过），也存下来，
            // 因为"重试后才成功"同样是提示词需要改进的信号。
            if (!collector.isEmpty) {
              const saved = await archiveFailure(
                body,
                model,
                'exhausted',
                collector,
                fullAnswer,
                '最终成功，但过程中有不合格的返回',
              )
              server.config.logger.info(
                `[judge-api] 本次批改经过多次尝试才成功，失败过程已存档${saved ? `（存档失败：${saved}）` : ''}`,
              )
            }
            server.config.logger.info(
              `[judge-api] 批改完成，用时 ${elapsed}s${sectionNote}，` +
                `错误 ${outcome.validated.errors.length} 处，亮点 ${outcome.validated.highlights.length} 处，` +
                `丢弃 ${outcome.repaired.length} 处`,
            )
            json(res, 200, outcome)
            return
          }

          // 失败存档：这是后续优化提示词的主要依据
          const saved = collector.isEmpty
            ? undefined
            : await archiveFailure(
                body,
                model,
                classifyFailure(outcome, DEFAULT_JUDGE_CONFIG.maxAttempts),
                collector,
                fullAnswer,
                outcome.message,
              )

          server.config.logger.warn(
            `[judge-api] 批改失败（${outcome.kind}，用时 ${elapsed}s${sectionNote}）：${outcome.message}` +
              (collector.isEmpty ? '' : saved ? `（存档失败：${saved}）` : '（失败详情已存档到 .ai-failures/）'),
          )
          json(res, 200, outcome)
        })().catch((error: unknown) => {
          server.config.logger.error(`[judge-api] 未预期的错误：${error instanceof Error ? error.stack : String(error)}`)
          if (!res.writableEnded) {
            json(res, 500, {
              ok: false,
              kind: 'server-error',
              message: `本地接口出错：${error instanceof Error ? error.message : String(error)}`,
            })
          }
        })
      })
    },
  }
}
