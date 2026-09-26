/**
 * 大改档的对照视图：把 AI 逐句重写的结果排成**四块一组**——
 * 一句原文、一句我的译文、一句修改译文，下面再跟一段「为什么这么改」（第 4 条）。
 *
 * 用户的原话："对照模式，将说明嵌入到对照视图中：一句原文，一句翻译，一句修改，
 * 一段说明（注意，也要格式化拆解，按照分号换行分点）；循环如此。"
 * 说明那一行的分点格式由 `explain-lines.tsx` 统一处理（与右下角大卡片同一套判据）。
 *
 * 用户同时交代过"批改视图不受影响"，因此这里只多排一行**原文**、只换三个标签，
 * 精修档的对照视图（以及它的「原译 / 改后」两个词）一个字都没动。
 *
 * 与精修档的对照视图（CompareView）**同一个渲染器**，差别只在数据来源与标签：
 * 那边是"每处错误所在的那一句"，这边是"AI 重写过的那一句"（见 domain/refine.ts）。
 *
 * 大改档没有勾画、没有批注清单，因此这里不是"点某处看说明"，
 * 而是把每一句的解释**直接印在下面**——一次性读完才知道他为什么这么改。
 *
 * ⚠️ 第 17 条第 5 条：每句**原文后面**多一颗「收藏」，点一下把这一句的
 * 原文 / 我的译文 / 修改译文 / 解释四部分存进「收藏」栏（用户点名的那四样）。
 * 收藏的构造在 `domain/favorites.ts` 的 `sentenceFavoriteOf`，这里只把
 * "哪一句、有没有收藏过、点了怎么办"传下去（`favorite` 这个参数）。
 */

import { useMemo } from 'react'
import { buildRefineLines, type RefineResult } from '../domain/refine'
import type { CompareLine } from '../domain/compare'
import { CompareLines, type CompareLabels } from './CompareLines'

/** 大改档的三个行首标签（用户点名的说法）。 */
const REFINE_LABELS: CompareLabels = { source: '原文', original: '我的译文', corrected: '修改译文' }

export function RefineView({
  refine,
  favorite,
}: {
  refine: RefineResult
  /**
   * 逐句收藏（第 17 条第 5 条）；不传就不画那颗按钮。
   *
   * 之所以由**调用方**传进来而不是在这里自己算：一条收藏要带上"当时是哪道题、第几页、
   * 什么方向、什么话题"，这些只有 App（或记录页）知道——大改视图在两个地方渲染
   * （练习页与练习记录页），各算一份必然有一处忘了带题号，那一条收藏就再也指不回原题。
   */
  favorite?: {
    favorited: (line: CompareLine) => boolean
    onToggle: (line: CompareLine) => void
  }
}) {
  const lines = useMemo(() => buildRefineLines(refine), [refine])
  // 大改档没有可点的批注：选中与点击都退化成空动作
  return (
    <CompareLines
      lines={lines}
      selection={null}
      onSelect={() => undefined}
      labels={REFINE_LABELS}
      {...(favorite ? { sentenceFavorite: favorite } : null)}
    />
  )
}
