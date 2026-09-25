import { createSession } from '../../../src/server/auth'
import { json, readJson, handle } from '../../../src/server/http'
import { toPublicUser } from '../../../src/server/rows'
import { cleanUsername, normalizePasswordHash } from '../../../src/server/validate'

interface LoginBody {
  username?: unknown
  passwordHash?: unknown
}

/**
 * 登录：前端先用 `/api/auth/salt` 拿到盐、在浏览器里算出哈希，再把它发到这里比对。
 *
 * ⚠️ 三条**刻意**的做法，改动前先读 ADR 0028：
 * - 失败一律 401 同一句话，不区分"用户不存在"与"密码错"，挡用户名枚举；
 * - 比对的是前端算好的哈希（服务端不持有明文，也不重算 PBKDF2）；
 * - 登录成功即签发 30 天会话，`/api/me` 用它换用户信息。
 */
export const onRequestPost = handle(async (context) => {
  const env = context.env
  const body = await readJson<LoginBody>(context.request)

  const username = cleanUsername(body.username)
  if (!username) return json({ error: { code: 'invalid_username', message: '请输入用户名' } }, 400)

  let pwd
  try {
    pwd = normalizePasswordHash(body.passwordHash)
  } catch {
    return json({ error: { code: 'invalid_password_hash', message: '密码哈希格式错误' } }, 400)
  }

  const row = await env.DB.prepare(
    `SELECT id, username, password_salt, password_hash, password_iterations, avatar, is_admin, created_at, updated_at
     FROM users WHERE username = ?`,
  )
    .bind(username)
    .first<{
      id: number
      password_hash: string
      password_salt: string
    }>()

  // 统一回 401，不区分"用户不存在/密码错误"，防枚举
  if (!row || row.password_hash !== pwd.hash || row.password_salt !== pwd.salt) {
    return json({ error: { code: 'wrong_password', message: '用户名或密码错误' } }, 401)
  }

  const now = Date.now()
  const token = await createSession(env, row.id, now)
  return json({ token, user: toPublicUser(row as never) })
})
