/**
 * 鉴权装饰器：把「登录 / 管理员」检查从各路由的重复样板里抽出来。
 *
 * 复用自「地图记忆」的 `functions/_lib/guard.ts`。
 * 本项目**只在服务端**用它：界面上的"没登录就弹窗"是另一回事（见 App.tsx 的提交门），
 * 这里管的是"就算前端被绕过，接口也不认"。
 */

import { verifySession, type SessionResult } from './auth'
import { json, type Ctx } from './http'

/** 登录会话上下文：verifySession 通过后传给 handler。 */
export interface AuthedCtx extends Ctx {
  session: SessionResult
}

/**
 * 包裹 onRequest handler：先验证登录，失败统一返回 401。
 *
 * 这个 401 前端看得懂：`requestJson` 会把它翻成 `ApiError`，
 * 登录态失效时界面据此把用户送回登录框（见 `auth/session.ts` 的 401 处理）。
 */
export function requireSession(handler: (context: AuthedCtx) => Promise<Response>) {
  return async (context: Ctx) => {
    const session = await verifySession(context.request, context.env, Date.now())
    if (!session) return json({ error: { code: 'unauthorized', message: '未登录' } }, 401)
    return handler({ ...context, session })
  }
}

/** 包裹 onRequest handler：先验证管理员，失败统一返回 403。 */
export function requireAdmin(handler: (context: AuthedCtx) => Promise<Response>) {
  return async (context: Ctx) => {
    const session = await verifySession(context.request, context.env, Date.now())
    if (!session || session.user.is_admin !== 1) {
      return json({ error: { code: 'forbidden', message: '需要管理员权限' } }, 403)
    }
    return handler({ ...context, session })
  }
}
