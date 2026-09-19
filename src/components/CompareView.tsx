import { useMemo } from 'react'
import type { ValidatedCorrection } from '../domain/validate'
import { buildCompareLines } from '../domain/compare'
import { MARK_COLOR_VALUE } from '../domain/color'
import type { Selection } from './annotation-summary'

/**
 * 对照视图：一句一句地对照「原文 / 修改后的完整那句」。
 *
 * 刻意**不勾底色、不填补**：勾画那套（荧光笔底色、方框、弧线）信息密度高，
 * 但读起来要跟着标记走；这一版反过来——先把每句完整读一遍，只有被改过的字染上颜色，
 * 颜色仍然沿用同一套（红＝硬性错误、橙＝表达问题、绿＝表达优秀）。
 * 点染色的字同样能在右下角看到那一处的说明。
 */
export function CompareView({
  validated,
  answer,
  selection,
  onSelect,
}: {
  validated: ValidatedCorrection
  answer: string
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
}) {
  const lines = useMemo(() => buildCompareLines(validated, answer), [validated, answer])

  if (lines.length === 0) return <p className="hint">提交批改后，这里会按句子给出「改前 / 改后」对照。</p>

  return (
    <ol className="compare-list">
      {lines.map((line, index) => (
        <li className={line.changed ? 'compare-line' : 'compare-line compare-line-same'} key={`line-${index}`}>
          <p className="compare-original">{line.original}</p>
          <p className="compare-corrected">
            {line.corrected.map((part, partIndex) =>
              part.color ? (
                <span
                  key={`part-${partIndex}`}
                  className="compare-mark"
                  style={{ color: MARK_COLOR_VALUE[part.color] }}
                  title="点击查看这一处的说明"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onSelect(
                      part.highlightId
                        ? { kind: 'highlight', id: part.highlightId }
                        : part.errorId
                          ? { kind: 'error', id: part.errorId }
                          : null,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onSelect(
                      part.highlightId
                        ? { kind: 'highlight', id: part.highlightId }
                        : part.errorId
                          ? { kind: 'error', id: part.errorId }
                          : null,
                    )
                  }}
                  data-selected={
                    (part.errorId && selection?.id === part.errorId) ||
                    (part.highlightId && selection?.id === part.highlightId)
                      ? 'true'
                      : undefined
                  }
                >
                  {part.text}
                </span>
              ) : (
                <span key={`part-${partIndex}`}>{part.text}</span>
              ),
            )}
          </p>
        </li>
      ))}
    </ol>
  )
}
