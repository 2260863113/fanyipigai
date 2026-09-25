/**
 * 门口那道闸：这次请求该放行、该去登录、还是该拒绝。
 *
 * 单独成一个纯函数（不碰 Request/Response）的理由：这是**安全相关的判断**，
 * 而它的每一条分支都该被测到——"过期了会怎样""签名被改了会怎样""没配口令会怎样"。
 * 混在中间件里就只能靠真发一次请求来验证，写不了这么多组合。
 *
 * ⚠️ 缺配置时**选择拒绝，而不是放行**（fail-closed）。这个取舍值得写下来：
 * 放行看起来更"友好"（站点还能打开），但代价是"忘了配 ACCESS_PASSWORD"会静默变成
 * **一个谁都能用、且花你的 API 钱的公开站**；而拒绝只表现为"站点打不开"，
 * 一眼就能看出是配置没做完，马上会去补。两边的失败代价不对等，因此取严的那一边。
 */

import { readCookie, verifySession, SESSION_COOKIE_NAME } from './session'

export type GateDecision =
  /** 放行 */
  | { kind: 'allow' }
  /** 没登录，而且是接口调用：回 401 JSON，让界面把"登录过期了"说出来 */
  | { kind: 'unauthorized' }
  /** 没登录，而且是要看页面：送去 /login */
  | { kind: 'redirect' }
  /** 服务端缺少必要配置：拒绝一切请求，并说明缺哪一项 */
  | { kind: 'misconfigured'; missing: 'ACCESS_PASSWORD' | 'SESSION_SECRET' }

export interface GateInput {
  pathname: string
  /** 原始 Cookie 头 */
  cookie: string | null
  /** Cloudflare 上的 ACCESS_PASSWORD（本地是 .dev.vars 里那一条） */
  accessPassword: string
  /** Cloudflare 上的 SESSION_SECRET */
  sessionSecret: string
  /** 当前时间（秒）。注入是为了让"过期"这件事测得出来，不用真的等到 30 天后 */
  now: number
}

/**
 * 不需要登录就能访问的路径。
 *
 * 为什么必须有：登录页自己要能被打开（否则永远进不去），退出入口也要能被点到——
 * 用户可能端着一条**已过期**的 cookie 去点退出，那时若还要先登录就成了死循环。
 * 图标与 robots 放行纯粹因为它们不花钱、也没有内容。
 */
const PUBLIC_PATHS: readonly string[] = ['/login', '/logout', '/favicon.ico', '/robots.txt']

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname)
}

export async function decideGate(input: GateInput): Promise<GateDecision> {
  if (!input.accessPassword) return { kind: 'misconfigured', missing: 'ACCESS_PASSWORD' }
  if (!input.sessionSecret) return { kind: 'misconfigured', missing: 'SESSION_SECRET' }
  if (isPublicPath(input.pathname)) return { kind: 'allow' }

  const cookie = readCookie(input.cookie, SESSION_COOKIE_NAME)
  if (await verifySession(input.sessionSecret, cookie, input.now)) return { kind: 'allow' }

  /*
   * 接口与页面分开处理：接口是 fetch 发出来的，返回一个 302 只会让前端拿到一坨 HTML，
   * 报错信息变成"解析 JSON 失败"，用户完全看不懂。因此接口回 401 + 一句人话。
   */
  return input.pathname.startsWith('/api/') ? { kind: 'unauthorized' } : { kind: 'redirect' }
}
