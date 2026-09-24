/**
 * 术语栏的**范围控件**：标题栏里那颗按钮 + 点开之后那个**两屏的弹窗**。
 *
 * ## 为什么是弹窗而不是下拉
 *
 * 文章栏的「领域」是一个下拉（`DomainSelect`），挑一下就换题。术语栏这里用户要的是
 * 另一个形状（第 13 轮原话："点击该按钮，弹出窗口，用户可以选择范围……
 * 点击相应卡片后，进入新卡片，可以一次性看到题目内容，用户可以根据文章内容，点击确定和返回"）。
 * 因此做成**两屏**：
 *   1. **两张范围卡片**（国内机关名称 / 国际机关名称），每张写清"多少条 · 共几页"；
 *   2. 点一张卡片 → 换成**一张大卡片**：范围名 + 条数页数 + 一张可滚动的**中英对照平表**，
 *      底部两颗按钮「确定」（切到该范围、**一律落到第 1 页**）与「返回」（退回两张卡片）。
 *
 * ## 对照表就是把答案摊开——这是用户拍板要的
 *
 * 这张表里中文与英文并排，等于是答案表。用户对这一点的答复是"中英文都列出来（等于一份对照表）"，
 * 并且练习中点「范围」**也照样能重新打开它**（当参考资料用）。
 * 因此这里不做任何遮蔽：列全、可滚、按材料原顺序（不分章节——用户拍板"丢掉小标题，只要两列"）。
 *
 * ## 为什么按钮上的字是「范围」
 *
 * 全站的「领域」已经专指社会／经济／文化／生态／科技那五个板块（话题领域）。
 * 术语栏这张表是**另一张平行的封闭表**（术语范围），按钮就写「范围」，
 * 免得同一个词指两个东西（见 domain/term-scopes.ts 与 CONTEXT.md）。
 */

import { useState, type JSX } from 'react'
import { Modal } from './Modal'
import { TERMS_PER_PAGE, termPageCount, termsOfScope } from '../domain/terms'
import { TERM_SCOPES, labelOfScope, type TermScope } from '../domain/term-scopes'

/** 一个范围在弹窗里要显示的几个数：条数、页数、末页几条。 */
function factsOf(scope: TermScope): { count: number; pages: number; last: number } {
  const count = termsOfScope(scope).length
  return { count, pages: termPageCount(scope), last: count % TERMS_PER_PAGE || TERMS_PER_PAGE }
}

export function TermScopeSelect({
  scope,
  onPick,
}: {
  /** 当前正在练的范围 */
  scope: TermScope
  /** 按「确定」时回调；调用方负责换题并落到第 1 页 */
  onPick: (scope: TermScope) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  /** 正在看哪一个范围的详情；null 表示停在"两张卡片"那一屏 */
  const [preview, setPreview] = useState<TermScope | null>(null)

  function close(): void {
    setOpen(false)
    // 关掉时退回第一屏：下次点开总是从"两张范围卡片"开始，不会停在半路
    setPreview(null)
  }

  const detail = preview ? factsOf(preview) : null
  const detailTerms = preview ? termsOfScope(preview) : []

  return (
    <div className="domain-select">
      <button
        type="button"
        className="domain-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="选择术语范围；每个范围按每页五条出题"
      >
        <span className="domain-trigger-label">范围</span>
        <span className="domain-trigger-value">{labelOfScope(scope)}</span>
        <span className="domain-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && preview === null && (
        <Modal title="选择范围" note="术语题按范围出题，每页五条" onClose={close} footer={<button type="button" className="btn" onClick={close}>关闭</button>}>
          <ul className="scope-cards">
            {TERM_SCOPES.map((item) => {
              const facts = factsOf(item.id)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === scope ? 'scope-card scope-card-active' : 'scope-card'}
                    onClick={() => setPreview(item.id)}
                    title="点开看这个范围的全部条目（中英对照），再决定要不要开始练"
                  >
                    <span className="scope-card-title">{item.label}</span>
                    <span className="scope-card-meta">
                      {facts.count} 条 · 共 {facts.pages} 页（每页 {TERMS_PER_PAGE} 条，末页 {facts.last} 条）
                      {item.id === scope && <span className="scope-card-now">正在练</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Modal>
      )}

      {open && preview !== null && detail && (
        <Modal
          title={labelOfScope(preview)}
          note={`${detail.count} 条 · 共 ${detail.pages} 页`}
          onClose={close}
          footer={
            <>
              {/* 「返回」= 退回两张范围卡片（用户点名的两颗按钮之一） */}
              <button type="button" className="btn" onClick={() => setPreview(null)}>
                返回
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onPick(preview)
                  close()
                }}
              >
                确定
              </button>
            </>
          }
        >
          <div className="scope-table-wrap" data-scope-table={preview}>
            <table className="scope-table">
              <thead>
                <tr>
                  <th scope="col">中文名称</th>
                  <th scope="col">官方英文名称</th>
                </tr>
              </thead>
              <tbody>
                {detailTerms.map((term, index) => (
                  <tr key={`${term.zh}-${index}`}>
                    <td>{term.zh}</td>
                    <td>{term.en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  )
}
