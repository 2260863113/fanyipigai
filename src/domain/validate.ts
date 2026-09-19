/**
 * 批注校验：在渲染之前确认每个错误对象指向的位置确实存在。
 *
 * 为什么需要这一层：定位用的是「字符序号区间 + 原文片段」双重描述，
 * 而 AI 数错位置是常见失败。片段让程序能自证位置是否有误——
 * 对不上就拒绝渲染这一处，而不是画到错误的地方上。
 */

import type { Anchor, ErrorObject, ErrorCategory, Highlight, MarkColor } from './types'
import { HARD_CATEGORIES } from './types'

/** 校验通过后得到的绝对区间。 */
export interface ValidatedSpan {
  start: number
  end: number
}

/** 校验失败的原因。 */
export interface Rejection {
  /** 相关的错误对象 / 亮点编号 */
  id: string
  /** 面向用户的中文说明，含可恢复的提示 */
  message: string
}

export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; rejection: Rejection }

/**
 * 颜色由错误分类推导，不由 AI 自由选择。
 * 这样同一类错误在任何一次批改里颜色都一致，用户才能形成稳定的阅读习惯。
 *
 * 红＝硬性错误，橙＝表达问题。哪一类算硬性错误由 types.ts 的 HARD_CATEGORIES 定义，
 * 这里不再重复写一份，避免两处不一致。
 */
export function colorForCategory(category: ErrorCategory): MarkColor {
  return HARD_CATEGORIES.includes(category) ? 'red' : 'orange'
}

/**
 * 归一化：折叠连续空白。
 * AI 有时会在片段里带出多余空格，属于无意义的差异，不该导致整处批注被丢弃。
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function checkSpan(id: string, anchor: Anchor, answer: string, what: string): ValidationOutcome<ValidatedSpan> {
  const fail = (message: string): ValidationOutcome<ValidatedSpan> => ({ ok: false, rejection: { id, message } })

  const { start, end, snippet } = anchor
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return fail(`${what}的字符序号不是整数，无法渲染`)
  }
  if (start < 0 || end > answer.length) {
    return fail(`${what}指向的位置超出了你的译文长度（你的译文共 ${answer.length} 个字符）`)
  }
  if (start > end) {
    return fail(`${what}的起止序号颠倒`)
  }
  if (!snippet) {
    return fail(`${what}没有携带原文片段，无法校验位置`)
  }
  const actual = answer.slice(start, end)
  if (normalize(actual) !== normalize(snippet)) {
    // 报错信息要能直接定位问题，因此给出实际片段、周围文字，以及片段的真实位置
    const foundAt = answer.indexOf(snippet)
    const hint =
      foundAt >= 0 && foundAt !== start
        ? `片段「${snippet}」实际出现在第 ${foundAt}–${foundAt + snippet.length} 个字符处，序号偏移 ${foundAt - start}`
        : nearMissHint(answer, start, end, snippet)
    const before = answer.slice(Math.max(0, start - 6), start)
    const after = answer.slice(end, Math.min(answer.length, end + 6))
    return fail(
      `${what}指向的位置与你译文中的文字对不上：第 ${start}–${end} 个字符实际是「${actual}」，` +
        `批注却说是「${snippet}」（上文「${before}」，下文「${after}」）。${hint}`,
    )
  }
  return { ok: true, value: { start, end } }
}

/**
 * 判断是否属于"差一个字符"的近失。
 * 这类错误最常见（AI 数序号时少算或多算一个），给出精确差值能让重试真正有用，
 * 而不是让它看到一句笼统的"对不上"再猜一次。
 */
function nearMissHint(answer: string, start: number, end: number, snippet: string): string {
  const normalizedSnippet = normalize(snippet)
  const candidates = [start - 1, start + 1, end - 1, end + 1]
  for (const candidate of candidates) {
    const width = snippet.length
    if (candidate < 0 || candidate + width > answer.length) continue
    if (normalize(answer.slice(candidate, candidate + width)) === normalizedSnippet) {
      return `片段本身是对的，但序号偏移了：应当写作 start=${candidate}、end=${candidate + width}（当前是 start=${start}、end=${end}）`
    }
  }
  return '这段文字在你的译文中并不存在，或序号与片段分属两处'
}

/** 校验通过的错误对象，附带各位置解算后的绝对区间。 */
export interface ValidatedError {
  error: ErrorObject
  /**
   * 这处批注真正要画的若干区间（按**词**求出的最小不同项，至少一项）。
   *
   * 为什么是数组：一处错误可能横跨好几个互不相邻的词——
   * farmers and herders 写成 farmer and herder，该划的是 farmer 和 herder 两个词
   * （and 没错），但它们逻辑上是同一处错误，因此共用同一个 id。
   */
  changes: Array<{ start: number; end: number; to: string }>
  /** 覆盖以上全部区间的外框，用于排序与重叠消解 */
  span: ValidatedSpan
  /** 插入类错误的落点（零长度区间） */
  insertPoint?: number
  /** 语序调换解算出的各片段区间 */
  reorderSpans?: ValidatedSpan[]
  /** 语序调换后，这些片段拼起来应该是什么样（用于展示调序结果） */
  reordered?: string
}

/** 取若干区间的外框。 */
function envelopeOf(changes: ReadonlyArray<{ start: number; end: number }>): ValidatedSpan {
  const first = changes[0]
  if (!first) return { start: 0, end: 0 }
  let start = first.start
  let end = first.end
  for (const change of changes) {
    start = Math.min(start, change.start)
    end = Math.max(end, change.end)
  }
  return { start, end }
}

export function validateError(error: ErrorObject, answer: string): ValidationOutcome<ValidatedError> {
  const fail = (message: string): ValidationOutcome<ValidatedError> => ({
    ok: false,
    rejection: { id: error.id, message },
  })

  /**
   * 校验时要用**原始区间**核对，而不是 anchor。
   * anchor 现在装的是最小修改之后的窄区间（如只覆盖 explore），
   * 拿它去核对模型圈的原文（have explore ways）必然对不上（实际踩过这个坑）。
   */
  const anchorToCheck = error.originalSpan ?? error.anchor

  /**
   * 渲染用的是缩窄后的区间（按单词求出的最小不同项）；没算出来就退回原始区间。
   * 一份 `to` 全部落空时给一项覆盖整段的替换，至少保证内容画得出来。
   */
  const renderChanges = (fallback: ValidatedSpan, to: string): ValidatedError['changes'] =>
    error.changed && error.changed.length > 0 ? error.changed : [{ start: fallback.start, end: fallback.end, to }]

  switch (error.type) {
    case 'replace':
    case 'rewrite': {
      if (!anchorToCheck) return fail('缺少原文位置，无法标注')
      if (error.targetText === undefined) {
        return fail(`${error.type === 'replace' ? '替换' : '整句重写'}没有给出正确写法`)
      }
      const span = checkSpan(error.id, anchorToCheck, answer, '该处批注')
      if (!span.ok) return span
      const changes = renderChanges(span.value, error.targetText)
      return { ok: true, value: { error, changes, span: envelopeOf(changes) } }
    }

    case 'delete': {
      // 删除类错误划掉即可，本来就没有替代写法
      if (!anchorToCheck) return fail('缺少原文位置，无法标注')
      const span = checkSpan(error.id, anchorToCheck, answer, '该处批注')
      if (!span.ok) return span
      const changes = renderChanges(span.value, '')
      return { ok: true, value: { error, changes, span: envelopeOf(changes) } }
    }

    case 'insert': {
      if (!error.insertAfter) return fail('缺少插入位置的锚点，无法标注')
      if (!error.targetText) return fail('插入类批注没有给出要补入的内容')
      const anchor = checkSpan(error.id, error.insertAfter, answer, '该处插入')
      if (!anchor.ok) return anchor
      const point = anchor.value.end
      return {
        ok: true,
        value: { error, changes: [{ start: point, end: point, to: error.targetText }], span: { start: point, end: point }, insertPoint: point },
      }
    }

    case 'reorder': {
      const segments = error.segments
      if (!segments || segments.length < 2) return fail('语序调换至少需要两个片段，无法画出配对弧线')

      const spans: ValidatedSpan[] = []
      for (const segment of segments) {
        const span = checkSpan(error.id, segment.anchor, answer, '该处语序调换')
        if (!span.ok) return span
        spans.push(span.value)
      }

      // sourceIndex 必须是一个 0..n-1 的排列，否则说明 AI 给的两端配对是自相矛盾的
      const source = segments.map((s) => s.sourceIndex).sort((a, b) => a - b)
      const expected = segments.map((_, i) => i)
      if (source.length !== expected.length || source.some((v, i) => v !== expected[i])) {
        return fail('语序调换的片段编号不成排列，配不出正确的弧线')
      }

      const first = spans[0]
      if (!first) return fail('语序调换没有解析出任何片段')
      let start = first.start
      let end = first.end
      for (const span of spans) {
        start = Math.min(start, span.start)
        end = Math.max(end, span.end)
      }

      // 把片段按调整后的次序拼起来，得到"调序后应该是什么样"的预览
      const ordered = [...segments].sort((a, b) => a.targetIndex - b.targetIndex)
      const reordered = ordered
        .map((segment) => {
          const span = checkSpan(error.id, segment.anchor, answer, '该处语序调换')
          return span.ok ? answer.slice(span.value.start, span.value.end) : ''
        })
        .join('')

      return { ok: true, value: { error, changes: [], span: { start, end }, reorderSpans: spans, reordered } }
    }

    default:
      return fail('未知的改法类型')
  }
}

/** 校验通过的亮点。 */
export interface ValidatedHighlight {
  highlight: Highlight
  span: ValidatedSpan
}

export function validateHighlight(highlight: Highlight, answer: string): ValidationOutcome<ValidatedHighlight> {
  const span = checkSpan(highlight.id, highlight.anchor, answer, '该处亮点')
  if (!span.ok) return span
  return { ok: true, value: { highlight, span: span.value } }
}

/** 一次批改中，全部通过校验的部分与全部被拒绝的部分。 */
export interface ValidatedCorrection {
  errors: ValidatedError[]
  highlights: ValidatedHighlight[]
  rejections: Rejection[]
}

export function validateCorrection(
  errors: readonly ErrorObject[],
  highlights: readonly Highlight[],
  answer: string,
): ValidatedCorrection {
  const validatedErrors: ValidatedError[] = []
  const validatedHighlights: ValidatedHighlight[] = []
  const rejections: Rejection[] = []

  for (const error of errors) {
    const outcome = validateError(error, answer)
    if (outcome.ok) validatedErrors.push(outcome.value)
    else rejections.push(outcome.rejection)
  }

  for (const highlight of highlights) {
    const outcome = validateHighlight(highlight, answer)
    if (outcome.ok) validatedHighlights.push(outcome.value)
    else rejections.push(outcome.rejection)
  }

  validatedErrors.sort((a, b) => a.span.start - b.span.start)
  validatedHighlights.sort((a, b) => a.span.start - b.span.start)

  return { errors: validatedErrors, highlights: validatedHighlights, rejections }
}
