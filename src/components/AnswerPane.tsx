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

import type { JSX } from 'react'
import { AnnotationText, type Selection } from './AnnotationText'
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
  /** 批过了，结果就是这一段文字 */
  | 'graded'
  /** 批过之后被「返回编辑」放开、文字又改过：不会再自动提交，要自己按「提交批改」 */
  | 'edited'

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
  sectionCount,
  currentAnswer,
  onSelect,
  onSettingsChange,
  onUnlock,
  onLevelChange,
  onSubmit,
  onSubmitFixture,
  onAnswerChange,
  onSectionChange,
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
  sectionCount: number
  currentAnswer: string
  onSelect: (selection: Selection | null) => void
  onSettingsChange: (patch: Partial<ViewSettings>) => void
  /** 「返回编辑」：作废这一页的结果，放开重写（之后这一页不再自动提交） */
  onUnlock: () => void
  onLevelChange: (level: PolishLevel) => void
  onSubmit: () => void
  onSubmitFixture: () => void
  onAnswerChange: (value: string) => void
  onSectionChange: (index: number) => void
}): JSX.Element {
  const hasAnswer = currentAnswer.trim().length > 0
  /** 这一页的结果还在（正在看的就是它）。它是"返回编辑"够不够格出现的依据 */
  const resultShown = shown !== null && !editing
  /**
   * 这一页被「返回编辑」放开过。
   *
   * 注意它问的是"放开过没有"，**不是**"此刻有没有结果"：用户改完手动提交一次之后
   * 结果又有了，但这一页仍然是"改过的那一页"——它照样不该再自动提交。
   */
  const wasUnlocked = pageState === 'edited'

  /**
   * 「下一页」的提示语。三种情形说的话完全不同，因此写清楚**点下去会发生什么**：
   * 自动交出去批、直接翻过去看结果、还是压根还没写完。
   */
  const nextHint = !hasAnswer
    ? '这一页还没写——先写点东西吧'
    : wasUnlocked
      ? '翻到下一页（改过的页不会自动提交，请先按「提交批改」）'
      : pageState === 'graded'
        ? '翻到下一页（这一页已批过，不会重新提交）'
        : '翻到下一页：这一页会先交去批改'

  return (
    <section className="pane pane-answer">
      <header className="pane-head">
        <h2>我的译文</h2>
        <div className="head-meta">
          {resultShown && (
            <div className="view-switch" role="group" aria-label="译文视图">
              <button
                type="button"
                className={settings.answerView === 'correct' ? 'view-btn view-btn-active' : 'view-btn'}
                onClick={() => onSettingsChange({ answerView: 'correct' })}
                title="在译文上勾画：划线、方框、调序弧线"
              >
                批改视图
              </button>
              <button
                type="button"
                className={settings.answerView === 'compare' ? 'view-btn view-btn-active' : 'view-btn'}
                onClick={() => onSettingsChange({ answerView: 'compare' })}
                title="一句一句对照：每句下方给出修改后的完整那句，不划线不填补"
              >
                对照视图
              </button>
            </div>
          )}
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
          {/* 正在写、而且这一页是"改过的那一页"：提醒它交出去要自己按，不会自动发 */}
          {editing && wasUnlocked && <span className="chip chip-warn">已改过 · 待提交</span>}
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
                {judging ? '批改中…' : wasUnlocked ? '提交批改（手动）' : '提交批改'}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="pane-body">
        {judging && (
          <p className="hint judging">
            正在批改这一页。长段通常十几秒；若返回未通过位置校验会自动重试。
          </p>
        )}

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
            <CompareView validated={shown.validated} answer={shown.answer} selection={selection} onSelect={onSelect} />
          ) : (
            <AnnotationText
              layout={layout}
              answer={shown.answer}
              validated={shown.validated}
              selection={selection}
              lineHeightBase={settings.lineHeight}
              showFixBoxes={settings.showFixBoxes}
              onSelect={onSelect}
            />
          )
        ) : null}

        {/*
          翻页导航**一直显示**（不再只在作答时显示）：批过的页是只读的，
          但它同样要能翻回上一页看结果、翻到下一页接着译——那是逐页批改的主循环。
        */}
        {multiSection && (
          <div className="section-nav">
            <button
              type="button"
              className="btn"
              onClick={() => onSectionChange(Math.max(0, sectionIndex - 1))}
              data-nav="prev"
              disabled={sectionIndex === 0 || judging}
            >
              ← 上一页
            </button>
            <span className="hint">
              第 {sectionIndex + 1} / {sectionCount} 页 · {PAGE_STATE_HINT[pageState]}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => onSectionChange(Math.min(sectionCount - 1, sectionIndex + 1))}
              data-nav="next"
              disabled={sectionIndex >= sectionCount - 1 || judging}
              title={nextHint}
            >
              下一页 →
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

/** 翻页导航中间那句状态说明。三种状态各一句话，让人一眼知道这一页走到哪一步了。 */
const PAGE_STATE_HINT: Record<PageState, string> = {
  pending: '待批改',
  graded: '已批改（只读，点「返回编辑」可改）',
  edited: '已修改 · 待提交',
}
