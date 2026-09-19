/**
 * 设置弹窗：行距、译文默认视图、是否显示填补的文字。
 *
 * 纯界面偏好，存在这台浏览器上（见 settings.ts），不影响批改结果。
 */

import type { JSX } from 'react'
import { Modal } from './Modal'
import { LINE_HEIGHT_RANGE, type ViewSettings } from './settings'

export function SettingsModal({
  settings,
  update,
  onClose,
}: {
  settings: ViewSettings
  update: (patch: Partial<ViewSettings>) => void
  onClose: () => void
}): JSX.Element {
  return (
    <Modal
      title="设置"
      note="只影响显示，不影响批改结果；存在这台浏览器上"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          完成
        </button>
      }
    >
      <p className="gen-label">正文行距（{settings.lineHeight.toFixed(1)}）</p>
      <input
        className="gen-range"
        type="range"
        min={LINE_HEIGHT_RANGE.min}
        max={LINE_HEIGHT_RANGE.max}
        step={LINE_HEIGHT_RANGE.step}
        value={settings.lineHeight}
        onChange={(event) => update({ lineHeight: Number(event.target.value) })}
      />
      <p className="hint">行距越大，勾画上方的方框越不容易跟上一行挤在一起。</p>

      <p className="gen-label">译文视图</p>
      <div className="gen-chips">
        <button
          type="button"
          className={settings.answerView === 'correct' ? 'gen-chip gen-chip-active' : 'gen-chip'}
          onClick={() => update({ answerView: 'correct' })}
        >
          批改视图（在译文上勾画）
        </button>
        <button
          type="button"
          className={settings.answerView === 'compare' ? 'gen-chip gen-chip-active' : 'gen-chip'}
          onClick={() => update({ answerView: 'compare' })}
        >
          对照视图（一句一句对照）
        </button>
      </div>

      <p className="gen-label">填补的文字</p>
      <label className="gen-check">
        <input
          type="checkbox"
          checked={settings.showFixBoxes}
          onChange={(event) => update({ showFixBoxes: event.target.checked })}
        />
        显示填补的正确写法（关掉后只留荧光笔底色与调序弧线）
      </label>
    </Modal>
  )
}
