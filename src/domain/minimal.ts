/**
 * 最小修改：算出一处批注真正改动的最小片段。
 *
 * 为什么需要它：模型给的 oldText 是它自己圈的，常圈得过宽。
 * 例如它把 "have explore ways" → "have explored ways"，其实只有 explore 一个词变化，
 * 但按它圈的范围会把 have / ways 一起划掉，看着像大改，实际是小修。
 * 更极端的一次实测：它把 ", " → "到达地，吸引了"，而真正变的只有那一个逗号。
 *
 * 做法：对新旧文字做**字符级差异**（先剥公共前缀后缀，再在中间做经典 LCS 回溯），
 * 得到若干"替换块"，然后合并挨得很近的块（中间只隔一两个字符）。
 * 不用启发式收缩——那种写法在"改动中间夹着空格"时会停错地方，
 * 把两侧没变的词一起划进去（实际踩过）。
 *
 * 本函数**不判断改法类型**：类型由 AI 的分类决定，颜色与计分都跟着分类走。
 * 它只负责把"圈得太宽"的范围收窄到真正变化的文字。
 */

export interface MinimalResult {
  /** 相对模型给出的原片段，真正发生变化的起止位置 */
  startOffset: number
  endOffset: number
  /** 变化前后的文字 */
  from: string
  to: string
}

/** 合并两个块之间允许的最大间隔：间隔小于等于这个值就把它们连起来一起标。 */
const MAX_GAP = 2

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

/** 一个字符是否属于"词"（字母、数字、汉字都算）。 */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

/**
 * 算出一处修改的最小差异。返回 null 表示新旧文字完全相同（无需标注）。
 */
export function minimizeChange(oldText: string, newText: string): MinimalResult | null {
  if (oldText === newText) return null
  if (oldText.length === 0) return { startOffset: 0, endOffset: 0, from: '', to: newText }
  if (newText.length === 0) return { startOffset: 0, endOffset: oldText.length, from: oldText, to: '' }

  const blocks = diffBlocks(oldText, newText)
  if (blocks.length === 0) return null

  // 把挨得很近的块合起来，避免出现一堆零碎的单字标记
  const merged: Block[] = []
  for (const block of blocks) {
    const last = merged[merged.length - 1]
    if (
      last &&
      block.oldStart - last.oldEnd <= MAX_GAP &&
      block.newStart - last.newEnd <= MAX_GAP &&
      !isWordChar(oldText.slice(last.oldEnd, block.oldStart))
    ) {
      last.oldEnd = block.oldEnd
      last.newEnd = block.newEnd
      continue
    }
    merged.push({ ...block })
  }

  const first = merged[0]
  if (!first) return null

  let oldStart = first.oldStart
  let oldEnd = first.oldEnd
  let newStart = first.newStart
  let newEnd = first.newEnd

  // 收尾：把标记扩到**词边界**，让范围读起来是一个完整的词，而不是半个词或几个孤立的字符。
  //
  // 为什么要扩：字符级差异会把"词形变化"缩到只剩一个字母
  // （explore → explored 只标出 d，recent year → recent years 只标出 s 并丢掉前面的空格），
  // 那种标法没人看得懂。实测里还出现过 In → Sin 这种把插入块与后面那个词切开的标法。
  //
  // 怎么扩：朝前与朝后**逐步**比对两侧的字符，相等才让出一步，一直走到词边界。
  // 逐步比对是关键——只按"还差几个字符"做算术会走错位（In → Sin 就是这么来的）；
  // 而中途一旦两侧不再相等就立刻停，所以不会把没变的部分卷进来。
  const wordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char)

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

  // 扩到片段两端：整段本身就是改动范围（整句重写就是这种），按整段标
  // 扩到片段两端：整段本身就是改动范围（整句重写就是这种）
  let useWholeSpan = oldStart === 0 && oldEnd === oldText.length

  // 最后一道判据，也是最重要的一道：**把这处最小修改应用回去，能不能还原成模型给的新文字**。
  //
  // 能还原，说明这是一处干净的最小改动（explore → explored 之类），只标那几个字就够了。
  // 还原不了，说明模型给的新旧文字之间存在**多处**互不相邻的变化——那正是整句重写的情形
  // （"In wake of reform" → "Since the beginning…" 就是这样，diff 会有好几个块）。
  // 此时按整段替换标，而不是挑出其中一小块来标：那样既标不全，重建出来的结果也是错的。
  if (!useWholeSpan) {
    const rebuilt = oldText.slice(0, oldStart) + newText.slice(newStart, newEnd) + oldText.slice(oldEnd)
    if (rebuilt !== newText) useWholeSpan = true
  }

  if (useWholeSpan) {
    oldStart = 0
    oldEnd = oldText.length
    newStart = 0
    newEnd = newText.length
  }

  const from = oldText.slice(oldStart, oldEnd)
  const to = newText.slice(newStart, newEnd)
  if (from === to) return null
  return { startOffset: oldStart, endOffset: oldEnd, from, to }
}

/** 把一处最小修改应用到片段上，得到修改后的片段。 */
export function applyMinimal(oldText: string, result: MinimalResult): string {
  return oldText.slice(0, result.startOffset) + result.to + oldText.slice(result.endOffset)
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
