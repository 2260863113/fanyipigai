/**
 * 右上栏：我的译文。
 *
 * 这一栏在**逐页批改**下有两种形态，由 `editing` 决定：
 *   - 在写（`editing`）：可编辑的输入框 + 修改风格档位 + 提交按钮 + 翻页导航；
 *   - 在看结果：**带批注的**作答——勾了底色的词、上方的小字、插入标记、调序弧线
 *     直接长在译文上；点任意一处勾画会在那一行下面浮出气泡，右下角同时只显示这一处的完整解释。
 *
 * ## 为什么"看结果"是只读的，要按「返回编辑」才能改
 *
 * 批过一次的页再改字，批注的位置就全对不上了（批注是按**提交当时**那段文字算出来的）。
 * 因此批过的页先只读，由用户明确说一句"我要改这一页"（`onUnlock`）才放开：
 * 那一刻结果作废、草稿留着、并且这一页从此**不再自动提交**——
 * 改完自己按「提交批改」，免得替他交一次、白花一次调用。
 *
 * 「哪一页批过没有」不在这个组件里判断：它由 App 按 session.pages 推出来，
 * 这里只按 `pageState` / `editing` 渲染。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { AnnotationText, type Selection } from './AnnotationText'
import { AnswerViewSwitch } from './AnswerViewSwitch'
import { CompareView } from './CompareView'
import { LEVEL_LABEL, type PolishLevel } from '../domain/types'
import type { AnnotatedLayout } from '../domain/layout'
import type { ValidatedCorrection } from '../domain/validate'
import type { ViewSettings } from './settings'

/** 正在展示的那一份批改（来自本次提交，或来自练习记录里的某一条）。 */
export interface ShownCorrection {
  correction: import('../domain/types').Correction
  validated: ValidatedCorrection
  answer: string
  level: PolishLevel
  attempt: number
  sectionCount: number
  raw: string
}

/**
 * 当前这一页在逐页批改里的状态。**按钮文案与翻页行为都由它推出来**，
 * 因此它的名称要与 reducer 里那几个动作对得上（见 session.ts）。
 */
export type PageState =
  /** 还没批过 */
  | 'pending'
  /** 批过了，结果就是这一段文字（只读） */
  | 'graded'
  /** 批过之后被「返回编辑」放开，但**一个字都还没改**：可以点回去看那份批改，翻页也会自动提交 */
  | 'edited'
  /** 放开之后**真的改过字**了：批注已对不上，不会再自动提交，只能自己按「提交批改（手动）」 */
  | 'modified'

export function AnswerPane({
  shown,
  layout,
  selection,
  settings,
  level,
  judging,
  error,
  notice,
  isFixtureAnswer,
  editing,
  pageState,
  multiSection,
  sectionIndex,
  currentAnswer,
  onSelect,
  onSettingsChange,
  onUnlock,
  canReturnToResult,
  onReturnToResult,
  onLevelChange,
  onSubmit,
  onSubmitFixture,
  onAnswerChange,
  favorite,
  onToggleFavorite,
}: {
  shown: ShownCorrection | null
  layout: AnnotatedLayout
  selection: Selection | null
  settings: ViewSettings
  level: PolishLevel
  judging: boolean
  /** 批改失败的信息（含"能不能看内置示例"的判断依据） */
  error: { message: string } | null
  notice: string | null
  /** 当前作答恰好等于某道内置示例，才给「查看内置示例批改」 */
  isFixtureAnswer: boolean
  /** 现在是不是在写这一页（否则就是在看这一页的批改结果） */
  editing: boolean
  pageState: PageState
  multiSection: boolean
  sectionIndex: number
  currentAnswer: string
  onSelect: (selection: Selection | null) => void
  onSettingsChange: (patch: Partial<ViewSettings>) => void
  /** 「返回编辑」：作废这一页的结果，放开重写（之后这一页不再自动提交） */
  onUnlock: () => void
  /** 这一页还能点回刚才那份批改（一个字都没改过） */
  canReturnToResult: boolean
  /** 点回去看那一份批改——**不重新提交**，只是把画面切回结果 */
  onReturnToResult: () => void
  onLevelChange: (level: PolishLevel) => void
  onSubmit: () => void
  onSubmitFixture: () => void
  onAnswerChange: (value: string) => void
  /** 小卡片里的「收藏」；不传就不显示那颗按钮（记录页不传） */
  favorite?: boolean
  onToggleFavorite?: () => void
}): JSX.Element {
  const hasAnswer = currentAnswer.trim().length > 0
  /** 这一页的结果还在（正在看的就是它）。它是"返回编辑"够不够格出现的依据 */
  const resultShown = shown !== null && !editing
  /**
   * 这一页被「返回编辑」放开过、而且已经改过字（"已修改 · 待提交"那一档）。
   *
   * 注意它问的是"改过没有"，**不是**"放开过没有"：放开之后一个字都没动时，
   * 那份批改还在暂存区、还能点回去看，界面不该说"已修改"。
   */
  const wasModified = pageState === 'modified'

  return (
    <section className="pane pane-answer">
      <header className="pane-head">
        <h2>我的译文</h2>
        <div className="head-meta">
          {resultShown && <AnswerViewSwitch view={settings.answerView} onChange={onSettingsChange} />}
          {/*
            批过的页是只读的，所以这里给的是「返回编辑」而不是可写的输入框。
            放开之后（unlocked）按钮消失，页面重新可写，并且**不再自动提交**。
          */}
          {pageState === 'graded' && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onUnlock}
              title="放开这一页重写；这一页的结果会作废，改完需要自己按「提交批改」"
            >
              返回编辑
            </button>
          )}
          {/*
            「返回编辑」之后还能点回那一份批改（用户要求："退回修改后，仍然可以返回到批改界面"）。
            只在这一页**一个字都没改**的时候给这颗按钮——理由见 App 里 canReturnToResult 的注释：
            批注的位置是按提交当时那段文字算的，改了字再回去看，画面上就会出现对不上的勾画。
          */}
          {editing && canReturnToResult && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onReturnToResult}
              title="回到这一页的批改结果（不重新提交、不消耗 API）；改了字就不能再回去看了"
            >
              查看上次批改
            </button>
          )}
          {/* 正在写、而且这一页是"改过的那一页"：提醒它交出去要自己按，不会自动发 */}
          {editing && wasModified && <span className="chip chip-warn">已改过 · 待提交</span>}
          {editing && (
            <>
              <div className="level-switch" role="group" aria-label="修改风格">
                {(Object.keys(LEVEL_LABEL) as PolishLevel[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === level ? 'level-btn level-btn-active' : 'level-btn'}
                    onClick={() => onLevelChange(key)}
                    title={LEVEL_LABEL[key]}
                  >
                    {LEVEL_LABEL[key].split('（')[0]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onSubmit}
                disabled={!hasAnswer || judging}
                title={hasAnswer ? undefined : '先在这一页写下你的译文'}
              >
                {judging ? '批改中…' : wasModified ? '提交批改（手动）' : '提交批改'}
              </button>
            </>
          )}
        </div>
      </header>

      {/*
        批改进度条：正好在「我的译文」标题栏下方、作答框上方（用户指定）。
        只在批改中显示——平时不占地方，也不给"进度"这种并不精确的东西常驻位置。
      */}
      {judging && <JudgingProgress />}

      <div className="pane-body">
        {error && (
          <div className="error-block">
            <strong>批改未完成：</strong>
            {error.message}
            {isFixtureAnswer && (
              <button type="button" className="btn btn-ghost" onClick={onSubmitFixture}>
                查看内置示例批改
              </button>
            )}
          </div>
        )}

        {notice && !error && <p className="hint notice">{notice}</p>}

        {editing ? (
          <textarea
            className="answer-input answer-input-fill"
            value={currentAnswer}
            onChange={(event) => onAnswerChange(event.target.value)}
            placeholder={
              multiSection
                ? `在第 ${sectionIndex + 1} 页写下你的译文……写完点「下一页」，这一页会自动交去批改`
                : '在这里写下你的译文……'
            }
            spellCheck={false}
          />
        ) : shown ? (
          settings.answerView === 'compare' ? (
            /*
             * 对照视图**不受行距设置影响**（用户要求"对照视图还是保持以前那样一句对一句"）。
             * 它本来就不画勾画、不画方框，行距只是它自己那份排版的事——
             * 因此这里刻意**不传** lineHeight，让它就用样式表里的默认值。
             */
            <CompareView validated={shown.validated} answer={shown.answer} selection={selection} onSelect={onSelect} />
          ) : (
            <AnnotationText
              layout={layout}
              answer={shown.answer}
              validated={shown.validated}
              selection={selection}
              /* 行距就是设置里那个值（1–3），批改视图与对照视图共用同一个口径 */
              lineHeightBase={settings.lineHeight}
              showFixBoxes={settings.showFixBoxes}
              onSelect={onSelect}
              {...(onToggleFavorite ? { onToggleFavorite, favorited: favorite === true } : null)}
            />
          )
        ) : null}

        {/*
          翻页导航**不在这里**——它挪到了左边「原文」那一栏（用户要求）。
          理由：翻页是为了换一段原文，人的眼睛在原文上；而这一栏是作答/结果，
          导航摆在这里会和「提交批改」挤在一起。
        */}
      </div>
    </section>
  )
}

/** 翻页导航中间那句状态说明。四档各一句话，让人一眼知道这一页走到哪一步了。 */
export const PAGE_STATE_HINT: Record<PageState, string> = {
  pending: '待批改',
  graded: '已批改（只读，点「返回编辑」可改）',
  edited: '编辑中（未改动，可点「查看上次批改」）',
  modified: '已修改 · 待提交',
}

/**
 * 「下一页」点下去会发生什么。
 *
 * 四种情形说的话完全不同，因此写清楚**点下去会发生什么**：
 * 自动交出去批、直接翻过去看结果、还是这一页压根还没写。
 */
export function nextPageHint(options: {
  hasAnswer: boolean
  pageState: PageState
}): string {
  if (!options.hasAnswer) return '这一页还没写——先写点东西吧'
  if (options.pageState === 'modified') return '翻到下一页（改过的页不会自动提交，请先按「提交批改」）'
  if (options.pageState === 'graded') return '翻到下一页（这一页已批过，不会重新提交）'
  return '翻到下一页：这一页会先交去批改'
}

/**
 * 批改进度条的**台阶表**（用户给的节奏，第二版）。
 *
 * 用户原话："进度条移动不要平滑，就一下一下地向前瞬移（瞬移！），
 * 到了百分之 80（大约 15 秒），瞬移速度明显变慢，到了 98（大约三十秒），停止不动，直到结果出来。"
 * 随后又调整成："进度条的跳动增加的距离可以调小一倍。到 80% 的时间延长到 20 秒，
 * 98% 的时间延长到 40 秒。"——因此这一版把**每一跳的步长减半、并把两个节点各往后推**。
 *
 * 写死一张表而不是拿公式算：公式画出来是连续的斜线，而用户要的是"跳"，
 * 跳的节奏只能一个个列出来。每一格至少占一秒（前端采样间隔半秒），
 * 因此看到的每一跳都稳稳停一下。
 *
 * 节奏：前 20 秒跳到 80%（约每 4 秒 16 个点），之后**明显变慢**——
 * 20→40 秒只再爬 18 个点（约每 4 秒 3.6 个点）。
 */
const JUDGING_STEPS: ReadonlyArray<{ at: number; percent: number }> = [
  { at: 0, percent: 0 },
  { at: 2000, percent: 6 },
  { at: 5000, percent: 16 },
  { at: 8000, percent: 26 },
  { at: 11000, percent: 38 },
  { at: 14000, percent: 50 },
  { at: 17000, percent: 62 },
  { at: 20000, percent: 80 },
  // 明显变慢：每 4 秒只涨 3–4 个点
  { at: 24000, percent: 84 },
  { at: 28000, percent: 88 },
  { at: 32000, percent: 91 },
  { at: 36000, percent: 94 },
  { at: 40000, percent: 98 },
]

/**
 * 批改进度条。
 *
 * 三条行为（都是用户点名的）：
 *   1. 按台阶表**一格一格跳**上去（不要平滑滑动）；
 *   2. 15 秒到 80% 之后**明显变慢**，30 秒到 98% 就**停住**不再动；
 *   3. 结果回来 → 组件随即卸载（提前返回也就是"立刻结束"）。
 *
 * ⚠️ 它估的是**时间，不是真进度**：批改接口只有"发出去"和"回来"两个时刻，
 * 中间没有任何可用于量进度的信号。因此刻意**不显示百分比数字**，
 * 只给一条细蓝线——它表达的是"还在忙"，不是一个可以信到个位的数字。
 */
function JudgingProgress(): JSX.Element {
  const [percent, setPercent] = useState(0)
  const startedAt = useRef<number>(Date.now())

  useEffect(() => {
    startedAt.current = Date.now()
    setPercent(0)
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt.current
      // 走到台阶表里"最后那个已经到点的格子"
      let next = 0
      for (const step of JUDGING_STEPS) {
        if (elapsed >= step.at) next = step.percent
      }
      setPercent(next)
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="judge-progress" role="progressbar" aria-label="批改进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span className="judge-progress-bar" style={{ width: `${percent}%` }} data-percent={percent} />
    </div>
  )
}
