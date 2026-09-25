import { verifySession } from '../../src/server/auth'
import { json, handle } from '../../src/server/http'

/**
 * 页面访问上报：前端每次进入站点时调用（带 token 则记录登录用户，否则记游客）。**不含 IP**。
 *
 * 为什么由前端上报而不是在中间件里记：中间件会把**静态资源**的每一个请求也算进去
 * （一次打开就是几十条），而这里要的是"人来了几次"。代价是关掉 JS 的访问记不到，
 * 对一个练习站无所谓。
 */
export const onRequestPost = handle(async (context) => {
  const env = context.env
  const now = Date.now()
  const ua = context.request.headers.get('user-agent') ?? null

  let userId: number | null = null
  try {
    const session = await verifySession(context.request, env, now)
    userId = session?.user.id ?? null
  } catch {
    userId = null // token 无效按游客记录
  }

  await env.DB.prepare('INSERT INTO access_logs (user_id, ua, created_at) VALUES (?, ?, ?)')
    .bind(userId, ua, now)
    .run()
  return json({ ok: true })
})
