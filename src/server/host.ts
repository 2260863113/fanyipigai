/**
 * 线上宿主：把 Cloudflare 给的东西（环境变量、请求）翻译成 `ApiHost`，供批改那三条链路使用。
 *
 * 这个文件是**唯一**知道"我们在 Cloudflare 上"的地方——三个批改端点都只调 `handleApi`，
 * 因此本地与线上的业务逻辑必然一致（见 `src/server/api.ts` 顶部的说明与 ADR 0026）。
 *
 * ⚠️ 账号那一套（注册/登录/留言板/管理）用的是另一条底座：直接吃 Pages 的 `context`
 * （`src/server/http.ts` 的 `Ctx`），因为它们只跑在线上、本地没有对应实现。
 * 两条底座共用同一个 `Env`：批改读 `DEEPSEEK_*`，账号读 `DB`。
 *
 * 共享代码为什么不放在 `functions/` 里：**`functions/` 下每个文件都是一个路由**。
 * 放一个 `host.ts` 进去就等于对外开了一条 `/host`。
 */

import * as domain from '../domain/ai'
import { summarizeFailureRecord, type FailureRecord } from '../domain/failure-collector'
import { handleApi, type ApiHost, type ApiKind } from './api'
import { json, type Ctx, type Env } from './http'

// 账号端点与批改端点都用这一个上下文类型；老名字 PagesContext 保留，免得改一堆 import。
export type { Ctx as PagesContext, Env }

/**
 * 批改端点的 JSON 响应：在 `json()` 之上加一条 `Cache-Control: no-store`。
 *
 * 与账号接口**刻意不同**：账号响应本来就短、且要按语义缓存；批改结果是一份"你这次写得怎么样"，
 * 被任何一层缓存住都是错的（用户会看到上一次的批改）。
 */
export function jsonResponse(payload: unknown, status = 200): Response {
  const response = json(payload, status)
  response.headers.set('Cache-Control', 'no-store')
  return response
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
     */
    archive: (record: FailureRecord) => {
      console.error(`[ai-failure] ${summarizeFailureRecord(record)}`)
      console.error(`[ai-failure] ${JSON.stringify(record)}`)
      return undefined
    },
  }
}

/** 三个批改端点的公共入口：读 JSON → 交给共用实现 → 变成响应。 */
export async function runEndpoint(kind: ApiKind, context: Ctx): Promise<Response> {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return jsonResponse({ ok: false, kind: 'bad-request', message: '请求体不是合法 JSON' }, 400)
  }

  const result = await handleApi(kind, body, buildHost(context.env))
  return jsonResponse(result.payload, result.status)
}
