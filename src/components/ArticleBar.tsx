/**
 * 「文章库」那一行：左领域下拉 · 中方向切换 · 右设置。
 *
 * 它取代了原来的「题目切换条」——那条是**一排按钮**，题目一多就横着铺不完，
 * 每一道还各占一个按钮。现在改成两个控件：
 *   - 领域：点开是一张下拉列表（八个赛制主题域），选完就在这一格内练；
 *   - 方向：中译英 / 英译中 两段切换，决定你看到的是哪三篇文章。
 *
 * 方向那一段是**可禁用的**：某个领域在某个方向下还没有文章时，那一侧点不动，
 * 点进去看到空白比"按钮是灰的"更让人困惑。
 *
 * 选文章本身放在弹窗里（ArticlePickerModal），不在这一行——一排卡片塞不下，
 * 也会把这一行撑高。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { ARTICLE_DOMAINS, hasArticles, labelOfDomain, type ArticleDomain } from '../domain/articles'
import { DIRECTION_LABEL, type Direction } from '../domain/types'

/** 文章库里选定的一格。 */
export interface ArticleSelection {
  domain: ArticleDomain
  direction: Direction
}

export function ArticleBar({
  selection,
  onChange,
  onPickArticle,
}: {
  selection: ArticleSelection
  onChange: (next: ArticleSelection) => void
  onPickArticle: () => void
}): JSX.Element {
  const [domainOpen, setDomainOpen] = useState(false)
  const domainRef = useRef<HTMLDivElement | null>(null)

  // 点外面就收起下拉（与批注气泡同一套做法）
  useEffect(() => {
    if (!domainOpen) return
    const onDocumentClick = (event: MouseEvent): void => {
      if (event.target instanceof Node && domainRef.current?.contains(event.target)) return
      setDomainOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDomainOpen(false)
    }
    document.addEventListener('click', onDocumentClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [domainOpen])

  const directions: Direction[] = ['zh-to-en', 'en-to-zh']

  return (
    <div className="article-bar">
      <div className="domain-select" ref={domainRef}>
        <button
          type="button"
          className="domain-trigger"
          onClick={() => setDomainOpen((open) => !open)}
          aria-haspopup="listbox"
          aria-expanded={domainOpen}
          title="选择主题领域；词库按赛制的八个主题域组织"
        >
          <span className="domain-trigger-label">领域</span>
          <span className="domain-trigger-value">{labelOfDomain(selection.domain)}</span>
          <span className="domain-trigger-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {domainOpen && (
          <ul className="domain-menu" role="listbox" aria-label="领域">
            {ARTICLE_DOMAINS.map((domain) => {
              // 这一格在**当前方向**下有没有文章；没有也允许选（切过去看另一方向），但不做假承诺
              const available = hasArticles(domain.id, selection.direction)
              return (
                <li key={domain.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={domain.id === selection.domain}
                    className={
                      domain.id === selection.domain ? 'domain-item domain-item-active' : 'domain-item'
                    }
                    onClick={() => {
                      onChange({ ...selection, domain: domain.id })
                      setDomainOpen(false)
                    }}
                  >
                    {domain.label}
                    {!available && <span className="domain-item-note">（此方向暂无文章）</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="dir-switch" role="group" aria-label="翻译方向">
        {directions.map((direction) => {
          const available = hasArticles(selection.domain, direction)
          return (
            <button
              key={direction}
              type="button"
              className={direction === selection.direction ? 'dir-btn dir-btn-active' : 'dir-btn'}
              onClick={() => onChange({ ...selection, direction })}
              disabled={!available}
              title={available ? undefined : '这个领域暂时没有该方向的文章'}
            >
              {DIRECTION_LABEL[direction]}
            </button>
          )
        })}
      </div>

      <div className="article-bar-right">
        <button type="button" className="btn btn-primary" onClick={onPickArticle}>
          选择文章
        </button>
      </div>
    </div>
  )
}
