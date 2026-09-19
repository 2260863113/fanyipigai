/**
 * 右下栏：批注详情。
 *
 * 只显示**当前点中的那一处**——批注是长在译文上的，用户的眼睛已经在译文上，
 * 把同样的内容再排一遍全量清单只会让人在两处之间来回找（见 DetailPanel 的说明）。
 *
 * 「查看 AI 返回完整内容」挂在这一栏的标题栏右侧：那是整份批改的元信息，
 * 不属于某一条批注，所以不放进 DetailPanel。
 */

import type { JSX } from 'react'
import { DetailPanel } from './DetailPanel'
import { RawResponseButton } from './RawResponseButton'
import type { Selection } from './AnnotationText'
import type { ShownCorrection } from './AnswerPane'

export function NotesPane({
  shown,
  selection,
  onSelect,
  /** 当前选中那一处的收藏内容；为 null 表示这一处不能收藏（例如不在结果里） */
  favorite,
  favorited,
  onToggleFavorite,
}: {
  shown: ShownCorrection | null
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
  favorite: { id: string } | null
  favorited: boolean
  onToggleFavorite: () => void
}): JSX.Element {
  return (
    <section className="pane pane-notes">
      <header className="pane-head">
        <h2>批注详情</h2>
        <div className="head-meta">
          {shown && (
            <span className="chip">
              共 {shown.validated.errors.length} 处错误
              {shown.validated.highlights.length > 0 && ` · ${shown.validated.highlights.length} 处优秀`}
            </span>
          )}
          {shown && <RawResponseButton raw={shown.raw} />}
        </div>
      </header>
      <div className="pane-body">
        {shown ? (
          <DetailPanel
            selection={selection}
            validated={shown.validated}
            answer={shown.answer}
            onClose={() => onSelect(null)}
            embedded
            {...(favorite
              ? { onToggleFavorite, favorited }
              : null)}
          />
        ) : (
          <p className="hint">提交批改后，点译文上的任意一处勾画，这里显示那一处的说明。</p>
        )}
      </div>
    </section>
  )
}
