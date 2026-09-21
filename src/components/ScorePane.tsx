/**
 * 左下栏：总体评分。
 *
 * 只放"一眼能扫完"的东西（分数、三色各自的处数、错误分类分布）——
 * 逐处批注在右下栏，这里不重复。没提交过就只给一句提示。
 *
 * ## 精修档的分数是**另一种东西**（务必标出来源）
 *
 * 润色档的分数由程序按错误列表算（可解释、可复算）；精修档不逐处批改，算不出"扣了几分"，
 * 因此那个分数是**模型按整篇印象给的总评**。同一个 0–100 在两档下含义不同、**不可比**，
 * 所以精修档这一栏明确写着「AI 总评」并附上模型给的理由，免得用户以为"换一档分数就掉了"。
 */

import type { JSX } from 'react'
import { ScoreSummary } from './ScoreSummary'
import type { ShownCorrection } from './AnswerPane'
import type { RefineResult } from '../domain/refine'

/**
 * 精修档的分数块：AI 给的总分 + 它给的理由 + 一句"这个分数与润色档不可比"。
 *
 * 抽出来是因为练习记录页也要显示同一块（记录里若存的是精修档的那一次，回看时看到的必须是同一套说法）。
 */
export function RefineScore({ refine }: { refine: RefineResult }): JSX.Element {
  return (
    <div className="score-summary">
      <div className="score-total">
        <span className="score-number">{refine.score}</span>
        <span className="score-unit">/ 100</span>
      </div>
      <div className="stats">
        <h3>为什么是这个分数</h3>
        <p className="hint">{refine.comment}</p>
      </div>
      <div className="result-meta-block">
        <span className="chip">精修</span>
        <span className="chip">逐句改写 {refine.sentences.length} 句</span>
      </div>
    </div>
  )
}

export function ScorePane({ shown }: { shown: ShownCorrection | null }): JSX.Element {
  const refine = shown?.refine
  return (
    <section className="pane pane-score">
      <header className="pane-head">
        <h2>总体评分</h2>
        {refine && (
          <div className="head-meta">
            <span className="chip chip-warn" title="精修档不逐处批改，因此分数由 AI 按整篇印象给出">
              AI 总评
            </span>
          </div>
        )}
      </header>
      <div className="pane-body">
        {refine ? (
          <RefineScore refine={refine} />
        ) : shown ? (
          <ScoreSummary
            correction={shown.correction}
            validated={shown.validated}
            answer={shown.answer}
            direction={shown.direction}
            level={shown.level}
            attempt={shown.attempt}
            sectionCount={shown.sectionCount}
          />
        ) : (
          <p className="hint">提交批改后，这里会显示分数与错误归类。</p>
        )}
      </div>
    </section>
  )
}
