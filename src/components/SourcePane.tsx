/**
 * 左上栏：原文。
 *
 * 顶部按钮的取舍写在这里：**自己贴的那一篇不给「换一换」「AI 出题」**——
 * 换掉就不是他自己贴的那篇了，只留一个「重新贴一篇」。
 * 内置题才有备选篇目与 AI 现出的题，因此那两个按钮也在这一栏。
 *
 * ## 「对照」按钮（用户要求）
 *
 * 标题栏里那颗按钮把当前这一页**铺成「一段原文、一段译文」交替**，再点一下回到只看原文。
 * 它在**所有带参考译文的题**上都出现（文章库、内置示例题、AI 出题的题），
 * 而不是只有文章栏才有——同一个"看参考译文"的动作在全站只有一套交互。
 *
 * 因此原先正文下面那个可折叠的「参考译文」块**删掉了**：它和这颗按钮是同一件事的两种做法，
 * 留着只会让人在两处找。参考译文**只给人看、从不发给模型**（ADR 0003）。
 *
 * 铺出来的"一对"是**自然段**级别的：一页可能由两个短自然段并成，
 * 那时就是 A1 / T1 / A2 / T2 四行，谁对着谁一眼可见。
 */

import type { JSX } from 'react'
import { KIND_LABEL, type Exercise, type MarkColor, type Mode } from '../domain/types'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import type { Section } from '../domain/sections'
import type { Term } from '../domain/terms'

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
  gradedPages,
  pageStateHint,
  nextHint,
  currentSection,
  currentSource,
  currentPairs,
  compare,
  sourceMark,
  onToggleCompare,
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
  /** 已批改过的页数（逐页批改：每一页各批各的） */
  gradedPages: number
  /** 当前这一页在逐页批改里的状态说明（"待批改 / 批改中 / 已批改 / 编辑中"） */
  pageStateHint: string
  /** 「下一页」点下去会发生什么（只翻页，草稿留着） */
  nextHint: string
  currentSection: Section | undefined
  currentSource: string
  /**
   * 当前这一页**逐段配好**的原文与译文（原文栏的「对照」按它一段一段地铺）。
   * 没有参考译文的题（自己贴的、句子、术语）是空的，那颗按钮也就不出现。
   */
  currentPairs: ReadonlyArray<{ source: string; reference: string }>
  /** 现在看的是原文还是对照（一段原文、一段译文交替） */
  compare: boolean
  /**
   * 当前选中那一处批改**对应到原文**的位置与颜色（用户要求：点译文上的某一处，
   * 左边原文栏里对应的那一处也标成同色；收起卡片就消失）。
   *
   * 位置由 AI 给的 `sourceText` 定位而来（见 domain/types.ts），**AI 给不出就不标**。
   * 坐标属于这一页的原文，与译文上的批注互不相干。
   */
  sourceMark?: { start: number; end: number; color: MarkColor } | null
  onToggleCompare: (next: boolean) => void
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
  /** 这一页确实有译文可对照时才给按钮（术语题与自定义题都没有） */
  const pairCandidates = currentPairs.filter((pair) => pair.reference.length > 0)
  const canCompare = mode !== 'term' && pairCandidates.length > 0

  return (
    <section className="pane pane-source">
      <header className="pane-head">
        <h2>原文</h2>
        <div className="head-meta">
          {/*
            「选择文章」与「换一句」放在**原文标题栏右侧、靠左**（用户要求）。
            它们是"换这一篇原文"的动作，摆在原文栏才对得上；而且这个位置紧挨着标题，
            视觉上是这一栏的头一组按钮，与右边的「换一换 / AI 出题」自然分开。
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
            「对照译文」排在"换一篇原文"那一组之后（用户早先定过：选择文章要当这一栏的头一组按钮，
            因此不能插到它前面），又排在两个信息芯片之前——它是一个控件，
            而"已批 N 页 / 官方建议 30 分钟"只是如实告知。
          */}
          {canCompare && (
            <button
              type="button"
              className={compare ? 'btn btn-ghost btn-ghost-on' : 'btn btn-ghost'}
              onClick={() => onToggleCompare(!compare)}
              aria-pressed={compare}
              title={
                compare
                  ? '回到只看原文（译文不再铺在下面）'
                  : '把这一页铺成「一段原文、一段译文」交替对照，方便逐段比对自己译得差在哪'
              }
            >
              对照译文
            </button>
          )}
          {multiSection && (
            <span className="chip" title="逐页批改：点「下一页」时，刚写完的那一页会自动交去批改">
              已批 {gradedPages} 页
            </span>
          )}
          {isCustom ? (
            <span
              className="chip"
              title="题型是按原文自己判的：多个自然段按文章题、两句以上按段落题、很短又没标点按术语题，其余按句子题"
            >
              自动判定 · {KIND_LABEL[exercise.mode]}
            </span>
          ) : (
            <span className="chip">官方建议 {exercise.suggestedMinutes} 分钟</span>
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
        ) : compare && canCompare ? (
          <div className="pair-list">
            {currentPairs.map((pair, index) => (
              <div className="pair" key={index}>
                <p className="pair-source">{pair.source}</p>
                {pair.reference.length > 0 && <p className="pair-reference">{pair.reference}</p>}
              </div>
            ))}
          </div>
        ) : (
          <SourceText
            text={multiSection ? (currentSection?.text ?? currentSource) : currentSource}
            mark={compare ? null : (sourceMark ?? null)}
          />
        )}

        {/*
          翻页导航在**原文这一栏**（用户要求「放在原文左边一栏去」）。
          放在这里更顺手：人的眼睛在原文上，翻页是为了换一段原文，
          而右栏是作答/结果——那里放导航会和「提交批改」挤在一起。

          ⚠️ **批改中照样能翻页**（用户要求：「即使在批改过程中，用户可以手动切换页数，
          继续翻译（但是批改过程中不能提交）」）。早先这两颗按钮上写着 `|| judging`，
          那是"一页批完才准走"的年代留下的——现在批改在后台跑，翻页与它无关，
          拦着反而把用户锁在原地干等。
        */}
        {multiSection && (
          <div className="section-nav">
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
          </div>
        )}
      </div>
    </section>
  )
}
