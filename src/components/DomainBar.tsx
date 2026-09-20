/**
 * 「句子」栏那一行：只要一个领域下拉，加一个「换一句」。
 *
 * 为什么不像文章栏那样给「选文章」与「方向」：
 *   用户的要求就是句子题**只能选领域、不能选文章**——题目从该领域的文章里自动切句；
 *   方向也不必人来选，一条句子是中文就练中译英、是英文就练英译中
 *   （领域里两个方向的句子都有）。
 *
 * 领域与文章栏共用同一份选择（articleSelection）：领域在整站只有一个含义，
 * 让人在两个栏里各选一次是多余的。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { ARTICLE_DOMAINS, labelOfDomain, type ArticleDomain } from '../domain/articles'

export function DomainBar({
  domain,
  onChange,
  onNext,
}: {
  domain: ArticleDomain
  onChange: (domain: ArticleDomain) => void
  /** 换一句：在该领域的句子里往下走一条 */
  onNext: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // 点外面就收起下拉（与文章栏同一套做法）
  useEffect(() => {
    if (!open) return
    const onDocumentClick = (event: MouseEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onDocumentClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="article-bar">
      <div className="domain-select" ref={ref}>
        <button
          type="button"
          className="domain-trigger"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="选择主题领域；句子从该领域的文章里自动挑选"
        >
          <span className="domain-trigger-label">领域</span>
          <span className="domain-trigger-value">{labelOfDomain(domain)}</span>
          <span className="domain-trigger-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <ul className="domain-menu" role="listbox" aria-label="领域">
            {ARTICLE_DOMAINS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === domain}
                  className={item.id === domain ? 'domain-item domain-item-active' : 'domain-item'}
                  onClick={() => {
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="article-bar-right">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNext}
          title="从该领域的文章里再挑一句"
        >
          换一句
        </button>
      </div>
    </div>
  )
}
