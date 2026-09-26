/**
 * 对照视图的渲染：**一行一句**，上中下排开。
 *
 * 为什么单独一个组件：**两份数据、同一个渲染形状**——
 *   - 精修档由 `buildCompareLines`（每处错误所在的那一句）算出来；
 *   - 大改档由 `buildRefineLines`（AI 重写过的那一句）算出来。
 * 两边的排版、颜色、点击行为必须一模一样，否则"对照视图"在两种档位下会长得不一样。
 *
 * ⚠️ **大改档多一行"原文"**（第 4 条，用户原话："按照一句原文，一句用户译文，一句修改译文这样排版"）：
 * `line.source` 有值就多排一行在最上面。精修档的每一行没有这个字段，因此它的排版一个字都没变
 * ——用户特意交代过"批改视图不受影响"。
 *
 * 各行的分工（来自实际使用要求）：
 *   - **我的译文那一行**：被改过的那一段加**荧光底色 + 同色文字**——荧光只出现在学生写的那一行；
 *   - **修改后的那一行**：只给文字上色，不加底色（那是"改成了什么"，不是被改内容）；
 *   - **原文那一行**：不加任何颜色（它是题目给的文字，不是谁的错）。
 * 点译文/改后两行里任意一段都能在右下角看到那一处的说明；颜色沿用同一套
 * （红＝硬性错误、橙＝表达问题、绿＝表达优秀）。大改档一律橙色——它不分类。
 *
 * 行首标签**可以换**（`labels`）：大改档用「原文 / 我的译文 / 修改译文」，
 * 精修档沿用「原译 / 改后」。判据只有一处，两个档位不会各说各话。
 *
 * ⚠️ 第 17 条第 5 条：大改档每句**原文后面**多一颗「收藏」（`sentenceFavorite`），
 * 点一下就把这一句的原文、译文、修改译文与解释四样存进「收藏」栏。
 * 只有大改档有它——理由见那个参数的说明。
 */

import type { JSX } from 'react'
import type { CompareLine, CompareSpan } from '../domain/compare'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import type { Selection } from './annotation-summary'
import { withCircledBreaks } from './explain-lines'

/** 行首那三个小标签。 */
export interface CompareLabels {
  original: string
  corrected: string
  /** 只有大改档会用到（那一行只在有 source 时才排出来） */
  source?: string
}

/** 精修档的标签（原来写死的那两个词，一个字都没动）。 */
const DEFAULT_LABELS: CompareLabels = { original: '原译', corrected: '改后' }

export function CompareLines({
  lines,
  selection,
  onSelect,
  labels = DEFAULT_LABELS,
  sentenceFavorite,
}: {
  lines: readonly CompareLine[]
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
  /** 行首标签；大改档传「原文 / 我的译文 / 修改译文」 */
  labels?: CompareLabels
  /**
   * 大改档的**逐句收藏**（第 17 条第 5 条）：给了它就在每句**原文后面**画一颗「收藏」。
   *
   * 用户原话："每一句原文后面加一个收藏按钮，点击后，收藏这一句，包括原文，译文，修改后的译文，
   * 解释四大部分。" 因此按钮长在原文那一行（`line.source` 存在时才有），
   * 而"收藏这一句都存了什么"由 `domain/favorites.ts` 的 `sentenceFavoriteOf` 说了算。
   *
   * 精修档不传它（那边的对照视图一行没有"原文"，收藏入口在右下角的批注卡片里）。
   */
  sentenceFavorite?: {
    favorited: (line: CompareLine) => boolean
    onToggle: (line: CompareLine) => void
  }
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
          {/*
            第一行：**这一句对应的原文**（只有大改档有）。它不加颜色——那是题目给的文字，
            不是谁的错；对不上时旁边挂个小标记说明"这一行没能与原文对上"。
          */}
          {line.source !== undefined && (
            <p className="compare-source">
              <span className="compare-label compare-label-source">{labels.source ?? '原文'}</span>
              {line.source}
              {line.sourceMatched === false && (
                <span className="compare-source-warn" title="这一句没能与屏幕上的原文对上（模型可能改写了几个字），只能当参考">
                  与原文对不上
                </span>
              )}
              {/*
                这一句的「收藏」（第 17 条第 5 条）。位置就在**原文那一行的末尾**——
                用户点名的位置是"每一句原文后面"。按钮上的字在「收藏 / 已收藏」之间切，
                与批注卡片里那颗同一个说法（同一件事两处不能各叫一个名字）。
              */}
              {sentenceFavorite && (
                <button
                  type="button"
                  className={sentenceFavorite.favorited(line) ? 'compare-fav compare-fav-on' : 'compare-fav'}
                  title={
                    sentenceFavorite.favorited(line)
                      ? '已收藏这一句（原文 / 你的译文 / 修改译文 / 解释）；再点一下取消'
                      : '收藏这一句：原文、你的译文、修改译文与解释一起存进「收藏」栏'
                  }
                  onClick={() => sentenceFavorite.onToggle(line)}
                >
                  {sentenceFavorite.favorited(line) ? '已收藏' : '收藏'}
                </button>
              )}
            </p>
          )}
          <p className="compare-original">
            <span className="compare-label">{labels.original}</span>
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
            <span className="compare-label compare-label-after">{labels.corrected}</span>
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
