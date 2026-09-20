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

export function SourcePane({
  exercise,
  mode,
  isCustom,
  sourceOptionsCount,
  multiSection,
  sourceSectionCount,
  sectionIndex,
  gradedPages,
  currentSection,
  currentSource,
  currentReference,
  onRepaste,
  onRotate,
  onOpenGenerator,
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
  currentSection: Section | undefined
  currentSource: string
  currentReference: string
  onRepaste: () => void
  onRotate: () => void
  onOpenGenerator: () => void
}): JSX.Element {
  return (
    <section className="pane pane-source">
      <header className="pane-head">
        <h2>原文</h2>
        <div className="head-meta">
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
              第 {sectionIndex + 1} / {sourceSectionCount} 页 · 已批 {gradedPages} 页
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
        <p className={mode === 'term' ? 'source-text source-term' : 'source-text'}>
          {multiSection ? (currentSection?.text ?? currentSource) : currentSource}
        </p>
        {/* 自己贴的题没有参考译文，那一栏就别摆个空壳子 */}
        {currentReference ? (
          <details className="reference">
            <summary>参考译文（随题固定，可折叠）</summary>
            <p>{currentReference}</p>
          </details>
        ) : null}
      </div>
    </section>
  )
}
