/**
 * 贴题弹窗：把自己找来的原文贴进来就能练，不用等我们出题。
 *
 * 只贴原文——方向按有没有汉字自动判断，题型按段落数/句数自动判断，参考译文留空。
 * 判断逻辑在 domain/custom.ts，这里只负责收文本与提示。
 */

import type { JSX } from 'react'
import { Modal } from './Modal'

export function PasteModal({
  text,
  error,
  onChange,
  onCancel,
  onApply,
}: {
  text: string
  error: string | null
  onChange: (text: string) => void
  onCancel: () => void
  onApply: () => void
}): JSX.Element {
  return (
    <Modal
      title="贴一篇自己的题"
      note="只贴原文就行；存在这台浏览器上，只留最新一篇"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onApply}
            disabled={text.trim().length < 2}
          >
            开始练习
          </button>
        </>
      }
    >
      <p className="gen-label">原文</p>
      <textarea
        className="answer-input gen-textarea"
        value={text}
        placeholder="把要翻译的原文整段贴在这里（中英都行；有空行就会按文章题分段处理）"
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="hint">
        方向与题型是自动判的：有汉字就按中译英，多个自然段按文章题（逐段作答）、
        两句以上按段落题、很短又没有标点按术语题，其余按句子题。
        篇长要求（英译汉 250–350 词那套）对自己贴的题不适用，多短都能练。
      </p>
      {error ? <p className="error-text">{error}</p> : null}
    </Modal>
  )
}
