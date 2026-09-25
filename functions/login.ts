/**
 * 登录：`GET /login` 给人看那张表单，`POST /login` 收口令、发凭证。
 *
 * 这条路径在 `gate.ts` 的公开清单里——它必须公开，否则没人进得来。
 */

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  passwordMatches,
  readCookie,
  sessionCookie,
  signSession,
  verifySession,
} from '../src/server/session'
import { isSecureRequest, type PagesContext } from '../src/server/host'
import { loginPage, misconfiguredPage } from '../src/server/pages'

export async function onRequestGet(context: PagesContext): Promise<Response> {
  // 已经登录的人直接送回站点：否则"退出"点完之后又落到这里，看起来像没退成功。
  const accessPassword = context.env.ACCESS_PASSWORD ?? ''
  const sessionSecret = context.env.SESSION_SECRET ?? ''
  if (accessPassword && sessionSecret) {
    const cookie = readCookie(context.request.headers.get('Cookie'), SESSION_COOKIE_NAME)
    const now = Math.floor(Date.now() / 1000)
    if (await verifySession(sessionSecret, cookie, now)) {
      return Response.redirect(new URL('/', new URL(context.request.url)).toString(), 302)
    }
  }
  return loginPage()
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const accessPassword = context.env.ACCESS_PASSWORD ?? ''
  const sessionSecret = context.env.SESSION_SECRET ?? ''
  if (!accessPassword) return misconfiguredPage('ACCESS_PASSWORD')
  if (!sessionSecret) return misconfiguredPage('SESSION_SECRET')

  let given = ''
  try {
    const form = await context.request.formData()
    given = String(form.get('password') ?? '')
  } catch {
    // 表单读不出来（畸形请求）也走同一个页面，不额外暴露内部细节
    return loginPage('这次提交没能识别，请再试一次。', 400)
  }

  if (!(await passwordMatches(accessPassword, given))) {
    /*
     * 失败**要留下痕迹**：口令是保护 API 余额的唯一一道门（见 .dev.vars.example 里那句），
     * 有人在猜的时候，站主应该能在日志里看见，而不是等到账单出来才知道。
     * 代价很小：Cloudflare 的实时日志里搜 `[login]` 即可。
     */
    console.warn(`[login] 口令不正确（来自 ${context.request.headers.get('CF-Connecting-IP') ?? '未知来源'}）`)
    return loginPage('口令不对，再试一次。', 401)
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  const value = await signSession(sessionSecret, expiresAt)
  return new Response(null, {
    // 303：POST 之后让浏览器改用 GET 去首页，刷新时不会"重新提交表单"
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie': sessionCookie(value, isSecureRequest(context.request)),
      'Cache-Control': 'no-store',
    },
  })
}
