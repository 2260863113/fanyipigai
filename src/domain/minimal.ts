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

/**
 * 一个改动块的两端，各有一段"新旧两侧逐字相同"的文字时，**达到几个单位**就把这段剪掉、不标色。
 *
 * 用户的口径是"相同部分**大于**两个字或者单词"——大于两个字/词，就是达到三个。
 * 单位仍然是这套算法的最小单位：英文一个**词**、中文一个**字**（见 `wholeUnitsIn`）。
 *
 * 与 MAX_GAP 的分工：那个管"挨得很近的两块要不要合成一块"，这个管"已经成块的改动里还夹着多少
 * 完全没变、不该跟着标色的文字"。
 */
const MIN_SAME_UNITS = 3

/** 一个汉字 = 一个单位（取法与对照视图 `tokenize`、与 `sections.ts` 的 `countUnits` 同一口径）。 */
const isCjkChar = (char: string | undefined): boolean =>
  char !== undefined && /[\u3400-\u9fff\uf900-\ufaff]/.test(char)

/**
 * 英文侧的最小单位：一串拉丁字母/数字就是一个**词**。
 *
 * 汉字必须排除在外：中文没有空格，若跟英文一样连着算，一整句中文就成了"一个词"，
 * "按词对齐"于是把整句卷进同一个块——中文句子整句标色正是从这里来的。
 */
const isLatinUnit = (char: string | undefined): boolean =>
  char !== undefined && !isCjkChar(char) && /[\p{L}\p{N}]/u.test(char)

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
 *
 * ## 先剥掉共同的前缀 / 后缀（这一步是"最小匹配"的成败关键）
 *
 * 用户报过一条真实的批注：
 *   原译 `the Director-general of Statistics Department of Comprehensive National Economy`
 *   改法 `the Director General of the Department of Comprehensive Statistics of the National Economy`
 * 两边共同的前缀是 `the Director`、后缀是 `National Economy`，肉眼一看就知道那两截不该标色。
 * 但直接把整串丢给下面的差异算法会**整段替换**：中间的词序被打乱之后，
 * 字符级 LCS 对齐得支离破碎（切出好几块互相压着的块），"能不能还原 + 各块不重叠"那道判据
 * 于是判它不合格，退回"整段替换"——共同的前缀后缀就一起被标红了。
 *
 * 因此这里先做**纯字符级**的前缀/后缀剥离，只把中间那一段交给差异算法，最后把抵消掉的
 * 偏移量加回去。剥离不影响正确性：两端原样不动，重建结果自然也对得上。
 */
export interface MinimizeOptions {
  /**
   * 最多允许切出几个"最小不同项"，超过就整段替换。
   *
   * 默认 2——这是**批注**口径（见 MAX_CHANGES 的说明）：一两项是常态，
   * 再多就是一堆互相牵制的碎片，不如整段重写来得清楚。
   *
   * **对照视图会调大它**：那边是"原译 / 改后"两行并排，多切几刀只是多染几个字，
   * 反而正好——用户要的就是"只把真正不同的字标出来"（见 compare.ts 的 COMPARE_MAX_CHANGES）。
   */
  maxChanges?: number
}

export function minimizeChange(oldText: string, newText: string, options: MinimizeOptions = {}): MinimalChange[] | null {
  if (oldText === newText) return null
  if (oldText.length === 0) return [{ startOffset: 0, endOffset: 0, from: '', to: newText }]
  if (newText.length === 0) return [{ startOffset: 0, endOffset: oldText.length, from: oldText, to: '' }]

  /** 共同前缀的长度（先按字符求，再退到"词的边界"上） */
  let head = 0
  while (head < oldText.length && head < newText.length && oldText[head] === newText[head]) head += 1
  /** 共同后缀的长度（不能与前缀重叠） */
  let tail = 0
  while (
    tail < oldText.length - head &&
    tail < newText.length - head &&
    oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]
  ) {
    tail += 1
  }

  /*
   * 退到**词的边界**上再剥。
   *
   * 这一步是必需的，不是保险：`farmer → farmers` 共同的字符前缀是 `farmer`，
   * 若就地剥掉，剩下的只差一个 `s`，下面的词对齐看到的是"两个字符完全相同"，
   * 于是给出"补入 s"——而要求是"划掉整个词、上方写新词"（`alignToWord` 的既定口径）。
   * 退到词边界之后，被剥的都是完整的词，剩下的仍是"整词 vs 整词"，口径保持不变。
   */
  const isBoundary = (text: string, index: number): boolean => {
    if (index <= 0 || index >= text.length) return true
    const before = text[index - 1] ?? ''
    const after = text[index] ?? ''
    return !/[\p{L}\p{N}]/u.test(before) || !/[\p{L}\p{N}]/u.test(after)
  }
  while (head > 0 && !(isBoundary(oldText, head) && isBoundary(newText, head))) head -= 1
  while (tail > 0 && !(isBoundary(oldText, oldText.length - tail) && isBoundary(newText, newText.length - tail))) {
    tail -= 1
  }

  const coreOld = oldText.slice(head, oldText.length - tail)
  const coreNew = newText.slice(head, newText.length - tail)
  const core = minimizeCore(coreOld, coreNew, options.maxChanges ?? MAX_CHANGES)
  if (!core) return null
  // 把偏移量搬回整串的坐标系
  return core.map((change) => ({
    ...change,
    startOffset: change.startOffset + head,
    endOffset: change.endOffset + head,
  }))
}

/** 差异算法的本体：`oldText` / `newText` 已经剥掉了共同的前后缀，两端都不为空。 */
function minimizeCore(oldText: string, newText: string, maxChanges: number): MinimalChange[] | null {
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

  /**
   * 切点能不能落在这里：落在**词中间**就是"半个词"，必须拒绝。
   * 汉字之间、汉字与字母之间都算边界——一个字就是一个单位，怎么切都不算拆字。
   */
  const atUnitEdge = (text: string, index: number): boolean => {
    if (index <= 0 || index >= text.length) return true
    return !(isLatinUnit(text[index - 1]) && isLatinUnit(text[index]))
  }

  /**
   * 数这一段（新旧两侧逐字相同）里有几个**完整单位**：一个汉字算一个、一个完整的词算一个；
   * 标点与空格不算（与 `sections.ts` 的 `countUnits` 一个口径：那里也只数词与汉字）。
   *
   * "完整"是硬要求，不是保险：`eanwhile` 是从 meanwhile 中间截出来的一节，一个单位都数不出来，
   * 于是 `At meanwhile → Meanwhile` 永远凑不够阈值，绝不会被剪成 `At m → M`。
   * 这一节左端/右端紧贴着字母时，那一头的词只是半个词，因此要 `attachedLeft` / `attachedRight`。
   */
  const wholeUnitsIn = (run: string, attachedLeft: boolean, attachedRight: boolean): number => {
    let units = 0
    let index = 0
    while (index < run.length) {
      const char = run[index]
      if (isCjkChar(char)) {
        units += 1
        index += 1
        continue
      }
      // 标点、空格、引号：各占一个位置，但不是"字"也不是"词"，不计
      if (!isLatinUnit(char)) {
        index += 1
        continue
      }
      const wordStart = index
      while (index < run.length && isLatinUnit(run[index])) index += 1
      if ((wordStart > 0 || !attachedLeft) && (index < run.length || !attachedRight)) units += 1
    }
    return units
  }

  /**
   * 把块首、块尾那一段"两边逐字相同"的文字从改动块里剪掉（剪不动就原样返回）。
   *
   * ## 为什么要在这里再剪一刀
   *
   * 用户的要求（原话）："对于中间内容相同的且相同部分大于两个字或者单词的雷同部分，也不标色"。
   * 上面两层只保证"块的两端落在词边界上"，**管不了块里面还夹着一大段完全相同的文字**：
   *   - 开头的"先剥共同前后缀"只对**整串**的首尾生效，而且那两截本来就要求是完整的词；
   *   - `alignToWord` 会为了对齐词边界，把块两侧相同的字**重新包进块里**（`At meanwhile` 就是这么来的）；
   *     中文没有空格，一整句在它眼里是"一个词"，于是**只改了一个词也能把整句包成一个块**——
   *     实测 `他们讨论了中国农业发展的问题 → 他们介绍了中国农业发展的问题` 会整句标色，
   *     而按用户的口径该标的只有"讨论 → 介绍"那两个字。
   *
   * 剪掉是安全的：剪掉的正是两侧逐字相同的那一段，把它留在原地、剩下的部分替换回去，
   * 结果字符串与目标文字一个字都不差（下面的重建校验照样会验一遍）。
   * 但**一个单位都不许剪开**：切点必须落在单位边界上——英文落在词与词之间、中文落在字与字之间，
   * 否则就成了用户明令禁止的"把一个单词按字母拆开改"。
   *
   * 放在"互不重叠 + 能重建"那两道判据**之前**：块被剪短之后，本来互相压着的两块就分开了，
   * 那两道判据于是从"过不去、只能整段替换"变成"过得了、按几处精确改动画"。
   * 实测（随机对拍八千组）：`农业葡萄环境问题他们 → opening 农业葡萄环境自然` 改前是两块都从第 0 位起、
   * 重建不回去，只能整段标；剪完是"插入 opening "+"问题他们 → 自然"，只标该标的——这类"整段替换
   * 收窄成精确改动"有三百多例，反过来（把已切好的块弄没了、块数变少）一次都没有：
   * 块只会被剪短，剪不出空块（整块都相同的那种在上面就被筛掉了）。
   */
  const trimSameEnds = (block: Block): Block => {
    const oldLength = block.oldEnd - block.oldStart
    const newLength = block.newEnd - block.newStart

    // 块首、块尾各自"两边逐字相同"的长度（两截不重叠，与上面剥前后缀同一套写法）
    let head = 0
    while (
      head < oldLength &&
      head < newLength &&
      oldText[block.oldStart + head] === newText[block.newStart + head]
    ) {
      head += 1
    }
    let tail = 0
    while (
      tail < oldLength - head &&
      tail < newLength - head &&
      oldText[block.oldEnd - 1 - tail] === newText[block.newEnd - 1 - tail]
    ) {
      tail += 1
    }

    /**
     * 能不能把 `length` 个字符从块里剪掉。
     *
     * `runOld` / `runNew` 是这一截在两侧的起点，`cutOld` / `cutNew` 是剪完之后**块的新边界**
     * ——块首那一截的切点在它后面，块尾那一截的切点在它前面。
     * 切点是这里唯一的硬约束：**两侧都要落在单位边界上**。只查一侧就会把一个词拆开——
     * `shows → …` 那种改法，相同的那一截在原文里切在词尾、在改后文字里却切在词中间。
     * 数单位时还要看这一截外面的邻居：紧贴着字母的那一头的词只是半个词，不算。
     */
    const cuttable = (runOld: number, runNew: number, length: number, cutOld: number, cutNew: number): boolean => {
      if (length <= 0) return false
      if (!atUnitEdge(oldText, cutOld) || !atUnitEdge(newText, cutNew)) return false
      const attachedLeft = isLatinUnit(oldText[runOld - 1]) || isLatinUnit(newText[runNew - 1])
      const attachedRight = isLatinUnit(oldText[runOld + length]) || isLatinUnit(newText[runNew + length])
      return wholeUnitsIn(oldText.slice(runOld, runOld + length), attachedLeft, attachedRight) >= MIN_SAME_UNITS
    }

    let { oldStart, oldEnd, newStart, newEnd } = block
    // 块首的一截：剪掉之后块从它后面开始
    if (cuttable(oldStart, newStart, head, oldStart + head, newStart + head)) {
      oldStart += head
      newStart += head
    }
    // 块尾的一截：剪掉之后块在它前面结束
    if (cuttable(oldEnd - tail, newEnd - tail, tail, oldEnd - tail, newEnd - tail)) {
      oldEnd -= tail
      newEnd -= tail
    }
    return { oldStart, oldEnd, newStart, newEnd }
  }

  /** 两边取值完全相同 = 这一块没有实际改动，画不出东西（渲染层拿到 from === to 的块也无从下笔）。 */
  const differs = (block: Block): boolean =>
    oldText.slice(block.oldStart, block.oldEnd) !== newText.slice(block.newStart, block.newEnd)

  const aligned = merged.map(alignToWord).filter(differs).map(trimSameEnds).filter(differs)

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

  /*
   * 改动项太多 → 整段替换（见 MAX_CHANGES 的说明；对照视图会把这个上限调大）
   *
   * ⚠️ 走到整段替换时（上面"重建不回去"那条也一样），**中间那段完全相同的文字会连着一起标**，
   * 不再受 `trimSameEnds` 保护。这是"整段替换"这个取舍自己的边界，不是漏剪：
   *   - 那种句子里相同的文字夹在**两处**改动之间，裁剪只剪块的两端，本来就剪不到它；
   *   - 要让它也只标真正变的词，唯一的办法是把上限调大（实测
   *     `the report shows bbb ccc dddd eee → since the start bbb ccc dddd dee` 不设上限就是四块、
   *     中间那三个词一个都不标），可那是**对照视图**的口径——两行并排、切得越细越好；
   *     批注是画在译文上的，这里宁可整段重写也不要一堆互相牵制的碎片，取舍不变。
   */
  if (aligned.length > maxChanges) {
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
