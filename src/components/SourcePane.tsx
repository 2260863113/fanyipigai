/**
 * 左上栏：原文。
 *
 * 顶部按钮的取舍写在这里：**自己贴的那一篇不给「换一换」「AI 出题」**——
 * 换掉就不是他自己贴的那篇了，只留一个「重新贴一篇」。
 * 内置题才有备选篇目与 AI 现出的题，因此那两个按钮也在这一栏。
 */

import type { JSX } from 'react'
import { KIND_LABEL, type Exercise, type Mode } from '../domain/types'
import type { Section } from '../domain/sections'
import type { Term } from '../domain/terms'

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
  judging,
  currentSection,
  currentSource,
  currentReference,
  onRepaste,
  onRotate,
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
  /** 当前这一页在逐页批改里的状态说明（"待批改 / 已批改 / 已修改待提交"） */
  pageStateHint: string
  /** 「下一页」点下去会发生什么（自动提交 / 只看结果 / 还没写完） */
  nextHint: string
  /** 批改进行中：这时不许翻页（结果还没落定） */
  judging: boolean
  currentSection: Section | undefined
  currentSource: string
  currentReference: string
  onRepaste: () => void
  onRotate: () => void
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
                  sourceOptionsCount < 2
                    ? '这道题暂时只有一篇原文；点右边的「AI 出题」可以现出一篇'
                    : '换一篇同话题、同文体的原文继续练'
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
        ) : (
          <p className="source-text">{multiSection ? (currentSection?.text ?? currentSource) : currentSource}</p>
        )}
        {/* 自己贴的题没有参考译文，那一栏就别摆个空壳子 */}
        {currentReference ? (
          <details className="reference">
            <summary>参考译文（随题固定，可折叠）</summary>
            <p>{currentReference}</p>
          </details>
        ) : null}

        {/*
          翻页导航在**原文这一栏**（用户要求「放在原文左边一栏去」）。
          放在这里更顺手：人的眼睛在原文上，翻页是为了换一段原文，
          而右栏是作答/结果——那里放导航会和「提交批改」挤在一起。
        */}
        {multiSection && (
          <div className="section-nav">
            <button
              type="button"
              className="btn"
              onClick={() => onSectionChange(Math.max(0, sectionIndex - 1))}
              data-nav="prev"
              disabled={sectionIndex === 0 || judging}
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
              disabled={sectionIndex >= sourceSectionCount - 1 || judging}
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
