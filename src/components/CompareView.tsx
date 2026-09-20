import { useMemo } from 'react'
import type { ValidatedCorrection } from '../domain/validate'
import { buildCompareLines, type CompareSpan } from '../domain/compare'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import type { Selection } from './annotation-summary'

/**
 * 对照视图：一句一句地对照「原文 / 修改后的完整那句」。
 *
 * 两行的分工（来自实际使用要求）：
 *   - **原文那一行**：被改过的那一段加**荧光底色 + 同色文字**——荧光只出现在原译文上；
 *   - **修改后的那一行**：只给文字上色，不加底色（那是"改成了什么"，不是被改内容）。
 * 点两行里任意一段都能在右下角看到那一处的说明；颜色沿用同一套
 * （红＝硬性错误、橙＝表达问题、绿＝表达优秀）。
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

  /** 点某一段 → 选中这一处（改动或亮点） */
  const select = (part: CompareSpan): void => {
    onSelect(
      part.highlightId
        ? { kind: 'highlight', id: part.highlightId }
        : part.errorId
          ? { kind: 'error', id: part.errorId }
          : null,
    )
  }

  const markProps = (part: CompareSpan) => ({
    title: '点击查看这一处的说明',
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => select(part),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      select(part)
    },
    'data-selected':
      (part.errorId && selection?.id === part.errorId) || (part.highlightId && selection?.id === part.highlightId)
        ? 'true'
        : undefined,
  })

  return (
    <ol className="compare-list">
      {lines.map((line, index) => (
        <li className={line.changed ? 'compare-line' : 'compare-line compare-line-same'} key={`line-${index}`}>
          {/*
            两句一组、上下交替（用户要求："一句译文，一句修改后译文交替排版，一句话占一行"）。
            行首给一个小标签，一眼分得清这一行是"你写的"还是"改成什么"。
            两行都允许在内部自动折行（长句子不会被截断、也不会横向溢出）。
          */}
          <p className="compare-original">
            <span className="compare-label">原译</span>
            {line.originalSpans.map((part, partIndex) =>
              part.color ? (
                <span
                  key={`orig-${partIndex}`}
                  className="compare-mark compare-mark-original"
                  style={{ color: MARK_COLOR_VALUE[part.color], background: MARK_BG_VALUE[part.color] }}
                  {...markProps(part)}
                >
                  {part.text}
                </span>
              ) : (
                <span key={`orig-${partIndex}`}>{part.text}</span>
              ),
            )}
          </p>
          <p className="compare-corrected">
            <span className="compare-label compare-label-after">改后</span>
            {line.corrected.map((part, partIndex) =>
              part.color ? (
                <span
                  key={`part-${partIndex}`}
                  className="compare-mark"
                  style={{ color: MARK_COLOR_VALUE[part.color] }}
                  {...markProps(part)}
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
