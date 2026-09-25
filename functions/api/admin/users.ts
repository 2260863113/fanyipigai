import { json, handle } from '../../../src/server/http'
import { requireAdmin } from '../../../src/server/guard'
import { parseJson } from '../../../src/server/rows'

interface AdminUserRow {
  id: number
  username: string
  avatar: string | null
  is_admin: number
  created_at: number
}

/** 管理员：用户列表（一个用户一行）。没有删除/封禁——与来源项目一样只读。 */
export const onRequestGet = handle(
  requireAdmin(async (context) => {
    const env = context.env

    const rows = await env.DB.prepare(
      `SELECT id, username, avatar, is_admin, created_at
       FROM users
       ORDER BY is_admin DESC, created_at ASC`,
    ).all<AdminUserRow>()

    const users = (rows.results ?? []).map((r) => ({
      id: r.id,
      username: r.username,
      avatar: parseJson<{ dataUrl: string }>(r.avatar)?.dataUrl ?? null,
      isAdmin: r.is_admin === 1,
      createdAt: r.created_at,
    }))
    return json({ users })
  }),
)
