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
 *   写错的**字或词**：荧光底色 + 一道横线划掉，**正确的写法写在它上方**；
 *   漏写的**字或词**：直接用**红色补进译文**（没有东西可划，就不划）；
 *   译对的整条：米绿底色（与文章模式的"亮点"同一个记号）。
 * ⚠️ 第 16 条起**不再整条重写**（早先是"整条划掉 + 右边跟一个「→ 官方译名」"）：
 * 用户要看的是"我哪个词写错了、应该写成什么"，不是把整条答案再抄一遍。
 * 没作答的那一条也不再写"（没作答）"——整行就只有红色的正确答案。
 * 点任意一条能**选中**它（对照视图里那一行跟着选中）。
 * ⚠️ 第 14 条第 6 条起，术语模式不再画右下的「批注详情」栏，因此"点一条看说明"这件事
 * 在术语题里没有了——判完的答案与官方译名本来就在同一行上，不必再绕一层卡片；
 * 这里保留"点一下选中"是因为它在**对照视图**里仍然有用（选中那一行）。
 */

import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react'
import type { Term } from '../domain/terms'
import { TERMS_PER_PAGE } from '../domain/terms'
import { answerPieces, termMarkId, type TermAnswerPiece, type TermVerdict } from '../domain/term-exercise'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import { CORRECTION_GAP, correctionFit, measureOneLineWidth } from './term-above-fit'

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

/** 判完：一行一条，**只改不对的字或词**（第 16 条）。 */
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

  const listRef = useRef<HTMLOListElement | null>(null)
  const fits = useCorrectionFits(listRef, verdicts)

  return (
    <div className="term-rows">
      <ol className="term-list" ref={listRef}>
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
          const pieces = verdict.correct ? [] : answerPieces(answer, verdict.accepted)
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
                {verdict.correct ? (
                  /* 译对的用绿色底色——与文章模式的"亮点"同一个记号 */
                  <span className="term-answer mk mk-highlight" style={{ background: tint }}>
                    {answer}
                  </span>
                ) : (
                  /*
                   * 译错的：**只把不对的字/词标出来**，其余原样留着（用户第 16 条：
                   * "只修改不对的字或者词，用颜色标记，然后在上方写正确的词，而不是整条重写"）。
                   *   - 写错的词：荧光底色 + 一道横线划掉，**正确写法写在它上方**（`.term-above`）；
                   *   - 漏写的词：**直接用红色补进译文**（`.term-added`，不划横线）——
                   *     没作答的那一条整行都走这一条路，屏幕上因此**只看到红色正确答案**，
                   *     不再写"（没作答）"（用户点名）。
                   * 判分一个字没动：这里画的仍然只是 `judgeTerms` 已经算好的对错。
                   * ⚠️ 第 17 条第 2 条起，上方那行更正**只占一行**、标记段会被量着拓宽，
                   * 见 `useCorrectionFits` 与 term-above-fit.ts。
                   */
                  <span className="term-answer">
                    {pieces.map((piece, index) => (
                      <Piece
                        key={index}
                        piece={piece}
                        color={color}
                        tint={tint}
                        fitKey={`${row}-${index}`}
                        fit={fits[`${row}-${index}`] ?? null}
                      />
                    ))}
                  </span>
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

/** 量出来的一条摆法：判据（`correctionFit`）＋"这一行还剩多少宽度"（折行兜底时要用）。 */
type FittedCorrection = { fit: ReturnType<typeof correctionFit>; available: number }

/**
 * 量一遍这一页每一条更正的摆法（第 17 条第 2 条）。
 *
 * 为什么要在**渲染之后**再量一次：更正那一行要多宽、被划掉那个词有多宽，
 * 都是排版的结果，React 渲染时算不出来。因此第一帧按最朴素的样子（一行、不加空白）画，
 * 量完立刻把 `--term-pad` 与"要不要折行"写回去——layout effect 跑在浏览器**绘制之前**，
 * 所以这个中间态不会闪一下。
 *
 * 用 `ResizeObserver` 盯住那一列：拖分隔条、改窗口大小都会换行，摆法必须跟着重算，
 * 否则"拓宽过的标记段"会留在一个已经不成立的宽度上。
 */
function useCorrectionFits(
  listRef: RefObject<HTMLOListElement | null>,
  verdicts: readonly TermVerdict[],
): Record<string, FittedCorrection> {
  const [fits, setFits] = useState<Record<string, FittedCorrection>>({})

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const measure = (): void => {
      const next: Record<string, FittedCorrection> = {}
      for (const node of list.querySelectorAll<HTMLElement>('.term-above')) {
        const key = node.dataset['fit'] ?? ''
        const anchor = node.parentElement
        const result = node.closest('.term-result')
        if (!key || !anchor || !result) continue
        const anchorRect = anchor.getBoundingClientRect()
        const mark = result.querySelector('.term-mark')
        const available =
          result.getBoundingClientRect().right -
          (mark ? mark.getBoundingClientRect().width : 0) -
          CORRECTION_GAP -
          anchorRect.left
        /*
         * 先减掉"已经加上的空白"再重新算：量出来的宽度里包含了上一轮撑开的 `--term-pad`
         * （标记段是它的父元素）。不减的话每量一次都会再撑一点，一直撑到上限为止。
         */
        const currentPad = Number.parseFloat(getComputedStyle(anchor).getPropertyValue('--term-pad')) || 0
        next[key] = {
          fit: correctionFit({
            correctionWidth: measureOneLineWidth(node.textContent ?? '', getComputedStyle(node).font),
            anchorWidth: anchorRect.width - currentPad * 2,
            availableWidth: available,
          }),
          available,
        }
      }
      setFits((previous) => (sameFits(previous, next) ? previous : next))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [listRef, verdicts])

  return fits
}

/** 两份摆法是不是一样（一样就不必重渲染：`ResizeObserver` 会在拖动时分很多次回调）。 */
function sameFits(a: Record<string, FittedCorrection>, b: Record<string, FittedCorrection>): boolean {
  const keys = Object.keys(b)
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((key) => {
    const left = a[key]
    const right = b[key]
    if (!left || !right) return false
    return (
      left.fit.pad === right.fit.pad &&
      left.fit.oneLine === right.fit.oneLine &&
      /* 折行兜底时宽度也来自量出来的数，因此它变了也得重画（拖分隔条就会变） */
      Math.round(left.available) === Math.round(right.available)
    )
  })
}

/** 一条作答里的一段：原样、写错（划掉 + 上方写正确的）、漏写（红色补进去）。 */
function Piece({
  piece,
  color,
  tint,
  fitKey,
  fit,
}: {
  piece: TermAnswerPiece
  color: string
  tint: string
  /** 这一段的编号（量摆法时用它把量与画对上，见 useCorrectionFits） */
  fitKey: string
  fit: FittedCorrection | null
}): JSX.Element {
  if (piece.kind === 'added') {
    /* 漏写的词：红色直接补在译文里，没有东西可划 */
    return (
      <span className="term-added" style={{ color }}>
        {piece.text}
      </span>
    )
  }
  if (piece.kind === 'same') return <span>{piece.text}</span>
  const oneLine = fit === null || fit.fit.oneLine
  return (
    /*
     * 写错的词：划掉它，并在**它上方**写出正确的写法。
     * 上方那一行的定位交给样式表（`.term-above` 用绝对定位吊在词的上面），
     * 因此这一行的高度不会因为多了一行字而变——两栏的横线仍对得上。
     *
     * `--term-pad` 挂在**这一层**（而不是里面那条色带）上：量摆法时要能从锚点读回
     * "上一轮已经撑开了多少"（自定义属性只往下继承，挂在色带上就再也读不回来了）。
     */
    <span className="term-wrong" style={{ '--term-pad': `${fit?.fit.pad ?? 0}px` } as CSSProperties}>
      {piece.to !== undefined && (
        <span
          className="term-above"
          data-fit={fitKey}
          style={{
            color,
            /*
             * 一行放得下就一行（`nowrap`，样式表里的默认值）；放不下才折行，
             * 并把宽度压在"这一段还剩多少"以内——否则它会横着跑出这一栏。
             */
            ...(oneLine ? null : { whiteSpace: 'normal' as const, maxWidth: `${Math.max(0, Math.round(fit.available))}px` }),
          }}
        >
          {piece.to}
        </span>
      )}
      <span className="term-wrong-text mk mk-delete" style={{ background: tint }}>
        <span className="mk-deleted" style={{ color }}>
          {piece.text}
        </span>
      </span>
    </span>
  )
}
