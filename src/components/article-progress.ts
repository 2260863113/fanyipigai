/**
 * 文章进度：**哪几页已经批改过**，存在浏览器里。
 *
 * ## 为什么必须落盘
 *
 * 用户的两条要求都建立在"上次做到哪儿"之上：
 *   - 「翻译了某几段、且已经批改，下次打开网站就**从没有翻译完成的那一段继续**」；
 *   - 「整篇翻译完并批改的文章，**后续打开网页不主动显示它的内容**，以后『换一换』留到最后」。
 *
 * 而会话状态（`session.ts` 里那个 reducer）是**内存里的**，刷新就没了；
 * 所以这里只存最小的一份事实：**这篇的哪几页已经批过**。
 * 页数本身不存——它由原文现算（`paginateArticle`），原文改了、页数变了，
 * 拿旧页号去比反而会错；存"批过哪几页"永远不会过期。
 *
 * ## 为什么「返回编辑」要把这一页从进度里去掉
 *
 * 那一页的结果在用户按下「返回编辑」时就作废了（见 session.ts），
 * 若进度里还算它"已完成"，用户再打开就会被送到更后面的一页，而这一页其实没做完。
 * 提交成功才记，作废就撤——进度于是永远等于"现在真的批好过哪几页"。
 */

import type { ArticleExcerpt } from '../domain/articles'

const STORAGE_KEY = 'translation-practice.article-progress.v1'

export interface ArticleProgress {
  /** 已经批改完成的页号（从小到大；去重由写入方保证） */
  graded: number[]
  /** 最后一次提交的时间，只用于展示与排序兜底 */
  updatedAt: string
}

export type ProgressMap = Record<string, ArticleProgress>

/** 读出来；存坏了就当没有，绝不让它把界面弄崩。 */
export function loadProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    const result: ProgressMap = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<ArticleProgress> | null
      if (!entry || !Array.isArray(entry.graded)) continue
      const graded = entry.graded.filter((index): index is number => Number.isInteger(index) && index >= 0)
      if (graded.length === 0) continue
      result[id] = { graded: [...new Set(graded)].sort((a, b) => a - b), updatedAt: String(entry.updatedAt ?? '') }
    }
    return result
  } catch {
    return {}
  }
}

function persist(map: ProgressMap): ProgressMap {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // 存不下（无痕模式、配额满）就算了：这一次界面上照常，只是刷新之后进度回到旧值
  }
  return { ...map }
}

/** 记下"这一页批完了"。 */
export function markGraded(map: ProgressMap, exerciseId: string, sectionIndex: number, now = new Date()): ProgressMap {
  const current = map[exerciseId]?.graded ?? []
  if (current.includes(sectionIndex)) return map
  const graded = [...current, sectionIndex].sort((a, b) => a - b)
  return persist({ ...map, [exerciseId]: { graded, updatedAt: now.toISOString() } })
}

/** 撤掉"这一页批完了"（用户在那一页按了「返回编辑」，结果已作废）。 */
export function clearGraded(map: ProgressMap, exerciseId: string, sectionIndex: number): ProgressMap {
  const current = map[exerciseId]?.graded ?? []
  if (!current.includes(sectionIndex)) return map
  const graded = current.filter((index) => index !== sectionIndex)
  const next = { ...map }
  if (graded.length === 0) delete next[exerciseId]
  else next[exerciseId] = { graded, updatedAt: map[exerciseId]?.updatedAt ?? '' }
  return persist(next)
}

/** 这篇练完了吗（每一页都批过）。`totalPages` 由原文现算，不用存。 */
export function isCompleted(map: ProgressMap, exerciseId: string, totalPages: number): boolean {
  if (totalPages <= 0) return false
  const graded = map[exerciseId]?.graded ?? []
  for (let index = 0; index < totalPages; index += 1) {
    if (!graded.includes(index)) return false
  }
  return true
}

/**
 * 该从第几页接着做：**第一个还没批过的页号**。
 * 全批完了就回到第 0 页（打开一篇练完的文章时从头发起，比空白一页强）。
 */
export function firstUngraded(map: ProgressMap, exerciseId: string, totalPages: number): number {
  const graded = map[exerciseId]?.graded ?? []
  for (let index = 0; index < totalPages; index += 1) {
    if (!graded.includes(index)) return index
  }
  return 0
}

/** 这篇做了几页（界面上报进度用）。 */
export function gradedCount(map: ProgressMap, exerciseId: string, totalPages: number): number {
  const graded = map[exerciseId]?.graded ?? []
  let count = 0
  for (let index = 0; index < totalPages; index += 1) {
    if (graded.includes(index)) count += 1
  }
  return count
}

/**
 * 选文章列表的顺序：**没练完的在前面，练完的排到最后**（用户要求"换一换留到最后"）。
 * 同一档里保持文章库自己的顺序，免得每次打开都在跳。
 */
export function orderForPicker(
  articles: readonly ArticleExcerpt[],
  map: ProgressMap,
  pageCountOf: (article: ArticleExcerpt) => number,
): ArticleExcerpt[] {
  const unfinished: ArticleExcerpt[] = []
  const finished: ArticleExcerpt[] = []
  for (const article of articles) {
    if (isCompleted(map, article.id, pageCountOf(article))) finished.push(article)
    else unfinished.push(article)
  }
  return [...unfinished, ...finished]
}
