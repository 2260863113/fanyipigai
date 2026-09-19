/**
 * 弹窗外壳。
 *
 * 为什么单独抽出来：设置、贴题、AI 出题三个弹窗原先各自手抄了一遍同样的结构
 * （backdrop + dialog + head + note + 关闭按钮 + body + foot），
 * 三份的细节还不一致——关闭时要不要拦（`genBusy` 期间不能关）、
 * 关闭按钮要不要 disable，都是各写各的。这类"同构但逐字重抄"的代码，
 * 改一处漏两处只是时间问题。
 *
 * 结构固定为：`.raw-modal-backdrop > .raw-modal.gen-modal > head / body / foot`。
 * 调用方只提供标题、副标题、正文、底部按钮，以及"点了外面/点了关闭"时做什么。
 */

import type { JSX, ReactNode } from 'react'

export function Modal({
  title,
  note,
  onClose,
  /** 关不掉的场景：AI 出题正在跑的时候不许关，免得把请求丢在半路 */
  closable = true,
  children,
  footer,
}: {
  title: string
  /** 标题右侧的一句小字说明 */
  note?: string
  onClose: () => void
  closable?: boolean
  children: ReactNode
  footer?: ReactNode
}): JSX.Element {
  const requestClose = (): void => {
    if (closable) onClose()
  }

  return (
    <div className="raw-modal-backdrop" onClick={requestClose} role="presentation">
      <div
        className="raw-modal gen-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // 点弹窗内部不该关掉它——事件冒泡到 backdrop 就会触发 onClick
        onClick={(event) => event.stopPropagation()}
      >
        <header className="raw-modal-head">
          <span>{title}</span>
          {note ? <span className="raw-modal-note">{note}</span> : null}
          <button
            type="button"
            className="raw-modal-close"
            onClick={onClose}
            disabled={!closable}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="gen-body">{children}</div>

        {footer ? <footer className="gen-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}
