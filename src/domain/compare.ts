/**
 * 对照视图的数据：把作答拆成一句一句，每句给出「修改后的完整那句」。
 *
 * 与批改视图的分工：
 *   批改视图 = 在原文上勾画（划线、方框、弧线），信息密度高，但要眼睛跟着标记走；
 *   对照视图 = 句子级的「改前 / 改后」对照，**不划线、不填补**，只把改动过的字染成对应颜色。
 * 两种视图共用同一份 validated（每处改动的最小不同项），因此永远不会各说各话。
 */

import type { MarkColor } from './types'
import { colorForCategory, type ValidatedCorrection } from './validate'

/** 对照视图里的一段文字；着色表示「这里被改过 / 值得肯定」。 */
export interface CompareSpan {
  text: string
  color?: MarkColor
  /** 点它就能在右下角看到这一处的说明 */
  errorId?: string
  highlightId?: string
}

export interface CompareLine {
  /** 原文那一句 */
  original: string
  /** 修改后的完整那一句（按改动拼出来） */
  corrected: CompareSpan[]
  /** 这一句有没有被改动（没有的话两行一样，界面可以淡化处理） */
  changed: boolean
}

const CJK_END = /[。！？；…]/
const LATIN_END = /[.!?]/
const TRAILING = /["'”’）)】]/

function isSentenceDot(text: string, index: number): boolean {
  const next = text[index + 1]
  // 后面必须跟空白或到结尾，否则 "3.5"、"U.S." 这类会被切碎
  if (next !== undefined && !/\s/.test(next)) return false
  const prev = text[index - 1]
  if (prev !== undefined && /\d/.test(prev)) return false
  return true
}

/** 把文本切成句子（返回的是原文里的区间，供着色时换算）。 */
export function splitSentences(text: string): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const isEnd = CJK_END.test(char) || (LATIN_END.test(char) && isSentenceDot(text, index))
    if (!isEnd) continue
    let end = index + 1
    while (end < text.length && TRAILING.test(text[end] ?? '')) end += 1
    result.push({ start, end })
    start = end
    index = end - 1
  }
  if (start < text.length) result.push({ start, end: text.length })
  return result.filter((item) => text.slice(item.start, item.end).trim().length > 0)
}

interface Edit {
  kind: 'edit'
  start: number
  end: number
  to: string
  color: MarkColor
  errorId: string
}

interface Mark {
  kind: 'mark'
  start: number
  end: number
  to: ''
  color: MarkColor
  errorId?: undefined
  highlightId: string
}

/**
 * 逐句生成对照。
 *
 * 只应用**完整落在本句内**的改动；跨句的改动（极少见）就在本句里把重叠部分染个色、
 * 不硬改文字——别为了对齐把句子改得读不通。语序调换同理：只染色、不重排
 * （要看调序结果，请切回批改视图看配对弧线）。
 */
export function buildCompareLines(validated: ValidatedCorrection, answer: string): CompareLine[] {
  const edits: Edit[] = validated.errors.flatMap((entry) =>
    entry.changes.map((change) => ({
      kind: 'edit' as const,
      start: change.start,
      end: change.end,
      to: change.to,
      color: colorForCategory(entry.error.category),
      errorId: entry.error.id,
    })),
  )
  const marks: Mark[] = validated.highlights.map((entry) => ({
    kind: 'mark' as const,
    start: entry.span.start,
    end: entry.span.end,
    to: '' as const,
    color: 'green' as const,
    highlightId: entry.highlight.id,
  }))

  return splitSentences(answer).map((sentence) => {
    const original = answer.slice(sentence.start, sentence.end)
    const parts: CompareSpan[] = []

    const touched = [...edits, ...marks]
      .filter((item) => item.start < sentence.end && item.end > sentence.start)
      .sort((a, b) => a.start - b.start || a.end - b.end)

    let cursor = sentence.start
    for (const item of touched) {
      const start = Math.max(item.start, sentence.start)
      const end = Math.min(item.end, sentence.end)
      if (start > cursor) parts.push({ text: answer.slice(cursor, start) })

      const inside = item.start >= sentence.start && item.end <= sentence.end
      if (item.kind === 'edit' && inside) {
        // to 为空 = 删除：不写任何东西（"不进行填补"正是这个意思）
        if (item.to.length > 0) parts.push({ text: item.to, color: item.color, errorId: item.errorId })
      } else if (start < end) {
        // 亮点，或跨句的改动：只染色、不改文字
        parts.push({
          text: answer.slice(start, end),
          color: item.color,
          errorId: item.kind === 'edit' && !inside ? item.errorId : undefined,
          highlightId: item.kind === 'mark' ? item.highlightId : undefined,
        })
      }
      cursor = Math.max(cursor, end)
    }
    if (cursor < sentence.end) parts.push({ text: answer.slice(cursor, sentence.end) })

    const corrected = mergeSpans(parts)
    return { original, corrected, changed: corrected.some((part) => part.color !== undefined) }
  })
}

/** 相邻同色的片段合成一段，免得渲染出一堆碎 span。 */
function mergeSpans(spans: CompareSpan[]): CompareSpan[] {
  const merged: CompareSpan[] = []
  for (const span of spans) {
    if (span.text.length === 0) continue
    const last = merged[merged.length - 1]
    if (last && last.color === span.color && last.errorId === span.errorId && last.highlightId === span.highlightId) {
      last.text += span.text
      continue
    }
    merged.push({ ...span })
  }
  return merged
}
