/**
 * 术语题的两态：**在写**（五个等分的输入框）与**判完**（五条带颜色的批注行）。
 *
 * ## 版式（用户指定，别改回去）
 *
 * "五个待翻译的术语用分割线隔开，即上下把区域分为五等份。输入框也是分成五个输入框，
 * 也是用分割线分割，**右侧输入栏不需要再出现原文**"。
 * 因此这里只有一列（作答），与左边原文栏那五等份**用同一套等分与分割线**
 * （样式都在 styles.css 的 .term-list / .term-row 里），两栏的横线对得上，
 * 一眼能看出哪个框对应哪条术语。
 *
 * ## 提交与「重新作答」的按钮**不在这里**
 *
 * 用户要求："术语模式的提交按钮改到译文栏标题的右边和文章模式的位置一样"。
 * 因此两颗按钮都由 App 渲染在 `.pane-answer` 的标题栏里（见 App.tsx），
 * 这里只管行本身。顺带说一句：原先这里还挂着一句
 * "已写 0 / 5 条。术语要求一字不差，判分由程序对照标准译法完成。"——
 * 用户要求去掉，现在按钮禁不禁用 + 鼠标悬停的说明已经把这件事说清了。
 *
 * ## 判完为什么不是"只给一个对错标记"
 *
 * 用户要求："术语提交后，需要按照像文章模式一样，进行对比后，颜色批注和修改"。
 * 于是判完之后不用禁用输入框那副样子，而是**用与文章模式同一套勾画语言**画出来：
 *   译错：整条答案加荧光底色 + 一道横线划掉，下面给出标准译法（"改后"）；
 *   译对：米绿底色，不再重复标准译法（本来就一样）。
 * 点任意一条能在右下角看到那一条的完整说明，与文章模式里点一处勾画是同一个动作。
 */

import type { JSX } from 'react'
import type { Term } from '../domain/terms'
import { termMarkId, type TermVerdict } from '../domain/term-exercise'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'

/** 在写：五个等分的输入框，一行一条术语。 */
export function TermRows({
  terms,
  answers,
  disabled,
  onChange,
}: {
  terms: readonly Term[]
  /** 逐条作答；下标与 terms 对齐 */
  answers: readonly string[]
  disabled: boolean
  onChange: (row: number, value: string) => void
}): JSX.Element {
  return (
    <div className="term-rows">
      <ol className="term-list">
        {terms.map((term, row) => (
          <li key={`${term.zh}-${row}`} className="term-row">
            <input
              type="text"
              className="term-input"
              value={answers[row] ?? ''}
              placeholder={`第 ${row + 1} 条的译文`}
              onChange={(event) => onChange(row, event.target.value)}
              disabled={disabled}
              spellCheck={false}
              aria-label={`第 ${row + 1} 条术语的译文（${term.zh}）`}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 判完：五条各一行，译错的划掉并给出标准译法。 */
export function TermResults({
  verdicts,
  selectedId,
  onSelect,
}: {
  verdicts: readonly TermVerdict[]
  /** 当前选中的是这一条（右下角正显示它的说明） */
  selectedId: string | null
  onSelect: (selection: { kind: 'error' | 'highlight'; id: string } | null) => void
}): JSX.Element {
  return (
    <div className="term-rows">
      <ol className="term-list">
        {verdicts.map((verdict, row) => {
          const id = termMarkId(row, verdict.correct)
          const color = verdict.correct ? MARK_COLOR_VALUE.green : MARK_COLOR_VALUE.red
          const tint = verdict.correct ? MARK_BG_VALUE.green : MARK_BG_VALUE.red
          const answer = verdict.answer.trim()
          const selection = { kind: verdict.correct ? ('highlight' as const) : ('error' as const), id }
          /*
           * 整行可点，而不是只有那几个字可点：一条术语就是一行，
           * 点到行里的空白处也该算"我要看这一条"（文章模式里点勾画也是同样的意思）。
           */
          const pick = (): void => onSelect(selection)
          return (
            <li key={`${verdict.term.zh}-${row}`} className={`term-row${verdict.correct ? ' term-row-ok' : ' term-row-bad'}`}>
              <div
                className="term-result"
                data-mark-id={id}
                data-selected={selectedId === id ? 'true' : undefined}
                role="button"
                tabIndex={0}
                title="点一下看这一条的说明（右下角）"
                onClick={pick}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  pick()
                }}
              >
                {answer.length === 0 ? (
                  <span className="term-answer-blank">（没作答）</span>
                ) : verdict.correct ? (
                  /* 译对的用绿色底色——与文章模式的"亮点"同一个记号 */
                  <span className="term-answer mk mk-highlight" style={{ background: tint }}>
                    {answer}
                  </span>
                ) : (
                  /*
                   * 译错的：荧光底色 + 一道横线划掉（与文章模式里"纯删除"同一套记号），
                   * 横线画在内层，于是横线与文字同色、底色仍是那条完整的带子。
                   */
                  <span className="term-answer mk mk-delete" style={{ background: tint }}>
                    <span className="mk-deleted" style={{ color }}>
                      {answer}
                    </span>
                  </span>
                )}
                {/*
                  标准译法跟在**同一行**（而不是另起一行）。
                  一行总共只占"五等份里的那一份"，另起一行就会把两行字挤进一行的格子里——
                  术语一长就压到下一行上去。相同的话在下面「对照视图」里是一句一行。
                */}
                {!verdict.correct && (
                  <>
                    <span className="term-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="term-fix" style={{ color }}>
                      {verdict.term.en}
                    </span>
                  </>
                )}
              </div>
              <span className={verdict.correct ? 'term-mark term-mark-ok' : 'term-mark term-mark-bad'}>
                {verdict.correct ? '✓' : '✗'}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
