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

/**
 * 方框左右各留一点空隙（不贴容器边）。
 *
 * 宽度**不再受"锚宽两倍"限制**：内容多长就多宽，超宽就靠方框内换行 + 往上加层来解决。
 * 唯一的上限是容器本身的宽度——再不济也不能横着溢出译文栏。
 */
const EDGE_PADDING = 4

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
 * 挑断点：把补写内容按原译文各行的宽度占比切开。
 *
 * 为什么按**宽度占比**而不是词数：被改内容第一行占了整段的几分之几，
 * 补写的字第一行也应当占同样的比例，断出来的两段才会各自落在对应那一行的正上方。
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
  /** 每一行画出来的带子（撑开前量到的矩形，含行尾空格） */
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
    const available = Math.max(80, containerWidth - EDGE_PADDING * 2)

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
     * 量一段补写内容的尺寸。
     *
     * `cap` 给了就**限宽并允许折行**（词与词之间随便断）：补写内容一律在"被改内容那么宽"的框里排，
     * 排不下就自己往下折，绝不把荧光带撑宽——这是用户明确要的（见文件头那段）。
     * 不给 cap 就是量"一行排完要多少宽度"，用来量那块插入空位与一个空格的宽度。
     */
    const measure = (text: string, cap = 0): { width: number; height: number } => {
      const node = document.createElement('span')
      node.className = 'fix-text'
      node.textContent = text
      if (cap > 0) {
        node.style.whiteSpace = 'normal'
        node.style.maxWidth = `${cap}px`
      }
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
      entry.partFlows = [false]
    }
    /*
     * 一个空格有多宽（按补写字号量）。撑宽与内缩都以"空格"为单位：
     * 用户要的是"荧光带比被改内容左右各宽 2 个空格"、"补写内容再往带子里缩"。
     *
     * 不能直接量一个空格：块级盒子里行首行尾的空白会被丢掉，量出来是 0。
     * 拿 "x x" 减 "xx" 才是那个空格真正的宽度。
     */
    const spaceWidth = Math.max(1, measure('x x').width - measure('xx').width)
    /** 左右各 2 个空格的宽度：荧光带的呼吸量 */
    const GUTTER = spaceWidth * 2

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
     * 6. 荧光带只比被改内容宽出**左右各 2 个空格**（padding）。
     *
     * 这一段是这一轮改掉的核心：以前是"补写内容多宽，荧光就撑多宽"，
     * 于是补写内容一长（重写常见），带子就变成一条横贯半行的大色块，把相邻文字推得老远；
     * 用户要的是反过来——**带子贴着被改内容**（左右各留 2 个空格当呼吸），
     * 补写内容排不下就自己往下折（见 measure 的 cap 与第 8 步）。
     *
     * 空档是真占地方的：相邻的文字会被推到带子的左右两侧去，
     * 这正是"荧光区域里只有被改内容"的做法。空档只有 6–7px，整段排版几乎不动。
     * 插入点不加：它自己就是一块量好宽度的空位，没有"内容"可撑开。
     */
    const applyPad = (entry: Entry): void => {
      const style = entry.element.style
      style.paddingLeft = entry.padFirst > 0 ? `${entry.padFirst.toFixed(2)}px` : ''
      style.paddingRight = entry.padLast > 0 ? `${entry.padLast.toFixed(2)}px` : ''
    }

    for (const entry of entries) {
      if (entry.isInsert || !entry.hasText || entry.rows.length === 0) continue
      entry.padFirst = GUTTER
      entry.padLast = GUTTER
      applyPad(entry)
    }

    /*
     * 7. 撑开之后的排版才是最终排版：重新量每一行（文字矩形与带子）。
     *    顺序不能倒——左边的空档会把被改内容往后推，可能就换了折法。
     */
    for (const entry of entries) {
      const shape = shapeOf(entry.element, base)
      if (!shape) continue
      entry.rows = shape.rows
      entry.anchor = shape.rect
      entry.textWidth = shape.totalWidth
      entry.bands = fragmentRects(entry.element, base)
    }

    /**
     * 第 i 段能有多宽：这一行带子的宽度，再**扣掉合计 2 个空格**（左右各让出 1 个）。
     *
     * 为什么不按"左右各 2 个空格"扣：那样连 `I am` 这种四个字符的短改动都会被硬拆成两行
     * （实测 `i is → I am` 真的折成了 `I` / `am`）。合计 2 个空格既能保证补写内容不贴住带子边缘，
     * 又不会把短改动拆散；长短两种情形都量过（见 README）。
     */
    const capFor = (entry: Entry, index: number): number => {
      const band = entry.bands[index] ?? entry.bands[entry.bands.length - 1]
      const cap = (band?.width ?? 0) - GUTTER
      return Math.max(24, Math.min(cap, available))
    }

    /*
     * 8. 补写内容排进这一行那么宽的框里，**词与词之间随便断**（词内部不拆）。
     *
     *    被改内容跨行、且整句一行放不进最宽那一行时，按各行的带子宽度占比把它切成几段，
     *    一段对一行；每段再各自限宽（本行带子宽 − 左右各 2 个空格），放不下就继续往下折。
     *    于是"跟随原译文换行"与"任意相邻两个词都能断"同时成立——正是用户这两条要求。
     */
    const measureParts = (entry: Entry, parts: string[]): void => {
      entry.parts = parts
      entry.partWidths = []
      entry.partHeights = []
      entry.partFlows = []
      parts.forEach((part, index) => {
        const size = measure(part, capFor(entry, index))
        entry.partWidths.push(size.width)
        entry.partHeights.push(size.height)
        entry.partFlows.push(size.width >= capFor(entry, index) - 0.5)
      })
    }

    for (const entry of entries) {
      if (entry.isInsert) continue
      // 单行：整句就一段，限宽后自己折行；跨行：按行切段（下面这段）
      if (entry.rows.length < 2 || entry.parts.length > 1) continue
      const bands = entry.bands
      if (bands.length !== entry.rows.length) continue
      // 一行放得下就不切：切了反而会把词硬分到两行去
      const widest = bands.reduce((best, band) => Math.max(best, band.width - GUTTER * 2), 0)
      if (entry.fullWidth <= widest) continue
      const words = entry.item.text.split(/\s+/).filter(Boolean)
      if (words.length < 2) continue
      const prefix: number[] = [0]
      for (let k = 1; k <= words.length; k += 1) prefix.push(measure(words.slice(0, k).join(' ')).width)
      const totalFix = prefix[prefix.length - 1] ?? 0
      const totalBand = bands.reduce((sum, band) => sum + band.width, 0)
      if (!(totalFix > 0) || !(totalBand > 0)) continue
      // 第 i 条断线应当落在"前面的带子加起来占了多少"这个比例处
      const targets: number[] = []
      let cumulative = 0
      for (let i = 0; i < bands.length - 1; i += 1) {
        cumulative += bands[i]?.width ?? 0
        targets.push((cumulative / totalBand) * totalFix)
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
     * 没切开的那几处（单行、或一行就放得下）：整句按"最宽那条带子减左右各 2 个空格"限宽量一次，
     * 放不下就在词与词之间折行——这就是"任意相邻两个单词都可以自由断开"。
     */
    for (const entry of entries) {
      if (entry.isInsert || entry.parts.length > 1) continue
      const widest = entry.bands.reduce((best, band, index) => (band.width > (entry.bands[best]?.width ?? 0) ? index : best), 0)
      const cap = capFor(entry, widest)
      const size = measure(entry.item.text, cap)
      entry.partWidths = [size.width]
      entry.partHeights = [size.height]
      entry.partFlows = [size.width >= cap - 0.5]
    }
    probe.remove()

    /*
     * 先把"这一摞需要多少竖直空间"报上去：正文会据此加大行间距（方框压在上一行文字上的问题
     * 从根上消失），同时顶部也留出同样多的空白给第一行。
     *
     * **必须在限宽折行量完之后**：补写内容折成两三行时方框会高一倍，
     * 早算一步就会按"一行"去要空间，方框于是顶出栏外、或者压到上一行去（实测踩过）。
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
      {boxes.map(({ key, item, text, placement, width }) => (
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
            /*
             * 一律限宽到"被改内容那么宽"并允许折行：宽了就在词与词之间断开，
             * 绝不把荧光带撑宽（见文件头那段与第 6、8 步）。
             */
            maxWidth: width,
            whiteSpace: 'normal',
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
