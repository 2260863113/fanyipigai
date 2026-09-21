/**
 * 大改档的批改结果：**把整篇译文逐句重写，并逐句说明为什么这么改**，最后给一个总评分数与评语。
 *
 * ## 为什么大改是另一套东西，而不是"精修档改得更狠"
 *
 * 精修档的产物是**逐处批注**：哪里错了、改成什么、为什么——分数由程序按错误列表累加（见 scoring.ts）。
 * 用户对大改的要求完全不同（原话）："让 ai 将整个翻译重新写，修改单位为每句，
 * 让 AI 说明他修改的某一句对应的是哪一句……大改模式下不统计，不逐处批改，
 * 但是让 AI 给一个最终分数和解释。"
 *
 * 于是大改档的产物是**一份改写后的全文 + 逐句解释 + AI 给的总体分数**：
 *   - **不逐处批改**：没有 errors，界面上也就没有勾画、没有右下角的批注清单、没有弱项统计；
 *   - **只给对照**：译文栏固定显示"一句原译 / 一句改后"，视图开关禁用（改动太多，勾画会糊成一片）；
 *   - **分数由 AI 给**：这一档算不出"扣了几分"——它没有逐处错误可扣。
 *
 * ## ⚠️ 两个档位的分数不可比（这是本项目唯一一处有意偏离"分数由程序算"）
 *
 * 精修档的分数是**程序按错误列表算的**（可解释、可复算，见 scoring.ts 与 ADR）；
 * 大改档的分数是**模型按整篇印象给的总体评价**。同一个 0–100 在两档下含义不同，
 * 因此界面上必须**标明来源**（左下角写着"AI 总评"），练习记录里也要标出来，
 * 否则用户会把两个数当成一回事，误以为"换一档分数就掉下来了"。
 *
 * ## 位置仍由程序定位，AI 不数序号
 *
 * 每条句子要给出 `original`（**逐字复制**学生的原句），程序用 `locate` 到译文里找位置
 * （与逐处批注完全同一套机制）。找不到的那一句就丢掉并在 problems 里说清，
 * 而不是硬塞一个位置上去。
 */

import type { Anchor, Direction } from './types'
import { extractJson } from './parse'
import { locate } from './locate'
import type { CompareLine, CompareSpan } from './compare'
import { diffForCompare } from './compare'

/** 大改档里的一句：原句 → 改后句 + 为什么这么改。 */
export interface RefineSentence {
  /** 批改内的编号（r1、r2……），界面与「查看完整返回」都用它 */
  id: string
  /** AI 给的原句，**逐字复制**学生的译文 */
  oldText: string
  /** 原句在作答里的绝对区间（程序定位后填入） */
  anchor: Anchor
  /** 改后的那一句。与原句相同时表示这一句没改 */
  rewritten: string
  /** 为什么这么改；没改的句子写一句"这一句不必改" */
  explanation: string
  /**
   * 这一句**写得好**在哪（用户要求：大改也让 AI 点出表达很好的句子，界面上标绿）。
   * 只在"不用改、而且确实好"时才非空；它与 `changed` 应当互斥（改了就不算"好"）。
   */
  praise: string
  /** 程序算出来的：这一句到底改了没有（AI 说改了但两串一样时以程序为准） */
  changed: boolean
}

/** 大改档的一次完整批改。 */
export interface RefineResult {
  /** AI 给的最终分数，0–100 的整数 */
  score: number
  /** AI 给的总体解释：为什么是这个分数 */
  comment: string
  /** 逐句改写，按原句在译文里的先后排好 */
  sentences: RefineSentence[]
}

export interface RefineParseSuccess {
  ok: true
  refine: RefineResult
}

export interface RefineParseFailure {
  ok: false
  problems: string[]
}

/** 与 parse.ts 的失败文案同一个口径：全是这一句时说明"这段文字根本不在译文里"。 */
export const PROBLEM_REFINE_NO_ANCHOR = '所有句子都没能定位到译文中的文字'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * 解析大改档的返回。
 *
 * 三类问题都会**原样回传给模型重试**（见 ai.ts）：分数不合法、缺字段、句子定位不上。
 * 任何一条不合格就整份重试，与精修档的 `parseCorrection` 同一口径——
 * 大改是"整篇重写"，缺了几句的对照视图会悄悄少掉那几句，比明确失败更糟。
 * 重试时会把具体哪一句定位不上告诉它（见 buildRefineRetryPrompt）。
 */
export function parseRefine(raw: string, answer: string): RefineParseSuccess | RefineParseFailure {
  const extracted = extractJson(raw)
  if ('error' in extracted) return { ok: false, problems: [extracted.error] }

  let parsed: unknown
  try {
    parsed = JSON.parse(extracted.text)
  } catch (error) {
    return { ok: false, problems: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!isRecord(parsed)) return { ok: false, problems: ['返回的 JSON 顶层不是对象'] }

  const problems: string[] = []

  const scoreValue = parsed.score
  const score =
    typeof scoreValue === 'number' && Number.isFinite(scoreValue) ? Math.round(scoreValue) : Number.NaN
  if (!Number.isFinite(score)) problems.push('缺少 score，或它不是数字（大改档必须给一个 0–100 的最终分数）')
  else if (score < 0 || score > 100) problems.push(`score 是 ${score}，超出 0–100`)

  const comment = readText(parsed.comment)
  if (!comment) problems.push('缺少 comment（说明为什么给这个分数）')

  const sentences: RefineSentence[] = []
  if (!Array.isArray(parsed.sentences)) {
    problems.push('sentences 不是数组（每一句都要有一条，包括没改的句子）')
  } else {
    const seen = new Set<string>()
    for (const [index, item] of parsed.sentences.entries()) {
      if (!isRecord(item)) {
        problems.push(`sentences[${index}] 不是对象`)
        continue
      }
      const original = readText(item.original) ?? readText(item.oldText)
      if (!original) {
        problems.push(`sentences[${index}] 缺少 original（原句要逐字复制学生的译文）`)
        continue
      }
      const rewritten = typeof item.rewritten === 'string' ? item.rewritten : null
      if (rewritten === null) {
        problems.push(`sentences[${index}] 缺少 rewritten（原样保留的句子也要照抄一遍）`)
        continue
      }
      const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : ''
      if (explanation.length === 0) {
        problems.push(`sentences[${index}] 缺少 explanation（每一句都要说明为什么这么改）`)
        continue
      }
      const praise = typeof item.praise === 'string' ? item.praise.trim() : ''

      const located = locate(answer, { text: original })
      if (!located.ok) {
        problems.push(`sentences[${index}] 的原句定位不到：${located.reason}`)
        continue
      }
      const key = `${located.value.start}-${located.value.end}`
      if (seen.has(key)) continue
      seen.add(key)
      sentences.push({
        id: `r${index + 1}`,
        oldText: original,
        anchor: located.value,
        rewritten,
        explanation,
        praise,
        changed: normalize(original) !== normalize(rewritten),
      })
    }
  }

  if (sentences.length === 0 && Array.isArray(parsed.sentences) && parsed.sentences.length > 0) {
    problems.push(PROBLEM_REFINE_NO_ANCHOR)
  }
  if (problems.length > 0) return { ok: false, problems }

  sentences.sort((left, right) => left.anchor.start - right.anchor.start)
  return { ok: true, refine: { score, comment: comment ?? '', sentences } }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 把大改结果排成对照视图用的行：**一句原译、一句改后**。
 *
 * 与精修档的 `buildCompareLines` 是**两份数据、同一个渲染形状**：
 * 那边的一行是"一处错误所在的那一句"，这边的一行是"AI 重写过的那一句"。
 *
 * 改动的地方由 `minimizeChange` 按**词**求最小不同项，只染真正变了的那几个词
 * （否则整句染色，一屏全是颜色——用户正是嫌"改得太多、屏幕太花"才要求大改只看对照）。
 * 颜色一律用**橙色（表达问题）**：大改**不分类**，没有依据说哪一处算硬性错误。
 */
export function buildRefineLines(refine: RefineResult): CompareLine[] {
  return refine.sentences.map((sentence) => {
    /*
     * 写得好的句子标绿（用户要求：大改也让 AI 分析表达很好的句子）。
     * 它必然没改过，因此两行一字不差、整句标绿，说明那一行写的是 praise。
     */
    if (!sentence.changed && sentence.praise.length > 0) {
      return {
        original: sentence.oldText,
        originalSpans: [{ text: sentence.oldText, color: 'green' as const }],
        corrected: [{ text: sentence.rewritten, color: 'green' as const }],
        changed: true,
        note: sentence.praise,
      }
    }

    const note = sentence.explanation
    /*
     * 改动处用 `diffForCompare` 求：它按「字 / 词 / 标点」逐单位对齐，
     * 中文（没有空格）也能切出"真正不同的那几个字"——用户要的就是这个
     * （"原译文和修改后的译文不同处才标颜色"）。用批注口径的 minimizeChange 时，
     * 中文整句会被当成一个词、差异算不齐，只能退回整段染色。
     */
    const changes = sentence.changed ? diffForCompare(sentence.oldText, sentence.rewritten) : null
    if (!changes || changes.length === 0) {
      // 没改动，或两串差得太远（minimizeChange 放弃）：整句当作一处改动
      return {
        original: sentence.oldText,
        originalSpans: sentence.changed
          ? [{ text: sentence.oldText, color: 'orange' as const }]
          : [{ text: sentence.oldText }],
        corrected: sentence.changed
          ? [{ text: sentence.rewritten, color: 'orange' as const }]
          : [{ text: sentence.rewritten }],
        changed: sentence.changed,
        note,
      }
    }

    const originalSpans: CompareSpan[] = []
    const corrected: CompareSpan[] = []
    let cursor = 0
    for (const change of changes) {
      if (change.startOffset > cursor) {
        const kept = sentence.oldText.slice(cursor, change.startOffset)
        originalSpans.push({ text: kept })
        corrected.push({ text: kept })
      }
      if (change.endOffset > change.startOffset) {
        originalSpans.push({ text: sentence.oldText.slice(change.startOffset, change.endOffset), color: 'orange' })
      }
      if (change.to.length > 0) corrected.push({ text: change.to, color: 'orange' })
      cursor = Math.max(cursor, change.endOffset)
    }
    if (cursor < sentence.oldText.length) {
      originalSpans.push({ text: sentence.oldText.slice(cursor) })
      corrected.push({ text: sentence.oldText.slice(cursor) })
    }

    return {
      original: sentence.oldText,
      originalSpans,
      corrected,
      changed: sentence.changed,
      note,
    }
  })
}

/** 大改里改过的句子有几条（界面上报一句"改了 N 句"）。 */
export function changedSentenceCount(refine: RefineResult): number {
  return refine.sentences.filter((sentence) => sentence.changed).length
}

/** 方向只是给调用方一个显式的位置（大改不需要按字数判轻重，但解析要过校验链）。 */
export type RefineDirection = Direction
