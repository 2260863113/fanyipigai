/**
 * 术语题的两态：**在写**（十个等分的输入框）与**判完**（十条带颜色的批注行）。
 *
 * ## 版式（用户指定，别改回去）
 *
 * "五个待翻译的术语用分割线隔开，即上下把区域分为五等份。输入框也是分成五个输入框，
 * 也是用分割线分割，**右侧输入栏不需要再出现原文**"——第 14 条把每份从五条改成
 * **十条**（`TERMS_PER_PAGE`），版式本身的道理没变。
 * 因此这里只有一列（作答），与左边原文栏那几等份**用同一套等分与分割线**
 * （样式都在 styles.css 的 .term-list / .term-row 里），两栏的横线对得上，
 * 一眼能看出哪个框对应哪条术语。
 *
 * ## 一页十条，但**末页可能只有三条**
 *
 * 术语库按每页 10 条切（国内 83 条 = 9 页，末页 3 条；国际 60 条 = 6 页，正好整）。
 * 用户对末页拍板的是"照旧等分，缺的行留空、不可填也不计分"，
 * 因此两栏一律画满 `TERMS_PER_PAGE` 行（`termRowsOf` 把缺的补成 `null`），
 * 缺的那几行：原文栏空着，作答栏是一个**禁用**的空框。这样两栏的横线在任何一页都对得上。
 *
 * ## 提交与「返回编辑」的按钮**不在这里**
 *
 * 用户要求："术语模式的提交按钮改到译文栏标题的右边和文章模式的位置一样"。
 * 因此那颗按钮由 App 渲染在 `.pane-answer` 的标题栏里（见 App.tsx），这里只管行本身。
 * 顺带说一句：原先这里还挂着一句
 * "已写 0 / 5 条。术语要求一字不差，判分由程序对照标准译法完成。"——
 * 用户要求去掉，现在按钮禁不禁用 + 鼠标悬停的说明已经把这件事说清了。
 *
 * ## 判完为什么不是"只给一个对错标记"
 *
 * 用户要求："术语提交后，需要按照像文章模式一样，进行对比后，颜色批注和修改"。
 * 于是判完之后不用禁用输入框那副样子，而是**用与文章模式同一套勾画语言**画出来：
 *   译错：整条答案加荧光底色 + 一道横线划掉，同一行右边给出官方译名；
 *   译对：米绿底色，不再重复官方译名（本来就一样）。
 * 点任意一条能**选中**它（对照视图里那一行跟着选中）。
 * ⚠️ 第 14 条第 6 条起，术语模式不再画右下的「批注详情」栏，因此"点一条看说明"这件事
 * 在术语题里没有了——判完的答案与官方译名本来就在同一行上，不必再绕一层卡片；
 * 这里保留"点一下选中"是因为它在**对照视图**里仍然有用（选中那一行）。
 */

import type { JSX } from 'react'
import type { Term } from '../domain/terms'
import { TERMS_PER_PAGE } from '../domain/terms'
import { termMarkId, type TermVerdict } from '../domain/term-exercise'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'

/**
 * 一页要画的**全部行**：真实的术语在前，末页缺的补成 `null`。
 *
 * 原文栏与作答栏**共用这一个函数**——两栏的等分与分割线能不能对上，全靠它们数的是同一个行数。
 * 谁要单独少画一行，两边的横线立刻错位（"一眼看不出哪个框对应哪条术语"就是这么坏的）。
 */
export function termRowsOf(terms: readonly Term[]): ReadonlyArray<Term | null> {
  const rows: Array<Term | null> = [...terms]
  while (rows.length < TERMS_PER_PAGE) rows.push(null)
  return rows
}

/** 在写：十个等分的输入框，一行一条术语。 */
export function TermRows({
  terms,
  answers,
  disabled,
  onChange,
}: {
  /** 这一页真实的术语（末页可能不足十条，缺的行由这里补空框） */
  terms: readonly Term[]
  /** 逐条作答；下标与 terms 对齐 */
  answers: readonly string[]
  disabled: boolean
  onChange: (row: number, value: string) => void
}): JSX.Element {
  return (
    <div className="term-rows">
      <ol className="term-list">
        {termRowsOf(terms).map((term, row) =>
          term === null ? (
            /* 末页缺的那几行：画成一个禁用的空框，两栏的行数仍然一致 */
            <li key={`blank-${row}`} className="term-row term-row-blank">
              <input
                type="text"
                className="term-input"
                value=""
                readOnly
                disabled
                aria-label={`第 ${row + 1} 行（本页没有这一条）`}
              />
            </li>
          ) : (
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
          ),
        )}
      </ol>
    </div>
  )
}

/** 判完：一行一条，译错的划掉并给出官方译名。 */
export function TermResults({
  verdicts,
  selectedId,
  onSelect,
}: {
  verdicts: readonly TermVerdict[]
  /** 当前选中的是这一条（对照视图里那一行也一起选中） */
  selectedId: string | null
  onSelect: (selection: { kind: 'error' | 'highlight'; id: string } | null) => void
}): JSX.Element {
  /* 末页不满十条时同样补空行，好与原文栏的横线对齐（与 TermRows 同一份口径） */
  const rows: Array<TermVerdict | null> = [...verdicts]
  while (rows.length < TERMS_PER_PAGE) rows.push(null)

  return (
    <div className="term-rows">
      <ol className="term-list">
        {rows.map((verdict, row) => {
          if (verdict === null) {
            return <li key={`blank-${row}`} className="term-row term-row-blank" aria-hidden="true" />
          }
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
                title="点一下选中这一条（对照视图里那一行也跟着选中）"
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
                  官方译名跟在**同一行**（而不是另起一行）。
                  一行总共只占"等分里的那一份"，另起一行就会把两行字挤进一行的格子里——
                  术语一长就压到下一行上去。相同的话在下面「对照视图」里是一句一行。
                  `verdict.standard` 而不是 `term.en`：英译中方向下标准答案可能是**两个中文**
                  （一英多中，如"直辖市人民政府／设区的市人民政府"），那一串由判分那里拼好。
                */}
                {!verdict.correct && (
                  <>
                    <span className="term-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="term-fix" style={{ color }}>
                      {verdict.standard}
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
