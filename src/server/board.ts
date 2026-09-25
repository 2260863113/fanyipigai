/**
 * 留言板的共享校验与分页常量。
 *
 * 复用自「地图记忆」的 `functions/_lib/board.ts`，去掉那边公告复用的 `cleanPlainText`。
 */

import { ApiError } from './http'
import { MAX_POST_LEN, MAX_REPLY_LEN } from './limits'

// 向后兼容再导出：调用方既可以从 limits 也可以从 board 取这两个上限（与来源项目一致）。
export { MAX_POST_LEN, MAX_REPLY_LEN }

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50

/** 纯文本清洗：trim + 长度校验（按 Unicode 码点计数，中文字符算 1）。非法返回 null。 */
export function cleanBoardText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (Array.from(text).length > maxLen) return null
  return text
}

/** 解析正整数 id；非法抛 ApiError 400。 */
export function parsePositiveInt(value: string | undefined, label: string): number {
  if (!value) throw new ApiError(400, 'invalid_param', `缺少${label}`)
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'invalid_param', `${label}无效`)
  return n
}

/** 解析分页游标 before：缺省或 0 表示从最新开始（合法）；非法抛 ApiError 400。 */
export function parseBefore(value: string | null): number {
  if (!value) return 0
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new ApiError(400, 'invalid_param', '分页游标无效')
  return n
}

/** 解析 limit，钳制到 [1, MAX_LIMIT]。 */
export function parseLimit(value: string | null): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}
