/**
 * 最小修改：算出一处批注真正改动的**最小不同项**（单位是词，不是字母）。
 *
 * 为什么需要它：模型给的 oldText 是它自己圈的，常圈得过宽。
 * 例如它把 "have explore ways" → "have explored ways"，其实只有 explore 一个词变化，
 * 但按它圈的范围会把 have / ways 一起划掉，看着像大改，实际是小修。
 *
 * 做法：对新旧文字做字符级差异，拿到若干"替换块"，合并挨得很近的块，
 * 再把**贴在词内部/词尾**的那些块对齐到词边界（见下方注释）。
 *
 * 一处批注可能同时含**多个**最小不同项：farmers and herders 写成 farmer and herder，
 * 该划的是 farmer 和 herder 两个词（and 没错），但它们逻辑上是同一处错误。
 * 因此返回值是数组，交给渲染层各画各的、共用同一个 id。
 *
 * 本函数**不判断改法类型**：类型由 AI 的分类决定，颜色与计分都跟着分类走。
 */

export interface MinimalChange {
  /** 相对模型给出的原片段，真正发生变化的起止位置 */
  startOffset: number
  endOffset: number
  /** 变化前后的文字 */
  from: string
  to: string
}

/** 合并两个块之间允许的最大间隔：间隔小于等于这个值就把它们连起来一起标。 */
const MAX_GAP = 2

/**
 * 一处批注里最多容纳几个最小不同项。
 *
 * 一到两项是常态（一个词写错、两个词各自写错）；再多就说明新旧文字之间牵连太多，
 * 逐项标出来是一堆互相牵制的碎片，不如整段替换来得清楚。
 * 实测例子：In wake of reform → Since the beginning of reform and opening up
 * 会被切出三项（In wake → Since the、插入 beginning、插入 and opening up），
 * 那就该按整句重写标。
 */
const MAX_CHANGES = 2

interface Block {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

/**
 * 字符级 LCS 差异，返回一组替换块。
 * 采用经典的回溯表实现；这里是批注用的短片段（几十到几百字符），代价可以接受。
 */
function diffBlocks(a: string, b: string): Block[] {
  const n = a.length
  const m = b.length

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0)
    }
  }

  const blocks: Block[] = []
  let i = 0
  let j = 0
  let current: Block | null = null

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      if (current) {
        blocks.push(current)
        current = null
      }
      i += 1
      j += 1
      continue
    }
    // 不一致：并入当前块，并按 LCS 的方向前进
    if (!current) current = { oldStart: i, oldEnd: i, newStart: j, newEnd: j }
    if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      i += 1
      current.oldEnd = i
    } else {
      j += 1
      current.newEnd = j
    }
  }

  // 收尾：一侧还有剩余时全部并入
  if (current) {
    current.oldEnd = n
    current.newEnd = m
    blocks.push(current)
  } else if (i < n || j < m) {
    blocks.push({ oldStart: i, oldEnd: n, newStart: j, newEnd: m })
  }

  return blocks.filter((block) => block.oldStart !== block.oldEnd || block.newStart !== block.newEnd)
}


/**
 * 算出一处修改的最小不同项（可能有多项）。返回 null 表示新旧文字完全相同（无需标注）。
 */
export function minimizeChange(oldText: string, newText: string): MinimalChange[] | null {
  if (oldText === newText) return null
  if (oldText.length === 0) return [{ startOffset: 0, endOffset: 0, from: '', to: newText }]
  if (newText.length === 0) return [{ startOffset: 0, endOffset: oldText.length, from: oldText, to: '' }]

  const blocks = diffBlocks(oldText, newText)
  if (blocks.length === 0) return null

  /*
   * 把挨得很近的块合起来，避免出现一堆零碎的单字标记。
   *
   * 判据是"两块之间隔着的是不是词与词之间的东西"：
   *   plant → afforested   字符级差异会把 a、t 这类字母对上号，切出好几块；
   *                        但它们都在**同一个词内部**（两侧都没有空白/标点）→ 必须合起来，
   *                        否则重建不回去，最后只能整句划掉（实测就踩了这个坑）
   *   farmer and herder    两块之间隔着 " and "（有空格）→ 绝不能合，那是两个词
   */
  const hasWord = (gap: string): boolean => /[\p{L}\p{N}]/u.test(gap)
  const hasSeparator = (gap: string): boolean => /[\s\p{P}\p{S}]/u.test(gap)
  const merged: Block[] = []
  for (const block of blocks) {
    const last = merged[merged.length - 1]
    const gapOld = last ? oldText.slice(last.oldEnd, block.oldStart) : ''
    const gapNew = last ? newText.slice(last.newEnd, block.newStart) : ''
    // 两种"该合"的情形：
    //   只隔了空格/标点（i is → I am、In wake of reform → Since…）——合起来当一处看
    //   隔的是词内字符，两侧都没空白标点（plant → afforested 被切出来的 a、t）——本来就是同一个词
    // 反之（farmer| and |herder）隔着一整个词，绝不能合：那是两个词各自改。
    const onlySeparators = !hasWord(gapOld) && !hasWord(gapNew)
    const insideWord = !hasSeparator(gapOld) && !hasSeparator(gapNew)
    if (
      last &&
      block.oldStart - last.oldEnd <= MAX_GAP &&
      block.newStart - last.newEnd <= MAX_GAP &&
      (onlySeparators || insideWord)
    ) {
      last.oldEnd = block.oldEnd
      last.newEnd = block.newEnd
      continue
    }
    merged.push({ ...block })
  }

  /**
   * 把一块对齐到**词**，而不是字母。判据是这处改动"贴不贴在词上"。
   *
   *   替换（两边都有内容）：**一定**按词对齐。
   *       At meanwhile → Meanwhile  字符级差异会给出 "At m" → "M"（只差一个大小写字母），
   *                                 按词对齐之后是 "At meanwhile" → "Meanwhile"。
   *   纯插入：只在"补进某个词的内部或词尾"时对齐（词形变化）
   *       explore → explored、recent year → recent years   划掉整个词
   *       past → the past                                   词与词之间，一个字都不划
   *   纯删除：只在"从某个词里挖掉一截"时对齐
   *       years → year       划掉整个词
   *       the past → past    词与词之间，只划掉多出来的 the
   *
   * 这一支最容易写错。早期版本不看形状，一律"朝两侧逐步比对、相等就让出一步"，
   * 于是 past → the past 被扩成"划掉 past、上方写 the past"——
   * 明明只是漏了一个词，看着却像整个词被换掉。
   */
  const wordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char)

  const alignToWord = (block: Block): Block => {
    let { oldStart, oldEnd, newStart, newEnd } = block

    const pureInsert = oldStart === oldEnd
    const pureDelete = newStart === newEnd
    const isReplace = !pureInsert && !pureDelete
    const touchesWord = isReplace
      ? true
      : oldStart > 0 &&
        wordChar(oldText[oldStart - 1]) &&
        (pureInsert ? wordChar(newText[newStart]) : wordChar(oldText[oldStart]))

    if (touchesWord) {
      const stepBack = (): boolean => {
        if (oldStart === 0 || newStart === 0) return false
        const oldChar = oldText[oldStart - 1]
        if (oldChar !== newText[newStart - 1] || !wordChar(oldChar)) return false
        oldStart -= 1
        newStart -= 1
        return true
      }
      const stepForward = (): boolean => {
        if (oldEnd >= oldText.length || newEnd >= newText.length) return false
        const oldChar = oldText[oldEnd]
        if (oldChar !== newText[newEnd] || !wordChar(oldChar)) return false
        oldEnd += 1
        newEnd += 1
        return true
      }

      while (stepBack()) {
        /* 一直走到词首，或两侧不再相等 */
      }
      while (stepForward()) {
        /* 一直走到词尾，或两侧不再相等 */
      }
    }

    return { oldStart, oldEnd, newStart, newEnd }
  }

  const aligned = merged
    .map(alignToWord)
    .filter((block) => oldText.slice(block.oldStart, block.oldEnd) !== newText.slice(block.newStart, block.newEnd))

  /** 各块必须互不重叠、且顺序一致，否则"多个最小不同项"根本讲不通。 */
  const disjoint = aligned.every((block, index) => {
    const next = aligned[index + 1]
    if (!next) return true
    return block.oldEnd <= next.oldStart && block.newEnd <= next.newStart
  })

  /*
   * 最后一道判据，也是最重要的一道：**把这些最小不同项按顺序应用回去，能不能还原成新文字**。
   *
   * 能还原，说明每一块都对齐得干净（explore → explored、farmer/herder 各改各的）。
   * 还原不了，或者各块互相压着，说明新旧文字之间存在多处互相牵连的变化（整句重写就是这样），
   * 那就整段替换——宁可标得大一点，也不要标错、更不要标出一份重建不出来的结果。
   *
   * 实测踩过：In wake of reform → Since the beginning… 会切出三个互相压着的块，
   * 靠"逆序应用"居然还能凑巧还原成新文字，但画在页面上就是三条互相压着的删除线。
   * 所以"能不能还原"必须与"各块互不重叠"一起判。
   */
  const rebuilt = disjoint
    ? applyChangesToText(
        oldText,
        aligned.map((block) => ({
          start: block.oldStart,
          end: block.oldEnd,
          replacement: newText.slice(block.newStart, block.newEnd),
        })),
      )
    : null
  if (rebuilt !== newText) {
    return [{ startOffset: 0, endOffset: oldText.length, from: oldText, to: newText }]
  }

  // 改动项太多 → 整段替换（见 MAX_CHANGES 的说明）
  if (aligned.length > MAX_CHANGES) {
    return [{ startOffset: 0, endOffset: oldText.length, from: oldText, to: newText }]
  }

  return aligned.map((block) => ({
    startOffset: block.oldStart,
    endOffset: block.oldEnd,
    from: oldText.slice(block.oldStart, block.oldEnd),
    to: newText.slice(block.newStart, block.newEnd),
  }))
}

/** 把一处最小修改应用到片段上，得到修改后的片段。 */
export function applyMinimal(oldText: string, change: MinimalChange): string {
  return oldText.slice(0, change.startOffset) + change.to + oldText.slice(change.endOffset)
}

/**
 * 把多处修改合成一份完整文本。
 *
 * 从后往前应用：后面的修改不会影响前面已经算好的位置，这是最不易出错的做法。
 * changes 里的 start / end 都是相对**同一份原始文本**的绝对位置。
 */
export function applyChangesToText(
  original: string,
  changes: Array<{ start: number; end: number; replacement: string }>,
): string {
  const ordered = [...changes].sort((a, b) => b.start - a.start)
  let text = original
  for (const change of ordered) {
    text = text.slice(0, change.start) + change.replacement + text.slice(change.end)
  }
  return text
}
