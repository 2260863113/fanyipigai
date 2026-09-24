/**
 * 按段切分、分页，与结果合并。
 *
 * 分页那一半（`paginateArticle`）只服务**文章题**：把整篇切成"一页 = 一个自然段"，
 * 用户一段一段地译、一段一段地交。
 *
 * 合并那一半是**批注的位置换算**：服务端按提交上来的分段各自返回批注，
 * 每段返回的序号是段内序号，合并时必须加上该段在全文中的起点，
 * 否则批注会全部标错位置。做错这一步，校验器会把所有批注都拒掉（问题能被发现），
 * 但仍然要在这里做对。
 */

import type { Correction, Direction, ErrorObject, Highlight } from './types'

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

/* ── 分页：一页 = 一个自然段（太短的与相邻段合并） ────────────────── */

/**
 * 分页规则。数字是用户定的，改之前先想清楚为什么。
 *
 * 用户原话：「把每个文章进行分段，文章模式下，一段一段的出」，
 * 以及在四个候选阈值里选了「不足 50 单位就算太短」。
 *
 * 于是现在的口径是**段落即练习单位**：一页就是一个自然段；
 * 只有明显破格的短段（不足 `mergeBelow`）才与相邻段并成一页——
 * 实测 48 篇共 222 个自然段，只有 23 段低于 50，并完是 220 页。
 *
 * ⚠️ 这里**没有上限**：单段本身很长（实测最长 231 单位）也不再按句切开。
 * 上限那套（100–200 一页、超 300 按句切）是 ADR 0009 的口径，随 ADR 0010 作废。
 */
export const PAGE_RULE = {
  /** 不足它就跟相邻的自然段并成一页 */
  mergeBelow: 50,
} as const

/**
 * 篇幅单位：**英译中计词数，中译英计汉字数**（与文章库的 `units` 同一口径，
 * 也与赛制要求一致）。数字空格不算词，标点不算字，因此中英混排时不会虚高。
 */
export function countUnits(text: string, direction: Direction): number {
  if (direction === 'zh-to-en') {
    return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  }
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

/** 一页：原文那一段（或并起来的几段）+ 它逐段对应的参考译文。 */
export interface ArticlePage extends Section {
  /**
   * 这一页里**逐段配好**的原文与译文。
   *
   * 之所以不是一段拼好的文字：原文栏的「对照」要一段原文、一段译文交替铺开，
   * 而"一页"可能由两个短自然段并成，所以配对关系必须留到这一层，
   * 不能等到渲染时再去切（那时已经分不清哪句对哪句了）。
   */
  pairs: ReadonlyArray<{ source: string; reference: string }>
}

/**
 * 一页的参考译文（把 `pairs` 里的译文拼成一块）。
 * 练习记录页要的是一整段文字，不是交替的两栏，因此从同一份数据里拼出来。
 */
export function referenceOfPage(page: ArticlePage): string {
  return page.pairs
    .map((pair) => pair.reference)
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/**
 * 把整篇原文切成**页**（文章模式的一页 = 一次给用户译、一次交去批的那一段）。
 *
 * 规则（用户指定）：
 *   1. 一页 = 一个自然段（按空行切，见 `splitSections`）；
 *   2. 自然段不足 `PAGE_RULE.mergeBelow` 单位时，与**后面的**自然段并成一页，
 *      一直到够数为止；已经是最后一页就并进**前一页**（否则它会成为一个孤零零的小页）；
 *   3. **不切**长段，也没有上限——段落就是这个练习单位的边界。
 *
 * 参考译文与正文**逐段对齐**（`check-articles.mjs` 逐篇验段数相等），
 * 因此一页对应的译文就是同下标的那些译文段拼起来。对不上时（数据坏了）
 * 缺的那几段当空串处理，界面顶多少显示一行，不会崩。
 *
 * 返回的页与 `splitSections` 同构（start/end/text 覆盖原文的连续区间），
 * 因此下游（提交时的 sourceSections、批注序号换算、翻页）一行都不用改。
 *
 * ## `mergeBelow` 这个参数是给术语题留的
 *
 * 文章题的一页 = 一个自然段，短段才并起来；**术语题的一页 = 固定五条**，
 * 它自己已经在源文里用空行把页切好了（见 term-exercise.ts 的 `termSourceText`），
 * 因此它传 `0`——于是"没有任何一段够短"、一段就是一页，切出来的页恰好是它切好的那些。
 * 不传就走文章题的老口径（不足 50 单位才并页）。
 */
export function paginateArticle(
  source: string,
  reference: string,
  direction: Direction,
  mergeBelow: number = PAGE_RULE.mergeBelow,
): ArticlePage[] {
  const paragraphs = splitSections(source)
  if (paragraphs.length === 0) return []
  const translations = splitSections(reference)

  const units = paragraphs.map((paragraph) => countUnits(paragraph.text, direction))
  /** 一页 = 一段连续的自然段（下标 from..to，to 不含） */
  const groups: Array<{ from: number; to: number }> = []
  let from = 0
  let total = 0

  paragraphs.forEach((_, index) => {
    if (index === from) {
      total = units[index] ?? 0
      return
    }
    /*
     * 本页已经够 `mergeBelow` 就收口，另起一页；否则把这一段并进来。
     * 一页里的第一段本身就是长段时（total 一开始就够），第二段立刻另起一页，
     * 这正是"一段一段出"要的结果。
     */
    if (total >= mergeBelow) {
      groups.push({ from, to: index })
      from = index
      total = units[index] ?? 0
      return
    }
    total += units[index] ?? 0
  })
  groups.push({ from, to: paragraphs.length })

  // 最后一页太短就并进前一页（短段后面没有下一段可并了）
  if (groups.length > 1) {
    const last = groups[groups.length - 1]
    const previous = groups[groups.length - 2]
    if (last && previous && sumOfRange(units, last.from, last.to) < mergeBelow) {
      previous.to = last.to
      groups.pop()
    }
  }

  return groups.map((group) => {
    const first = paragraphs[group.from]
    const last = paragraphs[group.to - 1]
    const start = first?.start ?? 0
    const end = last?.end ?? start
    return {
      start,
      end,
      text: source.slice(start, end),
      pairs: paragraphs.slice(group.from, group.to).map((paragraph, offset) => ({
        source: paragraph.text,
        // 译文对不上时（数据坏了）当空串，界面顶多少显示一行，不会崩
        reference: translations[group.from + offset]?.text ?? '',
      })),
    }
  })
}

/** 第 from 段到第 to 段（不含）合起来多少单位。 */
function sumOfRange(units: readonly number[], from: number, to: number): number {
  let total = 0
  for (let index = from; index < to; index += 1) total += units[index] ?? 0
  return total
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
