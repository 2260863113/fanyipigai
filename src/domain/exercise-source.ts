/**
 * 「某道题的原文在哪」的唯一入口。
 *
 * 为什么要有这个模块：原文有**五个来源**（文章库、内置示例题、自己贴的题、句子库、术语库），
 * 而"回头翻旧记录时要把当时的原文显示出来"这件事有**两处**要做（练习记录页、收藏页）。
 * 原先散在 `RecordsView` 里手写一串 `??`，于是两边各写一遍、还都只认其中几个来源。
 * 现在集中在这里，谁要原文都问它。
 *
 * ## 文章题要的是**这一页**，不是整篇
 *
 * 用户的要求：「收藏模式下，原文应该是**当前一段**的原文，而不是整篇文章。」
 * 文章题一篇被切成好几页（见 `paginateArticle`），一条练习记录就是**一页**，
 * 因此这里按分页规则把那一页切出来——分页规则与练习页**同一份**，
 * 所以"当时屏幕上那一页"与"这里显示的那一段"永远是同一段文字。
 *
 * 参考译文同理：`pageReferenceOf` 给的是**这一页**的译文。文章库的译文与原文逐段对齐（ADR 0010），
 * 因此一页对应的译文就是同下标的那些译文段。
 *
 * 其它题型没有分页：一条记录就是它自己的那一段（句子题是一句、术语题是那五条）。
 */

import type { Direction, Mode } from './types'
import { MOCK_CASES, EXERCISE_SOURCES } from './mock'
import { articleById } from './articles'
import { customSources, directionOf, modeOf } from './custom'
import { sentenceForExerciseId } from './sentence-exercise'
import { termsForExerciseId } from './term-exercise'
import { paginateArticle, referenceOfPage, type ArticlePage } from './sections'

export interface ExerciseSource {
  /** 整篇原文（文章题是全文，其它题型就是那一段） */
  text: string
  /** 整篇的参考译文；没有参考译文的题（自己贴的、句子、术语）是空串 */
  reference: string
  direction: Direction
  mode: Mode
}

/** 这道题的整篇原文；认不出来源就返回 null。 */
export function exerciseSourceOf(exerciseId: string): ExerciseSource | null {
  const article = articleById(exerciseId)
  if (article) {
    return { text: article.text, reference: article.reference, direction: article.direction, mode: 'article' }
  }

  const builtin = MOCK_CASES.find((item) => item.exercise.id === exerciseId)
  if (builtin) {
    return {
      text: builtin.exercise.source,
      reference: builtin.exercise.referenceTranslation,
      direction: builtin.exercise.direction,
      mode: builtin.exercise.mode,
    }
  }

  const custom = customSources()[exerciseId]
  if (custom) return { text: custom, reference: '', direction: directionOf(custom), mode: modeOf(custom) }

  const sentence = sentenceForExerciseId(exerciseId)
  if (sentence) {
    const direction: Direction = /[\u4e00-\u9fff]/.test(sentence.text) ? 'zh-to-en' : 'en-to-zh'
    return { text: sentence.text, reference: '', direction, mode: 'sentence' }
  }

  const terms = termsForExerciseId(exerciseId)
  if (terms.length > 0) {
    return { text: terms.map((term) => term.zh).join('\n'), reference: '', direction: 'zh-to-en', mode: 'term' }
  }

  // 内置题库里只有原文、没有 exercise 对象时（旧数据）也兜一层
  const fallback = EXERCISE_SOURCES[exerciseId]
  if (fallback) return { text: fallback, reference: '', direction: directionOf(fallback), mode: modeOf(fallback) }

  return null
}

/** 把一道题的原文切成页（只有文章题会多于 1 页）。 */
function pagesOf(source: ExerciseSource): ArticlePage[] {
  return paginateArticle(source.text, source.reference, source.direction)
}

/**
 * 某条记录该显示的**那一段**原文（''表示认不出这道题）。
 *
 * `sectionIndex` 是记录里存的页号；只有文章题会用到它，其它题型恒为 0。
 */
export function pageSourceOf(exerciseId: string, sectionIndex: number): string {
  const source = exerciseSourceOf(exerciseId)
  if (!source) return ''
  if (source.mode !== 'article') return source.text
  return pagesOf(source)[sectionIndex]?.text ?? ''
}

/**
 * 某条记录该显示的**这一页的参考译文**（''表示这道题没有译文，或认不出来）。
 *
 * 练习记录页用它——复盘时能直接对照标准答案，这是**参考译文**存在的意义之一（ADR 0003）。
 */
export function pageReferenceOf(exerciseId: string, sectionIndex: number): string {
  const source = exerciseSourceOf(exerciseId)
  if (!source) return ''
  if (source.mode !== 'article') return source.reference
  const page = pagesOf(source)[sectionIndex]
  return page ? referenceOfPage(page) : ''
}

/** 文章题一共几页（界面报进度、选文章卡片显示"共几页"都用它）。 */
export function pageCountOf(exerciseId: string): number {
  const source = exerciseSourceOf(exerciseId)
  if (!source) return 0
  if (source.mode !== 'article') return 1
  return Math.max(1, pagesOf(source).length)
}
