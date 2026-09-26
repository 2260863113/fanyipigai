/**
 * 管理端「流量看板」的**纯逻辑**：桶标签 → 轴刻度文案、整条折线的坐标与路径、y 轴上限。
 *
 * ## 为什么从"长条"改成"折线"（用户第 17 条第 7 条）
 *
 * 用户原话："日志记录的流量板需要形同『地图记忆』一样的折线图显示。"
 *
 * 这边原先画的是**一列 div 当柱子**，而 `.admin-bar` / `.admin-bar-col` 这两条规则
 * **样式表里根本没有**（翻遍 styles.css 与 styles-map-memory.css 都没有）——
 * 也就是说那个"流量板"其实是一排没有宽度、没有颜色、高度按百分比撑的方块，
 * 屏幕上基本看不出什么。用户要的折线图（带面积渐变、圆点、虚线网格、悬停给那一桶的访问量）
 * 那边是用 ECharts 画的。
 *
 * ## 为什么不引 ECharts
 *
 * 那边为了它引了整个 echarts（约 1MB 未压缩）。这边只需要**一条折线 + 圆点 + 一条渐变面积**，
 * 手写 SVG 大约一百行就够，而且不吃打包体积、不添依赖——与早先"流量板不引图表库"的取舍一致
 * （只是那次选择了画长条，而长条连样式都没写）。
 * 配色仍然**只用项目既有色**（站点主色 `--accent`，随明暗主题自动切换，见 TrafficChart 的说明）。
 *
 * ## 桶标签不去猜时间
 *
 * 服务端（`src/server/statsWindow.ts`）已经给的是**站点时区**（北京）的日历字符串，
 * 并且**缺桶已经补过 0**、顺序已经排好。因此这里只做两件事：
 *   - 用正则把 `2026-09-26` / `2026-09-26 14:00` 拆成"月 / 日 / 时"来写轴刻度；
 *   - 其余一概照抄标签本身。
 * ⚠️ **绝不用 `new Date(label)` 去解析**：那会把一个不含时区的日历串按浏览器时区解释，
 * 在非 +08 的机器上整条折线的刻度就跟着漂（这正是那边 `trafficSeries.ts` 花大篇幅避开的事）。
 */

/** 统计粒度：按小时（近一天）或按天（近七天 / 近一个月）。与 `src/server/statsWindow.ts` 同一口径。 */
export type TrafficUnit = 'hour' | 'day'

/** 折线上的一个点（`label` 是服务端给的桶标签，`count` 是该桶的访问量）。 */
export interface TrafficPoint {
  label: string
  count: number
}

const DAY_LABEL = /^(\d{4})-(\d{2})-(\d{2})$/
const HOUR_LABEL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00$/

/** 桶标签 → 月 / 日 / 时；拆不出来返回 null（脏数据不该让整个看板崩掉）。 */
export function parseBucketLabel(label: string): { month: number; day: number; hour: number | null } | null {
  const day = DAY_LABEL.exec(label)
  if (day) return { month: Number(day[2]), day: Number(day[3]), hour: null }
  const hour = HOUR_LABEL.exec(label)
  if (hour) return { month: Number(hour[2]), day: Number(hour[3]), hour: Number(hour[4]) }
  return null
}

/** 点标签 → 人话：按天 `9月16日`，按小时 `9月16日 14:00`（悬停时给完整日期）。 */
export function formatPointLabel(unit: TrafficUnit, label: string): string {
  const at = parseBucketLabel(label)
  if (!at) return label
  const md = `${at.month}月${at.day}日`
  if (unit !== 'hour' || at.hour === null) return md
  return `${md} ${String(at.hour).padStart(2, '0')}:00`
}

/** 点标签 → x 轴刻度：按天 `9/16`，按小时 `14:00`（完整日期在悬停提示里给，轴上只留最短的）。 */
export function formatAxisLabel(unit: TrafficUnit, label: string): string {
  const at = parseBucketLabel(label)
  if (!at) return label
  if (unit === 'hour' && at.hour !== null) return `${String(at.hour).padStart(2, '0')}:00`
  return `${at.month}/${at.day}`
}

/** 悬停提示：`9月16日 · 34 次访问`。 */
export function formatTooltip(unit: TrafficUnit, label: string, count: number): string {
  return `${formatPointLabel(unit, label)} · ${count} 次访问`
}

/** 合计访问量（空态判据与图上那句"共 N 次"都用它）。 */
export function totalTraffic(points: readonly TrafficPoint[]): number {
  return points.reduce((sum, point) => sum + Math.max(0, point.count), 0)
}

/** 峰值（y 轴上限与柱高都从这里来）。 */
export function peakTraffic(points: readonly TrafficPoint[]): number {
  return points.reduce((max, point) => Math.max(max, point.count), 0)
}

/**
 * y 轴上限的"整齐"化：1 / 2 / 5 × 10ⁿ 的最近上界（全 0 时给 1）。
 *
 * 与「地图记忆」的 `niceMax` 逐字同一条规矩，理由也一样：默认按峰值当上限的话，
 * 近七天 3 次 → 轴顶 3、切到近一月 120 次 → 轴顶 120，同一个数字在不同范围下的高度不一样，
 * 来回切两次就分不清"哪段更忙"了。取整齐上界之后刻度也是整数。
 */
export function niceMax(max: number, fallback = 1): number {
  if (!Number.isFinite(max) || max <= 0) return fallback
  const exponent = Math.floor(Math.log10(max))
  const base = 10 ** exponent
  const normalized = max / base
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * base
}

/** 画布内边距（给轴标签留的地方）。 */
export interface ChartBox {
  width: number
  height: number
  padding: { left: number; right: number; top: number; bottom: number }
}

/** 一个数据点在画布上的坐标。 */
export interface ChartPoint {
  x: number
  y: number
  /** 它在 `points` 里的下标（悬停命中与提示文案都要用） */
  index: number
  count: number
}

/** 折线图默认的内边距：左边留给 y 轴刻度，下边留给 x 轴刻度，上面留一点给圆点。 */
export const CHART_PADDING = { left: 44, right: 16, top: 14, bottom: 26 } as const

/**
 * 数据点 → 画布坐标。
 *
 * x 按**等距**排（类目轴：一个桶一格），y 按 `count / niceMax(峰值)` 归一化后翻过来
 * （SVG 的 y 向下）。只有一个点时放在正中——否则除以 `n - 1 = 0` 会得到 NaN。
 */
export function chartPoints(points: readonly TrafficPoint[], box: ChartBox): ChartPoint[] {
  const { padding } = box
  const innerWidth = Math.max(0, box.width - padding.left - padding.right)
  const innerHeight = Math.max(0, box.height - padding.top - padding.bottom)
  const top = niceMax(peakTraffic(points))
  const last = Math.max(1, points.length - 1)
  return points.map((point, index) => {
    const ratio = (points.length === 1 ? 0.5 : index / last)
    const count = Math.max(0, point.count)
    return {
      x: round2(padding.left + innerWidth * ratio),
      y: round2(padding.top + innerHeight * (1 - count / top)),
      index,
      count,
    }
  })
}

/** y 轴的刻度值（0 → 上限，等分四段，与网格线一一对应）。 */
export function yTicks(points: readonly TrafficPoint[], steps = 4): number[] {
  const top = niceMax(peakTraffic(points))
  const out: number[] = []
  for (let i = 0; i <= steps; i += 1) out.push(Math.round((top * i) / steps))
  return out
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 折线的 `d`：**平滑**的那种（用户看到的那张图是平滑折线，不是折来折去的直线）。
 *
 * 用均匀 Catmull-Rom 转三次贝塞尔：每个数据点两侧各取一个控制点，
 * 控制点落在"相邻点连线"的方向上（1/6 张力是 Catmull-Rom 的标准换算法）。
 * 端点没有"再前一个点"，就退化成二阶，于是曲线的开头与结尾不会甩出去。
 *
 * ⚠️ 曲线在陡降处会**略微过冲**（低于相邻两点）——与 `smooth: true` 的表现一致，
 * 这是平滑换来的代价；访问量是非负整数，过冲一点点看不出来。
 */
export function linePath(points: readonly ChartPoint[]): string {
  if (points.length === 0) return ''
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M ${first.x} ${first.y}`
  let d = `M ${first.x} ${first.y}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    if (!p0 || !p1 || !p2 || !p3) break
    const c1x = round2(p1.x + (p2.x - p0.x) / 6)
    const c1y = round2(p1.y + (p2.y - p0.y) / 6)
    const c2x = round2(p2.x - (p3.x - p1.x) / 6)
    const c2y = round2(p2.y - (p3.y - p1.y) / 6)
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/** 面积（折线下面那层渐变）的 `d`：折线本身收口到基线。 */
export function areaPath(points: readonly ChartPoint[], baseline: number): string {
  if (points.length === 0) return ''
  const line = linePath(points)
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''
  /* 只有一个点时画不出面积（宽为 0），返回空串让调用方只画那个圆点 */
  if (points.length === 1) return ''
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`
}

/**
 * x 轴上要写出来的刻度（下标）。
 *
 * 全写出来在"近一个月 30 个点"时必然叠在一起，因此按**能放下几个**抽稀：
 * 大约每 56px 一个刻度，首尾一定保留（首尾是"从哪天到哪天"，最要紧）。
 */
export function axisTickIndexes(count: number, innerWidth: number, perTick = 56): number[] {
  if (count <= 1) return count === 1 ? [0] : []
  const room = Math.max(2, Math.floor(innerWidth / perTick) + 1)
  if (room >= count) return Array.from({ length: count }, (_, index) => index)
  const step = Math.ceil((count - 1) / (room - 1))
  const out: number[] = []
  for (let index = 0; index < count; index += step) out.push(index)
  /* 最后一个点尽量写上：与倒数第二个刻度离得太近（不足半格）就不要，免得叠字 */
  const last = count - 1
  const previous = out[out.length - 1]
  if (previous !== last) {
    if (previous !== undefined && last - previous < step / 2) out[out.length - 1] = last
    else out.push(last)
  }
  return out
}
