/**
 * 把校验过的批改结果转换成一条可直接渲染的片段序列。
 *
 * 这是纯函数、不含任何 DOM 逻辑：输入「用户译文 + 已校验的批改」，
 * 输出一串按顺序排好的片段，每个片段说明自己是什么、属于哪处批注。
 * 渲染组件只负责把片段画出来，不再做任何位置计算。
 */

import type { ValidatedCorrection, ValidatedError, ValidatedSpan } from './validate'
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
  /**
   * 语序调换片段在 AI 给的 segments 里的序号（sourceIndex）。
   *
   * 弧线要做的是"把这一段连到那一段"，配对用的就是这个序号，而不是片段在文本里的字符位置。
   * 两者必须分开存：曾经把字符位置当成序号写进 data 属性，弧线于是一条都配不出来。
   */
  reorderSourceIndex?: number
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

/** 最终**画在译文上**的形态。注意它不一定等于 AI 给的 type。 */
export type RenderedKind = 'replace' | 'insert' | 'delete' | 'rewrite' | 'reorder'

/** 一个最小不同项最终画成什么。 */
export function renderedKindOf(change: { start: number; end: number; to: string }): RenderedKind {
  // 零宽落点 → 只补不划（漏了一个 the 就只显示 <the>）
  if (change.start === change.end) return 'insert'
  // 有划掉的范围却没有改后文字 → 就是删除（多了一个 the 只划掉即可）
  return change.to.length > 0 ? 'replace' : 'delete'
}

/**
 * 这一处批注整体算哪一种改法。
 *
 * 为什么要单独判一次：AI 说"替换"，按单词求最小不同项之后可能根本不是替换——
 *   past → the past      其实只是漏了一个 the    → 画成**插入**（一个字都不划）
 *   the past → past      其实只是多了一个 the    → 画成**删除**（不写任何东西）
 * 界面上的徽标、气泡、右下角说明都用这个结果，保证"画的是什么，卡片就写什么"。
 */
export function entryRenderedKind(entry: ValidatedError): RenderedKind {
  const { error } = entry
  if (error.type === 'reorder') return 'reorder'
  const first = entry.changes[0]
  if (error.type === 'rewrite') {
    // 只有"整段都换了"才算整句重写。按词求最小不同项之后如果只剩一小处，
    // 那就是普通的替换——曾经这里直接判成 rewrite，于是"只改了一个词"被整句划掉（实测踩过）。
    return isWholeSpanChange(entry, first) ? 'rewrite' : first ? renderedKindOf(first) : 'rewrite'
  }
  return first ? renderedKindOf(first) : 'delete'
}

/**
 * 这一处的最小不同项是不是正好覆盖**模型圈的那一整段**（= 真的是整句重写）。
 *
 * 注意要跟 `originalSpan`（模型圈的原始范围）比，不能跟 `entry.span` 比——
 * 后者是"改动项的外框"，只有一处改动时它正好等于改动项本身，一比就恒为真，
 * 于是"只改了一个词"也会被当成整句重写（实际踩过）。
 */
export function isWholeSpanChange(
  entry: ValidatedError,
  change: { start: number; end: number } | undefined,
): boolean {
  if (!change || entry.changes.length !== 1) return false
  const original = entry.error.originalSpan
  if (!original) return true
  return change.start === original.start && change.end === original.end
}

const AROUND = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function labelFor(index: number): string {
  return AROUND[index] ?? `(${index + 1})`
}

export function buildLayout(correction: ValidatedCorrection, answer: string): AnnotatedLayout {
  const segments: TextSegment[] = []

  const pushPlain = (start: number, end: number): void => {
    if (end <= start) return
    segments.push({ kind: 'plain', text: answer.slice(start, end), start, end })
  }

  /**
   * 处理一个错误对象。语序调换的片段不走这里。
   *
   * 画成什么由 `renderedKindOf` 决定，**不是**照抄 AI 的 type。
   * 一处错误可能落在好几个互不相邻的区间上（farmer and herder 要各改各的），
   * 因此按最小不同项**逐个画**；它们共用同一个 errorId，
   * 点哪一处选中的都是这一处错误。
   */
  const pushError = (entry: ValidatedError): void => {
    const { error } = entry
    // 颜色取解析时定死的那个（漏译/多译按字数定轻重，见 severity.ts），不按分类现推
    const color: MarkColor = entry.hard ? 'red' : 'orange'

    // 整句重写整段画一次：上面划掉原句，下面的方框给出完整新句。
    // 但只有"整段都换了"才是重写；只剩一处词级改动时按普通替换画（否则一个词写错会被整句划掉）。
    if (error.type === 'rewrite' && isWholeSpanChange(entry, entry.changes[0])) {
      const { span } = entry
      const text = answer.slice(span.start, span.end)
      segments.push({
        kind: 'rewrite',
        text,
        deletedText: text,
        targetText: error.targetText,
        start: span.start,
        end: span.end,
        errorId: error.id,
        color,
        category: error.category,
      })
      return
    }

    // 兜底：万一拿到的是没有 changes 的旧数据，至少按整段画出来
    const changes =
      entry.changes.length > 0
        ? entry.changes
        : [{ start: entry.span.start, end: entry.span.end, to: error.targetText ?? '' }]

    for (const change of changes) {
      const text = answer.slice(change.start, change.end)
      const base = {
        start: change.start,
        end: change.end,
        errorId: error.id,
        color,
        category: error.category,
      }

      switch (renderedKindOf(change)) {
        case 'insert':
          segments.push({ kind: 'insert', text: '', targetText: change.to, ...base, end: change.start })
          break
        case 'replace':
          segments.push({ kind: 'replace', text, deletedText: text, targetText: change.to, ...base })
          break
        case 'delete':
          // 只划掉，不写任何东西
          segments.push({ kind: 'delete', text, deletedText: text, ...base })
          break
        default:
          break
      }
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
        color: entry.hard ? 'red' : 'orange',
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
      pushError(mark.entry)
      cursor = Math.max(cursor, span.end)
      continue
    }

    const { part } = mark
    const text = answer.slice(part.span.start, part.span.end)
    const errorId = part.errorId
    const group = reorderGroups.find((g) => g.errorId === errorId)
    const color = group?.color ?? 'orange'
    // 调序片段始终是**一个**片段：文字 + 跟在后面的圈号。
    // 不再为"与亮点重叠"另开一个 highlight 片段——那样弧线就没有地方量坐标了，
    // 而且实际上 resolveOverlaps 本来就会把这种重叠的亮点丢掉。
    segments.push({
      kind: 'plain',
      text,
      start: part.span.start,
      end: part.span.end,
      errorId,
      color,
      category: group?.category,
      reorderLabel: part.label,
      reorderSourceIndex: part.sourceIndex,
      reordered: group?.reordered,
    })
    cursor = Math.max(cursor, part.span.end)
  }

  // 亮点：不参与错误统计，渲染为绿色着重
  for (const entry of correction.highlights) {
    const { span } = entry
    const overlapping = segments.some(
      (s) => spansOverlap({ start: s.start, end: s.end }, span) && (s.kind !== 'plain' || Boolean(s.errorId)),
    )
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
 * 被覆盖的低优先级片段直接丢弃，界面会汇总提示丢弃了多少处。
 * 宁可少标，不可标错——漏标的批注用户仍能在右侧详情里读到。
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
