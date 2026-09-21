/**
 * 对照视图的数据：把作答拆成一句一句，每句给出「修改后的完整那句」。
 *
 * 与批改视图的分工：
 *   批改视图 = 在原文上勾画（划线、方框、弧线），信息密度高，但要眼睛跟着标记走；
 *   对照视图 = 句子级的「改前 / 改后」对照，**不划线、不填补**，只把改动过的字染成对应颜色。
 * 两种视图共用同一份 validated（每处改动的最小不同项），因此永远不会各说各话。
 */

import type { MarkColor } from './types'
import type { ValidatedCorrection } from './validate'
import type { MinimalChange } from './minimal'
import { splitSentenceSpans } from './sentences'

/**
 * 对照视图里最多切出几个"最小不同项"。
 *
 * 批注口径只给 2 个（超过就整段替换，见 minimal.ts 的 MAX_CHANGES）——那是**画在译文上**的口径：
 * 一堆互相牵制的碎片比整段重写更难读。但对照视图是**两行并排**（原译 / 改后）：
 * 切得越细，用户越能一眼看出"到底哪几个字变了"。用户对这一点说得很直接——
 * "原译文和修改后的译文**不同处才标颜色**"——于是这里把上限调到 99：
 * 常见的"整句重写"因此不再把一整句都染上色，只染真正不同的那些词。
 */
export const COMPARE_MAX_CHANGES = 99

/** 对照视图里的一段文字；着色表示「这里被改过 / 值得肯定」。 */
export interface CompareSpan {
  text: string
  color?: MarkColor
  /** 点它就能在右下角看到这一处的说明 */
  errorId?: string
  highlightId?: string
}

export interface CompareLine {
  /** 原文那一句（按改动切开：被改过的那一段带颜色） */
  original: string
  /** 原文那一句的片段：被改动/被点赞的那一段带 color（界面给它加荧光底色） */
  originalSpans: CompareSpan[]
  /** 修改后的完整那一句（按改动拼出来） */
  corrected: CompareSpan[]
  /** 这一句有没有被改动（没有的话两行一样，界面可以淡化处理） */
  changed: boolean
  /**
   * 这一句的说明。**只有大改档会用到**（那边要逐句说清为什么这么改）；
   * 精修档的说明挂在每一处批注上，点那一处才显示，因此这里不填。
   */
  note?: string
}

/**
 * 把文本切成句子（返回的是原文里的区间，供着色时换算）。
 *
 * 判据在 domain/sentences.ts——**这里不再自己写一份**。原先这里有一份自己的实现，
 * 它不认"句末标点后面跟引号"（`xxxxx "xxxx."someone says` 会被当成一句），
 * 而收藏那一份认；两份判据分家之后，用户就在对照视图里看到了分句不对。
 * 现在两边同一个实现，差别只有收藏多开的那个"逗号也算句末"。
 *
 * 这里只做两件本层的事：把 `{from,to}` 换成 `{start,end}`（历史命名），
 * 以及丢掉纯空白的那几刀（对照视图里一行空行没有意义）。
 */
export function splitSentences(text: string): Array<{ start: number; end: number }> {
  return splitSentenceSpans(text)
    .map(({ from, to }) => ({ start: from, end: to }))
    .filter((item) => text.slice(item.start, item.end).trim().length > 0)
}

interface Edit {
  kind: 'edit'
  start: number
  end: number
  to: string
  color: MarkColor
  errorId: string
}

interface Mark {
  kind: 'mark'
  start: number
  end: number
  to: ''
  color: MarkColor
  errorId?: undefined
  highlightId: string
}

/**
 * 对照视图专用的差异：按「字 / 词 / 标点」逐单位对齐，返回最小不同项。
 *
 * ## 为什么不用 minimal.ts 的 minimizeChange（那是**批注**口径）
 *
 * 1. 它的上限是 2 项，超过就整段替换——而"整句重写"在对照视图里恰恰是常态；
 * 2. 它的"按词对齐"是为**英文**写的，而中文没有空格：
 *    一整句中文会被当成一个词，字符级差异算出来互相重叠、还原不回去，
 *    于是退回"整段替换"——**英译中的对照因此常常整句染色**，
 *    而这正是用户报的那个毛病（"原译文和修改后的译文不同处才标颜色"）。
 *
 * 因此这里自己切单位：CJK 一个字一个单位、拉丁按词、标点与空白各自成单位，
 * 再做一次 LCS 对齐。产物天然不重叠、拼起来一定还原得回去——
 * 不依赖"能不能重建"这条兜底判据，也就不会退回整段染色。
 *
 * ⚠️ 它只服务对照视图（与 `buildRefineLines`）。批注那条链路口径不变。
 */
export function diffForCompare(oldText: string, newText: string): MinimalChange[] | null {
  if (oldText === newText) return null
  const left = tokenize(oldText)
  const right = tokenize(newText)
  if (left.length === 0 || right.length === 0) {
    return [{ startOffset: 0, endOffset: oldText.length, from: oldText, to: newText }]
  }

  // LCS 表：cell(i, j) = left[i..] 与 right[j..] 的最长公共子序列长度
  const rows = left.length + 1
  const cols = right.length + 1
  const cell = new Uint32Array(rows * cols)
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      cell[i * cols + j] =
        left[i]!.text === right[j]!.text
          ? (cell[(i + 1) * cols + (j + 1)] ?? 0) + 1
          : Math.max(cell[(i + 1) * cols + j] ?? 0, cell[i * cols + (j + 1)] ?? 0)
    }
  }

  /** 配对好的（左边下标 → 右边下标），顺序递增 */
  const pairs: Array<{ i: number; j: number }> = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i]!.text === right[j]!.text) {
      pairs.push({ i, j })
      i += 1
      j += 1
      continue
    }
    const down = cell[(i + 1) * cols + j] ?? 0
    const rightward = cell[i * cols + (j + 1)] ?? 0
    if (down >= rightward) i += 1
    else j += 1
  }

  const changes: MinimalChange[] = []
  let li = 0
  let rj = 0
  for (const pair of [...pairs, { i: left.length, j: right.length }]) {
    // 两段配对之间没对上的那一截，就是一处改动
    if (pair.i > li || pair.j > rj) {
      const startOffset = left[li]?.start ?? oldText.length
      const endOffset = pair.i > li ? (left[pair.i - 1]?.end ?? oldText.length) : startOffset
      changes.push({
        startOffset,
        endOffset,
        from: oldText.slice(startOffset, endOffset),
        to: right.slice(rj, pair.j).map((token) => token.text).join(''),
      })
    }
    li = pair.i + 1
    rj = pair.j + 1
  }

  // 收尾没对上的那一截（上面的哨兵已经把尾巴算进去了，这里只需要处理空改动）
  return changes.filter((change) => change.from.length > 0 || change.to.length > 0)
}

interface Token {
  text: string
  start: number
  end: number
}

/** 切单位：CJK 一个字一个单位、拉丁词一个单位、标点与空白各自一个单位。 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  const isCjk = (char: string): boolean => /[\u3400-\u9fff\uf900-\ufaff]/.test(char)
  const isWordChar = (char: string): boolean => !isCjk(char) && /[\p{L}\p{N}]/u.test(char)

  while (index < text.length) {
    const char = text[index]!
    const start = index
    if (isCjk(char)) {
      index += 1
    } else if (isWordChar(char)) {
      while (index < text.length && isWordChar(text[index]!)) index += 1
    } else if (/\s/.test(char)) {
      while (index < text.length && /\s/.test(text[index]!)) index += 1
    } else {
      index += 1
    }
    tokens.push({ text: text.slice(start, index), start, end: index })
  }
  return tokens
}

/**
 * 逐句生成对照。
 *
 * 只应用**完整落在本句内**的改动；跨句的改动（极少见）就在本句里把重叠部分染个色、
 * 不硬改文字——别为了对齐把句子改得读不通。语序调换同理：只染色、不重排
 * （要看调序结果，请切回批改视图看配对弧线）。
 */
export function buildCompareLines(validated: ValidatedCorrection, answer: string): CompareLine[] {
  const edits: Edit[] = validated.errors.flatMap((entry) =>
    entry.changes.map((change) => ({
      kind: 'edit' as const,
      start: change.start,
      end: change.end,
      to: change.to,
      // 颜色取解析时定死的那个（漏译/多译按字数定轻重，见 severity.ts），不按分类现推
      color: entry.hard ? 'red' : 'orange',
      errorId: entry.error.id,
    })),
  )
  const marks: Mark[] = validated.highlights.map((entry) => ({
    kind: 'mark' as const,
    start: entry.span.start,
    end: entry.span.end,
    to: '' as const,
    color: 'green' as const,
    highlightId: entry.highlight.id,
  }))

  return splitSentences(answer).map((sentence) => {
    const original = answer.slice(sentence.start, sentence.end)
    const mine = edits.filter((item) => item.start < sentence.end && item.end > sentence.start)
    const myMarks = marks.filter((item) => item.start < sentence.end && item.end > sentence.start)

    /*
     * 第一步：拼出这一句的**改后文字**。口径与以前一致——只应用**完整落在本句内**的改动；
     * 跨句的改动（极少见）只在原译那一行染个色、不硬改文字，别为了对齐把句子改得读不通。
     */
    let correctedText = ''
    {
      let cursor = sentence.start
      for (const item of [...mine].sort((a, b) => a.start - b.start || a.end - b.end)) {
        const start = Math.max(item.start, sentence.start)
        const end = Math.min(item.end, sentence.end)
        if (start > cursor) correctedText += answer.slice(cursor, start)
        const inside = item.start >= sentence.start && item.end <= sentence.end
        if (inside) {
          // to 为空 = 删除：不写任何东西（"不进行填补"正是这个意思）
          correctedText += item.to
        } else if (start < end) {
          correctedText += answer.slice(start, end)
        }
        cursor = Math.max(cursor, end)
      }
      if (cursor < sentence.end) correctedText += answer.slice(cursor, sentence.end)
    }

    /*
     * 第二步：**只染真正不同的字**（用户明确要求）。
     * 行与行之间对齐一次，颜色从"盖住这一段的那处批注"取；亮点（绿）另外叠上去。
     */
    const pieces = diffForCompare(original, correctedText) ?? []
    const colorOf = (from: number, to: number): { color: MarkColor; errorId: string } | undefined => {
      const hit = mine.find((item) => item.start < to && item.end > from)
      return hit ? { color: hit.color, errorId: hit.errorId } : undefined
    }
    /** 亮点只按区间叠色（它不改文字） */
    const markOf = (from: number, to: number): string | undefined =>
      myMarks.find((item) => item.start < to && item.end > from)?.highlightId

    const originalParts: CompareSpan[] = []
    const correctedParts: CompareSpan[] = []
    let cursor = 0

    /** 原样不动的那些字：两边都写一遍（亮点在这一段上时只给绿色） */
    const pushPlain = (from: number, to: number): void => {
      if (to <= from) return
      const text = original.slice(from, to)
      const highlightId = markOf(sentence.start + from, sentence.start + to)
      originalParts.push({ text, ...(highlightId ? { color: 'green' as const, highlightId } : null) })
      correctedParts.push({ text, ...(highlightId ? { color: 'green' as const, highlightId } : null) })
    }

    for (const piece of pieces) {
      pushPlain(cursor, piece.startOffset)
      const from = sentence.start + piece.startOffset
      const to = sentence.start + piece.endOffset
      const edit = colorOf(from, to)
      const text = original.slice(piece.startOffset, piece.endOffset)
      // 原译那一行：被改掉的字（荧光底色由界面按 color 画）
      if (text.length > 0) {
        originalParts.push({ text, ...(edit ? { color: edit.color, errorId: edit.errorId } : { color: 'orange' as const }) })
      }
      // 改后那一行：只写替换后的文字，空串 = 删除（什么都不写）
      if (piece.to.length > 0) {
        correctedParts.push({ text: piece.to, ...(edit ? { color: edit.color, errorId: edit.errorId } : { color: 'orange' as const }) })
      }
      cursor = Math.max(cursor, piece.endOffset)
    }
    pushPlain(cursor, original.length)

    const corrected = mergeSpans(correctedParts)
    return {
      original,
      originalSpans: mergeSpans(originalParts),
      corrected,
      changed: corrected.some((part) => part.color !== undefined) || correctedText !== original,
    }
  })
}

/** 相邻同色的片段合成一段，免得渲染出一堆碎 span。 */
function mergeSpans(spans: CompareSpan[]): CompareSpan[] {
  const merged: CompareSpan[] = []
  for (const span of spans) {
    if (span.text.length === 0) continue
    const last = merged[merged.length - 1]
    if (last && last.color === span.color && last.errorId === span.errorId && last.highlightId === span.highlightId) {
      last.text += span.text
      continue
    }
    merged.push({ ...span })
  }
  return merged
}
