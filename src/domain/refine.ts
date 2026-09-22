/**
 * 大改档的批改结果：**把整篇译文逐句重写，并逐句说明为什么这么改**。
 *
 * ## 为什么大改是另一套东西，而不是"精修档改得更狠"
 *
 * 精修档的产物是**逐处批注**：哪里错了、改成什么、为什么——分数由程序按错误列表累加（见 scoring.ts）。
 * 用户对大改的要求完全不同（原话）："让 ai 将整个翻译重新写，修改单位为每句，
 * 让 AI 说明他修改的某一句对应的是哪一句……大改模式下不统计，不逐处批改。"
 *
 * 于是大改档的产物是**一份改写后的全文 + 逐句解释 + 每句对应的原句**：
 *   - **不逐处批改**：没有 errors，界面上也就没有勾画、没有右下角的批注清单、没有弱项统计；
 *   - **只给对照**：译文栏固定显示"一句原文 / 一句我的译文 / 一句修改译文 / 一段说明"，
 *     视图开关禁用（改动太多，勾画会糊成一片）；
 *   - **不打分**（用户后来明确取消）：没有分数、也没有总体评语，界面左下角只写一句"大改档不打分"。
 *
 * ## 分数只有精修档有（用户拍板）
 *
 * 精修档的分数是**程序按错误列表算的**（可解释、可复算，见 scoring.ts）。
 * 大改档原先由 AI 给一个"整篇印象分"，两个 0–100 含义不同、还不能直接比；
 * 用户的选择是**干脆取消它**："大改页面取消分数打分，分数打分只有精修部分有。"
 * 再追问"总评文字要不要留"时，他选的是"连文字总评也去掉"。
 * 于是 `RefineResult` 里既没有 score 也没有 comment——**语义干净了**：
 * 全站只有一个分数口径，也就是精修档那个能自己核出来的分数。
 *
 * ## 位置仍由程序定位，AI 不数序号
 *
 * 每条句子要给出 `original`（**逐字复制**学生的原句），程序用 `locate` 到译文里找位置
 * （与逐处批注完全同一套机制）。找不到的那一句就丢掉并在 problems 里说清，
 * 而不是硬塞一个位置上去。
 *
 * `sourceText`（这一句对应的**原文**）是第 4 条新加的：它属于**原文**那一侧，
 * 程序同样拿它去原文里找位置——找到就用**原文里那一段的原样文字**（保证逐字一致），
 * 找不到也不丢句子，只是标记成"对不上"（见 `sourceMatched`）。
 */

import type { Anchor, Direction } from './types'
import { extractJson } from './parse'
import { locate } from './locate'
import type { CompareLine, CompareSpan } from './compare'
import { diffForCompare } from './compare'

/** 大改档里的一句：原文那一句 → 学生原句 → 改后句 + 为什么这么改。 */
export interface RefineSentence {
  /** 批改内的编号（r1、r2……），界面与「查看完整返回」都用它 */
  id: string
  /**
   * 这一句对应的**原文**（第 4 条要求：对照视图要排成"一句原文、一句我的译文、一句修改译文"）。
   *
   * 程序会拿它去**原文**里找位置；找得到就换成原文里那段原样的文字（保证与原文逐字一致），
   * 找不到就原样留着 AI 给的那句、并把 `sourceMatched` 记成 false（界面会标一下）。
   */
  sourceText: string
  /** 在**原文**里的位置；定位不到时是 null（原文那一侧与译文那一侧是两套坐标） */
  sourceAnchor: Anchor | null
  /** AI 给的那句原文是否真的能在这一页原文里找到 */
  sourceMatched: boolean
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

/** 大改档的一次完整批改。**没有分数、也没有总评**（见文件头）。 */
export interface RefineResult {
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
 * 三类问题都会**原样回传给模型重试**（见 ai.ts）：缺字段、句子定位不上、原句对不上（不重试，
 * 只记一个标记）。任何一条实质问题不合格就整份重试，与精修档的 `parseCorrection` 同一口径——
 * 大改是"整篇重写"，缺了几句的对照视图会悄悄少掉那几句，比明确失败更糟。
 *
 * `source`（这一页的原文）用来给 `sourceText` 定位：**给它是为了把 AI 那句原文换成原文里的原样文字**，
 * 找不到不算失败——用户第 4 条要的是"能看见一句原文"，而对不上时如实标一下比整份重试更划算。
 */
export function parseRefine(raw: string, answer: string, source = ''): RefineParseSuccess | RefineParseFailure {
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

      /*
       * 这一句对应的**原文**（第 4 条）：拿 AI 给的那句去**原文**里找位置。
       * 找得到就用原文里那段原样的文字——这样界面上排出来的"原文"一行必然与左侧原文栏逐字一致
       * （模型偶尔会漏字或改标点，直接用它的句子会让两处对不上）。
       */
      const sourceGiven = readText(item.sourceText) ?? readText(item.source) ?? ''
      const sourceLocated = sourceGiven && source ? locate(source, { text: sourceGiven }) : null
      const matched = Boolean(sourceLocated?.ok)

      sentences.push({
        id: `r${index + 1}`,
        sourceText: matched && sourceLocated?.ok ? sourceLocated.value.snippet : sourceGiven,
        sourceAnchor: matched && sourceLocated?.ok ? sourceLocated.value : null,
        sourceMatched: matched,
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
  return { ok: true, refine: { sentences } }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 把大改结果排成对照视图用的行：**一句原文、一句我的译文、一句修改译文**（下面再跟一段说明）。
 *
 * 与精修档的 `buildCompareLines` 是**两份数据、同一个渲染形状**：
 * 那边的一行是"一处错误所在的那一句"，这边的一行是"AI 重写过的那一句"。
 * 第 4 条之后这边多了 `source`（那一句对应的原文），渲染器据此多排一行。
 *
 * 改动的地方由 `diffForCompare` 按**词**求最小不同项，只染真正变了的那几个词
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
        ...sourceOf(sentence),
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
        ...sourceOf(sentence),
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
      ...sourceOf(sentence),
      original: sentence.oldText,
      originalSpans,
      corrected,
      changed: sentence.changed,
      note,
    }
  })
}

/**
 * 一行里"原文"那一格要带的东西。
 *
 * 没给 sourceText 的（旧记录、或者模型没给、或者调用方手搭的对象）**不塞空字符串**：
 * 渲染器按"有没有这个字段"决定要不要多排一行，塞空串会排出一行空白的"原文"。
 */
function sourceOf(sentence: RefineSentence): Pick<CompareLine, 'source' | 'sourceMatched'> {
  const text = sentence.sourceText ?? ''
  if (text.length === 0) return {}
  return { source: text, sourceMatched: sentence.sourceMatched !== false }
}

/** 大改里改过的句子有几条（界面上报一句"改了 N 句"）。 */
export function changedSentenceCount(refine: RefineResult): number {
  return refine.sentences.filter((sentence) => sentence.changed).length
}

/** 方向只是给调用方一个显式的位置（大改不需要按字数判轻重，但解析要过校验链）。 */
export type RefineDirection = Direction
