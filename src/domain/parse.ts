/**
 * 解析 AI 返回的批改 JSON。
 *
 * 这一步承担两个职责，缺一不可：
 * 1. 把 AI 的自由文本收敛成程序可用的结构（去掉代码块包裹、补齐可缺省字段）
 * 2. 把不合格的结果**连同具体原因**退回去，交给上层重试
 *
 * 校验失败时绝不猜测、绝不凑合：宁可重试一次，也不要在页面上画出错误的位置。
 * 返回的 problems 会被原样交给 AI 作为重试提示，所以每条都要说清哪里不对、实际是什么。
 *
 * 注意：AI **不再返回分数**。分数由程序按错误列表算（见 scoring.ts）。
 */

import type { Correction, ErrorCategory, ErrorObject, ErrorType, Highlight } from './types'
import { CATEGORY_PRIORITY } from './types'
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

function readAnchor(value: unknown, label: string, problems: string[]): ErrorObject['anchor'] {
  if (!isRecord(value)) {
    problems.push(`${label} 的 anchor 不是对象`)
    return undefined
  }
  const { start, end, snippet } = value
  if (typeof start !== 'number' || typeof end !== 'number' || typeof snippet !== 'string') {
    problems.push(`${label} 的 anchor 缺少 start / end / snippet，或类型不对`)
    return undefined
  }
  return { start: Math.trunc(start), end: Math.trunc(end), snippet }
}

function readSegments(value: unknown, label: string, problems: string[]): ErrorObject['segments'] {
  if (!Array.isArray(value) || value.length < 2) {
    problems.push(`${label} 是语序调换，但 segments 不是至少含两个元素的数组`)
    return undefined
  }
  const segments = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      problems.push(`${label} 的第 ${index + 1} 个片段不是对象`)
      return undefined
    }
    const anchor = readAnchor(item, `${label} 的第 ${index + 1} 个片段`, problems)
    if (!anchor) return undefined
    const { sourceIndex, targetIndex } = item
    if (typeof sourceIndex !== 'number' || typeof targetIndex !== 'number') {
      problems.push(`${label} 的第 ${index + 1} 个片段缺少 sourceIndex / targetIndex`)
      return undefined
    }
    segments.push({ anchor, sourceIndex: Math.trunc(sourceIndex), targetIndex: Math.trunc(targetIndex) })
  }
  return segments
}

function readError(value: unknown, index: number, problems: string[]): ErrorObject | undefined {
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
    // 这是实际发生过的一类失败：某一条错误漏写了 category，导致整份返回作废。
    // 因此提示里要说清"这一条的哪个字段缺了"，而不是只说取值不合法。
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

  const base = { id, type: errorType, category: errorCategory, explanation }

  switch (errorType) {
    case 'replace':
    case 'rewrite': {
      const anchor = readAnchor(value.anchor, label, problems)
      const targetText = typeof value.targetText === 'string' ? value.targetText.trim() : ''
      if (!targetText) problems.push(`${label} 是 ${errorType}，但没有给出 targetText`)
      if (!anchor || !targetText) return undefined
      return { ...base, anchor, targetText }
    }
    case 'delete': {
      const anchor = readAnchor(value.anchor, label, problems)
      if (!anchor) return undefined
      return { ...base, anchor }
    }
    case 'insert': {
      const insertAfter = readAnchor(value.insertAfter ?? value.anchor, label, problems)
      const targetText = typeof value.targetText === 'string' ? value.targetText : ''
      if (!targetText) problems.push(`${label} 是 insert，但没有给出要补入的 targetText`)
      if (!insertAfter || !targetText) return undefined
      return { ...base, insertAfter, targetText }
    }
    case 'reorder': {
      const segments = readSegments(value.segments, label, problems)
      if (!segments) return undefined
      return { ...base, segments }
    }
    default:
      return undefined
  }
}

function readHighlight(value: unknown, index: number, problems: string[]): Highlight | undefined {
  if (!isRecord(value)) {
    problems.push(`highlights[${index}] 不是对象`)
    return undefined
  }
  const label = `highlights[${index}]`
  const anchor = readAnchor(value.anchor, label, problems)
  const comment = readText(value.comment, `${label} 的 comment`, problems)
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
      const error = readError(item, index, problems)
      if (error) errors.push(error)
    }
  }

  const highlights: Highlight[] = []
  if (parsed.highlights !== undefined) {
    if (!Array.isArray(parsed.highlights)) {
      problems.push('highlights 不是数组')
    } else {
      for (const [index, item] of parsed.highlights.entries()) {
        const highlight = readHighlight(item, index, problems)
        if (highlight) highlights.push(highlight)
      }
    }
  }

  // 结构层面没问题后，再做位置校验——这一步会剔除位置对不上的批注
  const validated = validateCorrection(errors, highlights, answer)
  const repaired = validated.rejections.map((rejection) => `${rejection.id}：${rejection.message}`)

  if (problems.length > 0) return { ok: false, problems }

  // 位置全部对不上时，说明这次返回毫无用处，值得重试
  if (errors.length > 0 && validated.errors.length === 0) {
    return {
      ok: false,
      problems: ['所有批注的位置都与学生译文对不上，等于没有标出任何问题', ...repaired],
    }
  }

  return { ok: true, correction: { errors, highlights }, validated, repaired }
}
