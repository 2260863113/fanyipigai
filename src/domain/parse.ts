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

function readText(value: unknown, label: string, problems: string[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    problems.push(`${label} 缺失或为空`)
    return ''
  }
  return value.trim()
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
function resolveChanged(
  span: { start: number; end: number; snippet: string },
  errorType: ErrorType,
  targetText: string | undefined,
): { start: number; end: number; from: string; to: string } {
  const original = span.snippet

  // 删除：整块划掉就是最小改法
  if (errorType === 'delete') {
    return { start: span.start, end: span.end, from: original, to: '' }
  }

  // 插入：没有可删的内容，落点即区间（零长度）
  if (errorType === 'insert' || typeof targetText !== 'string') {
    return { start: span.end, end: span.end, from: '', to: targetText ?? '' }
  }

  const minimal = minimizeChange(original, targetText)
  if (!minimal) {
    // 新旧文字完全相同：AI 标了一处其实没改的地方，按原区间展示
    return { start: span.start, end: span.end, from: original, to: targetText }
  }

  return {
    start: span.start + minimal.startOffset,
    end: span.start + minimal.endOffset,
    from: minimal.from,
    to: minimal.to,
  }
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
      const changed = resolveChanged(span, errorType, targetText)
      return {
        ...base,
        oldText: text,
        changed,
        anchor: { start: changed.start, end: changed.end, snippet: changed.from },
        targetText,
      }
    }
    case 'delete': {
      const text = readText(value.oldText, `${label} 的 oldText`, problems)
      const span = text ? resolveSpan(answer, text, before, after, occurrence, label, problems) : undefined
      if (!span) return undefined
      const changed = resolveChanged(span, errorType, undefined)
      return { ...base, oldText: text, changed, anchor: { start: changed.start, end: changed.end, snippet: changed.from } }
    }
    case 'insert': {
      // 落点用「补在这个片段之后」表达；也兼容旧字段名 afterText
      const text = readText(value.insertAfterText ?? value.oldText, `${label} 的 insertAfterText`, problems)
      const targetText = typeof value.targetText === 'string' ? value.targetText : ''
      if (!targetText) problems.push(`${label} 是 insert，但没有给出要补入的 targetText`)
      const span = text ? resolveSpan(answer, text, before, after, occurrence, label, problems) : undefined
      if (!span || !targetText) return undefined
      const changed = resolveChanged(span, errorType, targetText)
      return {
        ...base,
        oldText: text,
        changed,
        insertAfter: { start: span.start, end: span.end, snippet: span.snippet },
        anchor: { start: changed.start, end: changed.end, snippet: '' },
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
