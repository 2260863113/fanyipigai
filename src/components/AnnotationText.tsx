import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { AnnotatedLayout, ReorderGroup, TextSegment } from '../domain/layout'
import { MARK_COLOR_VALUE } from '../domain/color'

type Selection =
  | { kind: 'error'; id: string }
  | { kind: 'highlight'; id: string }
  | { kind: 'reorder'; id: string }

interface Props {
  layout: AnnotatedLayout
  answer: string
  onSelect: (selection: Selection) => void
}

interface Arc {
  key: string
  d: string
  color: string
  label: string
  labelX: number
  labelY: number
  segment: TextSegment
}

/** 弧线的基准高度与每层叠加的间距。 */
const BASE_ARC_HEIGHT = 16
const ARC_STEP = 13

function buildArcs(groups: ReorderGroup[], container: HTMLElement, segments: TextSegment[]): Arc[] {
  const base = container.getBoundingClientRect()
  const arcs: Arc[] = []

  for (const group of groups) {
    // 把片段按「调序前次序」和「调序后次序」配对，每一对画一条弧线
    const pairs: Array<[{ index: number; rect: DOMRect }, { index: number; rect: DOMRect }]> = []
    const rects = new Map<number, DOMRect>()

    container.querySelectorAll<HTMLElement>(`[data-reorder-owner="${group.errorId}"]`).forEach((el) => {
      const index = Number(el.dataset.reorderIndex)
      const rect = el.getBoundingClientRect()
      if (!Number.isNaN(index) && rect.width > 0) rects.set(index, rect)
    })

    const targetOrder = [...group.parts].sort((a, b) => a.targetIndex - b.targetIndex)
    for (const part of group.parts) {
      const sourceRect = rects.get(part.sourceIndex)
      const targetRect = rects.get(part.targetIndex)
      if (!sourceRect || !targetRect) continue
      pairs.push([
        { index: part.sourceIndex, rect: sourceRect },
        { index: part.targetIndex, rect: targetRect },
      ])
    }

    // 只保留"真的发生了位置变化"的配对；次序完全没动的组不画弧线
    if (targetOrder.every((part, i) => part.sourceIndex === i)) continue

    pairs.forEach(([a, b], depth) => {
      if (a.index === b.index) return
      const from = a.rect.left - base.left + a.rect.width / 2
      const to = b.rect.left - base.left + b.rect.width / 2
      const height = BASE_ARC_HEIGHT + depth * ARC_STEP
      const top = a.rect.top - base.top
      const midX = (from + to) / 2
      const apexY = top - height
      arcs.push({
        key: `${group.errorId}-${a.index}-${b.index}`,
        d: `M ${from} ${top} Q ${midX} ${apexY} ${to} ${top}`,
        color: MARK_COLOR_VALUE[group.color],
        label: `${group.parts.find((p) => p.sourceIndex === a.index)?.label ?? ''}${group.parts.find((p) => p.sourceIndex === b.index)?.label ?? ''}`,
        labelX: midX,
        labelY: apexY - 3,
        segment: segments.find((s) => s.errorId === group.errorId) ?? {
          kind: 'plain',
          text: '',
          start: 0,
          end: 0,
        },
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
  onSelect,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  layout: AnnotatedLayout
  onSelect: (selection: Selection) => void
}) {
  const [arcs, setArcs] = useState<Arc[]>([])
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || layout.reorderGroups.length === 0) {
      setArcs([])
      return
    }

    const measure = (): void => {
      setArcs(buildArcs(layout.reorderGroups, container, layout.segments))
      const needed = BASE_ARC_HEIGHT + layout.reorderGroups.length * ARC_STEP + 8
      setHeight(needed)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [containerRef, layout])

  return (
    <div className="arc-layer" style={{ height: height || undefined }} aria-hidden={arcs.length === 0}>
      <svg className="arc-svg" width="100%" height="100%">
        {arcs.map((arc) => (
          <g key={arc.key} className="arc-group" onClick={() => onSelect({ kind: 'reorder', id: arc.segment.errorId ?? '' })}>
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

function SegmentView({ segment, onSelect }: { segment: TextSegment; onSelect: (selection: Selection) => void }) {
  const color = segment.color ? MARK_COLOR_VALUE[segment.color] : undefined

  const select = (): void => {
    if (segment.errorId) onSelect({ kind: 'error', id: segment.errorId })
    else if (segment.highlightId) onSelect({ kind: 'highlight', id: segment.highlightId })
  }

  const interactiveProps = {
    role: segment.errorId || segment.highlightId ? ('button' as const) : undefined,
    tabIndex: segment.errorId || segment.highlightId ? 0 : undefined,
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
      return (
        <span className="mk mk-delete" style={{ color }} {...interactiveProps}>
          {segment.text}
        </span>
      )

    case 'replace':
      return (
        <span className="mk mk-replace" {...interactiveProps}>
          <span className="mk-deleted" style={{ color }}>
            {segment.deletedText ?? segment.text}
          </span>
          <span className="mk-fix" style={{ color }}>
            {segment.targetText}
          </span>
        </span>
      )

    case 'insert':
      return (
        <span className="mk mk-insert" title="此处缺少内容" {...interactiveProps}>
          <span className="mk-fix-inline" style={{ color }}>
            {segment.targetText}
          </span>
        </span>
      )

    case 'rewrite':
      return (
        <span className="mk mk-rewrite" {...interactiveProps}>
          <span className="mk-rewrite-old" style={{ color }}>
            {segment.deletedText ?? segment.text}
          </span>
          <span className="mk-rewrite-new" style={{ color }}>
            {segment.targetText}
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
        // 语序调换的片段：序号标记直接跟在文字后面，弧线靠 data 属性定位
        return (
          <span
            className="mk mk-reorder"
            data-reorder-owner={segment.errorId}
            data-reorder-index={segment.start}
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

/**
 * 带批注的作答文本。
 * 渲染逻辑只做一件事：把片段画出来；所有位置计算已经在 layout 层完成。
 */
export function AnnotationText({ layout, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className="annotated" ref={containerRef}>
      <ArcLayer containerRef={containerRef} layout={layout} onSelect={onSelect} />
      <div className="annotated-lines">
        {layout.segments.map((segment, index) =>
          segment.kind === 'rewrite' ? (
            <span className="mk-rewrite-block" key={`seg-${index}`}>
              <SegmentView segment={segment} onSelect={onSelect} />
            </span>
          ) : (
            <SegmentView segment={segment} onSelect={onSelect} key={`seg-${index}`} />
          ),
        )}
      </div>
    </div>
  )
}

export type { Selection }
