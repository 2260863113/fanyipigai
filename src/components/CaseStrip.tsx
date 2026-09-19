/**
 * 题目切换条：当前题型下的几道题。
 *
 * 只有一道题时不显示（没有可切的意义）——判断放在组件内部，
 * 这样调用方不必再写一遍 `inMode.length > 1`。
 * 点击只切"当前在看哪一道"，**不清空任何一道题的作答与结果**（见 App 的 selectExercise）。
 */

import type { JSX } from 'react'
import { DIRECTION_LABEL, type Direction } from '../domain/types'

/** 切换条只用到题号、方向、领域三样，因此只要求这三样。 */
export interface CaseTabItem {
  exercise: { id: string; direction: Direction; topic: string }
}

export function CaseStrip({
  cases,
  activeExerciseId,
  onSelect,
}: {
  cases: readonly CaseTabItem[]
  activeExerciseId: string
  onSelect: (exerciseId: string) => void
}): JSX.Element | null {
  if (cases.length <= 1) return null

  return (
    <nav className="case-strip" aria-label="题目">
      <span className="strip-label">题目</span>
      {cases.map((item) => (
        <button
          key={item.exercise.id}
          type="button"
          className={item.exercise.id === activeExerciseId ? 'case-tab case-tab-active' : 'case-tab'}
          onClick={() => onSelect(item.exercise.id)}
        >
          <span className="case-tab-title">
            {DIRECTION_LABEL[item.exercise.direction]} · {item.exercise.topic}
          </span>
        </button>
      ))}
    </nav>
  )
}
