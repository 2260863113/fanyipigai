/**
 * 收藏：把某一处批改连同「改前 / 改后 / 为什么」一起留下来，以后在「收藏」那一栏翻。
 *
 * 三条约定：
 *   1. **存的是内容，不是指针**。收藏里完整写着改前、改后、原因、所在的那一整句，
 *      以及当时是哪道题——练习记录会变、题库会更新，指向某一处的编号过几天可能就指不到了。
 *   2. **同一处只留一条**。再次点「收藏」就是取消，不去攒重复项。
 *   3. **存在这台浏览器上**（与设置、自定义题同一个存法），不联网、不花钱。
 *
 * 收藏里为什么还要存"那句话所在的整句"：用户说的是"保存这句话"——
 * 单独一句 `farmer → farmers` 过几天看就不知道在说什么了，连着整句才有复习价值。
 */

import type { Direction, MarkColor, Mode } from './types'

const STORAGE_KEY = 'translation-practice.favorites'
/** 最多留这么多条，再多就把最旧的挤掉（本地存储不是仓库） */
const MAX_FAVORITES = 200

export interface Favorite {
  id: string
  createdAt: string
  /** 这一处批注的编号（同一处再收藏一次算同一条） */
  errorId: string
  /** 改前 / 改后（标签是「要改的是 / 改成」这类说法） */
  fromLabel: string
  from: string
  toLabel: string
  to: string
  /** 为什么错 / 为什么好 */
  why: string
  /** 这一处是什么类型、什么分类，以及它的颜色 */
  typeLabel: string
  categoryLabel: string
  color: MarkColor
  /** 修改前的整句 */
  sentenceBefore: string
  /** 修改后的整句（把这一处的改法应用上去之后的整句） */
  sentenceAfter: string
  /**
   * 上色范围（相对各自那句话的字符下标）。
   * **改前那句**加荧光底色（文字也跟着变色）——荧光只出现在原译文上；
   * **改后那句**只给文字上色，不加底色（那是"改成了什么"，不该再被当成被改内容）。
   * 只标**这一处**：同一句里别的错误一律不标，重点就是这一处。
   */
  beforeStart: number
  beforeEnd: number
  afterStart: number
  afterEnd: number
  /** 当时是哪道题 */
  exerciseId: string
  mode: Mode
  direction: Direction
  topic: string
}

/**
 * 句末标点后面、真正属于"句子结尾"的那些收尾字符（引号、右括号之类）。
 *
 * ⚠️ 这里**同时收了 `“` 与 `”`**（以及 ASCII 的 `"`），看起来违反常识，但有必要：
 * 用户报的原例正是 `… fds .“ sdf  fds .”someone says.`——句末那个点号后面跟的是
 * **左引号** `“`（他自己敲的时候左右不分）。若只认右引号，这个句子就切不开。
 * 一句话里"句点紧跟引号"本身就是很强的收句信号，方向不对也仍然该切。
 */
const TRAILING = /["'“”‘’）)】]/

/** 一个句子的区间（`from` 含、`to` 不含）。 */
export interface SentenceSpan {
  from: number
  to: number
}

/**
 * 把一段文本切成句子（返回**首尾相接、不重不漏**的区间）。
 *
 * ## 句末的判据
 *
 * - `。！？!?…` 与换行：本身就是句末；
 * - `.`：要"收得住"才算句末。两种算，一种不算：
 *   1. 点号后面是空白或结尾（`… total. Then…`）→ 算；
 *   2. 点号后面**紧跟一个收尾引号**（`… fds ."` / `… fds .”`）→ 算。
 *      **这就是用户报的那一条**：句子以引号收尾时，引号后面往往没有空格，
 *      不认它就会把三句粘成一句；
 *   3. 点号后面紧跟数字（`3.5`）→ 不算（小数点）。
 *
 * ## 不重不漏靠"一次只切一刀 + 引号归前一句"
 *
 * 每个切点只切一次，切点后面的收尾引号归**前一句**（`… fds ."` 是自足的一句）。
 * 于是"右引号后面紧跟着下一个句子的第一个词"这种写法（`."someone says.`）也能切对：
 * 引号留在前一句里，下一句从 `someone` 开始，两边接得严丝合缝。
 *
 * ⚠️ 已知取舍：`e.g.` 这类缩写后面跟空格（或跟引号）看起来就是一个句末，会被切开。
 * 要做对得引一张缩写表；而收藏里的一整句多切一刀只是少给一点上下文，不值得。
 */
export function splitSentenceSpans(text: string): SentenceSpan[] {
  /** 点号后面紧跟收尾引号 → 这一句到此为止 */
  const quoteCloses = (index: number): boolean => {
    const after = text[index + 1]
    return after !== undefined && TRAILING.test(after)
  }
  const endsAt = (index: number): boolean => {
    const char = text[index] ?? ''
    if (/[。！？!?…\n]/.test(char)) return true
    if (char !== '.') return false
    const after = text[index + 1]
    if (after !== undefined && /[0-9]/.test(after)) return false // 3.5
    return after === undefined || /\s/.test(after) || quoteCloses(index)
  }

  const spans: SentenceSpan[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (!endsAt(index)) continue
    let end = index + 1
    /*
     * 句末标点后面的收尾引号属于这一句。ASCII 的 `"` 只在这个位置收（紧跟点号），
     * 别处它可能是**开启**引号——`" sdf` 开头那个就是，不能被上一句抢走。
     */
    if (quoteCloses(index)) {
      while (end < text.length && TRAILING.test(text[end] ?? '')) end += 1
    }
    spans.push({ from: start, to: end })
    start = end
    index = end - 1
  }
  if (start < text.length) spans.push({ from: start, to: text.length })
  return spans
}

/**
 * 取"这一处所在的那一整句"在原文里的区间。
 *
 * 从错误区间往两边扩到句末标点或换行为止，并把句末标点带上——不这么扩的话，
 * 收藏里就只剩两个词，回头根本看不出上下文。
 *
 * ## 断句要认引号（用户报过的那一条）
 *
 * 句子常常以**引号收尾**，而引号后面不一定有空格：
 *   - 用户的原例（ASCII 引号）：`sgadgg ds  ds ." sdf  fds ."someone says.` → 要拆成**三句**
 *   - 同一个例子的弯引号写法：`sgadgg ds  ds .“ sdf  fds .”someone says.`
 *
 * 边界由 `splitSentenceSpans` 统一算；这里只负责"这一处落在哪一句里"。
 * 这样"哪几处算一句"与"收藏里显示的整句"永远出自同一套判据，不会各说各话。
 *
 * ⚠️ 已知取舍：`e.g.` 这类缩写后面跟空格，看起来就是一个句末，会被切开。
 * 要做对得引一张缩写表；而收藏里的一整句多切一刀只是少给一点上下文，不值得。
 */
export function sentenceRange(answer: string, start: number, end: number): { from: number; to: number } {
  const spans = splitSentenceSpans(answer)
  const at = Math.max(0, Math.min(start, answer.length))
  // 落在哪一句里：包含 `at` 的那一句；`at` 正好在句首时就是它自己
  const hit = spans.find((span) => at >= span.from && at < span.to) ?? spans[spans.length - 1]
  if (!hit) return { from: 0, to: answer.length }
  // 区间里的首尾空白去掉，但**不能动句内的字**，因此只往里收、不外扩
  let from = hit.from
  const upper = Math.max(hit.from, Math.min(hit.to, end))
  while (from < upper && /\s/.test(answer[from] ?? '')) from += 1
  let to = Math.min(answer.length, Math.max(hit.to, end))
  while (to > from && /\s/.test(answer[to - 1] ?? '')) to -= 1
  return { from, to }
}

/** 取"这一处所在的那一整句"（只要文字）。 */
export function sentenceAround(answer: string, start: number, end: number): string {
  const range = sentenceRange(answer, start, end)
  return answer.slice(range.from, range.to).trim()
}

/**
 * 收藏里要的两句话：**修改前的整句**与**修改后的整句**，以及各自要上色的那一段。
 *
 * 改后的整句＝把这一处的改法（`span` 换成 `to`）应用上去之后的同一句。
 * 改前那句上色的是**被改掉的那一截**（纯插入时为零宽、没有可标的），
 * 改后那句上色的是**新写上去的那一截**（纯删除时为零宽）。
 * 于是"荧光在原译文上、改后的内容只标字体颜色"这件事，数据上就是分开的两段。
 */
export function sentencePair(
  answer: string,
  span: { start: number; end: number },
  to: string,
): { before: string; after: string; beforeStart: number; beforeEnd: number; afterStart: number; afterEnd: number } {
  const range = sentenceRange(answer, span.start, span.end)
  const before = answer.slice(range.from, range.to)
  const from = Math.max(0, Math.min(span.start - range.from, before.length))
  const to_ = Math.max(from, Math.min(span.end - range.from, before.length))
  const after = `${before.slice(0, from)}${to}${before.slice(to_)}`
  return {
    before,
    after,
    beforeStart: from,
    beforeEnd: to_,
    afterStart: from,
    afterEnd: from + to.length,
  }
}

/** 把「选中的那一处 + 当时那道题」整理成一条收藏。 */
export function favoriteOf(input: {
  summary: {
    key: string
    typeLabel: string
    categoryLabel: string
    color: MarkColor
    fromLabel: string
    from: string
    toLabel: string
    to: string
    why: string
  }
  answer: string
  span: { start: number; end: number }
  context: { exerciseId: string; mode: Mode; direction: Direction; topic: string }
  now?: Date
}): Favorite {
  const createdAt = (input.now ?? new Date()).toISOString()
  const sentences = sentencePair(input.answer, input.span, input.summary.to)
  return {
    id: `fav-${input.context.exerciseId}-${input.summary.key}`,
    createdAt,
    errorId: input.summary.key,
    fromLabel: input.summary.fromLabel,
    from: input.summary.from,
    toLabel: input.summary.toLabel,
    to: input.summary.to,
    why: input.summary.why,
    typeLabel: input.summary.typeLabel,
    categoryLabel: input.summary.categoryLabel,
    color: input.summary.color,
    sentenceBefore: sentences.before,
    sentenceAfter: sentences.after,
    beforeStart: sentences.beforeStart,
    beforeEnd: sentences.beforeEnd,
    afterStart: sentences.afterStart,
    afterEnd: sentences.afterEnd,
    exerciseId: input.context.exerciseId,
    mode: input.context.mode,
    direction: input.context.direction,
    topic: input.context.topic,
  }
}

/** 读出全部收藏（新的在前）。存坏了、没存过都返回空数组。 */
export function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Favorite => {
      const favorite = item as Partial<Favorite> | null
      return Boolean(favorite && typeof favorite.id === 'string' && typeof favorite.why === 'string')
    })
  } catch {
    return []
  }
}

function persist(favorites: readonly Favorite[]): Favorite[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
  } catch {
    // 存不下（无痕模式、配额满了）就算了：这一次界面上照样看得见，只是刷新之后没了
  }
  return [...favorites]
}

/**
 * 加一条或去掉一条（同一处再点就是取消）。返回新的整份列表。
 * 同一处判重看的是"哪道题的哪一处"，而不是时间——不然同一处能收藏出好几条。
 */
export function toggleFavorite(favorites: readonly Favorite[], favorite: Favorite): Favorite[] {
  const exists = favorites.some((item) => item.id === favorite.id)
  if (exists) return persist(favorites.filter((item) => item.id !== favorite.id))
  return persist([favorite, ...favorites].slice(0, MAX_FAVORITES))
}

/** 删掉一条（收藏页里的「删除」）。 */
export function removeFavorite(favorites: readonly Favorite[], id: string): Favorite[] {
  return persist(favorites.filter((item) => item.id !== id))
}

/** 清空（收藏页里的「全部清空」）。 */
export function clearFavorites(): Favorite[] {
  return persist([])
}
