import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { clampRatio, loadSplit, saveSplit, type SplitScope, type SplitState } from './split-layout'

/**
 * 四栏布局的边界拖动。
 *
 * 设计取舍：
 * - **默认不动**（split === null）：两排按内容自动让位，下方两栏最多占一半、最少留 180px
 *   （见 styles.css 的 .split-row-*）。这是"内容长短不一"时的默认平衡。
 * - **用户拖过之后**：改成他定的比例，不再自动让位——手动调过就以手动为准。
 * - 双击分隔条恢复自动。
 *
 * 拖动起点取"当前实际比例"（量出来的），不是 0.5——
 * 否则从自动布局切到手动的一瞬间画面会跳一下。
 *
 * ## 位置是**落盘**的（用户第 5 条）
 *
 * 用户原话："所有界面可移动分割线的位置需要个性化记忆，下次打开时按照相同位置的分割线展示。"
 * 因此这一版的 `split` 从 localStorage 里读初值，并且**双击恢复默认也写回存储**——
 * 用户对"恢复默认算不算数"的答复是"反正就是，你走的时候什么位置，下次回来之后，
 * 还是在那个位置"，所以恢复默认之后的自动布局就是他要记住的那个位置
 * （见 split-layout.ts 的文件头）。
 *
 * 写的时机只有两处：**一次拖动结束**与**双击恢复默认**。
 * 拖动过程中每一帧都写 localStorage 是没必要的开销（而且中途离开页面时那半截比例
 * 也不是用户想要的位置），因此移动只改内存状态，落盘发生在手松开的那一刻。
 */

export type { SplitState }

export function useSplitDrag(scope: SplitScope, containerRef: RefObject<HTMLElement | null>): {
  split: SplitState | null
  style: CSSProperties | undefined
  beginDrag: (axis: 'v' | 'h', event: ReactPointerEvent<HTMLElement>) => void
  resetSplit: () => void
} {
  const [split, setSplit] = useState<SplitState | null>(() => loadSplit(scope))
  const splitRef = useRef<SplitState | null>(null)
  splitRef.current = split

  /**
   * 量出"现在看起来"的比例，作为拖动起点。
   *
   * 两种布局都要认：
   *   - 练习页：`.split` 里是两排 `.split-row`，横向分界在 `.split-row-top` 的两个 `.pane` 之间；
   *   - 记录页：`.split-records` 直接就是左右两屏（`.screen`），没有排。
   * 认不出来时才退回 0.5——不然从自动布局切到手动的一瞬间画面会跳一下。
   */
  const measure = useCallback((): SplitState => {
    const container = containerRef.current
    if (!container) return { left: 0.5, top: 0.5 }
    const childrenOf = (parent: HTMLElement): HTMLElement[] =>
      [...parent.children].filter(
        (node): node is HTMLElement => node instanceof HTMLElement && !node.classList.contains('splitter'),
      )
    const rows = childrenOf(container).filter((node) => node.classList.contains('split-row'))
    // 横向先看上面那一排里的两栏，没有排就取容器自己的前两个直系子元素
    const columns = rows.length > 0 ? childrenOf(rows[0] as HTMLElement).filter((node) => node.classList.contains('pane')) : childrenOf(container)
    const leftWidth = columns[0]?.getBoundingClientRect().width ?? 0
    const rightWidth = columns[1]?.getBoundingClientRect().width ?? 0
    const topHeight = rows[0]?.getBoundingClientRect().height ?? 0
    const bottomHeight = rows[1]?.getBoundingClientRect().height ?? 0
    const sumX = leftWidth + rightWidth
    const sumY = topHeight + bottomHeight
    return {
      left: sumX > 0 ? clampRatio(leftWidth / sumX) : 0.5,
      top: sumY > 0 ? clampRatio(topHeight / sumY) : 0.5,
    }
  }, [containerRef])

  const beginDrag = useCallback(
    (axis: 'v' | 'h', event: ReactPointerEvent<HTMLElement>): void => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const start = splitRef.current ?? measure()
      const startX = event.clientX
      const startY = event.clientY
      const handle = event.currentTarget
      // 最后一次算出来的位置：松手那一刻要落盘的是它，而不是"上一帧渲染过的"那个
      let latest = start
      setSplit(start)

      const onMove = (move: PointerEvent): void => {
        const next: SplitState = {
          left: axis === 'v' && rect.width > 0 ? clampRatio(start.left + (move.clientX - startX) / rect.width) : start.left,
          top: axis === 'h' && rect.height > 0 ? clampRatio(start.top + (move.clientY - startY) / rect.height) : start.top,
        }
        latest = next
        setSplit(next)
      }
      const finish = (): void => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', finish)
        handle.removeEventListener('pointercancel', finish)
        saveSplit(scope, latest)
      }
      /*
       * ⚠️ `setPointerCapture` 必须包在 try 里：它只在"真有活动指针"时才成立。
       * 合成事件（浏览器验收脚本里 dispatch 出来的 PointerEvent）没有活动指针，
       * 调用会抛 `NotFoundError: No active pointer with the given id`，
       * 而它抛在 React 的事件处理函数里 —— 整棵组件树会因此被兜底界面换掉
       * （实测踩过：练习记录页拖一下横线，整页白屏）。
       * 捕获指针只是"手指滑出元素也继续收事件"的保险，没有它监听器照样在那个元素上。
       */
      try {
        handle.setPointerCapture?.(event.pointerId)
      } catch {
        /* 合成事件 / 老浏览器：不捕获也能拖 */
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', finish)
      handle.addEventListener('pointercancel', finish)
    },
    [containerRef, measure, scope],
  )

  const resetSplit = useCallback((): void => {
    setSplit(null)
    // 「恢复默认」也是"你走的时候的位置"（见文件头），因此照样写回存储
    saveSplit(scope, null)
  }, [scope])

  const style: CSSProperties | undefined = split
    ? ({
        '--col-left': `${split.left}fr`,
        '--col-right': `${1 - split.left}fr`,
        '--row-top': `${split.top}fr`,
        '--row-bottom': `${1 - split.top}fr`,
      } as CSSProperties)
    : undefined

  return { split, style, beginDrag, resetSplit }
}
