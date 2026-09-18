import { useMemo } from 'react'
import type { Correction, ErrorObject, ErrorType, Highlight } from '../domain/types'
import { CATEGORY_LABEL } from '../domain/types'
import { colorForCategory, type ValidatedCorrection, type ValidatedError } from '../domain/validate'
import { MARK_COLOR_VALUE } from '../domain/color'
import type { Selection } from './AnnotationText'

interface Props {
  correction: Correction
  validated: ValidatedCorrection
  answer: string
  onSelect: (selection: Selection | null) => void
  selectedId?: string
}

/** 改法类型的中文说法，用于批注列表上的小标签。 */
const TYPE_LABEL: Record<ErrorType, string> = {
  replace: '替换',
  insert: '插入',
  delete: '删除',
  rewrite: '整句重写',
  reorder: '语序调换',
}

/**
 * 右下角的逐处批注列表。
 *
 * 刻意**不显示用户的译文全文**：全文已经在右上角，而且逐处批注里
 * 只要给出"哪一段文字、错在哪、改成什么"就够用了。
 * 把整篇译文再排一遍，反而让人要在两处之间来回对照。
 */
export function AnnotationList({ validated, answer, onSelect, selectedId }: Props) {
  const rows = useMemo(() => buildRows(validated, answer), [validated, answer])

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
              <span className="note-badge" style={{ color: MARK_COLOR_VALUE[row.color], borderColor: MARK_COLOR_VALUE[row.color] }}>
                {TYPE_LABEL[row.type]}
              </span>
              <span className="note-category" style={{ color: MARK_COLOR_VALUE[row.color] }}>
                {CATEGORY_LABEL[row.category]}
              </span>
              <span className="note-index">第 {row.order} 处</span>
            </span>

            <span className="note-change">
              {row.from && <span className="note-from">{row.from}</span>}
              {row.from && row.to && <span className="note-arrow">→</span>}
              {row.to && <span className="note-to" style={{ color: MARK_COLOR_VALUE[row.color] }}>{row.to}</span>}
              {!row.to && !row.from && <span className="note-from">（见下方说明）</span>}
            </span>

            <span className="note-why">{row.why}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

interface Row {
  key: string
  order: number
  type: ErrorType
  category: ErrorObject['category']
  color: ReturnType<typeof colorForCategory>
  from: string
  to: string
  why: string
  selection: Selection
}

function buildRows(validated: ValidatedCorrection, answer: string): Row[] {
  const rows: Row[] = []
  let order = 0

  for (const entry of validated.errors) {
    order += 1
    rows.push(errorRow(entry, order, answer))
  }

  // 亮点排在最后集中展示，用绿色区分
  validated.highlights.forEach((entry: { highlight: Highlight }, index) => {
    rows.push({
      key: entry.highlight.id,
      order: validated.errors.length + index + 1,
      type: 'replace',
      category: 'word-choice',
      color: 'green',
      from: answer.slice(entry.highlight.anchor.start, entry.highlight.anchor.end),
      to: '',
      why: entry.highlight.comment,
      selection: { kind: 'highlight', id: entry.highlight.id },
    })
  })

  return rows
}

function errorRow(entry: ValidatedError, order: number, answer: string): Row {
  const { error, reordered } = entry
  const color = colorForCategory(error.category)
  const base = {
    key: error.id,
    order,
    type: error.type,
    category: error.category,
    color,
    why: error.explanation,
    selection: { kind: 'error' as const, id: error.id },
  }

  switch (error.type) {
    case 'replace': {
      const from = answer.slice(entry.span.start, entry.span.end)
      return { ...base, from, to: error.targetText ?? '' }
    }
    case 'delete':
      return { ...base, from: answer.slice(entry.span.start, entry.span.end), to: '' }
    case 'rewrite':
      return { ...base, from: answer.slice(entry.span.start, entry.span.end), to: error.targetText ?? '' }
    case 'insert':
      return {
        ...base,
        from: error.insertAfter?.snippet ?? '',
        to: error.targetText ?? '',
      }
    case 'reorder':
      return {
        ...base,
        from: error.segments?.map((segment) => segment.anchor.snippet).join(' / ') ?? '',
        to: reordered ?? '',
      }
    default:
      return { ...base, from: '', to: '' }
  }
}
