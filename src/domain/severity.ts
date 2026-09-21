/**
 * 漏译 / 多译的轻重：**由程序按字数判**，而不是让模型选颜色。
 *
 * 用户的口径（原话）："漏 0~2 个单位算橙色，漏三个单位以上算红色"。
 * 之所以要有这么一条：漏译与增译这两类**轻重差别极大**——漏一个冠词和漏掉一整句，
 * 都是"漏译"，但一个该扣 3 分、一个该扣 8 分。让模型去判"严不严重"会把颜色变成模型的心情，
 * 而字数是可以算的，用户也能自己核出来。
 *
 * ## 单位取哪一侧的口径（容易搞反，注意）
 *
 * **漏掉/多出的那段文字活在译文里**，因此按**译文那一侧**的口径数：
 * 中译英的译文是英文 → 数**词**；英译中的译文是中文 → 数**汉字**。
 * 这与文章篇幅的口径（原文那一侧）**恰好相反**，所以下面把方向翻过来再交给 `countUnits`。
 * 一篇中译英里漏掉三个英文词，就是"3 个单位"，判红。
 *
 * ## 量的是哪一段文字
 *
 * - **漏译**：量要补进去的那段（`targetText`）。因此提示词里明确要求"漏译一律用 insert 表达"——
 *   这样 `targetText` 就是漏掉的内容本身，不多不少。
 * - **多译**：量要划掉的那段（`oldText`）。同理要求"多译一律用 delete 表达"。
 * - 万一模型把漏译写成了整句重写（replace / rewrite），`targetText` 是整句、必然超过下限，
 *   于是判红——那也说得通：能把"漏了一整句"说成整句重写的，本来就严重。
 *
 * ## 这条规则只改颜色，不改分类
 *
 * 分类仍然是 `omission` / `addition`（弱项统计照旧按分类数），变的只是它落在红还是橙——
 * 以及跟着变的扣分（红扣 8、橙扣 3，见 scoring.ts）。
 */

import type { Direction, ErrorObject, MarkColor } from './types'
import { HARD_CATEGORIES } from './types'
import { countUnits } from './sections'

/**
 * 轻重线：**不足 3 个单位算轻微**（橙），3 个及以上算严重（红）。
 *
 * 数字是用户定的（"漏 0~2 个单位算橙色，漏三个单位以上算红色"），改之前先想清楚为什么。
 */
export const MINOR_UNITS_LIMIT = 2

/** 按轻重（而不是按分类）定颜色的两个分类。 */
export const SEVERITY_CATEGORIES = ['omission', 'addition'] as const

export function hasLengthSeverity(category: string): boolean {
  return (SEVERITY_CATEGORIES as readonly string[]).includes(category)
}

/**
 * 一处错误"漏掉/多出"了多少个单位。不是漏译/多译时返回 0。
 *
 * 口径见文件头：量的是**译文那一侧**的那段文字，方向因此要翻过来。
 */
export function severityUnits(error: ErrorObject, direction: Direction): number {
  if (!hasLengthSeverity(error.category)) return 0
  const text = error.category === 'omission' ? (error.targetText ?? '') : (error.oldText ?? '')
  const translationSide: Direction = direction === 'zh-to-en' ? 'en-to-zh' : 'zh-to-en'
  return countUnits(text, translationSide)
}

/**
 * 这一处算硬性错误（红）吗？
 *
 * 除漏译/多译之外一律按分类判（由 types.ts 的 HARD_CATEGORIES 定义，不在这里另写一份）；
 * 漏译/多译按上面的字数线判。
 */
export function isHardError(error: ErrorObject, direction: Direction): boolean {
  if (!hasLengthSeverity(error.category)) return HARD_CATEGORIES.includes(error.category)
  return severityUnits(error, direction) > MINOR_UNITS_LIMIT
}

/** 这一处的颜色（红＝硬性错误，橙＝表达问题）。 */
export function colorOfError(error: ErrorObject, direction: Direction): MarkColor {
  return isHardError(error, direction) ? 'red' : 'orange'
}
