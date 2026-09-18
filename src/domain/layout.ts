/**
 * 把校验过的批改结果转换成一条可直接渲染的片段序列。
 *
 * 这是纯函数、不含任何 DOM 逻辑：输入「用户译文 + 已校验的批改」，
 * 输出一串按顺序排好的片段，每个片段说明自己是什么、属于哪处批注。
 * 渲染组件只负责把片段画出来，不再做任何位置计算。
 */

import { colorForCategory, type ValidatedCorrection, type ValidatedError, type ValidatedSpan } from './validate'
import type { ErrorCategory, MarkColor } from './types'

export interface Point {
  start: number
  end: number
}

function spansOverlap(a: Point, b: Point): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * 取第 1..index 个片段的累计结束位置。
 * 语序调换的弧线需要知道每个片段在文本中的起止，因此这里保留索引。
 */
export type SegmentKind = 'plain' | 'delete' | 'replace' | 'insert' | 'rewrite' | 'highlight'

export interface TextSegment {
  kind: SegmentKind
  text: string
  start: number
  end: number
  /** 点击后弹窗展示用的编号，无批注时为空 */
  errorId?: string
  highlightId?: string
  color?: MarkColor
  category?: ErrorCategory
  /** 替换、插入、整句重写时的正确写法 */
  targetText?: string
  /** 删除线内容 */
  deletedText?: string
  /** 语序调换片段上的序号标记 */
  reorderLabel?: string
  /** 语序调换时，所在组的调序结果预览 */
  reordered?: string
}

export interface ReorderGroup {
  errorId: string
  color: MarkColor
  category: ErrorCategory
  /** 按文本先后顺序排列的片段区间与编号 */
  parts: Array<{ span: ValidatedSpan; label: string; sourceIndex: number; targetIndex: number }>
  /** 调序后这些片段拼起来的样子 */
  reordered?: string
}

export interface AnnotatedLayout {
  segments: TextSegment[]
  reorderGroups: ReorderGroup[]
  /** 被拒绝渲染的批注编号，供界面提示用 */
  rejectedIds: string[]
  /** 因位置重叠而被丢弃的批注数量 */
  droppedCount: number
}

const AROUND = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function labelFor(index: number): string {
  return AROUND[index] ?? `(${index + 1})`
}

export function buildLayout(correction: ValidatedCorrection, answer: string): AnnotatedLayout {
  const segments: TextSegment[] = []
  const highlightSpans = correction.highlights.map((h) => h.span)

  const pushPlain = (start: number, end: number): void => {
    if (end <= start) return
    segments.push({ kind: 'plain', text: answer.slice(start, end), start, end })
  }

  /** 处理单个错误对象覆盖的区间；语序调换的片段不走这里。 */
  const pushError = (entry: ValidatedError, span: ValidatedSpan): void => {
    const { error } = entry
    const color = colorForCategory(error.category)
    const text = answer.slice(span.start, span.end)
    const base = { start: span.start, end: span.end, errorId: error.id, color, category: error.category }

    switch (error.type) {
      case 'replace':
        segments.push({ kind: 'replace', text, deletedText: text, targetText: error.targetText, ...base })
        break
      case 'delete':
        segments.push({ kind: 'delete', text, deletedText: text, ...base })
        break
      case 'rewrite':
        segments.push({ kind: 'rewrite', text, deletedText: text, targetText: error.targetText, ...base })
        break
      case 'insert':
        segments.push({ kind: 'insert', text: '', targetText: error.targetText, ...base, start: span.start, end: span.start })
        break
      default:
        break
    }
  }

  // 需要渲染的错误：语序调换的片段单独处理，其余按整段处理
  const renderable: Array<{ entry: ValidatedError; span: ValidatedSpan }> = []
  const reorderGroups: ReorderGroup[] = []
  const reorderParts: Array<{ errorId: string; span: ValidatedSpan; label: string; sourceIndex: number; targetIndex: number }> = []

  for (const entry of correction.errors) {
    if (entry.error.type === 'reorder' && entry.reorderSpans) {
      const indexed = entry.reorderSpans.map((span, i) => ({ span, i }))
      indexed.sort((a, b) => a.span.start - b.span.start)
      const parts = indexed.map(({ span, i }) => {
        const segment = entry.error.segments?.[i]
        return {
          errorId: entry.error.id,
          span,
          label: labelFor(i),
          sourceIndex: segment?.sourceIndex ?? i,
          targetIndex: segment?.targetIndex ?? i,
        }
      })
      reorderGroups.push({
        errorId: entry.error.id,
        color: colorForCategory(entry.error.category),
        category: entry.error.category,
        parts: parts.map((p) => ({ span: p.span, label: p.label, sourceIndex: p.sourceIndex, targetIndex: p.targetIndex })),
        reordered: entry.reordered,
      })
      reorderParts.push(...parts)
      continue
    }
    renderable.push({ entry, span: entry.span })
  }

  const allMarks: Array<
    | { type: 'error'; entry: ValidatedError; span: ValidatedSpan }
    | { type: 'reorder'; part: (typeof reorderParts)[number] }
  > = [
    ...renderable.map((r) => ({ type: 'error' as const, entry: r.entry, span: r.span })),
    ...reorderParts.map((part) => ({ type: 'reorder' as const, part })),
  ].sort((a, b) => {
    const sa = a.type === 'error' ? a.span : a.part.span
    const sb = b.type === 'error' ? b.span : b.part.span
    return sa.start - sb.start || sa.end - sb.end
  })

  let cursor = 0
  for (const mark of allMarks) {
    const span = mark.type === 'error' ? mark.span : mark.part.span
    pushPlain(cursor, Math.max(cursor, span.start))

    if (mark.type === 'error') {
      pushError(mark.entry, mark.span)
      cursor = Math.max(cursor, span.end)
      continue
    }

    const { part } = mark
    const text = answer.slice(part.span.start, part.span.end)
    const overlapsHighlight = highlightSpans.some((h) => spansOverlap(h, part.span))
    const errorId = part.errorId
    const group = reorderGroups.find((g) => g.errorId === errorId)
    const color = group?.color ?? 'orange'
    if (overlapsHighlight) {
      segments.push({ kind: 'highlight', text, start: part.span.start, end: part.span.end, highlightId: undefined, color: 'green' })
      segments.push({
        kind: 'plain',
        text: part.label,
        start: part.span.end,
        end: part.span.end,
        errorId,
        color,
        category: group?.category,
        reorderLabel: part.label,
        reordered: group?.reordered,
      })
    } else {
      segments.push({
        kind: 'plain',
        text,
        start: part.span.start,
        end: part.span.end,
        errorId,
        color,
        category: group?.category,
        reorderLabel: part.label,
        reordered: group?.reordered,
      })
    }
    cursor = Math.max(cursor, part.span.end)
  }

  // 亮点：不参与错误统计，渲染为绿色着重
  for (const entry of correction.highlights) {
    const { span } = entry
    const overlapping = segments.some((s) => spansOverlap({ start: s.start, end: s.end }, span) && s.kind !== 'plain')
    if (overlapping) continue
    // 打断可能跨越此区间的普通片段
    const rebuilt: TextSegment[] = []
    for (const segment of segments) {
      if (segment.kind !== 'plain' || !spansOverlap({ start: segment.start, end: segment.end }, span)) {
        rebuilt.push(segment)
        continue
      }
      if (segment.start < span.start) {
        rebuilt.push({ ...segment, text: answer.slice(segment.start, span.start), end: span.start })
      }
      if (segment.end > span.end) {
        rebuilt.push({ ...segment, text: answer.slice(span.end, segment.end), start: span.end })
      }
    }
    rebuilt.push({
      kind: 'highlight',
      text: answer.slice(span.start, span.end),
      start: span.start,
      end: span.end,
      highlightId: entry.highlight.id,
      color: 'green',
    })
    rebuilt.sort((a, b) => a.start - b.start || a.end - b.end)
    segments.length = 0
    segments.push(...rebuilt)
  }

  const plainTail = answer.slice(cursor)
  if (plainTail) segments.push({ kind: 'plain', text: plainTail, start: cursor, end: answer.length })

  // 丢掉零长度的普通片段，避免渲染出无意义的空节点
  const cleaned = segments.filter((s) => s.kind === 'insert' || s.text.length > 0 || s.reorderLabel)
  const resolved = resolveOverlaps(cleaned, answer)

  return {
    segments: resolved.segments,
    reorderGroups,
    rejectedIds: correction.rejections.map((r) => r.id),
    droppedCount: resolved.dropped,
  }
}

/**
 * 重叠消解。
 *
 * 为什么需要它：批注来自 AI，同一段文字完全可能同时被两处批注覆盖——
 * 一处整句重写，加上句中若干个词级修正。若两处都画，页面上会出现
 * 划线上再划线、正确写法互相压字的情况，比不标还难读。
 *
 * 规则：跨度长的批注优先（整句重写压过词级修正），同级则位置靠前者优先；
 * 被覆盖的低优先级片段直接丢弃，页面下方会汇总提示丢弃了多少处。
 * 宁可少标，不可标错——漏标的批注用户仍能在下方列表里读到。
 */
/**
 * 重叠消解。
 *
 * 为什么需要它：批注来自 AI，同一段文字完全可能同时被两处批注覆盖——
 * 一处整句重写，加上句中若干个词级修正。若两处都画，页面上会出现
 * 划线上再划线、正确写法互相压字的情况，比不标还难读。
 *
 * 规则：跨度长的批注优先（整句重写压过词级修正），同级则位置靠前者优先；
 * 被覆盖的低优先级批注直接丢弃，界面会汇总提示丢弃了多少处。
 * 宁可少标，不可标错。
 *
 * 保留的批注之间的空隙，一律用原文补齐——批注只覆盖作答的一部分，
 * 剩下的文字（包括作答尾部）同样必须显示出来。
 */
function resolveOverlaps(segments: TextSegment[], answer: string): { segments: TextSegment[]; dropped: number } {
  const hasAnnotation = (segment: TextSegment): boolean =>
    segment.kind !== 'plain' || Boolean(segment.errorId) || Boolean(segment.highlightId)

  const priority = (segment: TextSegment): number => {
    if (segment.kind === 'highlight') return 1
    if (segment.kind === 'rewrite') return 3
    return hasAnnotation(segment) ? 2 : 0
  }

  const candidates = segments.filter(hasAnnotation).sort((a, b) => {
    const byPriority = priority(b) - priority(a)
    if (byPriority !== 0) return byPriority
    const byLength = b.end - b.start - (a.end - a.start)
    if (byLength !== 0) return byLength
    return a.start - b.start
  })

  const kept: TextSegment[] = []
  let dropped = 0

  for (const candidate of candidates) {
    const conflicts = kept.some((other) =>
      candidate.kind === 'insert'
        ? candidate.start > other.start && candidate.start < other.end
        : spansOverlap(candidate, other),
    )
    if (conflicts) {
      dropped += 1
      continue
    }
    kept.push(candidate)
  }

  kept.sort((a, b) => a.start - b.start)

  const result: TextSegment[] = []
  let cursor = 0
  for (const segment of kept) {
    if (segment.start > cursor) {
      result.push({ kind: 'plain', text: answer.slice(cursor, segment.start), start: cursor, end: segment.start })
    }
    result.push(segment)
    cursor = Math.max(cursor, segment.end)
  }
  if (cursor < answer.length) {
    result.push({ kind: 'plain', text: answer.slice(cursor), start: cursor, end: answer.length })
  }

  return { segments: result.filter((s) => s.kind !== 'plain' || s.text.length > 0), dropped }
}
