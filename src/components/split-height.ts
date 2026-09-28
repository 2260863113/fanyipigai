/**
 * 手机端的两件事，都在这里量：
 *   1. **可视高度** → CSS 变量 `--split-vh`（给两栏的高度算账用）；
 *   2. **输入法是不是开着** → 一个 `data-keyboard` 属性（给"输入法开着时界面怎么变"用）。
 *
 * ## 一、为什么需要 `--split-vh`：一个真实手机上才会暴露的 bug
 *
 * 手机端要求两栏各占可用高度的一半（剩下半屏留给输入法）。
 * 第一版把上排写成 `height: 100dvh`、两栏各 `calc(50dvh / 2)`。
 * **无头浏览器里 62 项验收全绿**，真机上整个界面是废的
 * （用户："所有东西全部重叠在第一行，根本没法用"）：
 *
 *   - `dvh` 是**视口**高，而 `.split` 上面还有一条 56px 的顶栏、下面还有页脚，
 *     于是"100dvh 的上排" + 顶栏 + 页脚把 `.app` 顶到 **953px**，而屏幕只有 **844px**；
 *   - `.app` 是 `overflow: hidden`、`html/body/#root` 又都是 `height: 100%`
 *     （**没有滚动条**），因此多出来那一截**既看不到、也滚不到**。
 *
 * 修法试错过两次（都写在 ADR 0032 第七节）：量 `main.split` 自己会成环（它高度由内容决定）、
 * 量它的父亲 `.app` 会多算一个顶栏。最后**量的是 `#root`**——它就是可视高度，
 * **与页面内容无关**，因此不成环；顶栏那 56px 由样式表用全站已有的令牌 `--topbar-h` 扣掉。
 *
 * ## 二、为什么用 `innerHeight` 而不是 `ResizeObserver`
 *
 * 这里**刻意不上观察器**：观察一个"高度取决于页面内容"的元素
 * （`documentElement` / `body` 都会因为内容变高而变高）会形成反馈——
 * 变量一改、内容一变、高度又变，量出来的数会一路涨上去（实测过：76 → 149 → 222）。
 * 因此只读 `window.innerHeight` / `visualViewport`（都不受页面内容影响），
 * 再加监听。
 *
 * ## 三、输入法怎么认出来（这一节是给"输入法开着时隐藏按钮"那条要求用的）
 *
 * 用户要求（第 19 条）：「当用户点开输入法的时候，隐藏『原文』这个标题栏，
 * 隐藏提交批改、翻页等所有按钮，当且仅当用户关掉输入法，才重新显现出来。」
 *
 * 手机上的输入法**不是**网页的一部分，浏览器只通过一件事告诉我们它在：
 * **可视区变矮了**。两个平台的上报方式还不一样：
 *
 *   - **安卓 Chrome**：`window.innerHeight` 直接变矮（页面被压缩）；
 *   - **苹果 Safari**：`innerHeight` **不变**，变的是 `visualViewport.height`。
 *
 * 因此这里两个都看，取**较小的那个**当作"当前能看见多少"，
 * 再跟"没有输入法时能看见多少"（基线）比：矮掉 **20% 以上**就认为输入法开着。
 *
 * 20% 这个门槛是留余量的：地址栏伸缩也会让可视区矮一点（通常 5%～10%），
 * 而输入法一弹出来通常要吃掉 40%～50%，两档之间隔得很开，因此不会把地址栏误判成输入法。
 *
 * 基线的取法有一条讲究（**踩过**）：不能拿"挂载那一刻的高度"当基线——
 * 那样一进页面时地址栏还没收起，基线就偏小，之后地址栏一收页面变高，
 * 反方向的差会算出负数、判据乱掉。这里维护的是**滚动最大值**：
 * 只要页面变得更高就抬高基线（说明这才是不受遮挡的真实高度），
 * 变矮则不动它（那正是输入法）。旋屏（宽度变了）时基线作废、重新开始学。
 */

import { useEffect, useState } from 'react'

/** 矮掉这么多就认为输入法开着（见文件头第三节对 20% 这个数的说明）。 */
const KEYBOARD_RATIO = 0.8

/** 现在能看见多少（苹果 Safari 只认 visualViewport，安卓两边都变小）。 */
function visibleHeight(): number {
  const inner = window.innerHeight || 0
  const visual = window.visualViewport?.height ?? 0
  /* 取较小的那个：两个都不为 0 时，谁小谁才是"真正看得见"的高度 */
  if (inner > 0 && visual > 0) return Math.min(inner, visual)
  return inner || visual
}

/**
 * 把可视高度写进 `--split-vh`，并返回"输入法是不是开着"。
 *
 * 返回值直接给界面用（手机端靠它挂 `data-keyboard` 属性开关那一整套样式）。
 */
export function useViewportHeightVar(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    /** 没有输入法时能看见多少（取滚动最大值，见文件头第三节） */
    let baseline = visibleHeight()
    let baselineWidth = window.innerWidth

    const write = (): void => {
      const height = visibleHeight()
      if (height > 0) document.documentElement.style.setProperty('--split-vh', `${height}px`)

      /*
       * 旋屏（宽度变了）：可视高度会整体换一个量级，老基线不再适用，
       * 而且那一瞬间也分不清是输入法还是方向变了——因此基线重新学一遍。
       */
      if (window.innerWidth !== baselineWidth) {
        baselineWidth = window.innerWidth
        baseline = height
        setKeyboardOpen(false)
        return
      }

      /* 变高了：说明地址栏收起来了、或者输入法关掉了——这才是"不遮挡"的高度 */
      if (height > baseline) baseline = height

      setKeyboardOpen(baseline > 0 && height < baseline * KEYBOARD_RATIO)
    }

    write()
    window.addEventListener('resize', write)
    window.addEventListener('orientationchange', write)
    /*
     * 苹果 Safari 上输入法弹出**不一定**发 window 的 resize，
     * 但它会改 visualViewport —— 那边有自己的一套事件，因此两处都挂。
     */
    const visual = window.visualViewport
    visual?.addEventListener('resize', write)
    visual?.addEventListener('scroll', write)
    return () => {
      window.removeEventListener('resize', write)
      window.removeEventListener('orientationchange', write)
      visual?.removeEventListener('resize', write)
      visual?.removeEventListener('scroll', write)
    }
  }, [])

  return keyboardOpen
}
