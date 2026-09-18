import { useMemo } from 'react'
import type { Correction, ErrorCategory } from '../domain/types'
import { CATEGORY_LABEL, COLOR_LABEL, LEVEL_LABEL, type PolishLevel } from '../domain/types'
import { colorForCategory, type ValidatedCorrection } from '../domain/validate'
import { scoreCorrection, SCORING_RULE_TEXT } from '../domain/scoring'
import { MARK_COLOR_VALUE } from '../domain/color'

interface Props {
  correction: Correction
  validated: ValidatedCorrection
  answer: string
  level: PolishLevel
  attempt: number
  sectionCount?: number
}

/**
 * 左下角的总体评分。
 *
 * 只放"一眼能扫完"的东西：分数、三色各自的处数、错误分类的分布。
 * 逐处批注在右下角，这里不重复。
 */
export function ScoreSummary({ correction, validated, answer, level, attempt, sectionCount }: Props) {
  const score = useMemo(() => scoreCorrection(correction, answer), [correction, answer])

  const stats = new Map<ErrorCategory, number>()
  for (const entry of validated.errors) {
    stats.set(entry.error.category, (stats.get(entry.error.category) ?? 0) + 1)
  }
  const statsList = [...stats.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="score-summary">
      <div className="score-total">
        <span className="score-number">{score.total}</span>
        <span className="score-unit">/ 100</span>
      </div>
      <p className="score-rule">{SCORING_RULE_TEXT}</p>

      <ul className="score-legend">
        <li style={{ color: MARK_COLOR_VALUE.red }}>
          {COLOR_LABEL.red}
          <span className="score-count">×{score.hardCount}</span>
        </li>
        <li style={{ color: MARK_COLOR_VALUE.orange }}>
          {COLOR_LABEL.orange}
          <span className="score-count">×{score.softCount}</span>
        </li>
        <li style={{ color: MARK_COLOR_VALUE.green }}>
          {COLOR_LABEL.green}
          <span className="score-count">×{score.highlightCount}</span>
        </li>
      </ul>

      <div className="stats">
        <h3>错误归类</h3>
        {statsList.length === 0 ? (
          <p className="hint">本次没有发现错误。</p>
        ) : (
          <ul className="stats-list">
            {statsList.map(([category, count]) => (
              <li key={category} style={{ color: MARK_COLOR_VALUE[colorForCategory(category)] }}>
                {CATEGORY_LABEL[category]}
                <span className="stats-count">×{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="result-meta-block">
        <span className="chip">{LEVEL_LABEL[level].split('（')[0]}</span>
        <span className="chip">第 {attempt} 次作答</span>
        {sectionCount !== undefined && sectionCount > 1 && <span className="chip">按 {sectionCount} 段批改</span>}
      </div>

      {validated.rejections.length > 0 && (
        <div className="warn-block">
          <h3>有 {validated.rejections.length} 处批注未能标出</h3>
          <p className="hint">
            这些批注给出的位置与你的译文对不上，为避免标错，程序拒绝渲染它们。这通常意味着批改结果本身有问题。
          </p>
          <ul>
            {validated.rejections.map((rejection) => (
              <li key={rejection.id}>
                <code>{rejection.id}</code> {rejection.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
