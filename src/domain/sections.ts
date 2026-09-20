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

import type { Correction, Direction, ErrorObject, Highlight } from './types'
import { splitSentenceSpans } from './sentences'

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

/* ── 分页：把自然段合成"一页"（用户指定 100–200，别随手改） ──────────── */

/**
 * 页的构成规则。数字是用户定的，改之前先想清楚为什么。
 *
 * 用户原话：「文章模式仍然切割成段落，但是要求保证每一页在 100-200 字，
 * 如果一段不足一百字，那么一页显示两段甚至三段，直到超过 100 字。
 * 如果某一段超过 300 字，那么你合理分割将其变成两段。」
 */
export const PAGE_RULE = {
  /** 一页的下限：不足就把后面的段落并进来 */
  min: 100,
  /** 一页的上限：到了它就不再并下一段 */
  max: 200,
  /** 单个自然段超过它就切开（太长的一段自己就超过一页了） */
  splitAbove: 300,
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

/**
 * 把一段过长的文字按**句子**切成若干段（每段尽量等长、都不超过上限）。
 *
 * 为什么按句切而不是按字数硬切：一页的原文如果从半句话开始，用户根本没法译。
 * 句子的判据直接用 domain/sentences.ts（与对照视图、收藏同一套），
 * 因此「引号收尾」这类边界也认得。
 *
 * 用户说的是"超过 300 就分成两段"；这里推广成"按需分成若干段"——
 * 一段 700 字的材料切成两半仍是 350 字一段，还是超过一页，
 * 那就再分一次，直到每段都放得下。
 */
function splitLongSection(section: Section, direction: Direction, depth = 0): Section[] {
  const total = countUnits(section.text, direction)
  if (total <= PAGE_RULE.splitAbove) return [section]
  /*
   * 先按"大概要分成几份"来分，分完再逐块检查。
   *
   * 为什么还要检查：切点只能落在句子（或逗号）边界上，因此实际切出来的块
   * **可能仍然超过上限**——例如一段 606 字、由 [400, 206] 两个句子组成时，
   * 等分点是 303，只能切在两句之间，于是第一块还是 400 字。
   * 这种块递归再分一次就好（每次至少对半，深度很浅）。
   */
  const parts = Math.ceil(total / PAGE_RULE.splitAbove)
  let sentences = splitSentenceSpans(section.text)
  /*
   * 句号不够用时改在**逗号**处断。
   *
   * 中文政论里"一句话"写三百多字是真实存在的（一串顿号＋逗号，末尾才一个句号），
   * 只认句号的话这一段根本切不开，只能整段当一页——用户要的是"每页 100–200"，
   * 这种巨句按逗号断开反而更好用。句号够用时绝不会走到这里。
   */
  if (sentences.length < parts) {
    const clauses = splitSentenceSpans(section.text, { splitAtCommas: true })
    if (clauses.length > sentences.length) sentences = clauses
  }
  // 逗号也不够（一整个大长句没有停顿）就只能照原样留着，总不能从词中间切开
  if (sentences.length < parts) return [section]

  const units = sentences.map((span) => countUnits(section.text.slice(span.from, span.to), direction))
  const cumulative: number[] = []
  units.forEach((value, index) => cumulative.push((cumulative[index - 1] ?? 0) + value))

  /*
   * 切点选在"累计单位数最接近等分点"的那个句子边界上。
   * 为什么按等分点找而不是"够了就切"：后者遇到 [110, 200] 这种句子分布时，
   * 前半段凑不到目标、于是在结尾一次性收口，等于根本没切。
   */
  const cuts: number[] = []
  for (let part = 1; part < parts; part += 1) {
    const target = (total * part) / parts
    const lower = (cuts[cuts.length - 1] ?? 0) + 1
    // 后面的每一段至少要留一个句子
    const upper = sentences.length - (parts - part)
    let best = -1
    let bestGap = Number.POSITIVE_INFINITY
    for (let index = lower; index <= upper; index += 1) {
      const gap = Math.abs((cumulative[index - 1] ?? 0) - target)
      if (gap < bestGap) {
        bestGap = gap
        best = index
      }
    }
    if (best < 0) break
    cuts.push(best)
  }
  if (cuts.length === 0) return [section]

  const result: Section[] = []
  let cursor = 0
  for (const cut of [...cuts, sentences.length]) {
    const from = cursor === 0 ? 0 : (sentences[cursor]?.from ?? section.text.length)
    const to = cut >= sentences.length ? section.text.length : (sentences[cut]?.from ?? section.text.length)
    result.push({ start: section.start + from, end: section.start + to, text: section.text.slice(from, to) })
    cursor = cut
  }
  if (result.length === 0) return [section]
  // 切完仍有超上限的块 → 再分一次（深度兜底，避免病态输入把栈打穿）
  return result.flatMap((piece) =>
    depth < 4 && countUnits(piece.text, direction) > PAGE_RULE.splitAbove
      ? splitLongSection(piece, direction, depth + 1)
      : [piece],
  )
}

/**
 * 把整篇原文切成**页**（文章模式的一页 = 一次给用户译、一次交去批的那一段）。
 *
 * 规则（用户指定）：
 *   1. 段落太短（不足 100 单位）就与后面的段落并成一页，直到超过 100；
 *   2. 并到快满 200 就收口，不再硬塞下一段；
 *   3. 单个自然段超过 300 先按句子切开（见 splitLongSection）；
 *   4. 最后一页太短就把最后两页**重新均分**（见下面的 rebalanceTail）。
 *
 * 两条硬约束（`scripts/check-articles.mjs` 逐篇验）：
 *   - 任何一页都不超过 300（超过 300 就该按规则切开了）；
 *   - 最后一页不是"小尾巴"（不足 100）。
 *
 * 返回的 Section 与 splitSections 同构（start/end/text 覆盖原文的连续区间），
 * 因此下游（提交时的 sourceSections、批注序号换算、翻页）一行都不用改。
 */
export function paginateArticle(source: string, direction: Direction): Section[] {
  const atoms = splitSections(source).flatMap((section) => splitLongSection(section, direction))
  if (atoms.length === 0) return []

  const units = atoms.map((atom) => countUnits(atom.text, direction))
  const unitOf = (index: number): number => units[index] ?? 0
  /** 第 from 个原子到第 to 个原子（不含）合起来多少单位 */
  const sumOf = (from: number, to: number): number => {
    let total = 0
    for (let index = from; index < to; index += 1) total += unitOf(index)
    return total
  }

  // 后缀和：用来判断"剩下的加起来还不够一页吗"（最后一页要不要并进上一页）
  const restUnits = new Array<number>(atoms.length + 1).fill(0)
  for (let index = atoms.length - 1; index >= 0; index -= 1) {
    restUnits[index] = (restUnits[index + 1] ?? 0) + unitOf(index)
  }

  /** 一页 = 一段连续的原子（下标 from..to，to 不含）。用下标记账，尾巴才好重新均分。 */
  const groups: Array<{ from: number; to: number }> = []
  let groupFrom = 0
  let groupUnits = 0

  atoms.forEach((_, index) => {
    const atomUnits = unitOf(index)
    if (groupFrom === index) {
      groupUnits = atomUnits
      return
    }
    /*
     * 还能不能再并这一段进来？两条路：
     *   1. 并进来不超过上限（200）→ 并；
     *   2. 本页还没到下限（100）→ 继续并，但最远只到绝对上限（300）。
     *      这正是用户要的"一段不足一百字就一页显示两段甚至三段，直到超过 100 字"。
     * 已经够了（≥100）就不再贪心往里塞：用户的口径是"每页 100–200"，
     * 塞到 250 只是让页数变少，却把每一页都撑出了他给的带宽。
     */
    const fits =
      groupUnits + atomUnits <= PAGE_RULE.max ||
      (groupUnits < PAGE_RULE.min && groupUnits + atomUnits <= PAGE_RULE.splitAbove)
    /*
     * 剩下的（含这一段）凑不满一页 → 就地把尾巴收进来，别留一条小尾巴。
     * ⚠️ 但**不许越过绝对上限**：越过了就交给下面的 rebalanceTail 重新均分
     * （实测过：10 个短段共 376 单位，一路"就地收进来"会收成一页 376）。
     */
    const shortTail =
      groupUnits >= PAGE_RULE.min &&
      (restUnits[index] ?? 0) < PAGE_RULE.min &&
      groupUnits + atomUnits <= PAGE_RULE.splitAbove
    if (fits || shortTail) {
      groupUnits += atomUnits
      return
    }
    groups.push({ from: groupFrom, to: index })
    groupFrom = index
    groupUnits = atomUnits
  })
  groups.push({ from: groupFrom, to: atoms.length })

  rebalanceTail(groups, sumOf)
  absorbShortPages(groups, sumOf)

  return groups.map((group) => {
    const first = atoms[group.from]
    const last = atoms[group.to - 1]
    const start = first?.start ?? 0
    const end = last?.end ?? start
    return { start, end, text: source.slice(start, end) }
  })
}

/**
 * 尾巴修正：最后一页不足下限时，把**最后两页的原子重新均分成两页**。
 *
 * 为什么不是"并进上一页"：并进去会让上一页明显超上限（实测：10 个短段共 376 单位，
 * 并起来就是一页 376 —— 既超过 300 又完全不是用户要的"每页 100–200"）。
 * 均分则能给出 180 / 196 这种正落在带里的结果，因为它动的是**边界**而不是总量。
 *
 * 只在"两页都落在 100–300 之间"的切法存在时才动手，否则保持原样。
 */
function rebalanceTail(groups: Array<{ from: number; to: number }>, sumOf: (from: number, to: number) => number): void {
  const last = groups[groups.length - 1]
  const prev = groups[groups.length - 2]
  if (!last || !prev) return
  if (sumOf(last.from, last.to) >= PAGE_RULE.min) return
  if (sumOf(prev.from, last.to) < PAGE_RULE.min * 2) return

  let best = -1
  let bestGap = Number.POSITIVE_INFINITY
  for (let cut = prev.from + 1; cut < last.to; cut += 1) {
    const left = sumOf(prev.from, cut)
    const right = sumOf(cut, last.to)
    if (left < PAGE_RULE.min || left > PAGE_RULE.splitAbove) continue
    if (right < PAGE_RULE.min || right > PAGE_RULE.splitAbove) continue
    const gap = Math.abs(left - right)
    if (gap < bestGap) {
      bestGap = gap
      best = cut
    }
  }
  if (best < 0) return
  prev.to = best
  last.from = best
}

/**
 * 补救"中间那些不足下限的小页"。
 *
 * 它们是怎么来的：贪心是**从左往右**走的——一页凑到 112 就不再收下一段（收了是 205，超了上限），
 * 于是后面那一段 93 只好自己占一页。可从"整篇"看，一页 205 明显好过一页 93：
 * 用户的带宽是 100–200，201–300 本来是允许的（单段太长的那些页就在这一档里）。
 *
 * 因此这里做一次事后补救：**确实不足下限**的页，能并进上一页就并（不许越过绝对上限 300），
 * 并进上一页不行就并进下一页；两边都塞不下（都接近上限）就留着——
 * 那种情况是真的没有办法，留一页短的比撕开一段话好。
 */
function absorbShortPages(groups: Array<{ from: number; to: number }>, sumOf: (from: number, to: number) => number): void {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (!group) continue
    if (sumOf(group.from, group.to) >= PAGE_RULE.min) continue
    const prev = groups[index - 1]
    if (prev && sumOf(prev.from, group.to) <= PAGE_RULE.splitAbove) {
      prev.to = group.to
      groups.splice(index, 1)
      continue
    }
    const next = groups[index + 1]
    if (next && sumOf(group.from, next.to) <= PAGE_RULE.splitAbove) {
      group.to = next.to
      groups.splice(index + 1, 1)
    }
  }
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
