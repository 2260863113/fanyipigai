/**
 * 「一句原译 / 一句改后」这两行的渲染。
 *
 * 为什么单独一个组件：**两份数据、同一个渲染形状**——
 *   - 精修档由 `buildCompareLines`（每处错误所在的那一句）算出来；
 *   - 大改档由 `buildRefineLines`（AI 重写过的那一句）算出来。
 * 两边的排版、颜色、点击行为必须一模一样，否则"对照视图"在两种档位下会长得不一样。
 *
 * 两行的分工（来自实际使用要求）：
 *   - **原文那一行**：被改过的那一段加**荧光底色 + 同色文字**——荧光只出现在原译文上；
 *   - **修改后的那一行**：只给文字上色，不加底色（那是"改成了什么"，不是被改内容）。
 * 点两行里任意一段都能在右下角看到那一处的说明；颜色沿用同一套
 * （红＝硬性错误、橙＝表达问题、绿＝表达优秀）。大改档一律橙色——它不分类。
 */

import type { JSX } from 'react'
import type { CompareLine, CompareSpan } from '../domain/compare'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import type { Selection } from './annotation-summary'
import { withCircledBreaks } from './explain-lines'

export function CompareLines({
  lines,
  selection,
  onSelect,
}: {
  lines: readonly CompareLine[]
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
}): JSX.Element {
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
          {/*
            大改档的逐句解释（用户要求"每一句都给出修改的解释"）。
            直接印在那一对的下面，而不是藏在点击里：一次性读完才知道他为什么这么改。

            ⚠️ 解释**按分号断行、每行带一个圈号**（用户要求："大改模式下，解释部分也要按照
            分号进行圈一圈二的序号标注分行"）。判据与小卡片那份是同一个
            （见 explain-lines.tsx）——不然同一段说明在小卡片里是①②③、在这里又是一整段。
          */}
          {line.note !== undefined && <p className="compare-note">{withCircledBreaks(line.note)}</p>}
        </li>
      ))}
    </ol>
  )
}
