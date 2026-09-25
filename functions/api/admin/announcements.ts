import { json, readJson, handle } from '../../../src/server/http'
import { requireAdmin } from '../../../src/server/guard'
import { cleanPlainText } from '../../../src/server/board'
import { MAX_ANNOUNCEMENT_CONTENT, MAX_ANNOUNCEMENT_TITLE } from '../../../src/server/limits'

interface AnnouncementBody {
  title?: unknown
  content?: unknown
  pinned?: unknown
}

/** 管理员：发布公告。 */
export const onRequestPost = handle(
  requireAdmin(async (context) => {
    const env = context.env

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
    const result = await env.DB.prepare(
      'INSERT INTO announcements (title, content, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(title, content, pinned, now, now)
      .run()
    return json(
      {
        announcement: {
          id: Number(result.meta.last_row_id),
          title,
          content,
          pinned: pinned === 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      201,
    )
  }),
)
