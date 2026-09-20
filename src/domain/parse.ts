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

/**
 * 「所有批注都没能定位到译文里的文字」这条问题的开头。
 *
 * 为什么做成导出常量：开发用的接口（vite-plugin-judge-api.ts）要按**失败原因**归档，
 * 而它原先靠 `problem.includes('…位置都与学生译文对不上…')` 这种散文匹配来判断
 * ——那段文字早被改掉了，于是"位置对不上"这一类失败**永远归不进档**，
 * 实测 178 份存档里一个都没有，全被误归成"格式不合法"。
 *
 * 现在两边引用同一份文本：谁改了文案，引用它的地方会立刻在编译期报错，
 * 而不是安静地失配。
 */
export const PROBLEM_NO_ANCHOR_MATCH = '所有批注都没能定位到译文中的文字'

/** 「返回的不是合法 JSON」这条问题的开头。与上面同理，供归档判断引用。 */
export const PROBLEM_JSON_PARSE_FAILED = 'JSON 解析失败'

/** 「返回里根本没有 JSON 对象」这条问题的开头（连花括号都找不到时走这条）。 */
export const PROBLEM_NO_JSON_OBJECT = '返回内容里找不到 JSON 对象'

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
    return { error: `${PROBLEM_NO_JSON_OBJECT}。实际返回的开头是：${trimmed.slice(0, 120)}` }
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
  span: { start: number; end: number; snippet: string },
  errorType: ErrorType,
  targetText: string | undefined,
): Array<{ start: number; end: number; to: string }> {
  const original = span.snippet

  /*
   * 删除：AI 圈的范围就是"要划掉的东西"，而且没有替换内容。
   *
   * ⚠️ 这里**不能**只取"最小不同项"：删除的本身就是"整块都不要了"，
   * 新旧文字之间也不存在"共同的前缀/后缀"可以让出来——
   * `the past` → 空 时，被删的 `the past` 两个词都得划掉，不能只划一个。
   * 因此纯删除走这一支，直接把整块划掉（界面上是荧光底色 + 一道横线，见 styles.css）。
   */
  if (errorType === 'delete') {
    return [{ start: span.start, end: span.end, to: '' }]
  }

  // 插入：没有可删的内容，落点即区间（零长度）
  if (errorType === 'insert' || typeof targetText !== 'string') {
    return [{ start: span.end, end: span.end, to: targetText ?? '' }]
  }

  /*
   * 剩下的全交给 minimizeChange。
   *
   * 它按**词**（不是字母）算出最小不同项，并且已经判好了"该不该划掉东西"：
   *   词形变化（explore → explored、recent year → recent years）→ 划掉整个词、上方写新词
   *   漏／多一个词（past ↔ the past）                        → 一个字都不划，或只划掉多出来的词
   *   一处错误落在好几个词上（farmer and herder → farmers and herders）→ 返回多项，各画各的
   *
   * 所以这一层**只做坐标换算**：把片段内的偏移搬到作答全文的绝对位置上。
   * 这里曾经还要"按词再扩一次"，那一步会把纯插入又扩成整词替换，
   * 覆盖掉 minimizeChange 的判断——不要再加回来。
   */
  const minimal = minimizeChange(original, targetText)
  if (!minimal) return [{ start: span.start, end: span.end, to: targetText }]

  return minimal.map((change) => ({
    start: span.start + change.startOffset,
    end: span.start + change.endOffset,
    to: change.to,
  }))
}

/**
 * 把解析后的批注还原成"AI 原本写的样子"。
 *
 * 解析器往每个错误对象上补了 anchor / originalSpan / changed / insertAfter 这些
 * 程序自己算出来的字段。要回答"AI 到底返回了什么"，就得把它们去掉——
 * 界面上的「查看 AI 完整返回内容」用的就是这个。
 */
export function toAiShape(correction: Correction): { errors: unknown[]; highlights: unknown[] } {
  return {
    errors: correction.errors.map((error) => ({
      id: error.id,
      type: error.type,
      category: error.category,
      ...(error.oldText !== undefined ? { oldText: error.oldText } : {}),
      ...(error.targetText !== undefined ? { targetText: error.targetText } : {}),
      ...(error.contextBefore !== undefined ? { contextBefore: error.contextBefore } : {}),
      ...(error.contextAfter !== undefined ? { contextAfter: error.contextAfter } : {}),
      ...(error.segments
        ? {
            segments: error.segments.map((segment) => ({
              oldText: segment.oldText,
              sourceIndex: segment.sourceIndex,
              targetIndex: segment.targetIndex,
            })),
          }
        : {}),
      explanation: error.explanation,
    })),
    highlights: correction.highlights.map((highlight) => ({
      id: highlight.id,
      oldText: highlight.oldText,
      comment: highlight.comment,
    })),
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
        // anchor 与 originalSpan 装的是**同一个**区间：AI 圈出的那片文字由程序定位出来的位置。
        // 真正要划的范围在 changed 里（按词求出的最小不同项），不是缩窄后的 anchor。
        // 曾经这里的注释写成"anchor 指向缩窄后的区间"，与代码不符——
        // 下游若照那句注释理解，会以为 originalSpan 是多余的。
        anchor: { start: span.start, end: span.end, snippet: span.snippet },
        originalSpan: span,
        targetText,
      }
    }
    case 'delete': {
      const text = readText(value.oldText, `${label} 的 oldText`, problems)
      const span = text ? resolveSpan(answer, text, before, after, occurrence, label, problems) : undefined
      if (!span) return undefined
      const changed = resolveChanged(span, errorType, undefined)
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
      const changed = resolveChanged(span, errorType, targetText)
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
      problems: [`${PROBLEM_JSON_PARSE_FAILED}：${error instanceof Error ? error.message : String(error)}`],
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

  /*
   * 位置全部对不上时，说明这次返回毫无用处，值得重试。
   *
   * ⚠️ 实测这一支**走不到**：定位失败（locate.ts 找不到片段）时，readError 会把原因
   * push 进 problems，于是上面的 `if (problems.length > 0)` 已经先返回了，
   * 带出来的文案是「errors[0]：译文里找不到片段…」而不是下面这句。
   * 换句话说，位置对不上这一类失败的真实文案来自 locate.ts。
   *
   * 保留这里是为了将来真有"errors 解析出来了、但一个都没通过位置校验"的情形；
   * 判断失败类型时请以 locate.ts / validate.ts 的常量为准，不要依赖下面这句话。
   */
  if (errors.length > 0 && validated.errors.length === 0) {
    return {
      ok: false,
      problems: [`${PROBLEM_NO_ANCHOR_MATCH}，等于没有标出任何问题`, ...repaired],
    }
  }

  return { ok: true, correction: { errors, highlights }, validated, repaired }
}
