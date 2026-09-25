import { json, handle } from '../../../src/server/http'
import { requireSession } from '../../../src/server/guard'
import { parsePositiveInt } from '../../../src/server/board'

/** 删自己的帖子（回复靠 D1 的外键级联一起删，见 schema.sql）。 */
export const onRequestDelete = handle(
  requireSession(async (context) => {
    const env = context.env
    const session = context.session

    const id = parsePositiveInt(context.params.id, '帖子ID')
    const post = await env.DB.prepare('SELECT id, user_id FROM board_posts WHERE id = ?')
      .bind(id)
      .first<{ id: number; user_id: number }>()
    if (!post) return json({ error: { code: 'not_found', message: '帖子不存在' } }, 404)
    if (post.user_id !== session.user.id) {
      return json({ error: { code: 'forbidden', message: '只能删除自己的帖子' } }, 403)
    }

    await env.DB.prepare('DELETE FROM board_posts WHERE id = ?').bind(id).run()
    return json({ ok: true })
  }),
)
