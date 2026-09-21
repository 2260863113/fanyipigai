/**
 * 「提交批改」之后立刻弹出的**等待提示**（用户指定）。
 *
 * 用户原话：「点击提交批改后，弹出窗口"批改大约需要一分钟，等待过程中，可进入下一页"，
 * 下面有两个按钮"停留此页""进入下一页"」。
 *
 * 它存在的理由，是逐页批改改版后的那条新规矩——**翻页不再自动提交、也不再拦住人**：
 * 一页交出去之后，用户完全可以翻到下一页接着译，批完再回来。
 * 既然如此就得有人把这件事说清楚，否则他只会盯着那十来秒的进度条干等。
 * 因此两个按钮都不是"取消"，而是"我留在这儿"与"我去下一页"；关掉弹窗（点空白处）
 * 与「停留此页」是同一件事。
 *
 * ⚠️ **只在还有下一页时弹**（判断在 App 里，见 `canGoNext`）：
 * 单页题（句子/段落/术语/自己贴的短题）与整篇的最后一页后面都没有"下一页"可去，
 * 弹出来只有一颗"知道了"能按——那不是提示，是打扰。
 */

import type { JSX } from 'react'
import { Modal } from './Modal'

export function JudgeWaitingModal({
  onStay,
  onNext,
}: {
  /** 留在这一页：收起弹窗，批改照旧在跑 */
  onStay: () => void
  /** 去下一页继续翻译：收起弹窗并翻页（批改照旧在跑，批完会在右下角通知） */
  onNext: () => void
}): JSX.Element {
  return (
    <Modal
      title="已交去批改"
      note="大约需要一分钟"
      onClose={onStay}
      footer={
        <>
          <button type="button" className="btn" onClick={onStay}>
            停留此页
          </button>
          <button type="button" className="btn btn-primary" onClick={onNext}>
            进入下一页
          </button>
        </>
      }
    >
      <p className="hint">
        批改大约需要一分钟。等待过程中可进入下一页继续翻译，这一页的草稿与批改都不会丢；
        批完会在右下角通知你，点一下就能回到这一页看结果。
      </p>
    </Modal>
  )
}
