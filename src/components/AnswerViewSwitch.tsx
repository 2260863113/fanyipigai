/**
 * 「批改视图 / 对照视图」分段按钮。
 *
 * 两个地方都要它：练习页的「我的译文」（见 AnswerPane.tsx）与练习记录页的「当时的译文」
 * （见 RecordsView.tsx，用户要求"练习记录，译文部分也要支持不同视图的分段按钮"）。
 * 抽成一个组件而不是各写一遍：两颗按钮的文案、标签、title 只要有一处不同，
 * 两个页面里的"同一个开关"就会长得不一样，用户会以为是两件事。
 *
 * 它只负责**显示与切换**，不持有状态——用的是设置里那一个 `answerView`
 * （存在浏览器里），因此在练习页切过之后，练习记录页打开就是同一个视图。
 */

import type { JSX } from 'react'
import type { ViewSettings } from './settings'

export function AnswerViewSwitch({
  view,
  onChange,
}: {
  view: ViewSettings['answerView']
  onChange: (patch: Partial<ViewSettings>) => void
}): JSX.Element {
  return (
    <div className="view-switch" role="group" aria-label="译文视图">
      <button
        type="button"
        className={view === 'correct' ? 'view-btn view-btn-active' : 'view-btn'}
        onClick={() => onChange({ answerView: 'correct' })}
        title="在译文上勾画：划线、方框、调序弧线"
      >
        批改视图
      </button>
      <button
        type="button"
        className={view === 'compare' ? 'view-btn view-btn-active' : 'view-btn'}
        onClick={() => onChange({ answerView: 'compare' })}
        title="一句一句对照：每句下方给出修改后的完整那句，不划线不填补"
      >
        对照视图
      </button>
    </div>
  )
}
