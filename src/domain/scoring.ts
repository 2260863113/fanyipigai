/**
 * 系统计分。
 *
 * 为什么由程序算而不是让 AI 打分：
 * 1. 一致性——分数与页面上实际标出的错误永远对得上，不会出现"90 分却标了 8 处硬性错误"；
 * 2. 可解释——用户能自己核出这个分数是怎么扣出来的，而不是拿到一个没法验证的数字；
 * 3. 成本——提示词里少一块内容，AI 的返回更短、更不容易被截断。
 *
 * 规则写死在代码里，改规则就改这里，不要散落在界面里。
 *
 * ⚠️ 「红还是橙」这件事**不只有分类**：漏译/多译的轻重由程序按字数判（见 severity.ts），
 * 因此算分必须拿到翻译方向。只按分类判会把漏译一律算成红色，分数与页面上标出的颜色就对不上了。
 */

import type { Correction, Direction, Score } from './types'
import { isHardError } from './severity'

/** 每处硬性错误（红色）扣多少分。 */
export const HARD_PENALTY = 8

/** 每处表达问题（橙色）扣多少分。 */
export const SOFT_PENALTY = 3

/** 表达优秀（绿色）是否加分。默认不加分：加分会让"多写亮点"成为刷分动机。 */
export const HIGHLIGHT_BONUS = 0

/**
 * 计算一次批改的分数。
 * 分数只反映"被标出来的错误"，所以它与批注区域里看到的东西一定一致。
 */
export function scoreCorrection(correction: Correction, answer: string, direction: Direction): Score {
  let hardCount = 0
  let softCount = 0

  for (const error of correction.errors) {
    if (isHardError(error, direction)) hardCount += 1
    else softCount += 1
  }

  // 空作答不该拿满分：什么都没写，谈不上"没有错误"
  const wroteNothing = answer.trim().length === 0
  const raw = wroteNothing ? 0 : 100 - hardCount * HARD_PENALTY - softCount * SOFT_PENALTY
  const total = Math.max(0, Math.min(100, Math.round(raw + correction.highlights.length * HIGHLIGHT_BONUS)))

  return { total, hardCount, softCount, highlightCount: correction.highlights.length }
}

/** 把计分规则写成一句人话，显示在分数旁边，让用户知道分数是怎么来的。 */
export const SCORING_RULE_TEXT = `系统计分：满分 100，每处硬性错误扣 ${HARD_PENALTY} 分，每处表达问题扣 ${SOFT_PENALTY} 分`
