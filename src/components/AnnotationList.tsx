import { useMemo } from 'react'
import type { Correction } from '../domain/types'
import type { ValidatedCorrection } from '../domain/validate'
import { MARK_COLOR_VALUE } from '../domain/color'
import { summarizeAll, type Selection } from './annotation-summary'

interface Props {
  correction: Correction
  validated: ValidatedCorrection
  answer: string
  onSelect: (selection: Selection | null) => void
  selectedId?: string
}

/**
 * 全量批注清单。
 *
 * 现在只用在**练习记录页**：那一页的译文是存档快照，页面上没有长批注，
 * 清单是唯一的索引，因此必须一次列全。
 * 练习页的右下栏不走这里——那里只显示当前点中的那一处（见 DetailPanel）。
 */
export function AnnotationList({ validated, answer, onSelect, selectedId }: Props) {
  const rows = useMemo(() => summarizeAll(validated, answer), [validated, answer])

  if (rows.length === 0) {
    return <p className="hint">本次没有标出任何问题。</p>
  }

  return (
    <ol className="note-list">
      {rows.map((row) => (
        <li key={row.key}>
          <button
            type="button"
            className={row.key === selectedId ? 'note-item note-item-active' : 'note-item'}
            onClick={() => onSelect(row.selection)}
          >
            <span className="note-top">
              <span
                className="note-badge"
                style={{ color: MARK_COLOR_VALUE[row.color], borderColor: MARK_COLOR_VALUE[row.color] }}
              >
                {row.typeLabel}
              </span>
              <span className="note-category" style={{ color: MARK_COLOR_VALUE[row.color] }}>
                {row.categoryLabel}
              </span>
              <span className="note-index">第 {row.order} 处</span>
            </span>

            <span className="note-change">
              {row.from && <span className="note-from">{row.from}</span>}
              {row.from && row.to && <span className="note-arrow">→</span>}
              {row.to && (
                <span className="note-to" style={{ color: MARK_COLOR_VALUE[row.color] }}>
                  {row.to}
                </span>
              )}
              {!row.to && !row.from && <span className="note-from">（见下方说明）</span>}
            </span>

            <span className="note-why">{row.why}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
