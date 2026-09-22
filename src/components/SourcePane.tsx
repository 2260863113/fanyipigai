/**
 * 左上栏：原文。
 *
 * 顶部按钮的取舍写在这里：**自己贴的那一篇不给「换一换」「AI 出题」**——
 * 换掉就不是他自己贴的那篇了，只留一个「重新贴一篇」。
 * 内置题才有备选篇目与 AI 现出的题，因此那两个按钮也在这一栏。
 *
 * ## 标题栏里现在有什么（用户第 7 条）
 *
 * 从左到右：`原文` → **领域下拉 + 方向切换**（紧挨标题，见 DomainSelect.tsx 的说明）
 * → 「选择文章」/「换一句」 → 「换一换」「AI 出题」（或「重新贴一篇」）
 * → 「自动判定」这一枚信息芯片。
 *
 * 被删掉的有三样（都是用户点名的）：
 *   - 「对照译文」按钮——它把这一页铺成"一段原文、一段参考译文交替"，
 *     而用户要的是正文末尾一个可点开可折叠的「参考译文」块；
 *   - 「已批 N 页」与「官方建议 N 分钟」两枚芯片。
 *     ⚠️ 删的只是**显示**：那份"哪几页批过"（article-progress.ts）照旧在用，
 *     它管的是"从没批完的那一段继续"与「已完成」标记，不是这一枚芯片。
 *
 * ## 参考译文只在正文末尾折叠出现（用户第 7 条）
 *
 * 用户原话："原文结束后有『参考译文』几个字，点击后，原文下方添加参考译文的内容，
 * 点击相同位置，参考译文折叠回来。"因此它回到正文下面（练习记录页一直是这个做法），
 * 并且**只在当前这一页确实有参考译文时**才画——自己贴的题、句子题、术语题没有译文，
 * 连这四个字都不出现。参考译文**只给人看、从不发给模型**（ADR 0003）。
 */

import type { JSX } from 'react'
import { KIND_LABEL, type Exercise, type MarkColor, type Mode } from '../domain/types'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import type { Section } from '../domain/sections'
import type { Term } from '../domain/terms'
import { DomainSelect, DirectionSelect, type ArticleSelection } from './DomainSelect'

/**
 * 原文正文。带一处可选的高亮：**选中某处批改时，它在原文里对应的那一小段也标成同色**
 * （用户要求："点击某一处批改……左边栏中原文显示的中文（或者英文）也要用相应的颜色标记出来，
 * 当收回小卡片，那么原文的颜色标记消失"）。
 *
 * 高亮区间由 AI 给的 `sourceText` 定位而来；**给不出对应原文的错误就没有这一处高亮**，
 * 因此这里把"有没有标记"当成正常情形处理，而不是异常。
 */
export function SourceText({
  text,
  mark,
}: {
  text: string
  mark: { start: number; end: number; color: MarkColor } | null
}): JSX.Element {
  const valid = mark && mark.start >= 0 && mark.end <= text.length && mark.start < mark.end
  if (!valid) return <p className="source-text">{text}</p>

  const { start, end, color } = mark
  return (
    <p className="source-text">
      {text.slice(0, start)}
      <span
        className="source-mark"
        style={{ color: MARK_COLOR_VALUE[color], background: MARK_BG_VALUE[color] }}
        title="这一处就是你点的那处批改在原文里对应的位置"
      >
        {text.slice(start, end)}
      </span>
      {text.slice(end)}
    </p>
  )
}

export function SourcePane({
  exercise,
  mode,
  isCustom,
  sourceOptionsCount,
  multiSection,
  sourceSectionCount,
  sectionIndex,
  pageStateHint,
  nextHint,
  currentSection,
  currentSource,
  currentPairs,
  range,
  sourceMark,
  onRepaste,
  onRotate,
  rotateTitle,
  onOpenGenerator,
  onSectionChange,
  onPickArticle,
  onNextSentence,
  terms = [],
}: {
  exercise: Exercise
  mode: Mode
  isCustom: boolean
  /** 备选篇目总份数；少于 2 份时「换一换」不可用 */
  sourceOptionsCount: number
  multiSection: boolean
  sourceSectionCount: number
  sectionIndex: number
  /** 当前这一页在逐页批改里的状态说明（"待批改 / 批改中 / 已批改 / 编辑中"） */
  pageStateHint: string
  /** 「下一页」点下去会发生什么（只翻页，草稿留着） */
  nextHint: string
  currentSection: Section | undefined
  currentSource: string
  /**
   * 当前这一页**逐段配好**的原文与译文。
   *
   * 正文末尾那个可折叠的「参考译文」按它拼出来（一页可能由两个短自然段并成，
   * 那时是两段译文拼成一块）。没有参考译文的题是空的，那一块也就不出现。
   */
  currentPairs: ReadonlyArray<{ source: string; reference: string }>
  /**
   * 「领域 × 方向」这两个范围控件（第 7 条：挪进原文标题栏、紧挨「原文」）。
   * 传 null 就不画——术语题与"自己贴的题"没有领域可言（见 DomainSelect.tsx）。
   */
  range?: { selection: ArticleSelection; onChange: (next: ArticleSelection) => void; withDirection: boolean } | null
  /**
   * 当前选中那一处批改**对应到原文**的位置与颜色（用户要求：点译文上的某一处，
   * 左边原文栏里对应的那一处也标成同色；收起卡片就消失）。
   *
   * 位置由 AI 给的 `sourceText` 定位而来（见 domain/types.ts），**AI 给不出就不标**。
   * 坐标属于这一页的原文，与译文上的批注互不相干。
   */
  sourceMark?: { start: number; end: number; color: MarkColor } | null
  onRepaste: () => void
  onRotate: () => void
  /** 「换一换」的悬停说明；文章栏换的是"下一篇"，说法与换原文不同 */
  rotateTitle?: string
  onOpenGenerator: () => void
  onSectionChange: (index: number) => void
  /** 有这一项就显示「选择文章」（文章栏用），放在标题栏右侧靠左 */
  onPickArticle?: () => void
  /** 有这一项就显示「换一句」（句子栏用），与「选择文章」同一个位置 */
  onNextSentence?: () => void
  /**
   * 术语题的条目（一组五条）。
   *
   * 有它就把原文栏画成"五等份、每份一条"（用户要求的术语题版式），
   * 而不是一块整段文本——术语题本来就没有"一整段原文"。
   */
  terms?: readonly Term[]
}): JSX.Element {
  /**
   * 这一页的参考译文：把逐段配好的译文拼成一块（与 sections.ts 的 referenceOfPage 同一口径，
   * 只是这里拿到的已经是"这一页"的 pairs，不必再按页号去找）。
   */
  const reference = currentPairs
    .map((pair) => pair.reference)
    .filter((text) => text.length > 0)
    .join('\n\n')

  return (
    <section className="pane pane-source">
      <header className="pane-head">
        <h2>原文</h2>
        <div className="head-meta">
          {/*
            **领域下拉与方向切换摆在最前面**，紧挨着「原文」三个字（用户第 7 条原话：
            "将领域下拉栏挪到原文标题栏紧靠『原文』的右边"）。它们决定的是"练哪一格的题"，
            因此排在"换哪一篇"之前——先定范围，再挑篇目。
          */}
          {range && <DomainSelect selection={range.selection} onChange={range.onChange} />}
          {range?.withDirection && <DirectionSelect selection={range.selection} onChange={range.onChange} />}
          {/*
            「选择文章」与「换一句」跟在范围控件后面（它们以前排在最前，那是"头一组按钮"
            的说法定下的顺序；现在头一组的位置让给了领域与方向）。
          */}
          {onPickArticle && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onPickArticle}
              title="按「领域 × 方向」以卡片罗列文章，选一篇来练"
            >
              选择文章
            </button>
          )}
          {onNextSentence && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onNextSentence}
              title="在该领域的句子里往下走一句"
            >
              换一句
            </button>
          )}
          {isCustom ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onRepaste}
              title="换一篇自己贴的原文；贴新的会覆盖上一篇（练习记录仍留着）"
            >
              重新贴一篇
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onRotate}
                disabled={sourceOptionsCount < 2}
                title={
                  rotateTitle ??
                  (sourceOptionsCount < 2
                    ? '这道题暂时只有一篇原文；点右边的「AI 出题」可以现出一篇'
                    : '换一篇同话题、同文体的原文继续练')
                }
              >
                换一换
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onOpenGenerator}
                title="按领域让 AI 现出一篇同规格的题；生成后会留存，可用「换一换」翻回来"
              >
                AI 出题
              </button>
            </>
          )}
          {/*
            第 9 条与第 7 条一起砍掉了三枚芯片里的两枚：
            「已批 N 页」与「官方建议 N 分钟」都不再显示。
            ⚠️ 删的只是显示——"哪几页批过"那份进度（article-progress.ts）照旧在用，
            它管的是"从没批完的那一段继续"与「选择文章」里的「已完成」标记。
            自己贴的题留「自动判定」：它说明的是"程序把你的原文判成了哪种题型"，
            与题目本身有关，不是进度。
          */}
          {isCustom && (
            <span
              className="chip"
              title="题型是按原文自己判的：多个自然段按文章题、两句以上按段落题、很短又没标点按术语题，其余按句子题"
            >
              自动判定 · {KIND_LABEL[exercise.mode]}
            </span>
          )}
        </div>
      </header>
      <div className="pane-body">
        {/*
          术语题：原文栏里把五条术语**一行一条、等分成五份**（用户要求
          "五个待翻译的术语用分割线隔开，即上下把区域分为五等份"）。

          术语题没有"一段原文"可言——它一次给五条短语。因此这里不画那一整块文本，
          而是列成五等份，每份一条；右边的作答栏也用同一套等分与分割线，
          两栏的横线因此**对得上**，一眼能看出哪个输入框对应哪条术语。
        */}
        {mode === 'term' ? (
          <ol className="term-source-list">
            {terms.map((term, index) => (
              <li key={`${term.zh}-${index}`} className="term-source-row">
                <span className="term-source-index">{index + 1}</span>
                <span className="term-source-text">
                  {term.zh}
                  {!term.verified && (
                    <span className="term-unverified" title="这一条的译法尚未人工核对，请以官方文件为准">
                      译法待核对
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <SourceText
            text={multiSection ? (currentSection?.text ?? currentSource) : currentSource}
            mark={sourceMark ?? null}
          />
        )}

        {/*
          「参考译文」：原文结束后这几个字，点一下把这一页的参考译文铺在原文下面，
          再点一下折回去（用户第 7 条原话）。用原生 `<details>` 就是因为它天生是这个行为，
          而练习记录页早就在用同一个块（见 RecordsView）。
          **没有参考译文的题连这四个字都不出现**（自己贴的、句子题、术语题）。
        */}
        {reference.length > 0 && (
          <details className="reference">
            <summary>参考译文</summary>
            <p>{reference}</p>
          </details>
        )}
      </div>

      {/*
        翻页导航**固定在原文栏的最下方**（用户第 8 条要求）。

        它原先也在这条栏里，但跟着正文一起滚（在 `.pane-body` 里）——
        一页很长的时候要滚到底才够得着「下一页」。现在它挪出滚动区，
        作为这一栏的页脚：正文自己滚，这两颗按钮永远在同一个位置。

        顺带保留两条老规矩：
          - 导航在**原文这一栏**（人的眼睛在原文上，翻页是为了换一段原文）；
          - **批改中照样能翻页**（用户要求：批改在后台跑，拦着反而把人锁在原地干等）。
      */}
      {multiSection && (
        <footer className="pane-foot section-nav">
          <button
            type="button"
            className="btn"
            onClick={() => onSectionChange(Math.max(0, sectionIndex - 1))}
            data-nav="prev"
            disabled={sectionIndex === 0}
          >
            ← 上一页
          </button>
          <span className="hint">
            第 {sectionIndex + 1} / {sourceSectionCount} 页 · {pageStateHint}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => onSectionChange(Math.min(sourceSectionCount - 1, sectionIndex + 1))}
            data-nav="next"
            disabled={sectionIndex >= sourceSectionCount - 1}
            title={nextHint}
          >
            下一页 →
          </button>
        </footer>
      )}
    </section>
  )
}
