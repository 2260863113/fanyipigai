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
 * - `.`：要"收得住"才算句末，三种算、两种不算：
 *   1. 点号后面是空白或结尾（`… total. Then…`）→ 算；
 *   2. 点号后面**紧跟一个收尾引号**（`… fds ."` / `… fds .”`）→ 算。
 *      这就是用户两次报过的那一条：句子以引号收尾时引号后面往往没有空格；
 *   3. 点号后面紧跟数字（`3.5`）→ 不算（小数点）；
 *   4. 点号后面紧跟字母（`U.S.`、`e.g.` 里的点）→ 不算（缩写/小数点更常见）。
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
    if (commas && COMMA_END.test(char)) return true
    if (char !== '.') return false
    const after = text[index + 1]
    if (after === undefined) return true
    if (/[0-9]/.test(after)) return false // 3.5
    return /\s/.test(after) || quoteCloses(index)
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
