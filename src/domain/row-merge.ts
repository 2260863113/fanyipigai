/**
 * 把 range / getClientRects 量出来的一堆矩形，按**顶边**归并成"视觉上的行"。
 *
 * 为什么需要归并：被改的文字外面还套着一层 span（挂荧光笔底色的那个），
 * 嵌套元素会让同一行报出**两个一模一样的矩形**，于是"只有一行"永远判不成立，
 * "两边加空档撑宽"这一步就从来没生效过（实测踩过）。
 *
 * ## 为什么这份逻辑有"两份实现"，以及怎么防止它们漂移
 *
 * 量坐标要分两边做：
 *   - 组件这一侧（测量方框该摆哪）用本文件；
 *   - 探针那一侧（把像素量出来核对）注入页面里的脚本用 scripts/lib/row-merge.mjs。
 *
 * 探针在 CDP 的模板字符串里跑，**结构上没法 import 本文件**，所以只能是两份。
 * 原先更糟：这个算法有**四份**（组件 1 + 探针 3，其中两份还写着
 * "与组件里 shapeOf 的算法一致"这种靠人盯的注释）。
 *
 * 现在靠一条断言兜住：冒烟测试把两份实现喂同一批矩形，比对输出必须一致
 * （见 scripts/smoke.ts 的"行归并的两份实现结果一致"）。改了这里而没改那边，
 * 测试立刻红——这比"注释提醒"可靠。所以**改动本文件时必须同步
 * scripts/lib/row-merge.mjs**。
 */

/** 同一行两个矩形的顶边相差多少以内算同一行（亚像素取整的余量）。 */
export const ROW_MERGE_EPSILON = 1

/** 只保留有宽度的矩形，并按顶边归并成行；同一行取更宽的那个。 */
export function mergeRowsOnTopEdge<T extends { top: number; width: number }>(rects: readonly T[]): T[] {
  const rows: T[] = []
  for (const rect of [...rects].filter((item) => item.width > 0).sort((a, b) => a.top - b.top)) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(rect.top - last.top) < ROW_MERGE_EPSILON) {
      if (rect.width > last.width) rows[rows.length - 1] = rect
      continue
    }
    rows.push(rect)
  }
  return rows
}
