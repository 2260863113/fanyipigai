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
import { DEFAULT_JUDGE_CONFIG, judgeAnswer } from './src/domain/ai'
import { FailureCollector, archiveFailure, type FailureKind } from './src/domain/archive'
import type { CorrectionRequest } from './src/domain/prompt'
import type { Direction, Genre, PolishLevel } from './src/domain/types'

const VALID_DIRECTIONS: readonly Direction[] = ['zh-to-en', 'en-to-zh']
const VALID_GENRES: readonly Genre[] = ['political', 'news', 'literature', 'expository']
const VALID_LEVELS: readonly PolishLevel[] = ['polish', 'refine']

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
 * - 重试次数用尽仍不合格：提示词约束不够，最需要关注
 * - 位置全部对不上：模型没按"逐字复制片段"的要求做
 * - 其余（JSON 解析不了、字段结构不合法）：格式约束问题
 */
function classifyFailure(outcome: { kind: string; problems: string[] }, maxAttempts: number): FailureKind {
  if (outcome.kind === 'truncated') return 'truncated'
  if (outcome.kind !== 'bad-output') return 'bad-json'
  if (outcome.problems.some((problem) => problem.includes('位置都与学生译文对不上'))) return 'anchor-mismatch'
  if (outcome.problems.some((problem) => problem.includes('JSON 解析失败'))) return 'bad-json'
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

function isCorrectionRequest(value: unknown): value is CorrectionRequest {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.source === 'string' &&
    typeof body.answer === 'string' &&
    typeof body.referenceTranslation === 'string' &&
    VALID_DIRECTIONS.includes(body.direction as Direction) &&
    VALID_GENRES.includes(body.genre as Genre) &&
    VALID_LEVELS.includes(body.level as PolishLevel)
  )
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
          const outcome = await judgeAnswer(body, { ...DEFAULT_JUDGE_CONFIG, apiKey, model }, undefined, collector)
          const elapsed = ((Date.now() - started) / 1000).toFixed(1)

          if (outcome.ok) {
            // 成功时理论上不会留下记录；万一有（前几次不合格、最后一次通过），也存下来，
            // 因为"重试后才成功"同样是提示词需要改进的信号。
            if (!collector.isEmpty) {
              const saved = await archiveFailure(body, model, 'exhausted', collector, '最终成功，但过程中有不合格的返回')
              server.config.logger.info(
                `[judge-api] 本次批改经过 ${outcome.attempts} 次尝试才成功，失败过程已存档${saved ? `（存档失败：${saved}）` : ''}`,
              )
            }
            server.config.logger.info(
              `[judge-api] 批改完成，用时 ${elapsed}s，尝试 ${outcome.attempts} 次，` +
                `错误 ${outcome.validated.errors.length} 处，亮点 ${outcome.validated.highlights.length} 处，` +
                `丢弃 ${outcome.repaired.length} 处`,
            )
            json(res, 200, outcome)
            return
          }

          // 失败存档：这是后续优化提示词的主要依据
          const saved = collector.isEmpty
            ? undefined
            : await archiveFailure(body, model, classifyFailure(outcome, DEFAULT_JUDGE_CONFIG.maxAttempts), collector, outcome.message)

          server.config.logger.warn(
            `[judge-api] 批改失败（${outcome.kind}，用时 ${elapsed}s）：${outcome.message}` +
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
