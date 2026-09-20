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

/** 译文那一栏看的是哪一面。见 viewOf 的注释。 */
export type AnswerView = 'answer' | 'result'

/** 一道题各自的会话状态。 */
export interface ExerciseSession {
  /** 逐段作答：段号 → 该段文字 */
  drafts: Record<number, string>
  /** 当前在第几段 */
  sectionIndex: number
  /** 上一次的批改结果；没提交过就是 null */
  result: JudgeDraft | null
  /**
   * 当前看的是作答框还是上次的结果。
   *
   * 点「返回修改」只切到作答框，**结果仍然留着**——只要没改一个字就能点回去看，
   * 不用重新提交（重新提交要十几秒，还可能因为模型波动给出不一样的结果）。
   * 一旦真的改了作答，结果就作废（见 answerChanged）。
   */
  view: AnswerView
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
  result: null,
  view: 'result',
  variantIndex: 0,
  generated: [],
}

export type SessionAction =
  /** 换一份原文（「换一换」）：只清当前这道题的作答与结果 */
  | { type: 'sourceRotated'; exerciseId: string; variantIndex: number }
  /** 用一篇刚生成出来的题：存进池子、切过去，并清掉旧的作答与结果 */
  | { type: 'generatedApplied'; exerciseId: string; generated: GeneratedExercise; variantIndex: number }
  /** 作答被修改：结果作废（这一段文字已经不是被批改的那一段了） */
  | { type: 'answerChanged'; exerciseId: string; text: string }
  /**
   * 写到指定的"行"（术语题的五条各写各的）。
   *
   * 与 answerChanged 的差别只有一个：写入哪个坑由调用方指定，而不是当前段号。
   * 术语题一次显示五行、五行同时可编辑，没有"当前在第几段"这回事。
   */
  | { type: 'answerAtChanged'; exerciseId: string; row: number; text: string }
  | { type: 'sectionChanged'; exerciseId: string; sectionIndex: number }
  | { type: 'viewChanged'; exerciseId: string; view: AnswerView }
  /** 批改完成：存下结果并把画面切到结果那一面 */
  | { type: 'resultCommitted'; exerciseId: string; draft: JudgeDraft }
  /**
   * 只作废结果，**保留作答**。
   * 术语题的「重新作答」用它：判分要清掉，但用户已写的五条译文要留着让他改。
   */
  | { type: 'resultCleared'; exerciseId: string }

/** 取某个题号的会话（没有就用空会话，调用方不需要判空）。 */
export function sessionOf(state: ExerciseSessions, exerciseId: string): ExerciseSession {
  return state.byExercise[exerciseId] ?? EMPTY_SESSION
}

/** 写回某个题号，其余题号原样保留。 */
function withSession(state: ExerciseSessions, exerciseId: string, next: ExerciseSession): ExerciseSessions {
  return { byExercise: { ...state.byExercise, [exerciseId]: next } }
}

/**
 * 清掉一道题的作答与结果：原文换了，旧作答不再对应这一篇。
 *
 * 只在**换原文**时调用，因此顺手把分段位置也归零——原文换了，旧的段号没有意义。
 * ⚠️ **不要用它来处理"改动作答"**：那只是编辑当前这一段，把段号归零会让人
 * 每打一个字就被弹回第一段（这正是第一版 reducer 的 bug，
 * 而且因为单元测试里是"先切段、再打字"，直到看了真实交互的日志才暴露）。
 */
function clearedFor(session: ExerciseSession, patch: Partial<ExerciseSession>): ExerciseSession {
  return { ...session, drafts: {}, sectionIndex: 0, result: null, view: 'result', ...patch }
}

/** 改动作答：只作废旧结果，**不动段号**（人还在这一段上打字）。 */
function afterAnswerChanged(session: ExerciseSession, text: string): ExerciseSession {
  return {
    ...session,
    drafts: { ...session.drafts, [session.sectionIndex]: text },
    // 结果对应的是上一版文字，改了就作废
    result: null,
    view: 'result',
  }
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
      return withSession(state, action.exerciseId, afterAnswerChanged(session, action.text))

    case 'answerAtChanged':
      return withSession(state, action.exerciseId, {
        ...session,
        drafts: { ...session.drafts, [action.row]: action.text },
        result: null,
        view: 'result',
      })

    case 'sectionChanged':
      return withSession(state, action.exerciseId, { ...session, sectionIndex: action.sectionIndex })

    case 'viewChanged':
      return withSession(state, action.exerciseId, { ...session, view: action.view })

    case 'resultCommitted':
      return withSession(state, action.exerciseId, { ...session, result: action.draft, view: 'result' })

    case 'resultCleared':
      // 只清结果与视图，**不动 drafts**（术语题的「重新作答」靠它保住已写的译文）
      return withSession(state, action.exerciseId, { ...session, result: null, view: 'result' })
  }
}

export const INITIAL_SESSIONS: ExerciseSessions = { byExercise: {} }
