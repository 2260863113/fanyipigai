import { useEffect, useState } from 'react'

/**
 * 「点击查看 AI 返回完整内容」+ 屏幕中央的弹窗。
 *
 * 放在右下角**标题栏的右侧**：它是"这一整份批改"的元信息，
 * 不属于某一条批注，所以不能挂在某一处的详情卡片里。
 */
export function RawResponseButton({ raw }: { raw?: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!raw) return null

  return (
    <>
      <button type="button" className="raw-link" onClick={() => setOpen(true)}>
        点击查看 AI 返回完整内容
      </button>
      {open && (
        <div className="raw-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            className="raw-modal"
            role="dialog"
            aria-modal="true"
            aria-label="AI 返回完整内容"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="raw-modal-head">
              <span>AI 返回完整内容</span>
              <span className="raw-modal-note">未经解析、未经收窄的原文</span>
              <button type="button" className="raw-modal-close" onClick={() => setOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>
            <pre className="raw-modal-body">{raw}</pre>
          </div>
        </div>
      )}
    </>
  )
}