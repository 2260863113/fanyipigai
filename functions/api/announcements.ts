import { json, handle } from '../../src/server/http'

interface AnnouncementRow {
  id: number
  title: string
  content: string
  pinned: number
  created_at: number
  updated_at: number
}

export interface AnnouncementDto {
  id: number
  title: string
  content: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/** 公开公告列表：**不需要登录**（公告就是给所有人看的），置顶优先 + 时间倒序，全部返回。 */
export const onRequestGet = handle(async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT id, title, content, pinned, created_at, updated_at
     FROM announcements
     ORDER BY pinned DESC, created_at DESC`,
  ).all<AnnouncementRow>()

  const announcements: AnnouncementDto[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  return json({ announcements })
})
