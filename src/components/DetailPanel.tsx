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
  /**
   * 「收藏」：把这一处连同改前/改后/原因存起来（见 domain/favorites.ts）。
   * 不传就不显示这个按钮——记录页里没有当前题目上下文时就是这样。
   */
  onToggleFavorite?: () => void
  /** 这一处是否已经在收藏里（按钮文案跟着变） */
  favorited?: boolean
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
export function DetailPanel({ selection, validated, answer, onClose, embedded, onToggleFavorite, favorited }: Props) {
  const summary = summarize(validated, answer, selection)

  if (!summary) {
    /*
     * 没选中任何一处时，这一栏**什么也不说**（用户明确要去掉那段"点右上角译文里……"的说明）。
     * 空着比写一段谁都不会读的用法提示更清爽：译文上那些标记本身就是入口。
     */
    return <aside className={embedded ? 'detail detail-idle detail-embedded' : 'detail detail-idle'} />
  }

  const color = MARK_COLOR_VALUE[summary.color]

  return (
    /*
     * `data-card="detail"` 是**"点这里不算点外面"的标记**：AnnotationText 的文档级点击处理
     * 只放行带 `data-card` 的地方（另一处是小卡片自己的 `data-card="bubble"`）。
     *
     * ⚠️ 早先放的是一张类名清单（`.detail-head` / `.detail-actions`），于是点到这张卡片的
     * **正文**（改前 / 改后 / 说明那几行）就把它关掉了——用户报的正是这个："点击任意卡片
     * 都不会关掉这两个卡片，当且仅当点击这两个卡片之外的地方才消失"。
     * 现在是"整张卡片"一个标记，卡片里加了什么新东西都不会再漏。
     */
    <aside
      className={embedded ? 'detail detail-embedded' : 'detail'}
      data-card="detail"
      style={{ borderColor: color }}
    >
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

      {onToggleFavorite && (
        <footer className="detail-foot detail-actions">
          <button
            type="button"
            className={favorited ? 'btn btn-primary' : 'btn'}
            onClick={onToggleFavorite}
            title={
              favorited
                ? '这一处已经在收藏里了；再点一次就取消收藏'
                : '把这一处连同改前/改后/为什么存进收藏，以后在顶栏的「收藏」里看'
            }
          >
            {favorited ? '已收藏' : '收藏'}
          </button>
          <span className="hint">存的是这一处所在的整句，方便以后复习</span>
        </footer>
      )}
    </aside>
  )
}