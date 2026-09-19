import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

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
 */
export interface SplitState {
  /** 左栏占的横向比例（0–1） */
  left: number
  /** 上排占的纵向比例（0–1） */
  top: number
}

const MIN = 0.15
const MAX = 0.85

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, value))
}

export function useSplitDrag(containerRef: RefObject<HTMLElement | null>): {
  split: SplitState | null
  style: CSSProperties | undefined
  beginDrag: (axis: 'v' | 'h', event: ReactPointerEvent<HTMLElement>) => void
  resetSplit: () => void
} {
  const [split, setSplit] = useState<SplitState | null>(null)
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
      left: sumX > 0 ? clamp(leftWidth / sumX) : 0.5,
      top: sumY > 0 ? clamp(topHeight / sumY) : 0.5,
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
      setSplit(start)

      const onMove = (move: PointerEvent): void => {
        const next: SplitState = {
          left: axis === 'v' && rect.width > 0 ? clamp(start.left + (move.clientX - startX) / rect.width) : start.left,
          top: axis === 'h' && rect.height > 0 ? clamp(start.top + (move.clientY - startY) / rect.height) : start.top,
        }
        setSplit(next)
      }
      const finish = (): void => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', finish)
        handle.removeEventListener('pointercancel', finish)
      }
      // setPointerCapture 在 jsdom 里可能不存在，可选调用
      handle.setPointerCapture?.(event.pointerId)
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', finish)
      handle.addEventListener('pointercancel', finish)
    },
    [containerRef, measure],
  )

  const resetSplit = useCallback((): void => setSplit(null), [])

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