import type { ErrorObject, Highlight } from '../domain/types'
import { CATEGORY_LABEL } from '../domain/types'
import { colorForCategory, type ValidatedError } from '../domain/validate'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import type { Selection } from './AnnotationText'

export interface SelectionData {
  errors: Map<string, ValidatedError>
  highlights: Map<string, Highlight>
}

interface Props {
  selection: Selection | null
  data: SelectionData
  onClose: () => void
}

function findError(data: SelectionData, id: string): ErrorObject | undefined {
  return data.errors.get(id)?.error
}

export function DetailPanel({ selection, data, onClose }: Props) {
  if (!selection) {
    return (
      <aside className="detail detail-idle">
        <p className="hint">点任意一处批注，这里会显示「错在哪一类、为什么错」。</p>
      </aside>
    )
  }

  if (selection.kind === 'highlight') {
    const highlight: Highlight | undefined = data.highlights.get(selection.id)
    if (!highlight) return <aside className="detail detail-idle"><p className="hint">该处批注已不存在。</p></aside>
    return (
      <aside className="detail" style={{ borderColor: MARK_COLOR_VALUE.green }}>
        <header className="detail-head" style={{ background: MARK_BG_VALUE.green }}>
          <span className="detail-kind" style={{ color: MARK_COLOR_VALUE.green }}>
            表达优秀
          </span>
          <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <p className="detail-text">{highlight.anchor.snippet}</p>
        <p className="detail-body">{highlight.comment}</p>
      </aside>
    )
  }

  const error = findError(data, selection.id)
  if (!error) {
    return (
      <aside className="detail detail-idle">
        <p className="hint">该处批注已不存在。</p>
      </aside>
    )
  }

  const color = colorForCategory(error.category)
  const validated = data.errors.get(selection.id)

  return (
    <aside className="detail" style={{ borderColor: MARK_COLOR_VALUE[color] }}>
      <header className="detail-head" style={{ background: MARK_BG_VALUE[color] }}>
        <span className="detail-kind" style={{ color: MARK_COLOR_VALUE[color] }}>
          {CATEGORY_LABEL[error.category]}
        </span>
        <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      <dl className="detail-list">
        {error.anchor && error.anchor.snippet && (
          <>
            <dt>要改的是（最小范围）</dt>
            <dd className="detail-text">{error.anchor.snippet}</dd>
          </>
        )}
        {error.changed?.to && (
          <>
            <dt>{error.type === 'rewrite' ? '整句改为' : '改成'}</dt>
            <dd className="detail-text">{error.changed.to}</dd>
          </>
        )}
        {!error.changed && error.anchor && (
          <>
            <dt>原文</dt>
            <dd className="detail-text">{error.anchor.snippet}</dd>
          </>
        )}
        {error.type === 'insert' && error.targetText && !error.changed?.to && (
          <>
            <dt>需补入</dt>
            <dd className="detail-text">{error.targetText}</dd>
          </>
        )}
        {error.type !== 'reorder' && error.targetText && !error.changed?.to && (
          <>
            <dt>正确写法</dt>
            <dd className="detail-text">{error.targetText}</dd>
          </>
        )}
        {error.type === 'rewrite' && error.targetText && (
          <>
            <dt>完整改后文字</dt>
            <dd className="detail-text">{error.targetText}</dd>
          </>
        )}
        {error.type === 'reorder' && validated?.reordered && (
          <>
            <dt>调序后</dt>
            <dd className="detail-text">
              {validated.reordered}
              <span className="hint">（仅为被调换的片段本身，整句请结合上下文中读）</span>
            </dd>
          </>
        )}
        <dt>说明</dt>
        <dd className="detail-body">{error.explanation}</dd>
      </dl>
    </aside>
  )
}
