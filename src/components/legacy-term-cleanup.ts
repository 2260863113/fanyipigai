/**
 * 术语库换代时，把**旧术语的记录与收藏一次性清掉**。
 *
 * ## 为什么要清
 *
 * 练习记录与收藏都**不存题干**，只存题号——原文要靠题号回题库里现取
 * （见 records-store.ts 的说明）。术语库整批换成两份机关名称材料之后，
 * 题号从 `term-v2-<领域>-<第几组>` 变成 `term-v3-<范围>-<方向>`，
 * 于是旧术语记录再也找不到对应的题：记录页上会变成一批没有题干、点开画不出东西的条目。
 * 用户对这一点的答复是："删掉我之前留下的术语记录，未来我留下的术语记录不会被自动删掉。"
 *
 * ## "以后永不再删"是**判据**保证的，不是靠自觉
 *
 * 判据是**旧代次的题号前缀**（`isLegacyTermExerciseId`：`term-v2-` 开头）。
 * 新代次的题号是 `term-v3-…`，**在结构上不可能**被这条判据命中，
 * 因此"以后我再练的术语记录"永远安全——它不依赖"这段代码只跑一次"这种约定。
 * （也正因为如此，本模块可以放心地在每次打开时都跑一遍：清完之后它一个都挑不出来。）
 *
 * ## 只碰术语，别的一律不动
 *
 * 文章题、句子题、内置题、自己贴的题——那些记录的题号解析得出来，因此原样留着。
 * 收藏与记录是两份数据，用户选的是**两样一起清**。
 */

import type { Favorite } from '../domain/favorites'
import type { RecordView } from './RecordsView'
import { isLegacyTermExerciseId } from '../domain/term-exercise'

/** 这些记录里有没有旧术语的（有就值得清一次）。 */
export function countLegacyTermRecords(records: readonly RecordView[]): number {
  return records.filter((record) => isLegacyTermExerciseId(record.exerciseId)).length
}

/** 这些收藏里有没有旧术语的。 */
export function countLegacyTermFavorites(favorites: readonly Favorite[]): number {
  return favorites.filter((favorite) => isLegacyTermExerciseId(favorite.exerciseId)).length
}

/** 去掉旧术语的记录，其余原样保留（顺序不变）。 */
export function dropLegacyTermRecords(records: readonly RecordView[]): RecordView[] {
  return records.filter((record) => !isLegacyTermExerciseId(record.exerciseId))
}

/** 去掉旧术语的收藏，其余原样保留（顺序不变）。 */
export function dropLegacyTermFavorites(favorites: readonly Favorite[]): Favorite[] {
  return favorites.filter((favorite) => !isLegacyTermExerciseId(favorite.exerciseId))
}
