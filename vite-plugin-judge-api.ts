/**
 * 本地开发用的 API 通道。
 *
 * 为什么需要它：浏览器的代码里绝不能出现 API 密钥——任何人按 F12 就能抄走。
 * 因此批改请求先发给本地这个接口，由它在服务端补上密钥再转发给 DeepSeek。
 * 线上同一路径由 Cloudflare Pages Functions 承担（`functions/api/*.ts`），前端代码不需要改动。
 *
 * ⚠️ 这个文件**只剩宿主那一层**：请求怎么读、密钥从哪儿来、日志往哪写、失败记录往哪存。
 * 接口本身的行为（校验、编排、文案、什么时候归档）全在 `src/server/api.ts`，
 * 本地与线上调的是**同一份**。理由是这个项目已经吃过一次"两份实现各走各的"的亏：
 * 线上若留着旧逻辑，现象是"代码明明改了、行为却没变"，而它又只在线上出现，最难查。
 *
 * 密钥来源：项目根目录的 .dev.vars（已在 .gitignore 里，不会进仓库）。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin, ViteDevServer } from 'vite'
import { writeFailureRecord } from './src/domain/archive'
import { handleApi, type ApiKind, type ApiResult, type ServerDomain } from './src/server/api'
import type { FailureRecord } from './src/domain/failure-collector'

// 这两样是给**验证脚本**用的：`scripts/smoke.ts` 拿 classifyFailure 量失败归类，
// `scripts/verify-per-page.mjs` 拿 isCorrectionRequest 检查接口桩捕获到的请求形状。
// 它们现在住在 src/server/api.ts（本地与线上共用），这里原样再导出一次，调用点不用改。
export { classifyFailure, isCorrectionRequest } from './src/server/api'

/**
 * 按请求取一份**当前**的批改/出题模块（见 handler 里那段说明）。
 *
 * `ssrLoadModule` 走的是 vite 的模块图与它的失效机制，因此改 `src/domain/*.ts`
 * 之后**下一次提交就用新的**，不必重启 dev server——这正是我们想要的开发体验。
 * 这里只借用类型（`import type` 不产生运行时代码，因此不会把旧模块钉死）。
 */
async function loadDomain(server: ViteDevServer): Promise<ServerDomain> {
  return (await server.ssrLoadModule('/src/domain/ai.ts')) as unknown as ServerDomain
}

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

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
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
      /*
       * 启动时只报一句"就绪"，模型名要**从当前那份领域模块里读**——
       * 这里不能写死一个默认值：`.dev.vars` 里通常没有 DEEPSEEK_MODEL，
       * 真正的默认值在 `ai.ts` 的 DEFAULT_JUDGE_CONFIG 里（写在这里就等于把它覆盖掉，
       * 实测踩过：日志从 deepseek-flash 变成了 deepseek-chat，也就是请求真换了模型）。
       */
      void (async () => {
        if (!apiKey) {
          server.config.logger.warn(
            '[judge-api] 没有在 .dev.vars 里找到 DEEPSEEK_API_KEY，提交批改会返回明确错误。\n' +
              '            要先用内置示例看批注效果，可以点界面上的「查看内置示例批改」。',
          )
          return
        }
        try {
          const domain = await loadDomain(server)
          server.config.logger.info(
            `[judge-api] 已就绪，模型 ${devVars.DEEPSEEK_MODEL ?? domain.DEFAULT_JUDGE_CONFIG.model}`,
          )
        } catch {
          server.config.logger.info('[judge-api] 已就绪（模型名待第一次请求时再解析）')
        }
      })()

      /**
       * 组装这一次请求的宿主。
       *
       * 领域模块**每个请求都要重新取**。原因是一次真实故障：改了 `src/domain/prompt.ts` 之后，
       * 用户重新提交批改，却看到"中译英点批注、原文不出现颜色标注"——因为 dev server 是
       * **启动时**把这份插件（以及它静态 import 的整个领域模块图）加载进来的，
       * 改 `src/domain/*.ts` 不会让 vite 重启（只有改 vite.config.ts 才会），
       * 于是服务端一直在用**改动前的旧提示词**，模型自然没给 sourceText。
       * 这种"代码明明改了、行为却没变"的现象最难查，所以这里保持按请求动态加载：
       * `ssrLoadModule` 走的是 vite 的模块图，文件一变它就给新的那份。
       */
      const host = async () => ({
        domain: await loadDomain(server),
        apiKey,
        modelOverride: devVars.DEEPSEEK_MODEL,
        tag: '[judge-api]',
        deploymentLabel: '本地接口',
        missingKeyHint: '请把 .dev.vars.example 复制成 .dev.vars 并填入 DEEPSEEK_API_KEY，然后重启开发服务。',
        archiveNote: '失败详情已存档到 .ai-failures/',
        log: {
          info: (message: string) => server.config.logger.info(message),
          warn: (message: string) => server.config.logger.warn(message),
          error: (message: string) => server.config.logger.error(message),
        },
        // 本地有文件系统：整条记录写进 .ai-failures/（形状与线上日志里那条完全一样）
        archive: (record: FailureRecord) => writeFailureRecord(record),
      })

      /*
       * 三条路径各自的处理器都只剩这几行：读请求体 → 交给共用实现 → 把结果写回去。
       * 出题与批改走同一把密钥、同一套失败分类，只是提示词与校验不同；
       * 大改（/api/refine）单独一条路径而不是在 /api/judge 里分支，是因为两边的
       * 提示词、解析器、产物都不同，混在一个处理器里只会让两条链路互相牵制。
       */
      const route = (url: string, kind: ApiKind): void => {
        server.middlewares.use(url, (req, res, next) => {
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

            const result: ApiResult = await handleApi(kind, body, await host())
            json(res, result.status, result.payload)
          })().catch((error: unknown) => {
            // 走到这里的是"接口之外的意外"：读请求体失败、按请求加载领域模块失败等。
            // 没有这一层，Promise 会静静地悬在那里，浏览器那头表现为请求一直不返回。
            server.config.logger.error(
              `[judge-api] 未预期的错误：${error instanceof Error ? error.stack : String(error)}`,
            )
            if (!res.writableEnded) {
              json(res, 500, {
                ok: false,
                kind: 'server-error',
                message: `本地接口出错：${error instanceof Error ? error.message : String(error)}`,
              })
            }
          })
        })
      }

      route('/api/generate', 'generate')
      route('/api/judge', 'judge')
      route('/api/refine', 'refine')
    },
  }
}
