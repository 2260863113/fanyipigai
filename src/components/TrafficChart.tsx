/**
 * 流量看板的折线图（用户第 17 条第 7 条："需要形同『地图记忆』一样的折线图显示"）。
 *
 * 那边这张图是 ECharts 画的（`ui/trafficChart.ts` + `ui/trafficSeries.ts`），
 * 这里用**手写 SVG** 画出同一个样子，理由写在 `domain/traffic.ts` 的文件头（不引 1MB 的依赖）。
 * 照着那边抄下来的观感有这几样，一件都不少：
 *   - **平滑折线**（不是折来折去的直线）+ 线上每个点一个**圆点**；
 *   - 线下**向下的渐变面积**（上浓下淡）；
 *   - y 轴**虚线网格** + 整齐的整数刻度，x 轴短刻度（按天 `9/16`、按小时 `14:00`）；
 *   - 鼠标挪到某个点上（或那一列的附近）弹出**那一桶的访问量**；
 *   - 图表高度 240px（`.admin-traffic-chart` 那条，也是从那边抄的）。
 *
 * 配色**只用项目既有色**，而且全部走 CSS 变量：折线 `--accent`、轴字 `--ink-faint`、
 * 网格 `--line`、提示框 `--paper` / `--line-strong` / `--ink`。
 * 这样明暗主题一换，图上的颜色跟着换，不需要 JS 再读一遍 `getComputedStyle`
 * （那边要读是因为 ECharts 的 option 不认 CSS 变量）。
 *
 * ⚠️ 宽度是**量出来的**（`ResizeObserver`）：容器宽度会随窗口与侧栏变化，
 * 而 SVG 的坐标必须按真实像素算，否则圆点位置与鼠标位置对不上。
 * 容器宽度为 0（隐藏着、或者 jsdom 里没有排版）时用兜底宽度先把图画出来——
 * 这与那边"ECharts 在 0 尺寸容器里初始化会画成 0×0"的坑是同一个，处理方式也一样：
 * 挂一个观察器，一旦有真实宽度就重画。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  CHART_PADDING,
  areaPath,
  axisTickIndexes,
  chartPoints,
  formatAxisLabel,
  formatTooltip,
  linePath,
  niceMax,
  peakTraffic,
  totalTraffic,
  yTicks,
  type TrafficPoint,
  type TrafficUnit,
} from '../domain/traffic'

/** 图表高度：与「地图记忆」的 `.admin-traffic-chart` 一致（240px）。 */
export const CHART_HEIGHT = 240
/** 量不到宽度时先按它画（见文件头）。 */
const FALLBACK_WIDTH = 720

export function TrafficChart({
  points,
  unit,
  /** 给屏幕阅读器与悬停用的范围说明，例如「近七天」 */
  rangeLabel,
}: {
  points: readonly TrafficPoint[]
  unit: TrafficUnit
  rangeLabel: string
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  /** 鼠标停在第几个点上；null 表示没停在图上 */
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const measure = (): void => setWidth(node.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const box = {
    width: Math.max(1, width > 0 ? width : FALLBACK_WIDTH),
    height: CHART_HEIGHT,
    padding: CHART_PADDING,
  }
  const coords = chartPoints(points, box)
  const baseline = box.height - box.padding.bottom
  const innerWidth = box.width - box.padding.left - box.padding.right
  const ticks = yTicks(points)
  const top = niceMax(peakTraffic(points))
  const hovered = hover !== null ? coords[hover] : undefined
  const hoveredPoint = hover !== null ? points[hover] : undefined

  return (
    <div className="traffic-chart" ref={wrapRef}>
      <svg
        className="traffic-svg"
        width={box.width}
        height={box.height}
        viewBox={`0 0 ${box.width} ${box.height}`}
        role="img"
        aria-label={`${rangeLabel}访问量折线图：共 ${totalTraffic(points)} 次，最高一次 ${peakTraffic(points)} 次`}
      >
        <defs>
          {/*
            面积渐变的两端：上浓下淡（与那边 `areaTop: 0.3 / areaBottom: 0.02` 同一个比例）。
            颜色写成 `currentColor`/CSS 变量，明暗主题因此不用各画一份（见文件头）。
          */}
          <linearGradient id="traffic-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="traffic-area-top" />
            <stop offset="100%" className="traffic-area-bottom" />
          </linearGradient>
        </defs>

        {/* y 轴的虚线网格与刻度（0 → 整齐上界，等分四段） */}
        {ticks.map((value) => {
          const y = round2(baseline - ((baseline - box.padding.top) * value) / top)
          return (
            <g key={`tick-${value}`}>
              <line className="traffic-grid" x1={box.padding.left} y1={y} x2={box.width - box.padding.right} y2={y} />
              <text className="traffic-axis-label" x={box.padding.left - 8} y={y + 4} textAnchor="end">
                {value}
              </text>
            </g>
          )
        })}

        {areaPath(coords, baseline) && (
          <path className="traffic-area" d={areaPath(coords, baseline)} fill="url(#traffic-area)" />
        )}
        <path className="traffic-line" d={linePath(coords)} />

        {/* 圆点：鼠标挪上去的那一个大一圈（与那边的 emphasis scale 同一个意思） */}
        {coords.map((point) => (
          <circle
            key={`dot-${point.index}`}
            className={hover === point.index ? 'traffic-dot traffic-dot-active' : 'traffic-dot'}
            cx={point.x}
            cy={point.y}
            r={hover === point.index ? 5.5 : 3.5}
          />
        ))}

        {/* 悬停时那一条竖线（与 ECharts 的 axisPointer 同一个作用：指清是哪一桶） */}
        {hovered && <line className="traffic-pointer" x1={hovered.x} y1={box.padding.top} x2={hovered.x} y2={baseline} />}

        {/* x 轴刻度：按能放下几个抽稀（近一月 30 个点全写会叠成一片） */}
        {axisTickIndexes(points.length, innerWidth).map((index) => {
          const point = coords[index]
          const source = points[index]
          if (!point || !source) return null
          return (
            <text
              key={`axis-${index}`}
              className="traffic-axis-label"
              x={point.x}
              y={box.height - 8}
              textAnchor="middle"
            >
              {formatAxisLabel(unit, source.label)}
            </text>
          )
        })}

        {/*
          命中区：一格（相邻两点之间的一半到下一半）一块透明矩形。
          为什么不只让圆点吃得下鼠标：圆点直径 7px，鼠标挪过去是"瞄一个点"；
          用一格来接则"挪到那一列的附近"就命中——与 ECharts 的 `trigger: 'axis'` 同一体验。
        */}
        {coords.map((point, index) => {
          const previous = coords[index - 1]
          const next = coords[index + 1]
          const left = previous ? (previous.x + point.x) / 2 : point.x - (innerWidth / Math.max(1, points.length - 1)) / 2
          const right = next ? (point.x + next.x) / 2 : point.x + (innerWidth / Math.max(1, points.length - 1)) / 2
          return (
            <rect
              key={`hit-${index}`}
              className="traffic-hit"
              x={round2(left)}
              y={box.padding.top}
              width={round2(Math.max(1, right - left))}
              height={Math.max(1, baseline - box.padding.top)}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover((current) => (current === index ? null : current))}
              data-traffic-index={index}
            />
          )
        })}
      </svg>

      {hovered && hoveredPoint && (
        <div
          className="traffic-tip"
          role="status"
          style={{
            /*
             * 提示框贴着那个点：默认居中在点上方，靠边的两个点会被容器裁掉，
             * 因此把 left 夹在 [8, 宽度-8] 之内（与 ECharts 的 confine 同一个意思）。
             */
            left: `${Math.min(Math.max(hovered.x, 60), box.width - 60)}px`,
            top: `${Math.max(0, hovered.y - 34)}px`,
          }}
        >
          {formatTooltip(unit, hoveredPoint.label, hoveredPoint.count)}
        </div>
      )}
    </div>
  )
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
