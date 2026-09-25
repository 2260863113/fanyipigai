import { createSession } from '../../../src/server/auth'
import { json, readJson, handle } from '../../../src/server/http'
import { toPublicUser } from '../../../src/server/rows'
import { cleanUsername, normalizePasswordHash } from '../../../src/server/validate'

interface RegisterBody {
  username?: unknown
  passwordHash?: unknown
}

/**
 * 注册：用户名的 salt 由**浏览器**现生成，服务端只存结果（明文密码从不上网）。
 *
 * ⚠️ 注册接口一律把 `is_admin` 写成 0：管理权限**没有自助入口**，
 * 只能由站主用 SQL 指定（见 schema.sql 末尾那条命令）。
 */
export const onRequestPost = handle(async (context) => {
  const env = context.env
  const body = await readJson<RegisterBody>(context.request)

  const username = cleanUsername(body.username)
  if (!username) return json({ error: { code: 'invalid_username', message: '请输入用户名' } }, 400)

  let pwd
  try {
    pwd = normalizePasswordHash(body.passwordHash)
  } catch {
    return json({ error: { code: 'invalid_password_hash', message: '密码哈希格式错误' } }, 400)
  }

  const now = Date.now()
  // 冲突检测：用 ON CONFLICT DO NOTHING，靠 meta.changes 判断是否插入成功
  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO users (username, password_salt, password_hash, password_iterations, avatar, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(username, pwd.salt, pwd.hash, pwd.iterations, now, now)
    .run()

  if (insert.meta.changes === 0) {
    return json({ error: { code: 'username_exists', message: '用户名已存在' } }, 409)
  }

  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first()
  if (!row) return json({ error: { code: 'internal', message: '注册失败' } }, 500)

  const token = await createSession(env, (row as { id: number }).id, now)
  return json({ token, user: toPublicUser(row as never) }, 201)
})
