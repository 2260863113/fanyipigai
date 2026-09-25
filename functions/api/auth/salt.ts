import { json, readJson, handle } from '../../../src/server/http'
import { cleanUsername } from '../../../src/server/validate'

interface SaltBody {
  username?: unknown
}

/**
 * 登录第一步：取这个用户名的 salt 与迭代次数。
 *
 * 为什么密码要分两步（先要盐、再在浏览器里算哈希）：明文密码从离开键盘那一刻就没了。
 * 服务端只拿到 PBKDF2 的结果，**没有盐也算不出**用户输入的原文，
 * 因此"库被拖走 = 密码泄露"这件事不成立（代价与取舍见 ADR 0028）。
 */
export const onRequestPost = handle(async (context) => {
  const env = context.env
  const body = await readJson<SaltBody>(context.request)

  const username = cleanUsername(body.username)
  if (!username) return json({ error: { code: 'invalid_username', message: '请输入用户名' } }, 400)

  const row = await env.DB.prepare('SELECT password_salt, password_iterations FROM users WHERE username = ?')
    .bind(username)
    .first<{ password_salt: string; password_iterations: number }>()

  // 用户不存在：返回**固定的假盐**，避免用它来枚举"哪些用户名已注册"
  if (!row) {
    return json({ salt: 'MDEyMzQ1Njc4OWFiY2RlZg==', iterations: 120000 })
  }
  return json({ salt: row.password_salt, iterations: row.password_iterations })
})
