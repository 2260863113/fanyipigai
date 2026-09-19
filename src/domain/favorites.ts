/**
 * 收藏：把某一处批改连同「改前 / 改后 / 为什么」一起留下来，以后在「收藏」那一栏翻。
 *
 * 三条约定：
 *   1. **存的是内容，不是指针**。收藏里完整写着改前、改后、原因、所在的那一整句，
 *      以及当时是哪道题——练习记录会变、题库会更新，指向某一处的编号过几天可能就指不到了。
 *   2. **同一处只留一条**。再次点「收藏」就是取消，不去攒重复项。
 *   3. **存在这台浏览器上**（与设置、自定义题同一个存法），不联网、不花钱。
 *
 * 收藏里为什么还要存"那句话所在的整句"：用户说的是"保存这句话"——
 * 单独一句 `farmer → farmers` 过几天看就不知道在说什么了，连着整句才有复习价值。
 */

import type { Direction, MarkColor, Mode } from './types'

const STORAGE_KEY = 'translation-practice.favorites'
/** 最多留这么多条，再多就把最旧的挤掉（本地存储不是仓库） */
const MAX_FAVORITES = 200

export interface Favorite {
  id: string
  createdAt: string
  /** 这一处批注的编号（同一处再收藏一次算同一条） */
  errorId: string
  /** 改前 / 改后（标签是「要改的是 / 改成」这类说法） */
  fromLabel: string
  from: string
  toLabel: string
  to: string
  /** 为什么错 / 为什么好 */
  why: string
  /** 这一处是什么类型、什么分类，以及它的颜色 */
  typeLabel: string
  categoryLabel: string
  color: MarkColor
  /** 这一处所在的那一整句 */
  sentence: string
  /** 当时是哪道题 */
  exerciseId: string
  mode: Mode
  direction: Direction
  topic: string
}

/**
 * 取"这一处所在的那一整句"。
 *
 * 从错误区间往两边扩到句末标点或换行为止，并把句末标点带上——不这么扩的话，
 * 界面上的收藏就只剩两个词，回头根本看不出上下文。
 * 英文句点要跟着空格或结尾才算断句，免得把 `e.g.` 这种切碎。
 */
export function sentenceAround(answer: string, start: number, end: number): string {
  const boundary = (index: number): boolean => {
    const char = answer[index] ?? ''
    if (/[。！？!?…\n]/.test(char)) return true
    if (char !== '.') return false
    const next = answer[index + 1] ?? ''
    return next === '' || /\s/.test(next)
  }
  let from = Math.max(0, start)
  while (from > 0 && !boundary(from - 1)) from -= 1
  let to = Math.max(from, Math.min(answer.length, end))
  while (to < answer.length && !boundary(to)) to += 1
  if (to < answer.length) to += 1
  return answer.slice(from, to).trim()
}

/** 把「选中的那一处 + 当时那道题」整理成一条收藏。 */
export function favoriteOf(input: {
  summary: {
    key: string
    typeLabel: string
    categoryLabel: string
    color: MarkColor
    fromLabel: string
    from: string
    toLabel: string
    to: string
    why: string
  }
  answer: string
  span: { start: number; end: number }
  context: { exerciseId: string; mode: Mode; direction: Direction; topic: string }
  now?: Date
}): Favorite {
  const createdAt = (input.now ?? new Date()).toISOString()
  return {
    id: `fav-${input.context.exerciseId}-${input.summary.key}`,
    createdAt,
    errorId: input.summary.key,
    fromLabel: input.summary.fromLabel,
    from: input.summary.from,
    toLabel: input.summary.toLabel,
    to: input.summary.to,
    why: input.summary.why,
    typeLabel: input.summary.typeLabel,
    categoryLabel: input.summary.categoryLabel,
    color: input.summary.color,
    sentence: sentenceAround(input.answer, input.span.start, input.span.end),
    exerciseId: input.context.exerciseId,
    mode: input.context.mode,
    direction: input.context.direction,
    topic: input.context.topic,
  }
}

/** 读出全部收藏（新的在前）。存坏了、没存过都返回空数组。 */
export function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Favorite => {
      const favorite = item as Partial<Favorite> | null
      return Boolean(favorite && typeof favorite.id === 'string' && typeof favorite.why === 'string')
    })
  } catch {
    return []
  }
}

function persist(favorites: readonly Favorite[]): Favorite[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
  } catch {
    // 存不下（无痕模式、配额满了）就算了：这一次界面上照样看得见，只是刷新之后没了
  }
  return [...favorites]
}

/**
 * 加一条或去掉一条（同一处再点就是取消）。返回新的整份列表。
 * 同一处判重看的是"哪道题的哪一处"，而不是时间——不然同一处能收藏出好几条。
 */
export function toggleFavorite(favorites: readonly Favorite[], favorite: Favorite): Favorite[] {
  const exists = favorites.some((item) => item.id === favorite.id)
  if (exists) return persist(favorites.filter((item) => item.id !== favorite.id))
  return persist([favorite, ...favorites].slice(0, MAX_FAVORITES))
}

/** 删掉一条（收藏页里的「删除」）。 */
export function removeFavorite(favorites: readonly Favorite[], id: string): Favorite[] {
  return persist(favorites.filter((item) => item.id !== id))
}

/** 清空（收藏页里的「全部清空」）。 */
export function clearFavorites(): Favorite[] {
  return persist([])
}
