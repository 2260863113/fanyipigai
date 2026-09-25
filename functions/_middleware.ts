/**
 * 门口那道闸的实现：每个请求都先过 `decideGate`，只有它说放行才继续往里走。
 *
 * Cloudflare Pages 会把 `_middleware.ts` 套在**这个目录下的所有路由**上（含静态文件），
 * 因此这里不需要、也不应该再列一遍哪些路径要保护——漏列一条就是一个后门。
 * 例外清单只有 `src/server/gate.ts` 里那一份，且它是纯函数、被冒烟测试盯着。
 */

import { decideGate } from '../src/server/gate'
import { jsonResponse, type PagesContext } from '../src/server/host'
import { misconfiguredPage } from '../src/server/pages'

/**
 * 补几个安全响应头。
 *
 * `nosniff`：浏览器不许猜类型——否则一个被当成脚本的图片就能执行。
 * `DENY`：不许被别人用 iframe 套住（这道门后面是登录态，套住就能骗点击）。
 * `no-referrer`：跳去别的站时不要把本站地址带出去。
 */
function harden(response: Response): Response {
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

export async function onRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url)
  const decision = await decideGate({
    pathname: url.pathname,
    cookie: context.request.headers.get('Cookie'),
    accessPassword: context.env.ACCESS_PASSWORD ?? '',
    sessionSecret: context.env.SESSION_SECRET ?? '',
    now: Math.floor(Date.now() / 1000),
  })

  switch (decision.kind) {
    case 'allow':
      return harden(await context.next())
    case 'misconfigured':
      return harden(misconfiguredPage(decision.missing))
    case 'unauthorized':
      return jsonResponse(
        {
          ok: false,
          kind: 'unauthorized',
          message: '登录状态已失效，请回到站点首页重新输入访问口令。',
        },
        401,
      )
    case 'redirect':
      // 302 而不是 301：这条跳转依赖"我当时没登录"这个临时状态，不能被浏览器长期记住。
      return Response.redirect(new URL('/login', url).toString(), 302)
  }
}
