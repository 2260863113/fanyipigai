/**
 * 让**同一排**里几栏的标题栏高矮一致（用户第 17 条第 3 条）。
 *
 * 用户原话："所有模式下，将原文和我的译文两个标题栏的高度变成一致。"
 *
 * ## 为什么不能只靠 CSS
 *
 * 两个标题栏都是"按内容定高"的：左边装的是领域/范围下拉（29px 高），
 * 右边装的是「勾画 / 对照」分段开关（34px 高）→ 天生差 5px（实测 46 vs 51）。
 * 这还只是**平时**；术语题判完之后，右边标题栏里会多出「批改记录」下拉、两枚芯片与
 * 「返回编辑」，一个屏幕宽度放不下就折到第二行——两栏于是差 31px（实测 51 vs 82），
 * 底下每格的高度跟着差 3px（十行下来第三十格差 30px）。
 *
 * 差多少取决于**当前状态与窗口宽度**，因此拿一个写死的像素值去凑是凑不准的。
 * 这里改成"量一遍再拉平"：每次渲染（以及容器尺寸变化）量一次各栏标题栏**内容需要**的高度，
 * 取其中最大的那个写成 CSS 变量 `--pane-head-h`，几栏一起用它当最小高度。
 * 内容高的那一栏不再把别的栏甩下，内容矮的那一栏也不会被切掉。
 *
 * ## 量的时序（这里有个坑）
 *
 * `scrollHeight` 量不出"内容真正需要多少"——盒子已经被撑高时，它至少等于 `clientHeight`，
 * 于是量出来的永远是上一轮那个高度，**只会越量越高、再也降不回去**。
 * 因此每一轮都**先把变量撤掉**（回到"按内容定高"），量完再写回去。
 * 两步都发生在同一帧、绘制之前，屏幕上不会闪。
 *
 * 高度写回时不去比较新旧值：变量刚被撤掉，不写回就等于没设——那样反而每帧在"有变量 / 没变量"
 * 之间来回跳（写同一个值是空操作，不会引起重排死循环）。
 */

import { useLayoutEffect, type RefObject } from 'react'

/** 一排里至少要几个标题栏才谈得上"拉平"（只有一栏时把变量撤掉，回到按内容定高）。 */
const MIN_HEADS = 2

export function useEqualPaneHeadHeights(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    /*
     * 只看**上排**那几个栏（原文 / 我的译文）。下排的「总体评分」「批注详情」标题栏里只有标题，
     * 它们由 `.pane-head` 自己的 `min-height` 兜住；记录页里嵌套的那一层也各管各的。
     *
     * ⚠️ 变量写在**这一排**（`.split-row-top`）上，而不是外面那个 `main.split` 上：
     * 外面那个元素的 `style` 是"拖动分隔条"那份状态的**证据**（清空它 = 回到自动布局，
     * 验收脚本量着这一条），往上写一个无关的变量会让那条断言看起来像坏了。
     */
    const row = root.querySelector<HTMLElement>('.split-row-top')
    if (!row) return
    const heads = [...row.querySelectorAll<HTMLElement>(':scope > .pane > .pane-head')]
    if (heads.length < MIN_HEADS) {
      row.style.removeProperty('--pane-head-h')
      return
    }
    row.style.removeProperty('--pane-head-h')
    const needed = Math.max(...heads.map((head) => Math.ceil(head.getBoundingClientRect().height)))
    row.style.setProperty('--pane-head-h', `${needed}px`)
  })
}
