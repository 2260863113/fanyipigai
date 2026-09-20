/**
 * 把「校验过的批改 + 你的译文 + 选中了哪一处」整理成人能直接读的一句话。
 *
 * 为什么单独放一层：译文上的气泡、右下角的详情、练习记录页的清单，说的都是同一件事
 * ——"哪段文字 → 改成什么 + 为什么"。三处各写一遍的话，同一个错误在不同地方
 * 显示的范围会不一样（实际就这么错过：译文上划的是最小范围，详情里给的却是 AI 圈的大范围）。
 * 因此**范围的唯一来源是 validate 出来的 span**，AI 圈过的原文只在需要解释时才提。
 */

import { CATEGORY_LABEL, type Direction, type ErrorType, type MarkColor, type Mode } from '../domain/types'
import { colorForCategory, type ValidatedCorrection, type ValidatedError } from '../domain/validate'
import { entryRenderedKind } from '../domain/layout'
import { favoriteOf, type Favorite } from '../domain/favorites'

/** 当前选中了哪一处批注。 */
export type Selection =
  | { kind: 'error'; id: string }
  | { kind: 'highlight'; id: string }
  /** 语序调换的弧线本身也可以被点中；它复用 error 那一套说明 */
  | { kind: 'reorder'; id: string }

/** 改法类型的中文说法。 */
export const TYPE_LABEL: Record<ErrorType, string> = {
  replace: '替换',
  insert: '插入',
  delete: '删除',
  rewrite: '整句重写',
  reorder: '语序调换',
}

export interface AnnotationSummary {
  key: string
  selection: Selection
  /** 第几处：错误按位置顺序编号，亮点排在最后 */
  order: number
  typeLabel: string
  categoryLabel: string
  color: MarkColor
  /** 「要改的是 / 删掉 / 补在这个片段之后 / 原句 / 调换的片段」 */
  fromLabel: string
  from: string
  /** 「改成 / 补入 / 整句改为 / 调序后」；没有可写的内容时为空串 */
  toLabel: string
  to: string
  /** 为什么错 / 为什么好 */
  why: string
}

/**
 * 卡片口径：
 * - 这处只涉及**一个**最小不同项 → 就用它（`farmer` → `farmers`）。
 * - 涉及**多个**互不相邻的不同项，或译文上画的是"纯补入/纯划掉" → 用模型圈的范围与它给的写法
 *   （`farmer and herder` → `farmers and herders`、`past` → `the past`），
 *   因为把多个变化硬拼成一句"from → to"反而更难读。
 * 两种情况说的都是同一件事，只是口径不同——**译文上的勾画永远是最小的那个动作**。
 */
export function summarizeError(entry: ValidatedError, order: number, answer: string): AnnotationSummary {
  const { error } = entry
  const color = colorForCategory(error.category)
  const kind = entryRenderedKind(entry)
  // 划掉/标注的范围一律取校验后的区间（= 按单词求最小不同项后的范围），不取 AI 圈的原文
  const spanText = answer.slice(entry.span.start, entry.span.end)
  const firstChange = entry.changes[0]
  const single = entry.changes.length === 1 ? firstChange : undefined
  const circled = error.originalSpan?.snippet ?? error.oldText ?? ''
  const exactFrom = single ? answer.slice(single.start, single.end) : ''
  const exactTo = single?.to ?? ''

  const base = {
    key: error.id,
    selection: { kind: 'error' as const, id: error.id },
    order,
    typeLabel: TYPE_LABEL[kind],
    categoryLabel: CATEGORY_LABEL[error.category],
    color,
    why: error.explanation,
  }

  switch (kind) {
    case 'insert':
      if (error.type === 'insert') {
        return {
          ...base,
          fromLabel: '补在这个片段之后',
          from: error.insertAfter?.snippet ?? '',
          toLabel: '补入',
          to: exactTo || (error.targetText ?? ''),
        }
      }
      // 模型报的是"替换"，但按单词求最小不同项后其实只是漏了一个词（past → the past）
      return { ...base, fromLabel: '要改的是', from: circled, toLabel: '改成', to: error.targetText ?? '' }
    case 'delete':
      if (error.type === 'replace') {
        // 同理：多了一个词，译文上只划掉；卡片按模型圈的范围说
        return { ...base, fromLabel: '要改的是', from: circled, toLabel: '改成', to: error.targetText ?? '' }
      }
      return { ...base, fromLabel: '删掉', from: spanText, toLabel: '', to: '' }
    case 'rewrite':
      // 整句重写就是要给出完整句子，因此这里用 targetText，而不是最小不同项
      return { ...base, fromLabel: '原句', from: spanText, toLabel: '整句改为', to: error.targetText ?? '' }
    case 'reorder':
      return {
        ...base,
        fromLabel: '调换的片段',
        from: error.segments?.map((segment) => segment.anchor.snippet).join(' / ') ?? '',
        toLabel: '调序后',
        to: entry.reordered ?? '',
      }
    default:
      // 多个互不相邻的改动（farmer and herder）：范围取外框，内容取模型给的写法
      return entry.changes.length > 1
        ? { ...base, fromLabel: '要改的是', from: spanText, toLabel: '改成', to: error.targetText ?? '' }
        : { ...base, fromLabel: '要改的是', from: exactFrom, toLabel: '改成', to: exactTo || (error.targetText ?? '') }
  }
}

export function summarizeAll(validated: ValidatedCorrection, answer: string): AnnotationSummary[] {
  const rows = validated.errors.map((entry, index) => summarizeError(entry, index + 1, answer))
  validated.highlights.forEach((entry, index) => {
    rows.push({
      key: entry.highlight.id,
      selection: { kind: 'highlight', id: entry.highlight.id },
      order: validated.errors.length + index + 1,
      typeLabel: '亮点',
      categoryLabel: '表达优秀',
      color: 'green',
      fromLabel: '做得好的地方',
      from: answer.slice(entry.span.start, entry.span.end),
      toLabel: '',
      to: '',
      why: entry.highlight.comment,
    })
  })
  return rows
}

/** 只取当前选中的那一处；选中项已经不在结果里时返回 null。 */
export function summarize(
  validated: ValidatedCorrection,
  answer: string,
  selection: Selection | null,
): AnnotationSummary | null {
  if (!selection) return null
  // 只按编号找：错误与亮点的编号前缀不同，不会撞车，
  // 这样语序弧线（kind 是 reorder）也能直接复用同一个错误对象的说明。
  return summarizeAll(validated, answer).find((row) => row.key === selection.id) ?? null
}

/**
 * 当前选中的那一处整理成一条**收藏**（见 domain/favorites.ts）。
 *
 * 放在这里而不是收藏模块里，是因为它要的东西刚好都在这一层：
 * 「哪段文字 → 改成什么 + 为什么」由 summarize 给，位置区间由 validate 给的 span 给。
 * 两处各写一遍的话，收藏里的说法迟早会和卡片上的对不上。
 */
export function favoriteFor(input: {
  selection: Selection | null
  validated: ValidatedCorrection
  answer: string
  context: { exerciseId: string; mode: Mode; direction: Direction; topic: string; sectionIndex: number }
  now?: Date
}): Favorite | null {
  const summary = summarize(input.validated, input.answer, input.selection)
  if (!summary) return null
  // 位置：错误与亮点分属两个数组，先当作错误找，找不到再当作亮点
  const span =
    input.validated.errors.find((entry) => entry.error.id === summary.key)?.span ??
    input.validated.highlights.find((entry) => entry.highlight.id === summary.key)?.span
  return favoriteOf({
    summary,
    answer: input.answer,
    span: span ?? { start: 0, end: 0 },
    context: input.context,
    ...(input.now ? { now: input.now } : {}),
  })
}
