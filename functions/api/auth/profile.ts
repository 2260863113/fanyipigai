import { json, readJson, handle, ApiError, type Env } from '../../../src/server/http'
import { requireSession } from '../../../src/server/guard'
import { toPublicUser } from '../../../src/server/rows'
import { cleanUsername } from '../../../src/server/validate'
import { resolveAvatar, resolvePassword, type ProfileBody } from '../../../src/server/profile'

/**
 * 校验并归一化新用户名；改名时查唯一性（排除自己）。
 *
 * 它是本路由**唯一**留在原地的校验 —— 因为它要查库。头像与密码那两条都在
 * `src/server/profile.ts`，无 DB 依赖、可当纯函数测。
 */
async function resolveUsername(env: Env, currentUsername: string, raw: unknown): Promise<string> {
  const username = cleanUsername(raw)
  if (!username) throw new ApiError(400, 'invalid_username', '请输入用户名')
  if (username.toLowerCase() !== currentUsername.toLowerCase()) {
    const clash = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()
    if (clash) throw new ApiError(409, 'username_exists', '用户名已存在')
  }
  return username
}

/**
 * 个人中心保存：改用户名、改头像、改密码，三件事一次请求。
 *
 * ⚠️ 改密码时前端要先拿旧密码算一遍旧哈希（`oldPasswordHash`），服务端拿它跟库里的比。
 * 这条**不是**多余的一步：会话 token 可能是捡来的（或借来的设备），
 * 光有 token 不该能改掉密码。
 */
export const onRequestPost = handle(
  requireSession(async (context) => {
    const env = context.env
    const user = context.session.user
    const body = await readJson<ProfileBody>(context.request)

    const username = await resolveUsername(env, user.username, body.username)
    const avatarJson = resolveAvatar(body, user.avatar)
    const pwd = resolvePassword(user, body)

    const now = Date.now()
    await env.DB.prepare(
      `UPDATE users SET username = ?, password_salt = ?, password_hash = ?, password_iterations = ?, avatar = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(username, pwd.salt, pwd.hash, pwd.iterations, avatarJson, now, user.id)
      .run()

    const row = await env.DB.prepare(
      `SELECT id, username, password_salt, password_hash, password_iterations, avatar, is_admin, created_at, updated_at
       FROM users WHERE id = ?`,
    )
      .bind(user.id)
      .first()
    if (!row) throw new ApiError(500, 'internal', '保存失败')

    return json({ user: toPublicUser(row as never) })
  }),
)
