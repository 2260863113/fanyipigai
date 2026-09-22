/**
 * 「领域」下拉与「方向」两段切换：这两个控件决定的是**练习范围**。
 *
 * ## 它们为什么会从一个组件文件变成另一个
 *
 * 早先这两个控件占着原文栏上方的一整条横条（`.article-bar`），
 * 用户第 7 条要求"将领域下拉栏挪到原文标题栏紧靠「原文」的右边"，
 * 第 10 条紧跟一句"整条删掉，方向切换也一起进原文标题栏"——
 * 于是那条横条没有了：领域与方向现在长在**原文标题栏**里，
 * 与「选择文章」「换一换」同一行，左边紧挨着「原文」三个字。
 * 文件因此也跟着改名（原名 ArticleBar 说的就是那条已经不存在的横条）。
 *
 * ## 为什么句子栏只给领域
 *
 * 句子题的题目是从该领域的文章里自动切出来的一句，方向由句子本身是中文还是英文决定，
 * 不需要人来选（见 sentence-exercise.ts）。因此 `DirectionSelect` 由调用方决定画不画。
 *
 * ## 术语题与"自己贴的题"没有这两个控件
 *
 * 术语库按题型供题、与领域无关；自己贴的题原文就是他贴的那一段。
 * 硬给它们一个领域下拉，点下去什么都不会变——那才是真让人困惑的东西。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { ARTICLE_DOMAINS, hasArticles, labelOfDomain, type ArticleDomain } from '../domain/articles'
import { DIRECTION_LABEL, type Direction } from '../domain/types'

/** 文章库里选定的一格（「领域 × 方向」）。 */
export interface ArticleSelection {
  domain: ArticleDomain
  direction: Direction
}

export function DomainSelect({
  selection,
  onChange,
}: {
  selection: ArticleSelection
  onChange: (next: ArticleSelection) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // 点外面就收起下拉（与批注气泡、批改记录下拉同一套做法）
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
    <div className="domain-select" ref={ref}>
      <button
        type="button"
        className="domain-trigger"
        onClick={() => setOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="选择主题领域；题目按赛制的主题域组织"
      >
        <span className="domain-trigger-label">领域</span>
        <span className="domain-trigger-value">{labelOfDomain(selection.domain)}</span>
        <span className="domain-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
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
                    setOpen(false)
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
  )
}

/**
 * 方向两段开关（中译英 / 英译中）。
 *
 * 某一段**可禁用**：某个领域在某个方向下还没有文章时，那一侧点不动，
 * 点进去看到空白比"按钮是灰的"更让人困惑。
 */
export function DirectionSelect({
  selection,
  onChange,
}: {
  selection: ArticleSelection
  onChange: (next: ArticleSelection) => void
}): JSX.Element {
  const directions: Direction[] = ['zh-to-en', 'en-to-zh']
  return (
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
  )
}
