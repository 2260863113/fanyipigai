import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { AnnotatedLayout, ReorderGroup, TextSegment } from '../domain/layout'
import type { ValidatedCorrection } from '../domain/validate'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import { summarize, type AnnotationSummary, type Selection } from './annotation-summary'
import { FixLayer, type FixItem } from './FixLayer'
import { withCircledBreaks } from './explain-lines'

export type { Selection } from './annotation-summary'

interface Props {
  layout: AnnotatedLayout
  answer: string
  validated: ValidatedCorrection
  /** 当前选中哪一处；气泡跟着它出现 */
  selection: Selection | null
  /** 正文行距（em 倍数），来自设置 */
  lineHeightBase: number
  /** 是否显示"填补内容"的方框（设置里可关） */
  showFixBoxes: boolean
  onSelect: (selection: Selection | null) => void
  /**
   * 小卡片里的「收藏」。
   *
   * 为什么不传就不显示：记录页也在用这个组件，那里没有"当前题目"上下文，
   * 收藏一条旧记录容易存出指不到题的条目（见 domain/favorites.ts 的说明）。
   */
  onToggleFavorite?: () => void
  /** 当前这一处是否已经在收藏里（按钮文案跟着变） */
  favorited?: boolean
}

interface Arc {
  key: string
  d: string
  color: string
  label: string
  labelX: number
  labelY: number
  errorId: string
}

/** 弧线的基准高度与每层叠加的间距。 */
const BASE_ARC_HEIGHT = 16
const ARC_STEP = 13

/**
 * 弧线画在文字**上方**，所以译文顶部必须留出等高的一块空白，
 * 否则最靠上那条弧线会被栏顶裁掉。
 * 一个调序组有 n 个片段就要画 n 条弧线，最上面那条是第 0 层。
 */
function arcSpaceFor(groups: ReorderGroup[]): number {
  if (groups.length === 0) return 0
  const deepest = Math.max(0, ...groups.map((group) => group.parts.length - 1))
  return BASE_ARC_HEIGHT + deepest * ARC_STEP + 8
}

function buildArcs(groups: ReorderGroup[], container: HTMLElement): Arc[] {
  const base = container.getBoundingClientRect()
  const arcs: Arc[] = []

  for (const group of groups) {
    // 把片段按「调序前次序」和「调序后次序」配对，每一对画一条弧线。
    // 这里查的键是**片段序号**（sourceIndex / targetIndex），因此渲染时必须把同一个序号
    // 写进 data-reorder-index —— 两边对不上的话 rects 里一个片段都取不到，
    // 弧线会静悄悄地一条都画不出来（实际踩过：把字符位置当成了序号）。
    const rects = new Map<number, DOMRect>()
    // 用遍历比对取值，而不是把 id 拼进 CSS 选择器：
    // id 来自 AI 返回的 JSON，里面万一有引号就会让选择器语法出错并直接抛异常。
    container.querySelectorAll<HTMLElement>('[data-reorder-owner]').forEach((el) => {
      if (el.dataset.reorderOwner !== group.errorId) return
      const index = Number(el.dataset.reorderIndex)
      const rect = el.getBoundingClientRect()
      if (!Number.isNaN(index) && rect.width > 0) rects.set(index, rect)
    })

    const targetOrder = [...group.parts].sort((a, b) => a.targetIndex - b.targetIndex)
    // 只保留"真的发生了位置变化"的组；次序完全没动的组不画弧线
    if (targetOrder.every((part, i) => part.sourceIndex === i)) continue

    const pairs: Array<[{ index: number; rect: DOMRect }, { index: number; rect: DOMRect }]> = []
    for (const part of group.parts) {
      const sourceRect = rects.get(part.sourceIndex)
      const targetRect = rects.get(part.targetIndex)
      if (!sourceRect || !targetRect) continue
      pairs.push([
        { index: part.sourceIndex, rect: sourceRect },
        { index: part.targetIndex, rect: targetRect },
      ])
    }

    pairs.forEach(([a, b], depth) => {
      if (a.index === b.index) return
      const from = a.rect.left - base.left + a.rect.width / 2
      const to = b.rect.left - base.left + b.rect.width / 2
      const height = BASE_ARC_HEIGHT + depth * ARC_STEP
      const top = a.rect.top - base.top
      const midX = (from + to) / 2
      const apexY = top - height
      const labelOf = (index: number): string => group.parts.find((p) => p.sourceIndex === index)?.label ?? ''
      arcs.push({
        key: `${group.errorId}-${a.index}-${b.index}`,
        d: `M ${from} ${top} Q ${midX} ${apexY} ${to} ${top}`,
        color: MARK_COLOR_VALUE[group.color],
        label: `${labelOf(a.index)}${labelOf(b.index)}`,
        labelX: midX,
        labelY: apexY - 3,
        errorId: group.errorId,
      })
    })
  }

  return arcs
}

/**
 * 调序弧线层。
 * 单独成一个组件，是为了保证它在 DOM 布局完成之后才测量片段位置——
 * 否则量到的是尚未排版的坐标，弧线会画歪。
 */
function ArcLayer({
  containerRef,
  layout,
  space,
  onSelect,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  layout: AnnotatedLayout
  space: number
  onSelect: (selection: Selection | null) => void
}) {
  const [arcs, setArcs] = useState<Arc[]>([])
  const [height, setHeight] = useState(0)

  /*
   * 用 useEffect 而不是 useLayoutEffect：本组件是 .annotated 的**子**节点，
   * 而 React 的 ref 是自下而上挂的——父节点的 ref 在子节点的 layout effect 里还是 null，
   * 弧线会一条都算不出来（实际踩过）。passive effect 一定在 ref 挂好之后才跑。
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container || layout.reorderGroups.length === 0) {
      setArcs([])
      return
    }

    const measure = (): void => {
      setArcs(buildArcs(layout.reorderGroups, container))
      setHeight(space)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [containerRef, layout, space])

  return (
    <div className="arc-layer" style={{ height: height || undefined }} aria-hidden={arcs.length === 0}>
      <svg className="arc-svg" width="100%" height="100%">
        {arcs.map((arc) => (
          <g key={arc.key} className="arc-group" onClick={() => onSelect({ kind: 'reorder', id: arc.errorId })}>
            <path className="arc-hit" d={arc.d} />
            <path className="arc-path" d={arc.d} style={{ stroke: arc.color }} />
            <text className="arc-label" x={arc.labelX} y={arc.labelY} style={{ fill: arc.color }}>
              {arc.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}



function SegmentView({
  segment,
  fixKey,
  onSelect,
}: {
  segment: TextSegment
  /** 有这一项表示它的正确写法画在上面的方框层里；这里只留被改动的原文 */
  fixKey?: string
  onSelect: (selection: Selection | null) => void
}) {
  const color = segment.color ? MARK_COLOR_VALUE[segment.color] : undefined
  /*
   * 荧光笔底色：被改动的内容不划删除线，改用相应颜色的底色勾画。
   * 底色必须挂在**带 data-fix-key 的最外层**上——补写的字更长时 FixLayer 会给它两边加空档，
   * 底色跟着一起撑开，才是一条与补写内容等宽的带子（挂在内层就只盖住文字本身）。
   */
  const tint = segment.color ? MARK_BG_VALUE[segment.color] : undefined
  const markId = segment.errorId ?? segment.highlightId

  const select = (): void => {
    if (segment.errorId) onSelect({ kind: 'error', id: segment.errorId })
    else if (segment.highlightId) onSelect({ kind: 'highlight', id: segment.highlightId })
  }

  const interactiveProps = {
    // 气泡要按"点了哪一处"找到这一段的坐标，因此每个可点的片段都带一个稳定的编号
    'data-mark-id': markId,
    role: markId ? ('button' as const) : undefined,
    tabIndex: markId ? 0 : undefined,
    onClick: select,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        select()
      }
    },
  }

  switch (segment.kind) {
    case 'delete':
      /*
       * 纯删除（没有替换内容）：底色 + 一道横线。
       * 底色挂在外层（FixLayer 会按需要给它加空档），横线画在内层——
       * 这样横线与文字同色，而底色仍是那条完整颜色的带子。
       */
      return (
        <span className="mk mk-delete" style={{ background: tint }} {...interactiveProps}>
          <span className="mk-deleted" style={{ color }}>
            {segment.text}
          </span>
        </span>
      )

    case 'replace':
      return (
        <span className="mk mk-replace" data-fix-key={fixKey} style={{ background: tint }} {...interactiveProps}>
          <span className="mk-deleted" style={{ color }}>
            {segment.deletedText ?? segment.text}
          </span>
        </span>
      )

    case 'insert':
      /*
       * 插入点不再画那根小竖线，改成一块**荧光笔颜色的空位**：
       * 宽度由 FixLayer 按"要补进去的内容"量出来之后写上去（见 components/FixLayer.tsx），
       * 于是上方那个方框与这块空位一样宽、分毫不差地上下对齐。补什么仍然写在方框里。
       * 没开「显示填补的正确写法」时量不到宽度，用 CSS 里那个小尺寸兜底，免得插入点整个看不见。
       */
      return (
        <span className="mk mk-insert" data-fix-key={fixKey} title="此处缺少内容" {...interactiveProps}>
          <span className="mk-slot" style={{ background: tint }} />
        </span>
      )

    case 'rewrite':
      return (
        <span className="mk mk-rewrite" data-fix-key={fixKey} style={{ background: tint }} {...interactiveProps}>
          <span className="mk-rewrite-old" style={{ color }}>
            {segment.deletedText ?? segment.text}
          </span>
        </span>
      )

    case 'highlight':
      return (
        <span className="mk mk-highlight" {...interactiveProps}>
          {segment.text}
        </span>
      )

    default:
      if (segment.reorderLabel && segment.errorId) {
        // 语序调换的片段：序号标记直接跟在文字后面，弧线靠 data 属性定位。
        // data-reorder-index 必须是**片段序号**（sourceIndex），不是文字在译文里的字符位置——
        // 弧线的配对查的就是这个键，写成字符位置会导致一条弧线都配不出来。
        return (
          <span
            className="mk mk-reorder"
            data-reorder-owner={segment.errorId}
            data-reorder-index={segment.reorderSourceIndex ?? segment.start}
            {...interactiveProps}
          >
            {segment.text}
            <span className="mk-reorder-label" style={{ color }}>
              {segment.reorderLabel}
            </span>
          </span>
        )
      }
      return <span className="mk-plain">{segment.text}</span>
  }
}

interface Bubble {
  summary: AnnotationSummary
  top: number
  left: number
  width: number
  arrowLeft: number
  /** 卡片翻到了这一行**上面**（下面放不下时），箭头跟着移到卡片下沿 */
  flipped: boolean
}

/**
 * 带批注的作答文本。
 *
 * 渲染只做两件事：把片段画出来，以及在**被点中的那一行下面**浮一个小气泡。
 * 位置计算全部在 layout 与这里完成，上层只需要知道"选中了哪一处"。
 */
export function AnnotationText({
  layout,
  answer,
  validated,
  selection,
  lineHeightBase,
  showFixBoxes,
  onSelect,
  onToggleFavorite,
  favorited,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const linesRef = useRef<HTMLDivElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  /**
   * 方框那一摞需要多少竖直空间（方框层量完回调这里）。
   *
   * 用途有二：
   *   1. 折成**行间距**，让"方框压在上一行文字上"从根上消失；
   *   2. 顶部留同样多的空白，第一行上方的方框才不会顶出容器。
   *
   * 行间距只补"原来那段行距放不下"的那部分：行距本身已经给了一段余量
   * （行高 2.5、字号 17.5px 时约 26px），单行方框通常刚好塞得下，
   * 不必把每一行都撑开——那正是"行前合适、行后太宽"的来源。
   * 关掉修改框时整个机制都不需要。
   */
  const [boxNeedRaw, setBoxNeedRaw] = useState(0)
  // 关掉修改框时，那一摞空间自然也不需要了
  const boxNeed = showFixBoxes ? boxNeedRaw : 0
  const baseLeading = Math.max(0, (lineHeightBase - 1) * 17.5)
  /*
   * 一行的内容盒并不是 1em 高：衬线体的上升部＋下降部约 1.15em（17.5px 字号下约 20px），
   * 按 1em 估会少算 2.5px。单行方框看不出来（余量本来就够），
   * 但被改内容跨行、补写的字拆成两段之后，第二段正好落在"上一行内容盒的底下那 2px"里。
   * 补上这个差值：行距本来就宽（默认 2.5）时结果一点不变，行距调紧时才真正顶用。
   */
  const INK_SLACK = 2.5
  const lineExtra = Math.max(0, boxNeed + INK_SLACK - baseLeading)
  const space = arcSpaceFor(layout.reorderGroups) + boxNeed

  /*
   * 换了批注就把上一份方框空间清掉。
   *
   * 必须放在**渲染阶段**（而不是 useEffect）：方框层是子组件，它的测量 effect 先跑、
   * 会 setBoxSpace(需要的值)，紧接着父组件的重置 effect 再把它清零——
   * 两次更新被合并，申请就丢了，方框永远画不出来（实际踩过这个坑）。
   * 渲染阶段重置则在所有 effect 之前完成，申请不会被吞掉。
   */
  const layoutRef = useRef(layout)
  if (layoutRef.current !== layout) {
    layoutRef.current = layout
    if (boxNeedRaw !== 0) setBoxNeedRaw(0)
  }

  /**
   * 要画成方框的填补内容：带上正确写法的片段。
   * 一处错误可能有两处改动（farmer and herder），那就是两个方框、共用一个 errorId。
   */
  const fixItems = useMemo<FixItem[]>(
    () =>
      layout.segments.flatMap((segment, index) =>
        segment.targetText && segment.errorId && segment.color
          ? [
              {
                key: `fix-${index}`,
                errorId: segment.errorId,
                text: segment.targetText,
                color: MARK_COLOR_VALUE[segment.color],
              },
            ]
          : [],
      ),
    [layout],
  )

  const measureBubble = useCallback((): void => {
    const container = containerRef.current
    const lines = linesRef.current
    if (!container || !lines || !selection) {
      setBubble(null)
      return
    }
    const target = [...container.querySelectorAll<HTMLElement>('[data-mark-id]')].find(
      (el) => el.dataset.markId === selection.id,
    )
    const summary = summarize(validated, answer, selection)
    if (!target || !summary) {
      setBubble(null)
      return
    }

    /*
     * ⚠️ 坐标一律用**视口**坐标（`position: fixed`），不是"相对译文栏"的坐标。
     *
     * 原因就是用户报的那一条："小卡片应该位于最上层，不能被下面的区域栏目所挡住"。
     * 小卡片原先画在译文栏里面（`position: absolute`），而译文栏的正文盒子是
     * `overflow-y: auto` 的滚动容器——**滚动容器会把超出它的内容剪掉**，
     * 于是一处靠近栏底部的批注，气泡画到一半就被切口截断，看着就像被下面那两栏压住了。
     * 剪裁不是 z-index 能解决的，只能把卡片挪出那个容器：现在它挂到 `document.body` 上
     * （见下面 createPortal），用视口坐标定位，因此栏怎么滚、怎么剪都与它无关。
     */
    const rect = target.getBoundingClientRect()
    // 行高取计算值：气泡要落在**这一行下面**，而不是压在字上
    const lineHeight = Number.parseFloat(getComputedStyle(lines).lineHeight) || rect.height || 40
    const lineTop = rect.top + rect.height / 2 - lineHeight / 2
    const lineBottom = rect.top + rect.height / 2 + lineHeight / 2
    const viewport = window.innerWidth || 1024
    const viewportHeight = window.innerHeight || 768
    const width = Math.max(180, Math.min(380, Math.min(container.clientWidth, viewport) - 8))
    const center = rect.left + rect.width / 2
    const left = Math.max(8, Math.min(center - width / 2, viewport - width - 8))

    /*
     * 高度只能**估**：这一次量的时候卡片还没画出来。用上一帧量的高度，没有就按四行估。
     * 估错的余地由下面的夹取吸收（多出来的部分顶在视口边界上，不会跑到屏幕外）。
     */
    const height = bubbleRef.current?.offsetHeight || 120
    /*
     * 下面放不下就**翻到这一行上面**。
     *
     * 卡片现在是固定定位（见上），因此不再有"滚动容器替它留位置"这回事：
     * 一处靠近窗口底部的批注，卡片照旧往下画就会整块落到视口外面——
     * 用户看到的仍然是"卡片没出来"。真实浏览器验收里量到过：卡片中心落在视口之外。
     * 翻上去之后箭头也跟着移到卡片下沿（见样式表里的 .ann-bubble-above）。
     */
    const below = lineBottom + 6
    const above = lineTop - 6 - height
    const flipped = below + height > viewportHeight - 8 && above >= 8
    setBubble({
      summary,
      top: flipped ? Math.max(8, above) : Math.min(below, Math.max(8, viewportHeight - height - 8)),
      left,
      width,
      arrowLeft: Math.max(14, Math.min(center - left, width - 14)),
      flipped,
    })
  }, [answer, selection, validated])

  useLayoutEffect(() => {
    measureBubble()
    window.addEventListener('resize', measureBubble)
    /*
     * 滚动时重新量一次：卡片是固定定位的，不跟着滚就会"留在原地、与那一处脱开"。
     * 用捕获阶段挂在 window 上，所有滚动容器（译文栏正文、整页）都会冒到这里。
     */
    window.addEventListener('scroll', measureBubble, true)
    return () => {
      window.removeEventListener('resize', measureBubble)
      window.removeEventListener('scroll', measureBubble, true)
    }
  }, [measureBubble, layout])

  /*
   * 点卡片（小卡片与右下角那张大卡片）**之外**的地方，才把这一处收起来。
   *
   * 三个例外：
   *   - 点到**勾画**本身（含调序弧线）：交给它自己的点击处理去切换选中，这里不插手；
   *   - 点到**上方补写的字**（`.fix-text`）：它同样代表这一处，点它也该把小卡片打开
   *     （它自己的点击处理已经选了，这里再关一次就等于"点了没反应"——实际踩过）；
   *   - 点到**任意一张卡片**里：一律不关。
   *
   * ⚠️ 最后那条是用户点名要求的："点击任意卡片都不会关掉这两个卡片，
   * 当且仅当点击这两个卡片之外的地方才消失。" 两张卡片因此都带 `data-card` 标记
   * （小卡片 `data-card="bubble"`、右下角那张 `data-card="detail"`），
   * 这里只认这个标记——**不再逐个类名去数**：早先只放行了 `.detail-actions` 与
   * `.detail-head`，于是点到大卡片自己的正文（"说明"那几行）就把它关掉了，
   * 用户看到的就是"点卡片也会消失"。
   *
   * 另一条必要的配套改动在样式表里：小卡片整张改成 `pointer-events: auto`。
   * 它原先是 `none`（免得挡住底下的勾画），那一击会**穿过卡片落到下面的元素上**，
   * 于是"点卡片"在浏览器看来就是"点了外面"。坐标兜底仍然留着——
   * jsdom 里没有命中测试，探针只能靠坐标走这条路。
   */
  useEffect(() => {
    if (!selection) return
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest('[data-mark-id]') ||
          target.closest('.arc-group') ||
          target.closest('.fix-text') ||
          target.closest('[data-card]'))
      ) {
        return
      }
      const box = bubbleRef.current?.getBoundingClientRect()
      if (box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) {
        return
      }
      onSelect(null)
    }
    document.addEventListener('click', onDocumentClick)
    return () => document.removeEventListener('click', onDocumentClick)
  }, [selection, onSelect])

  // Esc 关掉气泡
  useEffect(() => {
    if (!selection) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onSelect])

  return (
    <div className="annotated" ref={containerRef} style={space > 0 ? { paddingTop: space } : undefined}>
      <ArcLayer containerRef={containerRef} layout={layout} space={space} onSelect={onSelect} />
      <div
        className="annotated-lines"
        ref={linesRef}
        style={{ lineHeight: lineExtra > 0 ? `calc(${lineHeightBase}em + ${lineExtra}px)` : `${lineHeightBase}em` }}
      >
        {layout.segments.map((segment, index) => (
          <SegmentView
            key={`seg-${index}`}
            segment={segment}
            fixKey={segment.targetText && segment.errorId ? `fix-${index}` : undefined}
            onSelect={onSelect}
          />
        ))}
      </div>
      {showFixBoxes && (
        <FixLayer
          containerRef={containerRef}
          layout={layout}
          items={fixItems}
          onSelect={onSelect}
          onNeedSpace={setBoxNeedRaw}
          grantedSpace={boxNeedRaw}
        />
      )}

      {/*
        小卡片**挂到 document.body 上**、用固定定位（见 measureBubble 里的说明）：
        只有这样它才不会被译文栏那个滚动容器剪掉，也才压得住下面那两栏。
        `data-card` 是"点它不算点外面"的标记（见 onDocumentClick）。
      */}
      {bubble &&
        createPortal(
          <div
            className={bubble.flipped ? 'ann-bubble ann-bubble-above' : 'ann-bubble'}
            ref={bubbleRef}
            data-card="bubble"
            style={{ top: bubble.top, left: bubble.left, width: bubble.width }}
            role="note"
          >
            <span className="ann-bubble-arrow" style={{ left: bubble.arrowLeft }} />
            <span className="ann-bubble-head">
              <span className="ann-bubble-kind" style={{ color: MARK_COLOR_VALUE[bubble.summary.color] }}>
                {bubble.summary.typeLabel}
              </span>
              <span className="ann-bubble-cat">{bubble.summary.categoryLabel}</span>
              {/* 序号用这一处自己的颜色，与译文上的颜色对得上 */}
              <span className="ann-bubble-order" style={{ color: MARK_COLOR_VALUE[bubble.summary.color] }}>
                （{bubble.summary.order}）
              </span>
            </span>
            {/*
              这里**不写**"某某 → 某某"：改前改后本来就画在译文上（荧光带 + 上方小字），
              卡片再抄一遍反而占地方。卡片只说"这是什么问题、为什么"，完整说明在右下角。
              说明按分号断行、每行带圈号（与"大改"档的逐句解释同一份判据，见 explain-lines.tsx）。
            */}
            <span className="ann-bubble-why">{withCircledBreaks(bubble.summary.why)}</span>
            {/*
              小卡片自己带一颗「收藏」（用户要求）。
              整张卡片都收鼠标事件（样式表里 `pointer-events: auto`）、并且带 `data-card`，
              因此点卡片里任何地方都不会把它或右下角那张关掉——用户要求"点外面才消失"。
            */}
            <span className="ann-bubble-foot">
              {onToggleFavorite ? (
                <button
                  type="button"
                  className={favorited ? 'btn btn-primary btn-tiny' : 'btn btn-tiny'}
                  onClick={onToggleFavorite}
                  title={
                    favorited
                      ? '这一处已经在收藏里了；再点一次就取消收藏'
                      : '把这一处连同改前/改后/为什么存进收藏，以后在顶栏的「收藏」里看'
                  }
                >
                  {favorited ? '已收藏' : '收藏'}
                </button>
              ) : null}
              <span className="ann-bubble-more">完整说明见右下角</span>
            </span>
          </div>,
          document.body,
        )}
    </div>
  )
}
