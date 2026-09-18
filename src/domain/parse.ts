/**
 * 解析 AI 返回的批改 JSON。
 *
 * 这里承担三件事：
 * 1. 把 AI 的自由文本收敛成结构（去掉代码块包裹、补齐可缺省字段）
 * 2. **按文字定位**：AI 只说"要改哪段文字"，程序自己到译文里找位置（见 locate.ts）。
 *    模型因此完全不需要数字符序号，也就没有"数错序号"这种失败。
 * 3. 把不合格的结果连同**具体原因**退回去重试。绝不猜测、绝不凑合——
 *    宁可重试一次，也不要把批注画到错的地方。
 *
 * 注意：AI 不再返回分数（分数由 scoring.ts 按错误分类算），也不返回任何字符序号。
 */

import type { Correction, ErrorCategory, ErrorObject, ErrorType, Highlight } from './types'
import { CATEGORY_PRIORITY } from './types'
import { locate } from './locate'
import { minimizeChange } from './minimal'
import { validateCorrection, type ValidatedCorrection } from './validate'

export interface ParseSuccess {
  ok: true
  correction: Correction
  validated: ValidatedCorrection
  /** 位置对不上而被丢弃的批注说明 */
  repaired: string[]
}

export interface ParseFailure {
  ok: false
  /** 面向 AI 的重试提示，也用于日志 */
  problems: string[]
}

const ERROR_TYPES: readonly ErrorType[] = ['replace', 'insert', 'delete', 'rewrite', 'reorder']
const CATEGORIES: readonly ErrorCategory[] = CATEGORY_PRIORITY

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 去掉 AI 可能加上的代码块包裹与前后闲话，取出第一个完整的 JSON 对象。 */
export function extractJson(raw: string): { text: string } | { error: string } {
  const trimmed = raw.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) {
    return { error: `返回内容里找不到 JSON 对象。实际返回的开头是：${trimmed.slice(0, 120)}` }
  }
  return { text: withoutFence.slice(start, end + 1) }
}

/**
 * 读一个非空字符串。
 *
 * **只判断"是不是空的"，绝不 trim 返回值**：片段里的首尾空格属于片段本身，
 * trim 掉就会让定位偏到别处——实测踩过："China " 被 trim 成 "China"，
 * 于是定位到位置 0–5、把后面的 " insist" 漏在外面，画面上就出现了重复的 China。
 */
function readText(value: unknown, label: string, problems: string[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    problems.push(`${label} 缺失或为空`)
    return ''
  }
  return value
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 把 AI 给的文字片段定位成绝对区间。 */
function resolveSpan(
  answer: string,
  text: string,
  before: string | undefined,
  after: string | undefined,
  occurrence: number | undefined,
  label: string,
  problems: string[],
): { start: number; end: number; snippet: string } | undefined {
  const outcome = locate(answer, { text, contextBefore: before, contextAfter: after, occurrence })
  if (outcome.ok) return outcome.value
  problems.push(`${label}：${outcome.reason}`)
  return undefined
}

/**
 * 算出这处修改的**最小**区间：只覆盖真正变化的那几个字。
 *
 * 做法是拿 AI 自己写的改后文字反算差异（见 minimal.ts）。
 * 对替换与整句重写，把 AI 圈的 oldText 按它给的 targetText 修一遍，再取最小差异；
 * 删除与插入没有可缩的余地（一个全是删、一个全是增），按原意给出。
 *
 * 返回的 start / end 是**答案文本里的绝对位置**，程序直接据此渲染，
 * 不需要再按文字找一次——那样反而可能找到别处去。
 */
/**
 * 算出这处修改最终要显示什么。
 *
 * **所有坐标统一到"作答全文"这一套**：`start` / `end` 直接就是答案里的绝对位置，
 * 划掉的文字就是 `answer.slice(start, end)`；`to` 是上方要写的文字。
 * 这样彻底避免了在"片段内坐标"与"全文坐标"之间来回换算——
 * 之前正是在那里出错，画面上出现了 `China` 后面又跟一个 `insist` 这种重复。
 *
 * 三种显示形态：
 *   replace  划掉 start..end 里的文字，上方写 to
 *   delete   划掉 start..end 里的文字，不写任何东西
 *   insert   start === end（零宽落点），只显示补入的 to
 */
function resolveChanged(
  answer: string,
  span: { start: number; end: number; snippet: string },
  errorType: ErrorType,
  targetText: string | undefined,
): { start: number; end: number; to: string } {
  void answer
  const original = span.snippet

  // 删除：整块划掉就是最小改法
  if (errorType === 'delete') {
    return { start: span.start, end: span.end, to: '' }
  }

  // 插入：没有可删的内容，落点即区间（零长度）
  if (errorType === 'insert' || typeof targetText !== 'string') {
    return { start: span.end, end: span.end, to: targetText ?? '' }
  }

  const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char)

  // 先把 targetText 两端**原样重复的原文**剥掉。
  // 模型常这么写：原文 "China "、却把正确写法写成 "China insists on"（China 是原样保留的）。
  // 不剥的话页面上会先划掉 China、上方又写一遍 China——这正是实测看到的重复。
  // 现在坐标已统一到作答全文，所以这里只做字符串层面的去除，不牵涉任何位置换算。
  const stripEdgeRepeat = (text: string): string => {
    const core = original.trim()
    if (!core) return text
    for (const edge of [original, core]) {
      if (text.length > edge.length && text.startsWith(edge)) return text.slice(edge.length).trimStart()
      if (text.length > edge.length && text.endsWith(edge)) return text.slice(0, text.length - edge.length).trimEnd()
    }
    return text
  }
  const cleaned = stripEdgeRepeat(targetText)
  const replacement = cleaned.length > 0 ? cleaned : targetText

  // 情况一：正确写法里**包含**原文（含"在一端多出一截"）——只多不少。
  if (replacement.includes(original)) {
    const at = replacement.indexOf(original)
    const extra = replacement.slice(0, at) + replacement.slice(at + original.length)

    // 多出来的全是标点或空格 → 纯插入：不划任何字，只显示补进去的东西
    // （关键一环 → 关键一环。 只显示新增的 ）
    if (extra.length > 0 && ![...extra].some(isWordChar)) {
      const insertAt = at === 0 ? span.start : span.end
      return { start: insertAt, end: insertAt, to: extra }
    }

    // 多出来的含字母数字 → 真的换了字，照原区间显示（year → years 划掉 year）
    return { start: span.start, end: span.end, to: replacement }
  }

  // 情况二：正确写法里**不包含**原文——这才用最小差异缩窄，让"哪个词变了"看得清。
  //
  // 注意这里刻意不去"清理"模型抄重复的原文：实测它常给出含糊或重叠的 targetText
  // （如原文 "China "、targetText "China insists on"），任何自动换算都会算错位置，
  // 于是宁可照它给的范围显示，也不要自作聪明。真正治本的办法是提示词要求它只写改成的那部分。
  const minimal = minimizeChange(original, replacement)
  if (!minimal) return { start: span.start, end: span.end, to: replacement }

  let start = span.start + minimal.startOffset
  let end = span.start + minimal.endOffset

  // 求同存异要按**词**，不能按字母。
  //   have explore ways → have explored ways   最小差异只落在词尾的 d 上，
  //                                            但"整词"才是有意义的单位，应当划掉整个 explore
  //   live condition    → live conditions      同理，划的应是 condition，而不是那个 s
  // 做法：若最小差异落在词内（左右至少一侧紧邻的仍是词字符），
  // 就把范围扩到该词在原文里的完整边界。
  const isWord = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char)
  const insideWord = (start > 0 && isWord(answer[start - 1])) || (end < answer.length && isWord(answer[end]))
  if (insideWord) {
    // 向左扩到词首
    while (start > 0 && isWord(answer[start - 1])) start -= 1
    // 向右扩到词尾（已经相同的那部分也算进来，因为整词才是改动单位）
    while (end < answer.length && isWord(answer[end])) end += 1
    return { start, end, to: wordAfterFix(answer, start, end, span, minimal, replacement) }
  }

  return { start, end, to: minimal.to }
}

/**
 * 整词扩展后，算出上方该写什么。
 *
 * 扩展把"原本相同的那部分词"也纳入了划掉范围，因此上方不能只写最小差异，
 * 而要写出这个词改成后的完整形态。
 *   original 片段是 'have explore ways'，扩出来的词是 'explore'，
 *   最小差异是 explore → explored，于是上方写 'explored'。
 */
function wordAfterFix(
  answer: string,
  start: number,
  end: number,
  span: { start: number; end: number; snippet: string },
  minimal: { startOffset: number; endOffset: number; to: string },
  replacement: string,
): string {
  const oldWord = answer.slice(start, end)
  const headKeep = span.start - start // 左侧多纳入的相同字符数
  if (headKeep < 0) return replacement

  // 这个词 = 左侧相同部分 + 原片段 + 右侧相同部分
  const localStart = headKeep + minimal.startOffset
  const localEnd = headKeep + minimal.endOffset
  if (localStart < 0 || localEnd > oldWord.length) return replacement

  // 先算出这个词改成后的完整形态
  const correctedWord = oldWord.slice(0, localStart) + minimal.to + oldWord.slice(localEnd)

  // 再剥掉它**与原文相同的前后部分**：那些字没有被改动，写在上方只会造成重复。
  // 中间"确实变了的那一段"整段留下，这正是"按词不按字母"的含义：
  //   condition → conditions            左侧的 condition 在改后文字里不是原样前缀 → 上方写 conditions
  //   live condition → live conditions  左侧的 live 原样保留 → 上方只写 conditions
  //
  // 注意：这里**只剥左侧**，不剥右侧。因为右侧相同的部分正是"改成后的词尾"，
  // 例如 condition → conditions：左侧 condition 是新词的前缀（剥掉），
  // 右侧那个 s 是变化本身（必须留下）。若连右侧一起剥，就只剩一个空串了。
  let from = 0
  while (from < oldWord.length && from < correctedWord.length && oldWord[from] === correctedWord[from]) {
    from += 1
  }
  const visible = correctedWord.slice(from)
  return visible.length > 0 ? visible : correctedWord
}

function readSegments(
  value: unknown,
  answer: string,
  label: string,
  problems: string[],
): ErrorObject['segments'] {
  if (!Array.isArray(value) || value.length < 2) {
    problems.push(`${label} 是语序调换，但 segments 不是至少含两个元素的数组`)
    return undefined
  }

  const segments: NonNullable<ErrorObject['segments']> = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      problems.push(`${label} 的第 ${index + 1} 个片段不是对象`)
      return undefined
    }
    const segmentLabel = `${label} 的第 ${index + 1} 个片段`
    const text = readText(item.oldText ?? item.text, `${segmentLabel} 的 oldText`, problems)
    const anchor = text
      ? resolveSpan(
          answer,
          text,
          readOptionalText(item.contextBefore),
          readOptionalText(item.contextAfter),
          typeof item.occurrence === 'number' ? item.occurrence : undefined,
          segmentLabel,
          problems,
        )
      : undefined
    if (!anchor) return undefined

    const { sourceIndex, targetIndex } = item
    if (typeof sourceIndex !== 'number' || typeof targetIndex !== 'number') {
      problems.push(`${segmentLabel} 缺少 sourceIndex / targetIndex（这两个数字只表示片段之间的先后，不是字符位置）`)
      return undefined
    }
    segments.push({ oldText: text, anchor, sourceIndex: Math.trunc(sourceIndex), targetIndex: Math.trunc(targetIndex) })
  }
  return segments
}

function readError(value: unknown, index: number, answer: string, problems: string[]): ErrorObject | undefined {
  if (!isRecord(value)) {
    problems.push(`errors[${index}] 不是对象`)
    return undefined
  }
  const label = `errors[${index}]`

  const type = value.type
  if (typeof type !== 'string' || !ERROR_TYPES.includes(type as ErrorType)) {
    problems.push(`${label} 的 type 是 ${JSON.stringify(type)}，只能是 replace / insert / delete / rewrite / reorder`)
    return undefined
  }
  const category = value.category
  if (typeof category !== 'string' || !CATEGORIES.includes(category as ErrorCategory)) {
    const actual = value.category === undefined ? '缺了这个字段' : JSON.stringify(category)
    problems.push(
      `${label} 的 category ${actual}。每一个 error 都必须有 category，` +
        `取值只能是：${CATEGORIES.join(' / ')}`,
    )
    return undefined
  }

  const errorType = type as ErrorType
  const errorCategory = category as ErrorCategory
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `e${index + 1}`
  const explanation = readText(value.explanation, `${label} 的 explanation`, problems)
  const before = readOptionalText(value.contextBefore)
  const after = readOptionalText(value.contextAfter)
  const occurrence = typeof value.occurrence === 'number' ? value.occurrence : undefined

  const base = { id, type: errorType, category: errorCategory, explanation, contextBefore: before, contextAfter: after }

  switch (errorType) {
    case 'replace':
    case 'rewrite': {
      const text = readText(value.oldText, `${label} 的 oldText`, problems)
      const targetText = typeof value.targetText === 'string' ? value.targetText.trim() : ''
      if (!targetText) problems.push(`${label} 是 ${errorType}，但没有给出 targetText`)
      const span = text ? resolveSpan(answer, text, before, after, occurrence, label, problems) : undefined
      if (!span || !targetText) return undefined
      const changed = resolveChanged(answer, span, errorType, targetText)
      return {
        ...base,
        oldText: text,
        changed,
        // anchor 指向缩窄后的区间；原始区间另存一份供校验用
        // anchor 保留 AI 圈的原始区间；真正要划的范围在 changed 里
        anchor: { start: span.start, end: span.end, snippet: span.snippet },
        originalSpan: span,
        targetText,
      }
    }
    case 'delete': {
      const text = readText(value.oldText, `${label} 的 oldText`, problems)
      const span = text ? resolveSpan(answer, text, before, after, occurrence, label, problems) : undefined
      if (!span) return undefined
      const changed = resolveChanged(answer, span, errorType, undefined)
      return {
        ...base,
        oldText: text,
        changed,
        // anchor 保留 AI 圈的原始区间；真正要划的范围在 changed 里
        anchor: { start: span.start, end: span.end, snippet: span.snippet },
        originalSpan: span,
      }
    }
    case 'insert': {
      // 落点用「补在这个片段之后」表达；也兼容旧字段名 afterText
      const text = readText(value.insertAfterText ?? value.oldText, `${label} 的 insertAfterText`, problems)
      const targetText = typeof value.targetText === 'string' ? value.targetText : ''
      if (!targetText) problems.push(`${label} 是 insert，但没有给出要补入的 targetText`)
      const span = text ? resolveSpan(answer, text, before, after, occurrence, label, problems) : undefined
      if (!span || !targetText) return undefined
      const changed = resolveChanged(answer, span, errorType, targetText)
      return {
        ...base,
        oldText: text,
        changed,
        insertAfter: { start: span.start, end: span.end, snippet: span.snippet },
        anchor: { start: span.start, end: span.end, snippet: '' },
        originalSpan: span,
        targetText,
      }
    }
    case 'reorder': {
      const segments = readSegments(value.segments, answer, label, problems)
      if (!segments) return undefined
      return { ...base, segments }
    }
    default:
      return undefined
  }
}

function readHighlight(value: unknown, index: number, answer: string, problems: string[]): Highlight | undefined {
  if (!isRecord(value)) {
    problems.push(`highlights[${index}] 不是对象`)
    return undefined
  }
  const label = `highlights[${index}]`
  const text = readText(value.oldText ?? value.text, `${label} 的 oldText`, problems)
  const comment = readText(value.comment, `${label} 的 comment`, problems)
  const anchor = text
    ? resolveSpan(
        answer,
        text,
        readOptionalText(value.contextBefore),
        readOptionalText(value.contextAfter),
        typeof value.occurrence === 'number' ? value.occurrence : undefined,
        label,
        problems,
      )
    : undefined
  if (!anchor || !comment) return undefined
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `h${index + 1}`
  return { id, anchor, comment }
}

export function parseCorrection(raw: string, answer: string): ParseSuccess | ParseFailure {
  const extracted = extractJson(raw)
  if ('error' in extracted) return { ok: false, problems: [extracted.error] }

  let parsed: unknown
  try {
    parsed = JSON.parse(extracted.text)
  } catch (error) {
    return {
      ok: false,
      problems: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`],
    }
  }

  if (!isRecord(parsed)) return { ok: false, problems: ['返回的 JSON 顶层不是对象'] }

  const problems: string[] = []

  const errors: ErrorObject[] = []
  if (!Array.isArray(parsed.errors)) {
    problems.push('errors 不是数组（没有发现错误时也应当返回空数组 []）')
  } else {
    for (const [index, item] of parsed.errors.entries()) {
      const error = readError(item, index, answer, problems)
      if (error) errors.push(error)
    }
  }

  const highlights: Highlight[] = []
  if (parsed.highlights !== undefined) {
    if (!Array.isArray(parsed.highlights)) {
      problems.push('highlights 不是数组')
    } else {
      for (const [index, item] of parsed.highlights.entries()) {
        const highlight = readHighlight(item, index, answer, problems)
        if (highlight) highlights.push(highlight)
      }
    }
  }

  // 结构层面没问题后，再做一次位置校验（此时位置已由程序找出，因此这一步主要防内部错误）
  const validated = validateCorrection(errors, highlights, answer)
  const repaired = validated.rejections.map((rejection) => `${rejection.id}：${rejection.message}`)

  if (problems.length > 0) return { ok: false, problems }

  // 位置全部对不上时，说明这次返回毫无用处，值得重试
  if (errors.length > 0 && validated.errors.length === 0) {
    return {
      ok: false,
      problems: ['所有批注都没能定位到译文中的文字，等于没有标出任何问题', ...repaired],
    }
  }

  return { ok: true, correction: { errors, highlights }, validated, repaired }
}
