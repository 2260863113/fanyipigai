/**
 * 把 `#root` 的**实测高度**（= 真正的可视高度）写成 CSS 变量 `--split-vh`。
 *
 * ## 为什么需要它：一个真实手机上才会暴露的 bug
 *
 * 手机端要求"原文栏与我的译文栏各占可用高度的一半"（剩下半屏留给输入法）。
 * 我第一版把上排写成 `height: 100dvh`，两栏各 `calc(50dvh / 2)`。
 * **无头浏览器里 62 项验收全绿**，真机上整个界面是废的
 * （用户原话："所有东西全部重叠在第一行，根本没法用"）：
 *
 *   - `dvh` 是**视口**高，而 `.split` 上面还有一条 56px 的顶栏（三条横线 + 标题）、
 *     下面还有页脚——"100dvh 的上排" + 顶栏 + 页脚把 `.app` 顶到 **953px**，
 *     而屏幕只有 **844px**；
 *   - `.app` 是 `overflow: hidden`、`html/body/#root` 又都是 `height: 100%`
 *     （**没有滚动条**），于是多出来那一截**既看不到、也滚不到**：
 *     底部的提交按钮与「上一页 / 下一页」整条落在屏幕外。
 *
 * 无头浏览器里量不出来是因为**它没有地址栏**：`dvh == vh == innerHeight`，两种写法碰巧都对。
 *
 * ## 为什么量的是 `#root`，以及为什么不能量 `.app` 或 `main.split`
 *
 * 这个 bug 的修法试错过两次，两次都是**量错了对象**，记在这里免得以后再走一遍：
 *
 *   1. **量 `main.split` 自己** → 立刻塌成 1px。它的 `flex` 是 `1 1 0%`，
 *      高度由内容决定，而内容又由这个变量决定 —— 成环，解是"越小越好"；
 *   2. **量 `main.split` 的父亲**（就是 `.app`）→ 拿到 844，而真正能分给两栏的是
 *      **788**（844 减去 56 的顶栏）。于是两栏各 422、加起来 844 > 788，
 *      译文栏底部照样溢出 56px（正好是顶栏的高度，这是一条很好的线索）。
 *
 * 正确的对象是 `#root`：它的高度 = **视口高**，**与页面内容无关**
 * （它上面只有 `html/body` 两层 `height: 100%`），因此量它**不会成环**。
 * 顶栏那 56px 不在这里扣——由样式表用 `calc(50% - var(--topbar-h) / 2)` 扣，
 * 那个数字全站已经有一个令牌（`--topbar-h`），不该在 JS 里再写一遍。
 *
 * 这与 ADR 0031 的两条教训是同一条：**量出来的必须是一个"与内容无关"的盒子**，
 * 否则量到的永远是上一轮的结果、甚至越量越极端。
 *
 * ## 为什么用 `innerHeight` 而不是 `ResizeObserver`
 *
 * 这里**刻意不上观察器**：观察一个"高度取决于页面内容"的元素
 * （`documentElement` / `body` 都会因为内容变高而变高）会形成反馈——
 * 变量一改、内容一变、高度又变，量出来的数会一路涨上去（实测过：76 → 149 → 222）。
 * 因此只读 `window.innerHeight`（它就是可视高度，不受页面内容影响），
 * 再加一个 `resize` 监听——地址栏伸缩、旋屏、输入法弹出**都会**改变可视高度，
 * 桌面浏览器上它们都会触发 `resize`。
 */

import { useEffect } from 'react'

/**
 * 把可视高度写进 `document.documentElement` 的内联样式：`--split-vh`。
 *
 * 写在 `<html>` 上（而不是某个组件里）是因为用它的是手机端那一段版式规则
 * （`.split-mobile > .split-row-top > .pane` 的 `flex-basis`），
 * 而那条规则要在两栏上生效、与具体的 DOM 层级无关。
 *
 * ⚠️ 变量名里的 `split` 是历史叫法（它最早是"给 `main.split` 用的高度"）。
 * 现在它装的是**可视高度**，顶栏那 56px 由样式表用 `calc(… - var(--topbar-h) / 2)` 扣掉——
 * 那个数字全站已经有一个令牌，不该在这里再写一遍。
 */
export function useViewportHeightVar(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const write = (): void => {
      const height = window.innerHeight
      if (height > 0) document.documentElement.style.setProperty('--split-vh', `${height}px`)
    }

    write()
    window.addEventListener('resize', write)
    /* 旋屏有时只发 orientationchange、不发 resize（老机型上实测过） */
    window.addEventListener('orientationchange', write)
    return () => {
      window.removeEventListener('resize', write)
      window.removeEventListener('orientationchange', write)
    }
  }, [])
}
