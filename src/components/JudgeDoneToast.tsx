/**
 * 右下角的**批改完成通知**（用户指定）。
 *
 * 用户原话：「当批改结果出来时，右下角弹出信息通知"第x页已经批改完成"，
 * 用户可以点击该通知直接路由到那个页面，也可以手动翻页翻到前面。」
 *
 * 它是"翻页不再拦住人"这件事的另一半：既然允许用户交了就走，
 * 结果回来时必须有人喊住他——否则那一页批完了却没人知道，等于白花一次调用。
 *
 * 三件事刻意分开：
 *   - **点通知本身** → 跳到那一页（这是主操作，因此整块都可点，且是一颗真按钮）；
 *   - **点 ×** → 只是别挡着视线，跳不跳由用户自己决定（手动翻页过去看也一样）；
 *   - **人自己翻到那一页**时通知自动消失（在 App 的 setSection 里做）——
 *     已经站在那一页上了还挂着"点这里去看"就成了废话。
 *
 * 这一条通知**不落盘、不排队**：同时只可能有一次批改在跑（见 App 里 judgingTarget），
 * 因此也就只可能有一条通知，不需要一个队列。
 */

import type { JSX } from 'react'

export function JudgeDoneToast({
  pageNumber,
  onOpen,
  onDismiss,
}: {
  /** 第几页（1 起，与翻页导航里的"第 x / N 页"同一套数法） */
  pageNumber: number
  /** 跳到那一页看结果 */
  onOpen: () => void
  /** 只是关掉这条通知 */
  onDismiss: () => void
}): JSX.Element {
  return (
    <div className="judge-toast" role="status" aria-live="polite">
      <button
        type="button"
        className="judge-toast-main"
        onClick={onOpen}
        title={`跳到第 ${pageNumber} 页看这一次的批改结果`}
      >
        <strong>第 {pageNumber} 页已经批改完成</strong>
        <span className="judge-toast-hint">点这里去看结果</span>
      </button>
      <button type="button" className="judge-toast-close" onClick={onDismiss} aria-label="关闭通知">
        ×
      </button>
    </div>
  )
}
