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
 *
 * ## 漏译**按字数扣分**，不再按"一处扣固定分"（用户第 13 条）
 *
 * 用户的原话："漏译的扣分单独算，按照漏多少字（单词），扣多少分。"
 * 追问"与原来的每处固定分是什么关系"时，他选的是**完全按字数扣、不再另扣固定分**：
 * 一句"漏 20 个字"就扣 20 分。
 *
 * 于是三种扣法并存，且各有各的理由：
 *   - **漏译**：每个单位扣 `OMISSION_PENALTY_PER_UNIT`（1 分）——漏得多就扣得多，
 *     与"漏译的轻重按字数判红橙"（severity.ts）是同一套单位口径（中译英数词、英译中数汉字）；
 *   - **其它硬性错误**：每处 8 分；
 *   - **表达问题**：每处 3 分。
 *
 * ⚠️ **多译（addition）仍然按"每处"扣**：用户只点名了漏译。真要与漏译对齐（按多出的字数扣），
 * 把 `MIRROR_ADDITION_PENALTY` 打开即可——改之前先问，别自己替他决定。
 *
 * ⚠️ 颜色的**处数**（`hardCount` / `softCount`）**照旧把漏译算在内**：漏译在页面上也会被标红或标橙，
 * 图例里少算它就会变成"标了 5 处红、图例说 3 处"——那正是本项目最不想要的那种自相矛盾。
 */

import type { Correction, Direction, Score } from './types'
import { isHardError, severityUnits } from './severity'

/** 每处硬性错误（红色）扣多少分。 */
export const HARD_PENALTY = 8

/** 每处表达问题（橙色）扣多少分。 */
export const SOFT_PENALTY = 3

/** 漏译：**每个单位**（中译英一个词、英译中一个汉字）扣多少分。用户第 13 条。 */
export const OMISSION_PENALTY_PER_UNIT = 1

/** 表达优秀（绿色）是否加分。默认不加分：加分会让"多写亮点"成为刷分动机。 */
export const HIGHLIGHT_BONUS = 0

/** 漏译的扣分细则（界面与文档都引用它，免得三处各说一个数）。 */
export interface OmissionPenalty {
  /** 一共漏了多少个单位 */
  units: number
  /** 一共扣了多少分 */
  penalty: number
}

/**
 * 计算一次批改的分数。
 * 分数只反映"被标出来的错误"，所以它与批注区域里看到的东西一定一致。
 */
export function scoreCorrection(correction: Correction, answer: string, direction: Direction): Score {
  /** 图例用的处数：**含漏译**（漏译也会标色，图例少算它就不一致了） */
  let hardCount = 0
  let softCount = 0
  /** 扣分用的处数：不含漏译（它按字数扣） */
  let fixedHardCount = 0
  let fixedSoftCount = 0
  /** 漏译的单位数与扣分 */
  let omissionUnits = 0

  for (const error of correction.errors) {
    const hard = isHardError(error, direction)
    if (hard) hardCount += 1
    else softCount += 1

    if (error.category === 'omission') {
      omissionUnits += severityUnits(error, direction)
      continue
    }
    if (hard) fixedHardCount += 1
    else fixedSoftCount += 1
  }

  const omissionPenalty = omissionUnits * OMISSION_PENALTY_PER_UNIT
  // 空作答不该拿满分：什么都没写，谈不上"没有错误"
  const wroteNothing = answer.trim().length === 0
  const deduction = fixedHardCount * HARD_PENALTY + fixedSoftCount * SOFT_PENALTY + omissionPenalty
  const raw = wroteNothing ? 0 : 100 - deduction
  const total = Math.max(0, Math.min(100, Math.round(raw + correction.highlights.length * HIGHLIGHT_BONUS)))

  return {
    total,
    hardCount,
    softCount,
    highlightCount: correction.highlights.length,
    omissionUnits,
    omissionPenalty,
  }
}

/** 把计分规则写成一句人话，显示在分数旁边，让用户知道分数是怎么来的。 */
export const SCORING_RULE_TEXT =
  `系统计分：满分 100，每处硬性错误扣 ${HARD_PENALTY} 分、每处表达问题扣 ${SOFT_PENALTY} 分；` +
  `**漏译按字数扣**（漏多少字/词就扣多少分，不再另扣固定分）`

/** 漏译那一行的文案（分数栏里单独列出来，用户才知道这个分是怎么来的）。 */
export function omissionPenaltyText(penalty: OmissionPenalty, direction: Direction): string {
  const unit = direction === 'zh-to-en' ? '个单词' : '个汉字'
  return `漏译扣 ${penalty.penalty} 分（漏 ${penalty.units} ${unit}）`
}
