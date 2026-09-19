/**
 * 把 range / getClientRects 量出来的一堆矩形，按**顶边**归并成"视觉上的行"。
 * —— 这一份是给**探针**用的（经 CDP 注入页面里跑）。
 *
 * 为什么需要归并：被改的文字外面还套着一层 span（挂荧光笔底色的那个），
 * 嵌套元素会让同一行报出**两个一模一样的矩形**，于是"只有一行"永远判不成立，
 * "两边加空档撑宽"这一步就从来没生效过（实测踩过）。
 *
 * ## 与 src/domain/row-merge.ts 的关系
 *
 * 量坐标要分两边：组件那侧用 src/domain/row-merge.ts，探针这侧要把逻辑
 * 注入页面去跑——CDP 注入的是字符串，没法 import 组件那份。
 * 原先这个算法有**四份**（组件 1 + 探针 3，其中两份还写着
 * "与组件里 shapeOf 的算法一致"这种只能靠人盯的注释）。
 *
 * 现在只有**一份真正的实现**：下面这个函数。注入页面时用 `pageSource()` 取它的
 * 真实源码（`Function.prototype.toString`），所以注入的那份永远与这里一致——
 * 不存在"手抄歪了"的可能。
 *
 * 剩下组件那份（TS 版）无法自动同源，因此由冒烟测试比对两者输出必须一致
 * （见 scripts/smoke.ts 的"行归并的两份实现结果一致"）。**改这里就要同步改那边**。
 *
 * 注意：本文件是纯 JS（会被拼进注入脚本），不能有 TS 语法、import 或 Node 专有 API。
 */

/** 同一行两个矩形的顶边相差多少以内算同一行（亚像素取整的余量）。 */
const ROW_MERGE_EPSILON = 1

/** 只保留有宽度的矩形，并按顶边归并成行；同一行取更宽的那个。 */
function mergeRowsOnTopEdge(rects) {
  const rows = []
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

/**
 * 注入页面用的源码：**本文件里那个函数的真实源码**，外加它依赖的常量。
 *
 * 用 toString() 而不是另手写一份模板字符串——手写就是原先三份漂移的来源。
 */
export function pageSource() {
  return `const ROW_MERGE_EPSILON = ${ROW_MERGE_EPSILON};\n${mergeRowsOnTopEdge.toString()}\n`
}

export { mergeRowsOnTopEdge, ROW_MERGE_EPSILON }
