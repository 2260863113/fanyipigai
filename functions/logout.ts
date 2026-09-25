/**
 * 退出：把登录凭证作废，回登录页。
 *
 * 为什么不做成前端里的一个按钮：凭证是 `HttpOnly` 的，**脚本读不到也删不掉**，
 * 只有服务端能把它清掉。前端要加按钮，就得让界面知道"登录"这件事存在——
 * 而现在的界面完全不需要知道（没登录时根本加载不到）。
 *
 * 这条路径在公开清单里，因此**拿着过期凭证的人也能点**——否则会卡在
 * "想退出 → 被要求先登录 → 登录页又把你送回首页"这种绕圈里。
 */

import { clearSessionCookie } from '../src/server/session'
import { isSecureRequest, type PagesContext } from '../src/server/host'

export async function onRequest(context: PagesContext): Promise<Response> {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Set-Cookie': clearSessionCookie(isSecureRequest(context.request)),
      'Cache-Control': 'no-store',
    },
  })
}
