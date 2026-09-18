/**
 * 按文字定位。
 *
 * 这是取代"让 AI 给字符序号"的关键一步。
 *
 * 原来的做法：AI 数出 start / end，程序核对那个区间里的文字是不是它声称的片段。
 * 问题在于"数"这个动作本身——实测中 AI 数错一个字符是最常见的失败来源。
 *
 * 现在的做法：AI 只说"要改的是哪段文字"，最多再给左右各几个字用于消歧，
 * 位置由程序自己找。于是模型完全不需要数任何字符，
 * 而"数错序号"这一类失败从根上消失了。
 *
 * 找不到或找到多处时**不猜、不将就**：明确报出候选位置，交给上层退回重试。
 * 宁可少标一处，也不要把批注画到错的地方。
 */

export interface LocateInput {
  /** 要定位的原文片段，必须逐字复制 */
  text: string
  /** 片段左边紧邻的若干字（可选，用于消歧） */
  contextBefore?: string
  /** 片段右边紧邻的若干字（可选，用于消歧） */
  contextAfter?: string
  /** 片段出现多次且没有上下文时，可以指定取第几次（从 1 开始） */
  occurrence?: number
}

export interface Located {
  start: number
  end: number
  snippet: string
  /** 定位过程中发现的同一片段的全部出现位置，便于出错时解释 */
  candidates: number[]
}

/** 所有出现位置。 */
function findAllOccurrences(haystack: string, needle: string): number[] {
  const result: number[] = []
  if (!needle) return result
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    result.push(index)
    index = haystack.indexOf(needle, index + 1)
  }
  return result
}

/** 出现位置按"上下文吻合程度"打分：左边上下文吻合 +2，右边上下文吻合 +1。 */
function scoreCandidate(
  candidate: number,
  textLength: number,
  haystack: string,
  contextBefore?: string,
  contextAfter?: string,
): number {
  let score = 0
  if (contextBefore) {
    const expected = contextBefore
    const actual = haystack.slice(Math.max(0, candidate - expected.length), candidate)
    if (actual === expected) score += 2
  }
  if (contextAfter) {
    const start = candidate + textLength
    const actual = haystack.slice(start, start + contextAfter.length)
    if (actual === contextAfter) score += 1
  }
  return score
}

export type LocateOutcome = { ok: true; value: Located } | { ok: false; reason: string }

/**
 * 在 haystack 里定位 text。
 * 失败时给出**可操作的原因**，因为这段文字会被原样回传给 AI 作为重试提示。
 */
export function locate(haystack: string, input: LocateInput): LocateOutcome {
  const text = input.text
  if (!text) {
    return { ok: false, reason: '没有给出要修改的原文片段（oldText 为空）' }
  }

  const occurrences = findAllOccurrences(haystack, text)
  if (occurrences.length === 0) {
    const excerpt = text.slice(0, 30)
    return {
      ok: false,
      reason:
        `译文里找不到片段「${excerpt}${text.length > 30 ? '…' : ''}」。` +
        `请逐字复制译文中的原文，标点符号也必须一模一样，不要改写、不要补空格。`,
    }
  }

  // 只有一处：直接用，不需要上下文
  if (occurrences.length === 1) {
    const start = occurrences[0] ?? 0
    return { ok: true, value: { start, end: start + text.length, snippet: text, candidates: occurrences } }
  }

  // 多处：先用上下文消歧
  const scored = occurrences.map((candidate) => ({
    candidate,
    score: scoreCandidate(candidate, text.length, haystack, input.contextBefore, input.contextAfter),
  }))
  const best = Math.max(...scored.map((item) => item.score))
  const winners = scored.filter((item) => item.score === best)

  if (best > 0 && winners.length === 1) {
    const start = winners[0]?.candidate ?? 0
    return { ok: true, value: { start, end: start + text.length, snippet: text, candidates: occurrences } }
  }

  // 上下文也没能分开：允许按出现次序指定
  if (typeof input.occurrence === 'number' && input.occurrence >= 1 && input.occurrence <= occurrences.length) {
    const start = occurrences[input.occurrence - 1] ?? 0
    return { ok: true, value: { start, end: start + text.length, snippet: text, candidates: occurrences } }
  }

  const where = occurrences.map((index) => `第 ${index} 个字符处`).join('、')
  return {
    ok: false,
    reason:
      `片段「${text}」在译文中出现了 ${occurrences.length} 次（${where}）。` +
      `请补上 contextBefore / contextAfter（该片段左右紧邻的几个字）来指明是其中哪一处，` +
      `或者改用更长的片段把位置说清楚。`,
  }
}
