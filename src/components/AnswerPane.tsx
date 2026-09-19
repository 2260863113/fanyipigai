/**
 * 右上栏：我的译文。
 *
 * 这一栏有两种形态，由 `shown` 有没有值决定：
 *   - 没有（还没提交，或点了「返回修改」）：可编辑的输入框 + 修改风格档位 + 提交按钮；
 *   - 有（提交过、或正在看练习记录里的某一条）：**带批注的**作答——
 *     勾了底色的词、上方的小字、插入标记、调序弧线直接长在译文上；
 *     点任意一处勾画会在那一行下面浮出气泡，右下角同时只显示这一处的完整解释。
 *
 * 「返回修改」只切视图、**不清结果**（结果在 session.ts 里留着），
 * 所以只要没改字就还能点「查看上次批改」回到同一份结果，不必重新提交。
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
  canReturnToResult,
  multiSection,
  sectionIndex,
  sectionCount,
  filledSections,
  currentAnswer,
  onSelect,
  onSettingsChange,
  onBackToAnswer,
  onViewLastResult,
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
  /** 有上一次的结果、且现在停在作答框上 */
  canReturnToResult: boolean
  multiSection: boolean
  sectionIndex: number
  sectionCount: number
  filledSections: number
  currentAnswer: string
  onSelect: (selection: Selection | null) => void
  onSettingsChange: (patch: Partial<ViewSettings>) => void
  onBackToAnswer: () => void
  onViewLastResult: () => void
  onLevelChange: (level: PolishLevel) => void
  onSubmit: () => void
  onSubmitFixture: () => void
  onAnswerChange: (value: string) => void
  onSectionChange: (index: number) => void
}): JSX.Element {
  return (
    <section className="pane pane-answer">
      <header className="pane-head">
        <h2>我的译文</h2>
        <div className="head-meta">
          {shown && (
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
          {shown && (
            <button type="button" className="btn btn-ghost" onClick={onBackToAnswer}>
              返回修改
            </button>
          )}
          {!shown && canReturnToResult && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onViewLastResult}
              title="回到上一次的批改结果（不重新提交，也不消耗 API）"
            >
              查看上次批改
            </button>
          )}
          {!shown && (
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
                disabled={filledSections < sectionCount || judging}
                title={filledSections < sectionCount ? '请先写完所有段落' : undefined}
              >
                {judging
                  ? '批改中…'
                  : multiSection
                    ? `提交全篇（${filledSections}/${sectionCount} 段已写）`
                    : '提交批改'}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="pane-body">
        {judging && (
          <p className="hint judging">
            正在批改{multiSection ? `（${sectionCount} 段并行发出）` : ''}。长段通常十几秒；
            若返回未通过位置校验会自动重试。
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

        {shown ? (
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
        ) : (
          <textarea
            className="answer-input answer-input-fill"
            value={currentAnswer}
            onChange={(event) => onAnswerChange(event.target.value)}
            placeholder={
              multiSection
                ? `在第 ${sectionIndex + 1} 段写下你的译文……写完后点「下一段」`
                : '在这里写下你的译文……'
            }
            spellCheck={false}
          />
        )}

        {/* 分段导航放在原文下方、批改结果上方 */}
        {multiSection && !shown && (
          <div className="section-nav">
            <button
              type="button"
              className="btn"
              onClick={() => onSectionChange(Math.max(0, sectionIndex - 1))}
              data-nav="prev"
              disabled={sectionIndex === 0}
            >
              ← 上一段
            </button>
            <span className="hint">
              第 {sectionIndex + 1} / {sectionCount} 段 · 已写 {filledSections} 段
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => onSectionChange(Math.min(sectionCount - 1, sectionIndex + 1))}
              data-nav="next"
              disabled={sectionIndex >= sectionCount - 1}
            >
              下一段 →
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
