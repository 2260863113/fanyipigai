/**
 * 精修档的对照视图：把 AI 逐句重写的结果排成「原译 / 改后」两行，下面跟着这一句的解释。
 *
 * 与润色档的对照视图（CompareView）**同一个渲染器**，差别只在数据来源：
 * 那边是"每处错误所在的那一句"，这边是"AI 重写过的那一句"（见 domain/refine.ts）。
 *
 * 精修档没有勾画、没有批注清单，因此这里不是"点某处看说明"，
 * 而是把每一句的解释**直接印在下面**——一次性读完才知道他为什么这么改。
 */

import { useMemo } from 'react'
import { buildRefineLines, type RefineResult } from '../domain/refine'
import { CompareLines } from './CompareLines'

export function RefineView({ refine }: { refine: RefineResult }) {
  const lines = useMemo(() => buildRefineLines(refine), [refine])
  // 精修档没有可点的批注：选中与点击都退化成空动作
  return <CompareLines lines={lines} selection={null} onSelect={() => undefined} />
}
