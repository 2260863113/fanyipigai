/**
 * 断句：把一段文字切成"句子"，返回**首尾相接、不重不漏**的字符区间。
 *
 * ## 为什么单独抽成一份
 *
 * 同一件事原先有两份实现：对照视图的切句（compare.ts）与收藏的断句（favorites.ts）。
 * 两份本该只差"逗号算不算句末"这一条，但**句末标点后面跟引号**这条规则只补进了收藏那份
 * （用户当时报的是收藏），于是同一段
 *   `xxxxx  "xxxx."someone says`
 * 在收藏里切成两句，在对照视图里却还是一句——用户第二次来报的就是这个。
 *
 * 教训：一份判据分成两份维护，就一定会各说各话。现在两边都调这里，
 * 差别只剩 `splitAtCommas` 这一个显式开关，改一处两边一起生效。
 *
 * ## 句末的判据
 *
 * - `。！？；…` 与换行：本身就是句末，中英文都算；
 * - `!` `?`：一律算（不必像 `.` 那样再看后面）；
 * - `.`：要"收得住"才算句末，四种算、两种不算：
 *   1. 点号后面是空白或结尾（`… total. Then…`）→ 算；
 *   2. 点号后面**紧跟一个收尾引号**（`… fds ."` / `… fds .”`）→ 算。
 *      这就是用户两次报过的那一条：句子以引号收尾时引号后面往往没有空格；
 *   3. 点号后面**紧跟大写字母、而点号前面是小写字母或数字**（`… livelihood.The…`）→ 算。
 *      这是用户第三次报的那一条：**句号后面漏了空格**。同一件事在提示词里也写着——
 *      "逗号、句号后面与下一个词之间有没有空格，一律忽略"（见 domain/prompt.ts）：
 *      AI 不许因为少一个空格扣分，那么程序自己也不该因为少一个空格就把三句读成一句。
 *   4. 点号后面紧跟数字（`3.5`）→ 不算（小数点）；
 *   5. 点号后面紧跟字母、但**不满足第 3 条**（`U.S.`、`e.g.` 里的点）→ 不算（缩写更常见）。
 *
 * 第 3 条为什么要求"点号前面是小写字母或数字"：`U.S.A` 这种缩写里，
 * 点号前面是大写字母，照旧不切。代价是 `Mr.Smith` 会被切开，
 * 与下面那条 `e.g.` 的取舍是同一类——缩写表不值得引，多切一刀只是少给一点上下文。
 *
 * ## 不重不漏靠"一次只切一刀 + 收尾引号归前一句"
 *
 * 每个切点只切一次，切点后面的收尾引号归**前一句**（`… fds ."` 是自足的一句）。
 * 于是"右引号后面紧跟着下一个句子的第一个词"（`."someone says.`）也能切对：
 * 引号留在前一句里，下一句从 `someone` 开始，两边接得严丝合缝。
 *
 * ⚠️ 已知取舍：`e.g.` 后面跟空格（看起来就是一个句末）仍会被切开，
 * 要做对得引一张缩写表；多切一刀只是少给一点上下文，不值得。
 */

/** 一个句子的区间（`from` 含、`to` 不含）。 */
export interface SentenceSpan {
  from: number
  to: number
}

export interface SplitSentenceOptions {
  /**
   * 逗号、顿号、分号也算句末。
   *
   * 收藏要的是"这一处所在的**那一小截**"，而不是语法意义上的完整句子：
   * 一整句里只有半截被改过时，把整句抄进收藏反而让人找不到重点（用户要求）。
   * 对照视图与句子题**不传**这个开关——它们要的是句子。
   */
  splitAtCommas?: boolean
}

/** 一律算句末的标点：句号、问号、叹号、分号、省略号与换行。 */
const ALWAYS_END = /[。！？；…\n]/
/** 拉丁文的叹号与问号：不必再看后面是什么。 */
const LATIN_END = /[!?]/
/** 只有"逗号也断句"时才认的标点。 */
const COMMA_END = /[,，、;]/
/**
 * 句末标点后面、真正属于"句子结尾"的那些收尾字符（引号、右括号之类）。
 *
 * ⚠️ 这里**同时收了 `“` 与 `”`**（以及 ASCII 的 `"`），看起来违反常识，但有必要：
 * 用户报的原例正是 `… fds .“ sdf  fds .”someone says.`——句末那个点号后面跟的是
 * **左引号** `“`（他敲的时候左右不分）。若只认右引号，这个句子就切不开。
 * 一句话里"标点紧跟引号"本身就是很强的收句信号，方向不对也仍然该切。
 */
const TRAILING = /["'“”‘’）)】]/

export function splitSentenceSpans(text: string, options: SplitSentenceOptions = {}): SentenceSpan[] {
  const commas = options.splitAtCommas === true

  /** 标点后面紧跟收尾引号 → 这一句到此为止（只用于 `.` 那条判断） */
  const quoteCloses = (index: number): boolean => {
    const after = text[index + 1]
    return after !== undefined && TRAILING.test(after)
  }
  const endsAt = (index: number): boolean => {
    const char = text[index] ?? ''
    if (ALWAYS_END.test(char) || LATIN_END.test(char)) return true
    if (commas && COMMA_END.test(char)) {
      /*
       * 数字里的千位分隔符（`82,000`）不是一句的结尾。
       *
       * 收藏按逗号断句（"那一小截"），而用户那段里正好有 `82,000,offering`
       * ——不排除的话收藏会收下一个以 `82,` 结尾的碎片，看着像把数字截断了。
       */
      const insideNumber = /[0-9]/.test(text[index - 1] ?? '') && /[0-9]/.test(text[index + 1] ?? '')
      return !insideNumber
    }
    if (char !== '.') return false
    const after = text[index + 1]
    if (after === undefined) return true
    if (/[0-9]/.test(after)) return false // 3.5
    if (/\s/.test(after) || quoteCloses(index)) return true
    /*
     * 句号后面漏了空格：`… livelihood.The meeting…`。
     *
     * 判据是"后面紧跟大写字母、而前面是小写字母或数字"——句首大写是最强的收句信号，
     * 而前面那个小写字母把 `U.S.A`（前面是大写）这类缩写排除在外。
     * 用户第三次报的就是这一条：他那段三句话全被读成了一句，对照视图上就是一整段。
     */
    return /[A-Z]/.test(after) && /[a-z0-9]/.test(text[index - 1] ?? '')
  }

  const spans: SentenceSpan[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (!endsAt(index)) continue
    let end = index + 1
    /*
     * 句末标点后面的收尾引号属于这一句。ASCII 的 `"` 只在这个位置收（紧跟标点），
     * 别处它可能是**开启**引号——`" sdf` 开头那个就是，不能被上一句抢走。
     */
    while (end < text.length && TRAILING.test(text[end] ?? '')) end += 1
    spans.push({ from: start, to: end })
    start = end
    index = end - 1
  }
  if (start < text.length) spans.push({ from: start, to: text.length })
  return spans
}
