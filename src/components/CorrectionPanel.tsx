import { useMemo } from 'react'
import type { Correction, ErrorCategory } from '../domain/types'
import { CATEGORY_LABEL, DIMENSION_LABEL, LEVEL_LABEL, type PolishLevel } from '../domain/types'
import { colorForCategory, type ValidatedCorrection } from '../domain/validate'
import { buildLayout } from '../domain/layout'
import { AnnotationText, type Selection } from './AnnotationText'
import { MARK_COLOR_VALUE } from '../domain/color'

interface Props {
  correction: Correction
  /** 已通过位置校验的批改结果 */
  validated: ValidatedCorrection
  answer: string
  level: PolishLevel
  attempt: number
  onSelect: (selection: Selection) => void
  /** 嵌在右屏里时不再自带面板外框与标题 */
  embedded?: boolean
}

function DimensionBar({ name, score }: { name: string; score: number }) {
  const ratio = Math.max(0, Math.min(100, score)) / 100
  return (
    <div className="dim">
      <div className="dim-head">
        <span>{name}</span>
        <span className="dim-score">{score}</span>
      </div>
      <div className="dim-track">
        <div className="dim-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

export function CorrectionPanel({ correction, validated, answer, level, attempt, onSelect, embedded = false }: Props) {
  const layout = useMemo(() => buildLayout(validated, answer), [validated, answer])

  const stats = new Map<ErrorCategory, number>()
  for (const entry of validated.errors) {
    stats.set(entry.error.category, (stats.get(entry.error.category) ?? 0) + 1)
  }
  const statsList = [...stats.entries()].sort((a, b) => b[1] - a[1])

  const content = (
    <>
      <div className="score-block">
        <div className="score-total">
          <span className="score-number">{correction.total}</span>
          <span className="score-unit">/ 100</span>
          <span className="score-note">尺子：比赛评分标准</span>
        </div>
        <div className="dims">
          {(Object.keys(DIMENSION_LABEL) as Array<keyof typeof DIMENSION_LABEL>).map((key) => (
            <DimensionBar key={key} name={DIMENSION_LABEL[key]} score={correction.dimensions[key]} />
          ))}
        </div>
      </div>

      <div className="head-meta result-meta">
        <span className="chip">{LEVEL_LABEL[level].split('（')[0]}</span>
        <span className="chip">第 {attempt} 次作答</span>
      </div>

      <p className="summary">{correction.summary}</p>

      <div className="comment-grid">
        {(Object.keys(DIMENSION_LABEL) as Array<keyof typeof DIMENSION_LABEL>).map((key) => (
          <div className="comment" key={key}>
            <span className="comment-name">{DIMENSION_LABEL[key]}</span>
            <span className="comment-text">{correction.dimensionComments[key]}</span>
          </div>
        ))}
      </div>

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
        {validated.highlights.length > 0 && (
          <p className="stats-highlight" style={{ color: MARK_COLOR_VALUE.green }}>
            另有 {validated.highlights.length} 处表达优秀，不计入错误。
          </p>
        )}
      </div>

      <div className="annotated-block">
        <h3>逐处批注</h3>
        <AnnotationText layout={layout} answer={answer} onSelect={onSelect} />
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
    </>
  )

  if (embedded) return <div className="result-body">{content}</div>

  return (
    <section className="panel panel-result">
      <header className="panel-head">
        <h2>批改结果</h2>
      </header>
      <div className="panel-body">{content}</div>
    </section>
  )
}
