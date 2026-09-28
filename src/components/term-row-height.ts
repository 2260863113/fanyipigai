/**
 * 术语模式 + 手机端的两件事：输入法一开，十条术语行放大到 **3 倍**；
 * 并且让两栏的正文盒**等高**（第 17 条第 4 条"两栏的格子必须一格对一格"）。
 *
 * ## 一、为什么"三倍"要量（用户第 19 条）
 *
 * 用户原话（意思）：「术语翻译模式下，打开输入法时，**每一个术语所在行的行高度，
 * 增加为现在的三倍**，输入栏的每一个输入栏也增加到现在高度的三倍。
 * 关掉输入法之后，每一条译文所在行的高度变成和关掉输入法后原文行高度一样。」
 *
 * "现在的三倍"里的**现在**是关键词：那个高度是**算出来的**——两栏的十条术语行各占
 * `flex: 1 1 0`、把可用高度十等分（见 styles.css 的 `.term-source-list` / `.term-list`），
 * 因此"一行多高"取决于当帧的可用高度与行数，写死一个像素数必然对不上。
 * 这与第 17 条那批"版式靠测量"是同一条口径（ADR 0031）：**要一样高，就量一遍再落。**
 *
 * ## 二、⚠️ 量什么：踩过三个坑，都记在这里
 *
 * 正确答案是量**行所在的那个正文盒**（`.pane-body`）：
 * 一行多高 = `(正文盒可用高度 − 行间距) / 行数`。
 * 它的高度由栏高决定、与我们怎么排那些行无关（因果单向），因此量它安全。
 * 另外三种量法实测都不行：
 *
 *   1. **量行本身**：一旦样式表把行的 `flex-basis` 改成三倍，行高就由我们控制了，
 *      再拿它当"现在的行高"就是自证——量出来永远是上一轮那个放大值；
 *   2. **量装行的那个列**（`.term-rows`）：① 它只长在**作答栏**里，原文栏那边是
 *      `.term-source-list` 直接挂在正文盒下，选择器抓不到；② 它自己也 `flex: 1 1 auto`，
 *      在"行被我们撑大"的那一档会被内容挤扁——实测量到 **0.35px**（原样乘 3 还是 0.35px）；
 *   3. **两栏只量到一栏就凑合用**：输入法刚弹出来那一帧原文栏可能暂时量不到，
 *      拿另一栏的数当基线，三倍之后是 **48px** 而正确答案是 **39px**（验收脚本抓到的）。
 *      现在**两栏都必须量得出来**才算数，取较小值。
 *
 * ## 三、⚠️ 基线只在**输入法关着**时学，且要等布局安静下来
 *
 * 输入法弹出/收起是一段两三百毫秒的动画，期间视口高度会经过好几个中间值。
 * 直接写会把这些过渡态当成"现在的行高"记进基线（实测吃到过 2.8px，
 * 三倍之后 8.4px，屏幕上看着像完全没放大）。因此观察器回调**推迟到安静下来再写**。
 *
 * 基线还只在 `!keyboardOpen` 时更新：输入法开着那一档的正文盒本来就矮得多，
 * 拿它当基准的话"三倍"反而比平时还小——用户说的显然是**平时那个行高**。
 *
 * ## 四、为什么还要管"两栏正文盒等高"
 *
 * 手机上两栏的 pane 一样高，但**"非正文部分"不一样**：
 *   - 原文栏：上面 51px 的标题栏（「原文 · 选择」）；
 *   - 译文栏：0（标题栏在手机上不画）+ 下面 87px 的底部操作栏
 *     （装着「提交批改 / 精修大改 / 批改记录 / 上一页 / 下一页」）。
 *
 * 于是两栏正文盒 **255 vs 218**、十条格子 **23px vs 19px**——每差 1px，
 * 十条下来最后一行就错开 10px，正是第 17 条第 4 条（ADR 0031）不许发生的事。
 * 桌面端靠 `--term-foot-h` 那条补偿维持它，而手机上那条补偿已经不成立（见 styles.css）。
 *
 * 这里用一个 `--term-pane-body` 把**较高的那个正文盒**压到较矮那个的高度上。
 *
 * ⚠️ 量它之前必须**先把变量撤掉再量**（与 `pane-heads.ts` 量标题栏同一个手法）：
 * 不撤的话量到的是"已经被自己压过的高度"，实测写进去 217.5px 而实际是 218px，
 * 而且**输入法关掉之后不再恢复**（两栏停在 155px、本该回到 218px）。
 * 先撤再量，因果才是单向的。
 *
 * ⚠️ **批改视图下不封顶**：那一档两栏要"有多长就展开多长"（用户第 18 条），
 * 封顶会把展开的内容剪掉（验收脚本第 7 节量到过"译文多余 66px"）。
 */

import { useEffect, useRef, type RefObject } from 'react'

/** 一条术语行在原高之上的放大倍数（用户点名"三倍"）。 */
export const TERM_ROW_SCALE = 3

/**
 * 采信基线的下限（像素）。真实的一行怎么也有十几像素；
 * 比它更小的只可能是"视口刚变、布局还没稳"那一帧量出来的过渡值——
 * 实测吃到过 2.8px（三倍之后 8.4px，屏幕上看着像完全没放大）。
 */
const MIN_ROW_PX = 10

/** 行间距从计算样式里读；读不到时按 0 算（宁可少扣一点，也不要凭空造一个数） */
function rowGapOf(list: HTMLElement | null): number {
  return Number.parseFloat(list ? getComputedStyle(list).rowGap : '0') || 0
}

export function useTermRowHeight(ref: RefObject<HTMLElement | null>, enabled: boolean, keyboardOpen: boolean): void {
  /** 记着"输入法关着时"一行有多高——放大倍数是以它为基准的（见文件头第三节）。 */
  const baselineRef = useRef(0)

  useEffect(() => {
    const root = ref.current
    if (!root) return

    if (!enabled) {
      root.style.removeProperty('--term-row-h')
      root.style.removeProperty('--term-pane-body')
      return
    }

    const bodyOf = (selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector)
    const listOf = (body: HTMLElement): HTMLElement | null =>
      body.querySelector<HTMLElement>('.term-source-list, .term-list')

    /** 一行有多高（按这个正文盒的**可用**高度算），量不出来返回 null */
    const perRowOf = (body: HTMLElement | null, height: number): number | null => {
      if (!body) return null
      const list = listOf(body)
      const rows = list ? list.children.length : 0
      if (rows <= 0) return null
      const style = getComputedStyle(body)
      const inner =
        height - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0)
      if (inner <= 0) return null
      const gap = rowGapOf(body.querySelector<HTMLElement>('.term-rows'))
      const perRow = (inner - gap * (rows - 1)) / rows
      return perRow > 0 ? perRow : null
    }

    const write = (): void => {
      /*
       * 第一步：**先把封顶撤掉再量**（关键，见文件头第四节）。
       * 撤掉之后两栏正文盒都回到"栏本来能给多少"，量到的才是真数。
       */
      root.style.removeProperty('--term-pane-body')

      const sourceBody = bodyOf('.pane-source .pane-body')
      const answerBody = bodyOf('.pane-answer .pane-body')
      const sourceHeight = sourceBody?.getBoundingClientRect().height ?? 0
      const answerHeight = answerBody?.getBoundingClientRect().height ?? 0

      /*
       * 第二步：**先算"一行多高"，再封顶**。
       *
       * ⚠️ 顺序不能反。第一版是"先封顶、再量行高"，于是量到的是**已经被自己压过**的高度：
       * 手机上输入法开着时正文盒 155px、封顶之后只剩 6.3px 一行，直接跌破
       * `MIN_ROW_PX` 那道下限、整轮提前返回——结果是 `--term-row-h` **根本没写上**，
       * 屏幕上那个"三倍"其实是样式表里的**兜底值** 48px（验收脚本量到的一直是 48 而不是 38）。
       * 现在用的这两个高度都是**撤掉封顶之后**量的，与怎么排那些行无关。
       */
      const source = perRowOf(sourceBody, sourceHeight)
      const answer = perRowOf(answerBody, answerHeight)

      /*
       * 第三步：两栏正文盒封顶成同一个高度（取较矮那个），让两栏的格子一格对一格。
       * ⚠️ 批改视图不封顶（那一档要"有多长就展开多长"，封顶会把内容剪掉）。
       */
      const measured = [sourceHeight, answerHeight].filter((value) => value > 0)
      if (root.getAttribute('data-result') === null && measured.length === 2) {
        const cap = Math.min(...measured)
        if (cap > 0) root.style.setProperty('--term-pane-body', `${cap}px`)
      }

      /*
       * 第四步：写"一行多高"。
       * ⚠️ 两栏都必须量得出来才算数（见文件头第二节第 3 个坑）。
       */
      if (source === null || answer === null) return
      const perRow = Math.min(source, answer)

      if (!keyboardOpen) {
        /*
         * 输入法关着：**学基线**（放大的基准就是它），并把这个原高写进变量。
         *
         * ⚠️ `MIN_ROW_PX` 这道下限**只在这里**用：基线是"平时一行有多高"，
         * 它必须是十几像素这个量级；比它更小的只可能是"视口刚变、布局还没稳"
         * 那一帧量到的过渡值（实测 2.8px）。**不能拿它去卡输入法开着那一档**——
         * 那一档一行本来就矮（375×667 上正文盒只剩 155px、一行 6.3px），
         * 卡下去会导致整轮提前返回、变量根本没写上（第一版就是这么错的：
         * 屏幕上那个"三倍"其实是样式表里的兜底值 48px，而正确的数是 38px）。
         */
        if (perRow >= MIN_ROW_PX) baselineRef.current = perRow
        root.style.setProperty('--term-row-h', `${Math.round(perRow)}px`)
        return
      }

      const baseline = baselineRef.current >= MIN_ROW_PX ? baselineRef.current : perRow
      root.style.setProperty('--term-row-h', `${Math.round(baseline * TERM_ROW_SCALE)}px`)
    }

    write()

    if (typeof ResizeObserver !== 'function') return
    /*
     * 观察器回调**推迟到布局安静下来再写**（见文件头第三节：输入法那段动画的中间值不能当基线）。
     * 首帧那次 `write()` 是同步的、仍然照跑，因此刚挂载时不会迟一下才生效。
     */
    let timer = 0
    const schedule = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(write, 60)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(root)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [ref, enabled, keyboardOpen])
}
