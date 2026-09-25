import { json, readJson, handle } from '../../../../src/server/http'
import { requireAdmin } from '../../../../src/server/guard'
import { cleanPlainText, parsePositiveInt } from '../../../../src/server/board'
import { MAX_ANNOUNCEMENT_CONTENT, MAX_ANNOUNCEMENT_TITLE } from '../../../../src/server/limits'

interface AnnouncementBody {
  title?: unknown
  content?: unknown
  pinned?: unknown
}

/** 管理员：修改公告。 */
export const onRequestPut = handle(
  requireAdmin(async (context) => {
    const env = context.env

    const id = parsePositiveInt(context.params.id, '公告ID')
    const existing = await env.DB.prepare('SELECT id, created_at FROM announcements WHERE id = ?')
      .bind(id)
      .first<{ id: number; created_at: number }>()
    if (!existing) return json({ error: { code: 'not_found', message: '公告不存在' } }, 404)

    const body = await readJson<AnnouncementBody>(context.request)
    const title = cleanPlainText(body.title, MAX_ANNOUNCEMENT_TITLE)
    const content = cleanPlainText(body.content, MAX_ANNOUNCEMENT_CONTENT)
    if (!title || !content) {
      return json(
        {
          error: {
            code: 'invalid_announcement',
            message: `标题(≤${MAX_ANNOUNCEMENT_TITLE}字)与内容(≤${MAX_ANNOUNCEMENT_CONTENT}字)不能为空`,
          },
        },
        400,
      )
    }
    const pinned = body.pinned === true ? 1 : 0
    const now = Date.now()

    await env.DB.prepare('UPDATE announcements SET title = ?, content = ?, pinned = ?, updated_at = ? WHERE id = ?')
      .bind(title, content, pinned, now, id)
      .run()

    // 完整返回 AnnouncementDto（含 createdAt），与前端 `Announcement` 类型对齐
    return json({
      announcement: { id, title, content, pinned: pinned === 1, createdAt: existing.created_at, updatedAt: now },
    })
  }),
)

/** 管理员：删除公告。 */
export const onRequestDelete = handle(
  requireAdmin(async (context) => {
    const id = parsePositiveInt(context.params.id, '公告ID')
    const result = await context.env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run()
    if (result.meta.changes === 0) return json({ error: { code: 'not_found', message: '公告不存在' } }, 404)
    return json({ ok: true })
  }),
)
