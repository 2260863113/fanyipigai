/**
 * 解析 AI 返回的批改 JSON。
 *
 * 这一步承担两个职责，缺一不可：
 * 1. 把 AI 的自由文本收敛成程序可用的结构（去掉代码块包裹、缺字段补默认值）
 * 2. 把不合格的结果**连同具体原因**退回去，交给上层重试
 *
 * 校验失败时绝不猜测、绝不凑合：宁可重试一次，也不要在页面上画出错误的位置。
 * 返回的 problems 会被原样交给 AI 作为重试提示，所以每条都要说清哪里不对、实际是什么。
 */

import type { Correction, ErrorCategory, ErrorObject, ErrorType, Highlight } from './types'
import { CATEGORY_PRIORITY, DIMENSION_LABEL } from './types'
import { validateCorrection } from './validate'
import type { ValidatedCorrection } from './validate'

export interface ParseSuccess {
  ok: true
  correction: Correction
  validated: ValidatedCorrection
  /** 被丢弃的无效批注数量（位置对不上），用于界面提示 */
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

function readScore(value: unknown, label: string, problems: string[]): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    problems.push(`维度 ${label} 的分数不是数字，实际是 ${JSON.stringify(value)}`)
    return 0
  }
  if (value < 0 || value > 100) {
    problems.push(`维度 ${label} 的分数 ${value} 超出 0–100 的范围`)
    return Math.max(0, Math.min(100, value))
  }
  return Math.round(value)
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
    problems.push(
      `${label} 的 category 是 ${JSON.stringify(category)}，必须从分类表里取值：${CATEGORIES.join(' / ')}`,
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

/**
 * 把一个维度都没给的评语补成可用文本：评语缺失只影响展示，不该导致整份批改作废。
 */
function readDimensionComments(value: unknown, problems: string[]): Record<keyof Correction['dimensions'], string> {
  const source = isRecord(value) ? value : {}
  const keys = Object.keys(DIMENSION_LABEL) as Array<keyof Correction['dimensions']>
  const result = {} as Record<keyof Correction['dimensions'], string>
  for (const key of keys) {
    const text = source[key]
    if (typeof text === 'string' && text.trim()) {
      result[key] = text.trim()
    } else {
      problems.push(`dimensionComments.${key}（${DIMENSION_LABEL[key]}）缺失或为空`)
      result[key] = ''
    }
  }
  return result
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

  const totalRaw = parsed.total
  let total = 0
  if (typeof totalRaw !== 'number' || Number.isNaN(totalRaw)) {
    problems.push(`total 不是数字，实际是 ${JSON.stringify(totalRaw)}`)
  } else {
    total = Math.max(0, Math.min(100, Math.round(totalRaw)))
  }

  const dimensionsRaw = isRecord(parsed.dimensions) ? parsed.dimensions : {}
  const dimensions = {
    terminology: readScore(dimensionsRaw.terminology, DIMENSION_LABEL.terminology, problems),
    grammar: readScore(dimensionsRaw.grammar, DIMENSION_LABEL.grammar, problems),
    coherence: readScore(dimensionsRaw.coherence, DIMENSION_LABEL.coherence, problems),
    register: readScore(dimensionsRaw.register, DIMENSION_LABEL.register, problems),
  }

  const summary = readText(parsed.summary, 'summary（总体评语）', problems)
  const dimensionComments = readDimensionComments(parsed.dimensionComments, problems)

  const errors: ErrorObject[] = []
  if (!Array.isArray(parsed.errors)) {
    problems.push('errors 不是数组')
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

  const correction: Correction = { total, dimensions, summary, dimensionComments, errors, highlights }
  return { ok: true, correction, validated, repaired }
}
