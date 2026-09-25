/**
 * 每个响应补几个安全响应头。
 *
 * ⚠️ 这里**只有响应头，没有门**。这个站原先有一道访问口令（见 ADR 0026），
 * 用户后来要求"去掉进入口令这一环节，任何人都可以访问"，于是整道门拆掉了
 * （`gate.ts` / `session.ts` / `login.ts` / `logout.ts` 一起删，见 ADR 0027）。
 *
 * 留下这几个头与"要不要登录"无关，它们防的是另一类事：
 * `nosniff`：浏览器不许猜类型——否则一个被当成脚本的图片就能执行。
 * `DENY`：不许被别人用 iframe 套住（套住就能骗点击）。
 * `no-referrer`：跳去别的站时不要把本站地址带出去。
 */

import type { PagesContext } from '../src/server/host'

export async function onRequest(context: PagesContext): Promise<Response> {
  const response = await context.next()
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
