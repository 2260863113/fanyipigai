/**
 * AI 出题弹窗：选「领域（也可自己输入）+ 文体 + 方向」，现出一篇同规格的题。
 *
 * 生成结果按题目留存（见 domain/generate.ts 与 App 的 generatedApplied 动作），
 * 之后用「换一换」还能翻回来接着练。
 *
 * 生成中（busy）时整个弹窗不可关、控件不可点：半路把请求丢下没有意义。
 */

import type { Direction, Genre, Mode } from '../domain/types'
import { DIRECTION_LABEL, GENRE_LABEL, UNIT_LABEL } from '../domain/types'
import { GENERATION_TOPICS, LENGTH_RULE } from '../domain/generate'
import { Modal } from './Modal'
import type { JSX } from 'react'

export function GenerateModal({
  direction,
  genre,
  topic,
  busy,
  error,
  mode,
  onDirectionChange,
  onGenreChange,
  onTopicChange,
  onClose,
  onGenerate,
}: {
  direction: Direction
  genre: Genre
  topic: string
  busy: boolean
  error: string | null
  /** 当前题型：决定"全文直接用"还是"从全文里截取" */
  mode: Mode
  onDirectionChange: (direction: Direction) => void
  onGenreChange: (genre: Genre) => void
  onTopicChange: (topic: string) => void
  onClose: () => void
  onGenerate: () => void
}): JSX.Element {
  return (
    <Modal
      title="AI 出题"
      note="生成后会留存，可用「换一换」翻回来"
      onClose={onClose}
      closable={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onGenerate}
            disabled={busy || topic.trim().length === 0}
          >
            {busy ? '正在出题…（通常十几秒）' : '生成题目'}
          </button>
        </>
      }
    >
      <p className="gen-label">方向</p>
      <div className="gen-chips">
        {(Object.keys(DIRECTION_LABEL) as Direction[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === direction ? 'gen-chip gen-chip-active' : 'gen-chip'}
            onClick={() => onDirectionChange(key)}
            disabled={busy}
          >
            {DIRECTION_LABEL[key]}
          </button>
        ))}
      </div>

      <p className="gen-label">文体</p>
      <div className="gen-chips">
        {(Object.keys(GENRE_LABEL) as Genre[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === genre ? 'gen-chip gen-chip-active' : 'gen-chip'}
            onClick={() => onGenreChange(key)}
            disabled={busy}
          >
            {GENRE_LABEL[key]}
          </button>
        ))}
      </div>

      <p className="gen-label">领域</p>
      <div className="gen-chips">
        {GENERATION_TOPICS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === topic ? 'gen-chip gen-chip-active' : 'gen-chip'}
            onClick={() => onTopicChange(item)}
            disabled={busy}
          >
            {item}
          </button>
        ))}
      </div>
      <input
        className="gen-input"
        value={topic}
        onChange={(event) => onTopicChange(event.target.value)}
        placeholder="也可以自己输入领域，例如：低碳转型"
        disabled={busy}
        spellCheck={false}
      />

      <p className="hint">
        篇幅要求：{LENGTH_RULE[direction].min}-{LENGTH_RULE[direction].max} {LENGTH_RULE[direction].unit}
        （程序会硬校验，不达标会自动退回重写）。
        {mode === 'article' ? '文章题直接用全文。' : `当前是${UNIT_LABEL[mode]}题，会从全文里截取对应大小。`}
      </p>
      {error ? <p className="hint gen-error">{error}</p> : null}
    </Modal>
  )
}
