/**
 * D1 行 → 对外的 JSON 形状。
 *
 * 复用自「地图记忆」的 `functions/_lib/rows.ts`，去掉那边排行榜/家乡的部分。
 * **服务端绝不返回密码哈希**这条是硬性的，`toPublicUser` 是唯一出口。
 */

import type { UserRow } from './auth'

export interface PublicUser {
  username: string
  avatar: { dataUrl: string; name: string; size: number; type: string } | null
  isAdmin: boolean
  createdAt: number
  updatedAt: number
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    username: row.username,
    avatar: parseJson<{ dataUrl: string; name: string; size: number; type: string }>(row.avatar),
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 库里几处 JSON 列（头像）的统一解析：坏数据当没有，不抛。 */
export function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}
