/**
 * 左下栏：总体评分。
 *
 * 只放"一眼能扫完"的东西（分数、三色各自的处数、错误分类分布）——
 * 逐处批注在右下栏，这里不重复。没提交过就只给一句提示。
 */

import type { JSX } from 'react'
import { ScoreSummary } from './ScoreSummary'
import type { ShownCorrection } from './AnswerPane'

export function ScorePane({ shown }: { shown: ShownCorrection | null }): JSX.Element {
  return (
    <section className="pane pane-score">
      <header className="pane-head">
        <h2>总体评分</h2>
      </header>
      <div className="pane-body">
        {shown ? (
          <ScoreSummary
            correction={shown.correction}
            validated={shown.validated}
            answer={shown.answer}
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
