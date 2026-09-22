/**
 * 左下栏：总体评分。
 *
 * 只放"一眼能扫完"的东西（分数、三色各自的处数、错误分类分布）——
 * 逐处批注在右下栏，这里不重复。没提交过就只给一句提示。
 *
 * ## 大改档**不打分**（用户拍板，ADR 0020）
 *
 * 大改原先由 AI 给一个"整篇印象分"＋一段理由。两个 0–100 含义不同、还不能直接比，
 * 用户的选择是**干脆取消它**："大改页面取消分数打分，分数打分只有精修部分有。"
 * 追问"总评文字要不要留"时，他选的是"连文字总评也去掉"。
 *
 * 因此这一栏在大改档下只写一句"大改档不打分"，并说明分数为什么只有精修档才有——
 * **不留一个空白的分数位**：那会让人以为是加载失败。
 */

import type { JSX } from 'react'
import { ScoreSummary } from './ScoreSummary'
import type { ShownCorrection } from './AnswerPane'

/**
 * 大改档的分数块：**只有一句说明**（不打分、也不给总评）。
 *
 * 抽出来是因为练习记录页也要显示同一块（记录里若存的是大改档的那一次，回看时看到的必须是同一套说法）。
 */
export function RefineNoScore(): JSX.Element {
  return (
    <div className="score-summary">
      <p className="hint score-noscore">
        大改档不打分。
        <br />
        分数只有精修档才有——那一档逐处挑错，分数由程序按错误列表算出来，你自己能核；
        大改是整篇逐句重写，没有"哪一处扣了几分"这回事，所以不给分数、也不给总评。
      </p>
      <div className="result-meta-block">
        <span className="chip">大改</span>
      </div>
    </div>
  )
}

export function ScorePane({ shown }: { shown: ShownCorrection | null }): JSX.Element {
  const refine = shown?.refine
  return (
    <section className="pane pane-score">
      <header className="pane-head">
        <h2>{refine ? '大改档' : '总体评分'}</h2>
        {refine && (
          <div className="head-meta">
            <span className="chip" title="大改不逐处批改，因此没有分数也没有总评">
              不打分
            </span>
          </div>
        )}
      </header>
      <div className="pane-body">
        {refine ? (
          <RefineNoScore />
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
