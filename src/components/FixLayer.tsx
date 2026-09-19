import { useEffect, useState, type RefObject } from 'react'
import type { AnnotatedLayout } from '../domain/layout'
import { placeFixBoxes, type FixBoxInput, type FixBoxPlacement } from '../domain/fix-layout'
import type { Selection } from './annotation-summary'

/** 一处要画成方框的填补内容。 */
export interface FixItem {
  /** 段落在 layout 里的唯一键（同一处错误可能有两个方框） */
  key: string
  errorId: string
  text: string
  color: string
}

/** 画出来的一个方框（跨行的补写内容会拆成好几个）。 */
interface PlacedBox {
  /** 同一处填补拆成多段时每段各有编号 */
  key: string
  item: FixItem
  /** 这一段要写的字 */
  text: string
  placement: FixBoxPlacement
  width: number
  height: number
  /** 宽到整行放不下、只能折行的那些（超长重写） */
  flowsOver: boolean
}

/** 容器里的一个矩形（相对容器左上角）。 */
interface Rect {
  left: number
  width: number
  top: number
  /** 内容盒的高度：带子层照原样画一条同高的带子 */
  height: number
}

/**
 * 把 range 量出来的矩形按**顶边**归并成"行"，并排好序。
 *
 * 不能直接数矩形个数：被改的文字外面还套着一层 span（挂荧光笔底色的那个），
 * 嵌套元素会让同一行报出两个一模一样的矩形，于是"只有一行"永远判不成立，
 * "两边加空档撑宽"这一步就从来没生效过（实测踩过）。
 */
function anchorRows(element: HTMLElement): DOMRect[] {
  // jsdom 没有实现 Range.getClientRects（冒烟测试跑在 jsdom 里），所以先探一下能力
  if (typeof document.createRange !== 'function') return []
  const range = document.createRange()
  range.selectNodeContents(element)
  if (typeof range.getClientRects !== 'function') return []

  const rows: DOMRect[] = []
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0)
    .sort((a, b) => a.top - b.top)
  for (const rect of rects) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(rect.top - last.top) < 1) {
      // 同一行的重复矩形（嵌套元素报的），取宽的那个
      if (rect.width > last.width) rows[rows.length - 1] = rect
      continue
    }
    rows.push(rect)
  }
  return rows
}

function rectOf(rect: { left: number; width: number; top: number; height: number }, base: DOMRect): Rect {
  return {
    left: rect.left - base.left,
    width: rect.width,
    top: rect.top - base.top,
    height: rect.height,
  }
}

/**
 * 量一处被改内容：**每一行**的矩形、以及按行相加的总宽。
 *
 * 为什么总宽要按行相加：被改内容跨两行时（"有一半在上一行"），
 * 它横向一共占掉的就是两行之和——要跟上方补写的字比宽，比的就是这个数。
 */
interface AnchorShape {
  /** 最宽的那一行（只有一段时方框居中于它） */
  rect: Rect
  /** 各行宽度之和：补写内容要与之等宽的，单行时就是这个数 */
  totalWidth: number
  /** 每一行的文字矩形（按行序） */
  rows: Rect[]
}

function shapeOf(element: HTMLElement, base: DOMRect): AnchorShape | null {
  const rows = anchorRows(element)
  let picked: DOMRect | null = null
  for (const row of rows) {
    if (!picked || row.width > picked.width) picked = row
  }
  if (!picked) {
    // 量不出矩形时退回元素自身的包围盒，至少不崩
    const fallback = element.getBoundingClientRect()
    if (!(fallback.width > 0)) return null
    return {
      rect: rectOf(fallback, base),
      totalWidth: fallback.width,
      rows: [rectOf(fallback, base)],
    }
  }
  return {
    rect: rectOf(picked, base),
    totalWidth: rows.reduce((sum, row) => sum + row.width, 0),
    rows: rows.map((row) => rectOf(row, base)),
  }
}

/**
 * 元素自身的**分行**矩形：跨行时一个片段一个。
 *
 * 它量的是**画出来的荧光笔带子**（含空档、含行尾那个空格），正是方框要对齐的东西；
 * 文字矩形（shapeOf 里按 Range 量的）不含行尾空格，拿它对不齐。
 */
function fragmentRects(element: HTMLElement, base: DOMRect): Rect[] {
  if (typeof element.getClientRects !== 'function') return []
  return Array.from(element.getClientRects())
    .filter((rect) => rect.width > 0)
    .map((rect) => rectOf(rect, base))
}

/** 插入点在译文上的那块荧光笔空位（宽度由这里量出来再写上去）。 */
function slotOf(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>('.mk-slot')
}

/**
 * 挑断点：把补写内容切成几段，一段占一行。
 *
 * `targets` 是**累计余量**（前 i 行各自"带子宽 − 外侧各 4 个空格"加起来）。
 * 断点取最接近的那个：词边界是量化的，取"装得下的最大那个"会把每行的零头都浪费掉、
 * 全压到最后一行去；取最近的则把这点零头摊到各行，谁也不会明显挤出去。
 *
 * 断点只落在词与词之间——词内部一旦断开，读起来就不是句子了。
 */
function chooseCuts(prefix: readonly number[], targets: readonly number[]): number[] {
  const cuts: number[] = []
  let from = 1
  targets.forEach((target, index) => {
    // 后面还有几个断点，就得给它们各留至少一个词的位置
    const last = prefix.length - 1 - (targets.length - index - 1)
    let best = from
    let bestDelta = Number.POSITIVE_INFINITY
    for (let k = from; k <= last; k += 1) {
      const delta = Math.abs((prefix[k] ?? 0) - target)
      if (delta < bestDelta) {
        bestDelta = delta
        best = k
      }
    }
    cuts.push(best)
    from = best + 1
  })
  return cuts
}

/** 一处填补的完整中间量：锚点、补写内容拆成的几段、以及各段两边要加多宽的空档。 */
interface Entry {
  item: FixItem
  element: HTMLElement
  /** 插入点：译文上没有文字，只有一个荧光笔空位 */
  isInsert: boolean
  /** 有实际文字可撑宽吗（插入点没有"内容"可撑，它自己就是一块空位） */
  hasText: boolean
  /** 被改内容每一行的文字矩形（按行序，撑开前量到的） */
  rows: Rect[]
  /** 每一行画出来的带子（撑开前量到的矩形，含行尾空格）——切断点按它的占比来分 */
  naturalBands: Rect[]
  /** 每一行画出来的带子（撑开之后的最终值，方框按它摆位） */
  bands: Rect[]
  /** 最宽的那一行 */
  anchor: Rect
  /** 各行相加的总宽 */
  textWidth: number
  /** 补写内容自然状态下的宽高（整句，未拆） */
  fullWidth: number
  fullHeight: number
  /** 补写内容按原译文换行位置拆成的几段（通常只有一段） */
  parts: string[]
  partWidths: number[]
  partHeights: number[]
  partFlows: boolean[]
  /** 第一行左边、最后一行右边各加多宽的空档（CSS 正好按这个规矩落位） */
  padFirst: number
  padLast: number
}

/**
 * 填补内容层。
 *
 * 为什么单独成层：正确写法要画成互不覆盖的方框，而方框的宽高只有渲染出来才知道，
 * 所以必须"先渲染在文字流之外量一次、再摆位置"。
 *
 * 一条约定：**补写内容去适配被改内容，而不是反过来**。
 * 荧光带只比被改内容宽出左右各 2 个空格（见第 6 步），补写内容限宽到那条带子再左右各缩 2 个空格，
 * 放不下就在词与词之间折行（见第 8 步）——"任意相邻两个单词都能断开"就是这么做出来的。
 * 撑宽那一小段空档是真占地方的（相邻文字会被推开），但它只有 8–9px，整段排版几乎不动。
 *
 * 一次测量分七步，**顺序不能换**：
 *   1. 先清掉上一轮加的空档与空位宽度；
 *   2. 量方框的自然尺寸（插入点那块荧光笔空位的宽度就是从这一步来的）；
 *   3. 把空位宽度写上去，**再**量锚点——空位是有宽度的，它一落地整段文字的换行就定了；
 *   4. 量锚点的每一行：文字矩形、画出来的带子、总宽；
 *   5. 被改内容跨行、且补写内容比它宽时，把补写内容按各行的宽度占比拆成几段（一段对一行）；
 *   6. 该撑的加空档，撑到与对应的那一段等宽（量一遍、差多少补多少，最多两轮）；
 *   7. 按**撑开之后**的锚点摆位置：单段居中于最宽那一行，多段各对各自那一行的带子。
 */
export function FixLayer({
  containerRef,
  layout,
  items,
  onSelect,
  onNeedSpace,
  grantedSpace = 0,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  layout: AnnotatedLayout
  items: readonly FixItem[]
  onSelect: (selection: Selection | null) => void
  /** 方框那一摞需要多少竖直空间（正文据此加大行间距、顶部也留同样多） */
  onNeedSpace: (space: number) => void
  /** 上面已经给了多少：只比这个多才再要，避免"要空间 → 重新量 → 还要空间"停不下来 */
  grantedSpace?: number
}) {
  const [boxes, setBoxes] = useState<PlacedBox[]>([])

  /** 容器尺寸的指纹：宽或高一变就重排（见下面那个 ResizeObserver 的说明）。 */
  const [sizeKey, setSizeKey] = useState('')

  /*
   * 译文栏一改宽度（拖分隔条）、或整块文字一改高度（换行、改行距），锚点位置就变了，
   * 方框必须跟着重算——否则方框留在原地与被改的文字错开（实测拖动分隔条后偏了 94px）。
   *
   * 为什么不用 window.resize：四栏是 flex 布局，拖分隔条改的是**栏宽**，
   * 窗口尺寸一点没变，resize 事件根本不会来。
   * 也不监听 .annotated 的高度：它的高度里含着"给方框留的白"，
   * 那正是这个组件自己申请出来的，监听它会绕成自激。
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver !== 'function') return
    const lines = container.querySelector<HTMLElement>('.annotated-lines')
    const read = (): string => `${container.clientWidth}x${lines ? lines.offsetHeight : 0}`
    // 量在外、判在里：state 的更新函数要保持纯（不读 DOM），React 会重复调用它
    const sync = (): void => {
      const next = read()
      setSizeKey((previous) => (previous === next ? previous : next))
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(container)
    if (lines) observer.observe(lines)
    return () => observer.disconnect()
  }, [containerRef, layout, items])

  /*
   * 卸载或换一份批注时，把写上去的空档与空位宽度还原。
   *
   * 关掉设置里的「显示填补的正确写法」时本组件直接卸载，测量那一步再也不会跑，
   * 而空档是直接写在被改内容的 style 上的——没人清就会留在那里：
   * 方框没了，译文上却还挂着一条条拉长的荧光笔带子、以及一块块不该存在的空位。
   */
  useEffect(() => {
    const container = containerRef.current
    return () => {
      if (!container) return
      for (const element of container.querySelectorAll<HTMLElement>('[data-fix-key]')) {
        element.style.paddingLeft = ''
        element.style.paddingRight = ''
        const slot = slotOf(element)
        if (slot) slot.style.width = ''
      }
    }
  }, [containerRef, layout])

  /*
   * 用 useEffect 而不是 useLayoutEffect：本组件是 .annotated 的**子**节点，
   * 而 React 的 ref 是自下而上挂的——父节点的 ref 在子节点的 layout effect 里还是 null。
   * passive effect 一定在所有 ref 挂好之后才跑，测量才拿得到容器。
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container || items.length === 0) {
      setBoxes([])
      return
    }

    let base = container.getBoundingClientRect()
    const containerWidth = container.clientWidth || base.width

    /* 1. 清掉上一轮写上去的东西，并找出每一处的锚点元素 */
    const elements = new Map<string, HTMLElement>()
    for (const element of container.querySelectorAll<HTMLElement>('[data-fix-key]')) {
      element.style.paddingLeft = ''
      element.style.paddingRight = ''
      const slot = slotOf(element)
      if (slot) slot.style.width = ''
      if (element.dataset.fixKey) elements.set(element.dataset.fixKey, element)
    }

    const entries: Entry[] = []
    for (const item of items) {
      const element = elements.get(item.key)
      if (!element) continue
      entries.push({
        item,
        element,
        isInsert: element.classList.contains('mk-insert'),
        hasText: (element.textContent ?? '').trim() !== '',
        rows: [],
        naturalBands: [],
        bands: [],
        anchor: { left: 0, width: 0, top: 0, height: 0 },
        textWidth: 0,
        fullWidth: 0,
        fullHeight: 0,
        parts: [item.text],
        partWidths: [0],
        partHeights: [0],
        partFlows: [false],
        padFirst: 0,
        padLast: 0,
      })
    }
    if (entries.length === 0) {
      setBoxes([])
      return
    }

    /*
     * 2. 量尺寸：在容器里临时挂一份同样式的副本（不可见、不参与布局判定），量完立刻摘掉。
     *    第一轮按"永不换行"量理想宽度；只有实在放不进译文栏的（长句重写那种）才开安全阀——
     *    限宽、允许折行，否则它会横着一整栏溢出去，读都没法读。
     */
    const probe = document.createElement('div')
    probe.className = 'fix-layer fix-layer-probe'
    container.appendChild(probe)
    /**
     * 量一段补写内容的尺寸。**永远按一行量**：方框永不折行（需要地方就靠带子继续拓宽）。
     */
    const measure = (text: string): { width: number; height: number } => {
      const node = document.createElement('span')
      node.className = 'fix-text'
      node.textContent = text
      probe.appendChild(node)
      const rect = node.getBoundingClientRect()
      probe.removeChild(node)
      return { width: rect.width, height: rect.height }
    }
    for (const entry of entries) {
      const full = measure(entry.item.text)
      entry.fullWidth = full.width
      entry.fullHeight = full.height
      // 默认只有一段：整句就是那一段（跨行时下面会重新拆）
      entry.partWidths = [full.width]
      entry.partHeights = [full.height]
    }
    /*
     * 一个空格有多宽（按补写字号量）。撑宽与内缩都以"空格"为单位：
     * 用户要的是"荧光带比补写内容**左右各再宽 4 个空格**"。
     *
     * 不能直接量一个空格：块级盒子里行首行尾的空白会被丢掉，量出来是 0。
     * 拿 "x x" 减 "xx" 才是那个空格真正的宽度。
     */
    const spaceWidth = Math.max(1, measure('x x').width - measure('xx').width)
    /** 左右各 4 个空格的宽度：带子比补写内容多出来的呼吸量 */
    const MARGIN = spaceWidth * 4

    /*
     * 3. 插入点：译文上那块荧光笔空位的宽度，与上方补写内容的宽度分毫不差。
     *    必须先写宽度、再量锚点——空位是有宽度的，它一落地，这一段文字的换行位置就定了。
     */
    for (const entry of entries) {
      if (!entry.isInsert) continue
      const slot = slotOf(entry.element)
      if (slot && entry.fullWidth > 0) slot.style.width = `${entry.fullWidth.toFixed(2)}px`
    }

    /* 4. 量锚点：每一行的文字矩形、每一行画出来的带子、以及总宽 */
    for (const entry of entries) {
      const shape = shapeOf(entry.element, base)
      if (!shape) continue
      entry.anchor = shape.rect
      entry.rows = shape.rows
      entry.textWidth = shape.totalWidth
      entry.bands = fragmentRects(entry.element, base)
      // 撑开前的这一份留着：切断点按它的占比分（撑开之后各行比例会变）
      entry.naturalBands = entry.bands
    }

    /*
     * 把一处填补要画的方框列出来：通常一个；拆成多段时每段一个、各自锚在对应那一行上。
     * `anchorsFor` 返回多段时各段的锚点（量不到就返回 null，退回"一个方框居中于最宽行"）。
     */
    interface Plan {
      entry: Entry
      ids: string[]
    }
    const buildPlan = (anchorsFor: (entry: Entry) => Rect[] | null): { inputs: FixBoxInput[]; plans: Plan[] } => {
      const inputs: FixBoxInput[] = []
      const plans: Plan[] = []
      for (const entry of entries) {
        const anchors = entry.parts.length > 1 ? anchorsFor(entry) : null
        if (anchors && anchors.length === entry.parts.length) {
          const ids = entry.parts.map((_, index) => `${entry.item.key}#${index}`)
          entry.parts.forEach((_, index) => {
            const anchor = anchors[index]
            if (!anchor) return
            inputs.push({
              id: ids[index] as string,
              anchorLeft: anchor.left,
              anchorWidth: anchor.width,
              anchorTop: anchor.top,
              width: entry.partWidths[index] ?? 0,
              height: entry.partHeights[index] ?? 0,
            })
          })
          plans.push({ entry, ids })
          continue
        }
        inputs.push({
          id: entry.item.key,
          anchorLeft: entry.anchor.left,
          anchorWidth: entry.anchor.width,
          anchorTop: entry.anchor.top,
          width: entry.partWidths[0] ?? entry.fullWidth,
          height: entry.partHeights[0] ?? entry.fullHeight,
        })
        plans.push({ entry, ids: [entry.item.key] })
      }
      return { inputs, plans }
    }

    /*
     * 6. 撑开带子：**照着补写内容的宽度来**，两边各再留 4 个空格。
     *
     * 空档 = "整处差多少"的一半 + 4 个空格（两边一样），于是
     *   带子总宽 = 原文天然总宽 + 差多少 + 8 个空格 = 补写内容一行排完的宽度 + 左右各 4 个空格
     * 正是用户要的那个关系。补写内容一行排得下（方框永不折行），相邻的文字被推到带子两侧，
     * "荧光区域里只有被改内容"仍然成立（空档是真占地方的，所以整段会跟着重新折行，
     * 这是明确选过的取舍）。
     *
     * 边界：带子不许横着跑出译文栏，右边被栏宽顶住时多余的挪到左边。
     *
     * **只按"没撑开时"的天然宽度算一次**，不来回调：空档一变大，被改内容自己就会重排、
     * 行宽全变，再照新行宽去调就成了自激（实测把一处撑到 174px、整块挤成一行）。
     * 撑开之后的少量出入由第 7 步的切断点吸收——那一段是按**最终行宽**做的。
     *
     * 插入点不加空档：它自己就是一块量好宽度的空位，没有"内容"可撑开。
     */
    const applyPad = (entry: Entry): void => {
      const style = entry.element.style
      style.paddingLeft = entry.padFirst > 0 ? `${entry.padFirst.toFixed(2)}px` : ''
      style.paddingRight = entry.padLast > 0 ? `${entry.padLast.toFixed(2)}px` : ''
    }

    for (const entry of entries) {
      if (entry.isInsert || !entry.hasText) continue
      const bands = entry.naturalBands
      const lastBand = bands[bands.length - 1]
      if (!lastBand) continue
      const natural = bands.reduce((sum, band) => sum + band.width, 0)
      const surplus = Math.max(0, entry.fullWidth - natural)
      entry.padFirst = surplus / 2 + MARGIN
      entry.padLast = surplus / 2 + MARGIN
      const roomLast = Math.max(0, containerWidth - (lastBand.left + lastBand.width))
      if (entry.padLast > roomLast) {
        entry.padFirst += entry.padLast - roomLast
        entry.padLast = roomLast
      }
      applyPad(entry)
    }

    /*
     * 撑开之后的排版才是最终排版：重新量每一行（文字矩形与带子）。
     * 顺序不能倒——左边的空档会把被改内容往后推，可能就换了折法。
     */
    const remeasure = (): void => {
      for (const entry of entries) {
        const shape = shapeOf(entry.element, base)
        if (!shape) continue
        entry.rows = shape.rows
        entry.anchor = shape.rect
        entry.textWidth = shape.totalWidth
        entry.bands = fragmentRects(entry.element, base)
      }
    }
    remeasure()

    /*
     * 7. 补写内容跟着原译文换行：被改内容跨行时切成几段，一段对一行。
     *
     *    每段**自己是一行**（方框永不折行，见上面 measure）。断线按**最终行宽的占比**落
     *    （所以这一步必须放在撑开之后）：这样切出来的段与它那一行是同一个比例，
     *    每一段都排得进它那一行，也不会多折一行。
     */
    const measureParts = (entry: Entry, parts: string[]): void => {
      entry.parts = parts
      entry.partWidths = []
      entry.partHeights = []
      for (const part of parts) {
        const size = measure(part)
        entry.partWidths.push(size.width)
        entry.partHeights.push(size.height)
      }
    }

    for (const entry of entries) {
      if (entry.isInsert || entry.rows.length < 2) continue
      const bands = entry.bands
      if (bands.length !== entry.rows.length) continue
      const lastIndex = bands.length - 1
      const rooms = bands.map((band, index) => {
        const left = index === 0 ? MARGIN : 0
        const right = index === lastIndex ? MARGIN : 0
        return Math.max(24, band.width - left - right)
      })
      const totalRoom = rooms.reduce((sum, room) => sum + room, 0)
      if (!(totalRoom > 0)) continue
      const words = entry.item.text.split(/\s+/).filter(Boolean)
      if (words.length < 2) continue
      const prefix: number[] = [0]
      for (let k = 1; k <= words.length; k += 1) prefix.push(measure(words.slice(0, k).join(' ')).width)
      const totalFix = prefix[prefix.length - 1] ?? 0
      if (!(totalFix > 0)) continue
      const targets: number[] = []
      let cumulative = 0
      for (let i = 0; i < rooms.length - 1; i += 1) {
        cumulative += rooms[i] ?? 0
        targets.push((cumulative / totalRoom) * totalFix)
      }
      const cuts = chooseCuts(prefix, targets)
      const bounds = [0, ...cuts, words.length]
      const parts = bounds
        .slice(0, -1)
        .map((from, index) => words.slice(from, bounds[index + 1] ?? words.length).join(' '))
        .filter((part) => part.length > 0)
      if (parts.length > 1) measureParts(entry, parts)
    }

    /*
     * 没切开的那几处（单行、或一行就放得下）：整句按一行量。
     */
    for (const entry of entries) {
      if (entry.isInsert || entry.parts.length > 1) continue
      const size = measure(entry.item.text)
      entry.partWidths = [size.width]
      entry.partHeights = [size.height]
    }
    probe.remove()

    /*
     * 先把"这一摞需要多少竖直空间"报上去：正文会据此加大行间距（方框压在上一行文字上的问题
     * 从根上消失），同时顶部也留出同样多的空白给第一行。
     * 只比手上这份多才再要一次——否则在测不出真实排版的环境里
     * （坐标不随样式变化）会陷在"要空间 → 重新量 → 还要空间"里出不来。
     */
    const estimate = buildPlan((entry) => (entry.rows.length === entry.parts.length ? entry.rows : null)).inputs
    const placements = placeFixBoxes(estimate, containerWidth)
    let needAbove = 0
    for (const input of estimate) {
      const placement = placements.find((candidate) => candidate.id === input.id)
      if (!placement) continue
      needAbove = Math.max(needAbove, input.anchorTop - placement.top)
    }
    // 只算竖直方向需要的量：EDGE_PADDING 是左右留白，加到行间距里会白白撑开一大截
    needAbove = Math.ceil(needAbove)
    if (needAbove > grantedSpace) {
      onNeedSpace(needAbove)
      return
    }

    /*
     * 9. 摆位置。多段：每段的锚点取**那一行画出来的带子**，于是每一段都正对在自己那一行的上方。
     *    单段：锚点取最宽的那条带子（撑开之后带子就是"被改内容占据的整段宽度"，
     *    方框居中于它，才与它左右对齐）。
     *
     * 早期版本是"按撑开前的位置摆好、再把方框右移半个差值"，那要求"实际撑开的量"
     * 与"算出来的差值"分毫不差；现在直接按撑开后的矩形重新算，居中就是定义本身，
     * 不依赖任何估算。
     */
    base = container.getBoundingClientRect()
    for (const entry of entries) entry.bands = fragmentRects(entry.element, base)
    const final = buildPlan((entry) => (entry.bands.length === entry.parts.length ? entry.bands : null))
    const finalPlacements = placeFixBoxes(final.inputs, containerWidth)
    const byId = new Map(finalPlacements.map((placement) => [placement.id, placement]))

    const next: PlacedBox[] = []
    for (const { entry, ids } of final.plans) {
      ids.forEach((id, index) => {
        const placement = byId.get(id)
        if (!placement) return
        next.push({
          key: id,
          item: entry.item,
          text: entry.parts[index] ?? entry.item.text,
          placement,
          width: entry.partWidths[index] ?? entry.fullWidth,
          height: entry.partHeights[index] ?? entry.fullHeight,
          flowsOver: entry.partFlows[index] ?? false,
        })
      })
    }

    setBoxes(next)
  }, [containerRef, layout, items, onNeedSpace, grantedSpace, sizeKey])

  if (boxes.length === 0) return null

  return (
    <div className="fix-layer" aria-hidden={false}>
      {boxes.map(({ key, item, text, placement }) => (
        <span
          key={key}
          className="fix-text"
          role="button"
          tabIndex={0}
          // 供测量脚本按"哪一处的第几段"对号入座
          data-fix-for={item.key}
          data-fix-part={key.includes('#') ? key.split('#')[1] : '0'}
          style={{
            left: placement.left,
            top: placement.top,
            color: item.color,
          }}
          title="点击查看这一处的说明"
          onClick={() => onSelect({ kind: 'error', id: item.errorId })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onSelect({ kind: 'error', id: item.errorId })
          }}
        >
          {text}
        </span>
      ))}
    </div>
  )
}
