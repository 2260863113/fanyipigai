/**
 * 线上那一半的"宿主"：把 Cloudflare 给的东西（环境变量、请求）翻译成 `ApiHost`。
 *
 * 这个文件是**唯一**知道"我们在 Cloudflare 上"的地方——三个接口端点都只调 `handleApi`，
 * 因此本地与线上的业务逻辑必然一致（见 `src/server/api.ts` 顶部的说明）。
 *
 * 它为什么不放在 `functions/` 里：**`functions/` 下每个文件都是一个路由**。
 * 放一个 `host.ts` 进去，就等于对外开了一条 `/host`——那种"没人知道为什么存在、
 * 但确实能被访问"的端点正是该避免的。因此共享代码一律留在 `src/server/`，
 * `functions/` 里只放真路由（以及 `_middleware.ts`）。
 */

import * as domain from '../domain/ai'
import { summarizeFailureRecord, type FailureRecord } from '../domain/failure-collector'
import { handleApi, type ApiHost, type ApiKind } from './api'

/**
 * Cloudflare 上的环境变量与 Secret。
 *
 * 三个名字与本地 `.dev.vars` 完全一致，是为了让"本地能跑、线上忘了配"这种错误
 * 变成一次明显的失败（提示里会点名缺哪一个），而不是行为悄悄不同。
 */
export interface Env {
  DEEPSEEK_API_KEY?: string
  /** 可选：覆盖模型名。不给就用领域层的默认值（`deepseek-flash`） */
  DEEPSEEK_MODEL?: string
  /** 站点访问口令 */
  ACCESS_PASSWORD?: string
  /** 登录凭证的签名密钥 */
  SESSION_SECRET?: string
}

/**
 * Pages Functions 传进来的上下文。
 *
 * 这里**刻意不引 `@cloudflare/workers-types`**：Pages 是按**导出名**（`onRequestPost` 等）
 * 认端点的，不需要任何 import，因此只要结构对得上就能跑；引了那套全局类型反而会与
 * 前端那份 DOM 类型打架（两份 `Request`/`Response` 混在一起报错最费时间）。
 */
export interface PagesContext {
  request: Request
  env: Env
  next(): Promise<Response>
  params: Record<string, string | string[]>
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 批改结果与登录态都不该被任何一层缓存住
      'Cache-Control': 'no-store',
    },
  })
}

/** 请求是不是 https。cookie 的 Secure 属性据此决定（本地 http 上加了就回传不了）。 */
export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

/**
 * 非 POST 请求的统一答复。
 *
 * 比"落到静态资源里、返回一坨 index.html"强：前端拿到 HTML 会报"JSON 解析失败"，
 * 而 405 加一句话能直接说明是方法用错了。
 */
export function methodNotAllowed(): Response {
  return jsonResponse({ ok: false, kind: 'method-not-allowed', message: '这个接口只接受 POST 请求。' }, 405)
}

export function buildHost(env: Env): ApiHost {
  return {
    // 线上静态 import：workerd 里没有"按请求重新加载模块"这回事，
    // 每次部署本来就是一份全新的包，因此不需要本地那种动态加载。
    domain,
    apiKey: env.DEEPSEEK_API_KEY ?? '',
    modelOverride: env.DEEPSEEK_MODEL,
    tag: '[api]',
    deploymentLabel: '服务端',
    missingKeyHint:
      '请在 Cloudflare 项目的 Settings → Variables and Secrets 里设置 DEEPSEEK_API_KEY，然后重新部署。',
    archiveNote: '失败详情已写进服务端日志',
    log: {
      info: (message) => console.log(message),
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
    },
    /*
     * 失败存档：线上没有文件系统，只能打进服务端日志。
     * 两行一起打——一行是给人扫的摘要，一行是完整的 json（能直接喂给 scripts/failures.mjs 那套分析）。
     * 看日志的办法：面板里的实时日志，或 `npx wrangler pages deployment tail`。
     * 完整的记录整条打出来，是因为本地那份存档的价值恰恰在于"原始返回全文不截断"，
     * 线上只留摘要就等于把改提示词最需要的那部分丢了。
     */
    archive: (record: FailureRecord) => {
      console.error(`[ai-failure] ${summarizeFailureRecord(record)}`)
      console.error(`[ai-failure] ${JSON.stringify(record)}`)
      return undefined
    },
  }
}

/** 三个端点的公共入口：读 JSON → 交给共用实现 → 变成响应。 */
export async function runEndpoint(kind: ApiKind, context: PagesContext): Promise<Response> {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return jsonResponse({ ok: false, kind: 'bad-request', message: '请求体不是合法的 JSON' }, 400)
  }

  const result = await handleApi(kind, body, buildHost(context.env))
  return jsonResponse(result.payload, result.status)
}
