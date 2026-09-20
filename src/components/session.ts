/**
 * 「每一道题各自的状态」的 reducer。
 *
 * ## 为什么需要它
 *
 * 原先这些状态是 App.tsx 里**六个各自独立的 useState**，都按题号索引：
 * draftsByExercise / sectionByExercise / resultByExercise / viewByExercise /
 * variantByExercise / generatedByExercise。
 *
 * 直接后果是"**切换题目的语义只存在于人脑里**，不在代码里"：
 *   - `selectExercise` 手写一份清空清单（selection / openRecord / error / notice）；
 *   - `rotateSource` 手写另一份（重置 drafts、section，删 result，清 selection/error，view 回 'result'）；
 *   - `applyGeneratedExercise` 又把第二份**几乎逐行抄了一遍**。
 * 三份清单还不完全一致，漏掉任何一项就是一个 bug，而没有任何类型或测试在守着这件事。
 *
 * 现在"切换题目意味着什么"写在 reducer 里、由 action 命名表达，不可能漏。
 *
 * ## 一个刻意的取舍：跨题目不共享
 *
 * 切题型或切题目时**不清空任何一道题的作答与结果**（切回来还是离开时的样子），
 * 这是产品要求，不是疏忽。所以所有 per-exercise 状态都按 id 分开存。
 * 只有那两个"原文换了"的 action 会清掉**当前这一道**的作答——
 * 因为旧作答对应的已经不是这一篇原文了。
 *
 * ## 逐页批改：为什么结果按页存，而不是只存"上一次"
 *
 * 文章题一篇有好几页，用户是**一页一页译、一页一页交**的：
 *   点「下一页」时，刚写完的那一页自动交去批改；已经批过的那一页下次翻回来**不重新提交**；
 *   批过又改过的页也**不自动提交**（改完得自己按「提交批改」，否则等于偷偷花掉一次调用）。
 *
 * 这就要求"哪一页已经批过"必须留在状态里，因此第一版那个**单数的 `result`** 不够用了：
 * 翻到第 4 页提交会把第 2 页的结果冲掉，用户再翻回去就只能重新提交。
 * 现在每个页号各存各的（`pages`），于是：
 *   - 翻回旧页 → 直接看到当时那次批改，零调用；
 *   - 「上一页 / 下一页」的可用性、按钮文案都由这一页自己的状态推出来。
 *
 * 术语题没有分页（一次五行），但它同样是"一页"（第 0 页），因此走的还是同一套 ——
 * 不必为它开一个特例分支。
 */

import type { GeneratedExercise } from '../domain/generate'
import type { Correction, PolishLevel } from '../domain/types'
import type { ValidatedCorrection } from '../domain/validate'

/** 一次批改的完整结果（含 AI 原样返回的文本，供「查看完整返回内容」用）。 */
export interface JudgeDraft {
  correction: Correction
  validated: ValidatedCorrection
  level: PolishLevel
  source: 'live' | 'fixture'
  sectionCount: number
  /** AI 原样返回的完整文本 */
  raw: string
}

/**
 * 某一页已提交的那一次批改。
 *
 * `answer` 是**提交当时的那段文字**，刻意与 `drafts` 分开存：
 *   - 界面上的译文与勾画、计分都必须对着这段文字，而不是对着用户后来改过的草稿
 *     （否则改一个字，批注的位置就全对不上了）；
 *   - 有了它才能判断"这一页是不是批过之后又改过"——那是"不自动提交"的判据。
 */
export interface PageResult {
  draft: JudgeDraft
  answer: string
}

/** 一道题各自的会话状态。 */
export interface ExerciseSession {
  /** 逐页作答：页号 → 该页文字（术语题的五行也走这里，第几行就是第几"页"） */
  drafts: Record<number, string>
  /** 当前在第几页 */
  sectionIndex: number
  /**
   * 逐页的批改结果：页号 → 那一页提交过的那一次。
   *
   * 没有条目 = 这一页还没批过。**"当前该看作答框还是看结果"就由它推出来**，
   * 因此这里没有、也不该有第二份 `view` 状态——两份状态迟早会打架
   * （第一版就有：`view` 说在看结果，而结果已经被换页清掉了）。
   */
  pages: Record<number, PageResult>
  /**
   * 批过之后又被放开来改的页号。
   *
   * 「返回编辑」把结果作废、让这一页重新可写，同时记在这里。
   * 它的用途只有一个：**改过的页不再自动提交**——结果已经被用户主动丢掉了，
   * 再自动补一次等于偷偷花掉一次调用，而且用户可能根本没改完。
   */
  unlocked: number[]
  /** 当前用的是第几份原文（0 是题目自带的，之后是备选与 AI 生成的） */
  variantIndex: number
  /** AI 现出的题；按题目留存，「换一换」还能翻回来 */
  generated: GeneratedExercise[]
}

export interface ExerciseSessions {
  /** 题号 → 会话；没有条目表示这道题还是全新状态 */
  byExercise: Record<string, ExerciseSession>
}

export const EMPTY_SESSION: ExerciseSession = {
  drafts: {},
  sectionIndex: 0,
  pages: {},
  unlocked: [],
  variantIndex: 0,
  generated: [],
}

export type SessionAction =
  /** 换一份原文（「换一换」）：只清当前这道题的作答与结果 */
  | { type: 'sourceRotated'; exerciseId: string; variantIndex: number }
  /** 用一篇刚生成出来的题：存进池子、切过去，并清掉旧的作答与结果 */
  | { type: 'generatedApplied'; exerciseId: string; generated: GeneratedExercise; variantIndex: number }
  /** 作答被修改：只写进草稿，**不动**已提交的结果（见 answerAtChanged 的说明） */
  | { type: 'answerChanged'; exerciseId: string; text: string }
  /**
   * 写到指定的"行"（术语题的五条各写各的）。
   *
   * 与 answerChanged 的差别只有一个：写入哪个坑由调用方指定，而不是当前页号。
   * 术语题一次显示五行、五行同时可编辑，没有"当前在第几页"这回事。
   */
  | { type: 'answerAtChanged'; exerciseId: string; row: number; text: string }
  | { type: 'sectionChanged'; exerciseId: string; sectionIndex: number }
  /** 这一页批改完成：结果按页存下来，界面随之显示这一页的结果 */
  | { type: 'pageGraded'; exerciseId: string; sectionIndex: number; draft: JudgeDraft; answer: string }
  /**
   * 「返回编辑」：作废**当前这一页**的结果，让它重新可写。
   *
   * 只清结果与"已放开"标记，**不动 drafts**——用户是回来改字的，草稿必须还在。
   * 同时把这一页记进 unlocked：之后无论怎么改，都不会在翻页时自动提交。
   */
  | { type: 'pageUnlocked'; exerciseId: string }

/** 取某个题号的会话（没有就用空会话，调用方不需要判空）。 */
export function sessionOf(state: ExerciseSessions, exerciseId: string): ExerciseSession {
  return state.byExercise[exerciseId] ?? EMPTY_SESSION
}

/** 某一页的批改结果；没批过就是 undefined。 */
export function pageResultOf(session: ExerciseSession, sectionIndex: number): PageResult | undefined {
  return session.pages[sectionIndex]
}

/** 写回某个题号，其余题号原样保留。 */
function withSession(state: ExerciseSessions, exerciseId: string, next: ExerciseSession): ExerciseSessions {
  return { byExercise: { ...state.byExercise, [exerciseId]: next } }
}

/**
 * 清掉一道题的作答与结果：原文换了，旧作答不再对应这一篇。
 *
 * 只在**换原文**时调用，因此顺手把页码也归零——原文换了，旧的页号没有意义。
 * ⚠️ **不要用它来处理"改动作答"**：那只是编辑当前这一页，把页码归零会让人
 * 每打一个字就被弹回第一页（这正是第一版 reducer 的 bug，
 * 而且因为单元测试里是"先切页、再打字"，直到看了真实交互的日志才暴露）。
 */
function clearedFor(session: ExerciseSession, patch: Partial<ExerciseSession>): ExerciseSession {
  return { ...session, drafts: {}, sectionIndex: 0, pages: {}, unlocked: [], ...patch }
}

export function sessionReducer(state: ExerciseSessions, action: SessionAction): ExerciseSessions {
  const session = sessionOf(state, action.exerciseId)
  switch (action.type) {
    case 'sourceRotated':
      return withSession(state, action.exerciseId, clearedFor(session, { variantIndex: action.variantIndex }))

    case 'generatedApplied':
      return withSession(
        state,
        action.exerciseId,
        // 新生成的题排在池子末尾，之后「换一换」还能翻回来
        clearedFor(session, {
          variantIndex: action.variantIndex,
          generated: [...session.generated, action.generated],
        }),
      )

    case 'answerChanged':
      /*
       * 改动作答**只写草稿**，不碰已提交的结果，也**不碰页号**
       * （人还在这一页上打字，把页号归零就是那个"每打一个字弹回第一页"的老 bug）。
       *
       * 为什么不顺手把这一页的结果作废：结果本该只在用户明确说"我要改这一页"时作废，
       * 而那句话就是「返回编辑」（pageUnlocked，已经在它里面作废了）。
       * 这里再作废一次会连带毁掉"批过又改过"这个状态的判据——
       * 那时用户就再也分不清自己是"没提交过"还是"改过了"，
       * 而这两种情况一个要自动提交、一个绝不能自动提交。
       *
       * 写这一页之前它只会处在两种状态：还没批过（没有结果），或者已经被
       * 「返回编辑」放开来（结果已在 pageUnlocked 里作废）。两种都不会让
       * 界面上的译文与勾画对不上。
       */
      return withSession(state, action.exerciseId, {
        ...session,
        drafts: { ...session.drafts, [session.sectionIndex]: action.text },
      })

    case 'answerAtChanged':
      return withSession(state, action.exerciseId, {
        ...session,
        drafts: { ...session.drafts, [action.row]: action.text },
      })

    case 'sectionChanged':
      return withSession(state, action.exerciseId, { ...session, sectionIndex: action.sectionIndex })

    case 'pageGraded':
      return withSession(state, action.exerciseId, {
        ...session,
        pages: {
          ...session.pages,
          [action.sectionIndex]: { draft: action.draft, answer: action.answer },
        },
      })

    case 'pageUnlocked': {
      const pages = { ...session.pages }
      delete pages[session.sectionIndex]
      return withSession(state, action.exerciseId, {
        ...session,
        pages,
        unlocked: session.unlocked.includes(session.sectionIndex)
          ? session.unlocked
          : [...session.unlocked, session.sectionIndex],
      })
    }
  }
}

export const INITIAL_SESSIONS: ExerciseSessions = { byExercise: {} }
