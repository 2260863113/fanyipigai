/**
 * 按段切分与结果合并。
 *
 * 为什么按段调用 API：
 * 1. 准确——一次让模型标一整篇的几十处批注，它数错位置的概率明显上升；
 * 2. 效率——段落之间互不依赖，可以并行请求，总耗时取决于最慢的那一段；
 * 3. 一致——每段的上下文更短，模型更容易把注意力放在这一段上。
 *
 * 难点在**位置换算**：每段单独返回的序号是段内序号，合并时必须加上该段在全文中的起点，
 * 否则批注会全部标错位置。做错这一步，校验器会把所有批注都拒掉（问题能被发现），
 * 但仍然要在这里做对。
 */

import type { Correction, ErrorObject, Highlight } from './types'

export interface Section {
  /** 段落在全文中的起始字符序号 */
  start: number
  /** 段落在全文中的结束字符序号（不含） */
  end: number
  /** 段落文字本身，不含分隔符 */
  text: string
}

/**
 * 按空行切分。
 * 只在有空行时才算分段：句子题、段落题、术语题的原文都是单段，
 * 会原样返回一个 section，因此调用方不需要按题型写分支。
 */
export function splitSections(source: string): Section[] {
  const sections: Section[] = []
  let offset = 0

  let blockStart = -1
  let buffer: string[] = []

  const flush = (): void => {
    if (buffer.length === 0) return
    const text = buffer.join('\n')
    const leading = text.length - text.trimStart().length
    const trimmed = text.trim()
    if (trimmed.length > 0) {
      sections.push({ start: blockStart + leading, end: blockStart + leading + trimmed.length, text: trimmed })
    }
    buffer = []
    blockStart = -1
  }

  for (const line of source.split('\n')) {
    const lineStart = offset
    offset += line.length + 1 // 计入换行符
    if (line.trim().length === 0) {
      flush()
      continue
    }
    if (blockStart < 0) blockStart = lineStart
    buffer.push(line)
  }
  flush()

  if (sections.length === 0) {
    const trimmed = source.trim()
    if (trimmed.length === 0) return []
    const leading = source.length - source.trimStart().length
    return [{ start: leading, end: leading + trimmed.length, text: trimmed }]
  }
  return sections
}

/** 把一段批改里的所有锚点平移 delta 个字符。 */
function shiftBy<T>(value: T, delta: number): T {
  const source = value as T & {
    anchor?: { start: number; end: number; snippet: string }
    insertAfter?: { start: number; end: number; snippet: string }
    segments?: Array<{ anchor: { start: number; end: number; snippet: string }; sourceIndex: number; targetIndex: number }>
  }

  const shift = (anchor: { start: number; end: number; snippet: string }): { start: number; end: number; snippet: string } => ({
    ...anchor,
    start: anchor.start + delta,
    end: anchor.end + delta,
  })

  const result = { ...source }
  if (source.anchor) result.anchor = shift(source.anchor)
  if (source.insertAfter) result.insertAfter = shift(source.insertAfter)
  if (source.segments) result.segments = source.segments.map((segment) => ({ ...segment, anchor: shift(segment.anchor) }))
  return result as T
}

/**
 * 把各段拼回一份完整文本。
 *
 * 段的起点由调用方声明（而不是靠分隔符宽度去推断），因此这里只用它来填"段与段之间的空白"，
 * 段内的文字严格来自各段自身。合并后的批注序号全部基于这些起点，
 * 所以这里算出来的文本必须与那些序号自洽——用同一个 rebuild 函数两边都走一遍即可。
 */
export function rebuildFromSections(sections: readonly Section[]): string {
  const last = sections[sections.length - 1]
  if (!last) return ''
  const buffer = new Array<string>(last.end).fill(' ')
  for (const section of sections) {
    for (let i = 0; i < section.text.length; i += 1) {
      buffer[section.start + i] = section.text[i] ?? ' '
    }
  }
  return buffer.join('')
}

export interface SectionCorrection {
  /** 这一段在作答中的起点，用于把段内序号换算到全文 */
  answerStart: number
  correction: Correction
}

/**
 * 合并各段的批改结果。
 * 序号统一加上该段的全文起点；编号加段前缀，避免跨段重名。
 */
export function mergeSectionCorrections(results: SectionCorrection[]): Correction {
  const errors: ErrorObject[] = []
  const highlights: Highlight[] = []

  results.forEach((result, index) => {
    for (const error of result.correction.errors) {
      errors.push({ ...shiftBy(error, result.answerStart), id: `s${index + 1}-${error.id}` })
    }
    for (const highlight of result.correction.highlights) {
      highlights.push({ ...shiftBy(highlight, result.answerStart), id: `s${index + 1}-${highlight.id}` })
    }
  })

  return { errors, highlights }
}
