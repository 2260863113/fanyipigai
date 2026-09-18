/**
 * 颜色分级的值。集中在一处，便于整体调整视觉。
 * 分类到颜色的对应关系见 validate.ts 的 colorForCategory——
 * 颜色由分类推导，不由 AI 自由选择。
 */

import type { MarkColor } from './types'

export const MARK_COLOR_VALUE: Record<MarkColor, string> = {
  red: 'var(--mark-red)',
  orange: 'var(--mark-orange)',
  green: 'var(--mark-green)',
}

/** 标记的浅色底，用于插入、弧线与悬浮态。 */
export const MARK_BG_VALUE: Record<MarkColor, string> = {
  red: 'var(--mark-red-bg)',
  orange: 'var(--mark-orange-bg)',
  green: 'var(--mark-green-bg)',
}
