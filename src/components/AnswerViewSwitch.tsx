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
 *
 * ## 精修档：`locked` 时保留但禁用
 *
 * 精修档的产物是"整篇逐句重写"，改动遍布每一句——再画勾画只会糊成一片
 * （用户原话："修改的太多了屏幕太花了"），因此**精修只能看对照**。
 * 这里按用户选的做法处理：**开关保留但禁用**，并在旁边注明为什么，
 * 而不是把它藏起来——藏起来用户会以为设置丢了。
 */

import type { JSX } from 'react'
import type { ViewSettings } from './settings'

export function AnswerViewSwitch({
  view,
  onChange,
  locked = false,
}: {
  view: ViewSettings['answerView']
  onChange: (patch: Partial<ViewSettings>) => void
  /** 精修档：锁在对照视图上（见文件头） */
  locked?: boolean
}): JSX.Element {
  return (
    <div className="view-switch" role="group" aria-label="译文视图">
      <button
        type="button"
        className={view === 'correct' && !locked ? 'view-btn view-btn-active' : 'view-btn'}
        onClick={() => onChange({ answerView: 'correct' })}
        disabled={locked}
        title={locked ? '精修档只能看对照视图：改写遍布每一句，勾画会糊成一片' : '在译文上勾画：划线、方框、调序弧线'}
      >
        批改视图
      </button>
      <button
        type="button"
        className={view === 'compare' || locked ? 'view-btn view-btn-active' : 'view-btn'}
        onClick={() => onChange({ answerView: 'compare' })}
        disabled={locked}
        title={locked ? '精修档固定看这一种' : '一句一句对照：每句下方给出修改后的完整那句，不划线不填补'}
      >
        对照视图
      </button>
    </div>
  )
}
