/**
 * 「上一次关掉网页时停在哪」——存在浏览器里，下次打开就落回那里。
 *
 * ## 记的是三样
 *
 *   1. **栏**（文章 / 段落 / 句子 / 术语 / 自己贴的 / 记录 / 收藏）；
 *   2. **题**（那一栏里当时看的是哪一道）+ 它的**来源**；
 *   3. **页**（文章题当时翻到第几页）。
 *
 * 用户的要求是「个性化记忆，下一次落到上一次关掉时的界面」。三样缺一不可：
 * 只记栏会回到"该栏第一题"，只记题会回到"那一篇第一页"——都不是"上次关掉时的界面"。
 *
 * ## 为什么还要记来源
 *
 * 光记题号不够：文章栏的题号可能是 `art-…`（文章库）、`article-001`（内置题库）、
 * AI 现出的 `gen-…`，也可能是自己贴的 `custom-…`。取回来时按**来源**重新确认一遍，
 * 才能保证"取回来的确实是当初那一篇"，而不是某个撞了号的别的东西（取不回来就当没记过）。
 *
 * ## 与「练完的文章不主动打开」的分工
 *
 * 那个规矩（`article-progress.ts`）管的是**文章题**：整篇练完并批改过的文章，
 * 下次打开不主动落在它上面。因此这里的页号对**句子题、术语题**照常生效，
 * 只有文章题会被那条规矩拦下来——拦下来时退回"同一格里第一篇没练完的"。
 * 判断在 App 的启动落点那一处，不在这里（这里只管存取）。
 *
 * ## 存坏了怎么办
 *
 * 一律当作"没记过"：宁可回到默认落点，也不要让界面停在一道不存在的题上。
 * 无痕模式、localStorage 被禁用、内容不是 JSON，全都走这一条。
 */

import type { Mode } from '../domain/types'

/** 顶栏的七个栏位。 */
export type ViewTab = Mode | 'custom' | 'records' | 'favorites'

/**
 * 一道题是从哪里来的。
 *
 * 光记题号不够：文章栏的题号可能是 `art-…`（文章库）、`article-001`（内置题库）、
 * AI 现出的 `gen-…`，也可能是自己贴的 `custom-…`。按来源重新解析一遍，
 * 才能保证"取回来的确实是当初那一篇"，而不是某个撞了号的别的东西。
 */
export type ExerciseOrigin = 'article-bank' | 'builtin' | 'custom' | 'sentence' | 'term'

export interface LastView {
  tab: ViewTab
  /** 当时看的是哪一道题 */
  exerciseId: string
  origin: ExerciseOrigin
  /** 文章题当时翻到第几页；其它题型恒为 0 */
  sectionIndex: number
}

const STORAGE_KEY = 'translation-practice.last-view.v1'

const TABS: readonly ViewTab[] = ['article', 'paragraph', 'sentence', 'term', 'custom', 'records', 'favorites']
const ORIGINS: readonly ExerciseOrigin[] = ['article-bank', 'builtin', 'custom', 'sentence', 'term']

/**
 * 上一次写进去的那一份（序列化后的）。
 *
 * 用途是**免掉重复写**：界面每渲染一次都会把"现在停在哪"报过来，
 * 而真正变化的只有翻页、切题、切栏那几下。比对一行字符串比每帧写 localStorage 便宜得多。
 */
let written = ''

/** 读出上一次停在哪；没记过、存坏了、或形状不对都返回 null。 */
export function loadLastView(): LastView | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    written = raw
    const parsed = JSON.parse(raw) as Partial<LastView>
    if (typeof parsed.exerciseId !== 'string' || parsed.exerciseId.length === 0) return null
    const tab = TABS.find((item) => item === parsed.tab)
    const origin = ORIGINS.find((item) => item === parsed.origin)
    if (!tab || !origin) return null
    const sectionIndex = Number(parsed.sectionIndex)
    return {
      tab,
      exerciseId: parsed.exerciseId,
      origin,
      sectionIndex: Number.isInteger(sectionIndex) && sectionIndex >= 0 ? sectionIndex : 0,
    }
  } catch {
    // 无痕模式、localStorage 被禁用、内容不是 JSON——一律当作"没记过"
    return null
  }
}

/** 记下"现在停在哪"。内容没变就一个字都不写。 */
export function saveLastView(view: LastView): void {
  try {
    const json = JSON.stringify(view)
    if (json === written) return
    written = json
    window.localStorage.setItem(STORAGE_KEY, json)
  } catch {
    /* 存不下就算了：这一次照样能用，只是下次回到默认落点 */
  }
}
