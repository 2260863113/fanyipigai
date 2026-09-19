import type { ValidatedCorrection } from '../domain/validate'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import { summarize, type Selection } from './annotation-summary'

interface Props {
  selection: Selection | null
  validated: ValidatedCorrection
  answer: string
  onClose: () => void
  /** 直接铺在右下栏里（练习页）而不是贴在栏底（记录页）时，去掉外边距 */
  embedded?: boolean
}

/**
 * **一处**批注的完整说明。
 *
 * 这里只显示当前选中的那一处——不做全量清单。
 * 理由：批注是长在译文上的，用户的眼睛已经在译文上；把同样的内容再排一遍清单，
 * 只会让人在两处之间来回找。译文那边点哪一处，这里就换哪一处。
 *
 * 「查看 AI 返回完整内容」不在这里，而在右下角标题栏的右侧（见 RawResponseButton）：
 * 那是整份批改的元信息，不属于某一条批注。
 */
export function DetailPanel({ selection, validated, answer, onClose, embedded }: Props) {
  const summary = summarize(validated, answer, selection)

  if (!summary) {
    return (
      <aside className={embedded ? 'detail detail-idle detail-embedded' : 'detail detail-idle'}>
        <p className="hint">
          点右上角译文里的任意一处勾画——勾了底色的词、上方的小字、插入标记、调序弧线——这里只显示那一处的说明。
        </p>
      </aside>
    )
  }

  const color = MARK_COLOR_VALUE[summary.color]

  return (
    <aside className={embedded ? 'detail detail-embedded' : 'detail'} style={{ borderColor: color }}>
      <header className="detail-head" style={{ background: MARK_BG_VALUE[summary.color] }}>
        <span className="detail-kind" style={{ color }}>
          {summary.typeLabel} · {summary.categoryLabel}
        </span>
        <span className="detail-order">第 {summary.order} 处</span>
        <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      <dl className="detail-list">
        {summary.from && (
          <>
            <dt>{summary.fromLabel}</dt>
            <dd className="detail-text">{summary.from}</dd>
          </>
        )}
        {summary.to && (
          <>
            <dt>{summary.toLabel}</dt>
            <dd className="detail-text">{summary.to}</dd>
          </>
        )}
        <dt>说明</dt>
        <dd className="detail-body">{summary.why}</dd>
      </dl>
    </aside>
  )
}