/**
 * 术语题：**五个等分的输入框**，一行一条。
 *
 * 版式是用户指定的："五个待翻译的术语用分割线隔开，即上下把区域分为五等份。
 * 输入框也是分成五个输入框，也是用分割线分割，**右侧输入栏不需要再出现原文**"。
 * 因此这里只有一列（输入框），与左边原文栏那五等份**用同一套等分与分割线**，
 * 两栏的横线对得上，一眼能看出哪个框对应哪条术语。
 *
 * 与其它题型的两点不同：
 *   1. **没有整段作答文本**。别的题型作答是一篇文章/一段话，可以在上面画勾画；
 *      术语题作答是五个独立的短语，没有"位置"可言，所以这里不渲染 AnnotationText。
 *   2. **批改完全本地**。术语有唯一正确译法，提交后立刻由程序对照判分（见 term-exercise.ts），
 *      不走 AI、不用等、不花钱。
 */

import type { JSX } from 'react'
import type { Term } from '../domain/terms'
import type { TermVerdict } from '../domain/term-exercise'

export function TermRows({
  terms,
  answers,
  verdicts,
  disabled,
  onChange,
  onSubmit,
  onReset,
}: {
  terms: readonly Term[]
  /** 逐条作答；下标与 terms 对齐 */
  answers: readonly string[]
  /** 判分结果；null 表示还没提交 */
  verdicts: readonly TermVerdict[] | null
  disabled: boolean
  onChange: (row: number, value: string) => void
  onSubmit: () => void
  onReset: () => void
}): JSX.Element {
  const answered = answers.filter((answer) => answer.trim().length > 0).length
  const allAnswered = answered === terms.length
  const wrong = verdicts ? verdicts.filter((verdict) => !verdict.correct).length : 0

  return (
    <div className="term-rows">
      <ol className="term-list">
        {terms.map((term, row) => {
          const verdict = verdicts?.[row]
          const state = verdict ? (verdict.correct ? ' term-row-ok' : ' term-row-bad') : ''
          return (
            <li key={`${term.zh}-${row}`} className={`term-row${state}`}>
              <input
                type="text"
                className="term-input"
                value={answers[row] ?? ''}
                placeholder={`第 ${row + 1} 条的译文`}
                onChange={(event) => onChange(row, event.target.value)}
                // 判分之后锁住：要改就得先按「重新作答」（与文章模式的只读规矩一致）
                disabled={disabled}
                spellCheck={false}
                aria-label={`第 ${row + 1} 条术语的译文（${term.zh}）`}
              />
              {verdicts && (
                <span className={verdict?.correct ? 'term-mark term-mark-ok' : 'term-mark term-mark-bad'}>
                  {verdict?.correct ? '✓' : '✗'}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <div className="term-actions">
        {verdicts ? (
          <>
            <span className="hint">
              这一组 {terms.length} 条，错 {wrong} 条。标准译法见右下角逐条说明。
            </span>
            <button type="button" className="btn" onClick={onReset}>
              重新作答
            </button>
          </>
        ) : (
          <>
            <span className="hint">
              已写 {answered} / {terms.length} 条。术语要求一字不差，判分由程序对照标准译法完成。
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSubmit}
              disabled={!allAnswered}
              title={allAnswered ? undefined : '请先把五条都写上'}
            >
              提交批改
            </button>
          </>
        )}
      </div>
    </div>
  )
}
