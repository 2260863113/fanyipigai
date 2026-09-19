/**
 * 「填补内容」方框的摆放。
 *
 * 为什么要单独算：批注里的正确写法（补入的词、替换后的词、重写后的整句）以前是
 * 直接写在文字流里的，两处挨得近就会互相压字，而且会把整行的换行位置挤歪。
 * 现在它们一律画成绝对定位的方框，位置由这里统一算。
 *
 * 规则（来自实际使用要求）：
 * 1. 每处填补一个方框，**默认居中**在被修改内容上方（中心与中心对齐），默认只占一行；
 * 2. 两个方框快贴上时，**左边的向左延展、右边的向右延展**，谁也别盖谁；
 * 3. 延展时又碰到别的方框 → **往上加一层**；
 * 4. 居中是首要的，但真放不下时会被栏边顶回来（被改内容的中心离栏边不到半个方框宽时）——
 *    让补写的字跑出译文栏、被栏裁掉，比稍微不居中更糟；
 * 5. 被修改内容跨行时，**每行各摆一个方框**（补写内容在 FixLayer 里已按行切开，
 *    锚点就是那一行画出来的带子），单行的仍锚定**字数最多的那一行**（在测量层选，
 *    这里只拿到锚定行的矩形）。
 *
 * 本文件是纯函数：不碰 DOM，给定矩形就能算出位置，方便单测。
 */

export interface FixBoxInput {
  id: string
  /** 锚定那一行的矩形（相对容器左上角） */
  anchorLeft: number
  anchorWidth: number
  anchorTop: number
  /** 方框的尺寸（测量层给的：宽到放不下的那些已经在测量层折好行） */
  width: number
  height: number
}

export interface FixBoxPlacement {
  id: string
  left: number
  top: number
  /** 从锚定行往上数第几层：0 = 紧贴文字上方 */
  row: number
}

/** 同一层里两个方框之间至少留的空隙 */
export const FIX_BOX_GAP = 6
/** 层与层之间的空隙 */
export const FIX_BOX_ROW_GAP = 2
/**
 * 第 0 层方框的底边到锚定行**内容区顶边**的距离。
 *
 * 取 0 不等于"贴在一起"：方框自己那一行带着半个行距的空白（约 3px），
 * 锚定行的内容区顶边也在字身最高点上方好几个像素——两边各自的空白加起来，
 * 眼睛看到的间隔仍有 7–10px。以前取 6，补写的字就明显"飘"在被改文字的半空中。
 */
export const FIX_BOX_TOP_GAP = 0
const MAX_ROUNDS = 30

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 两个横向区间重叠多少（<= 0 表示没碰上） */
function overlapOf(aLeft: number, aWidth: number, bLeft: number, bWidth: number): number {
  return Math.min(aLeft + aWidth, bLeft + bWidth) - Math.max(aLeft, bLeft)
}

function centerOf(box: FixBoxInput): number {
  return box.anchorLeft + box.anchorWidth / 2
}

function maxLeftOf(box: FixBoxInput, containerWidth: number): number {
  return Math.max(0, containerWidth - box.width)
}

interface Placed {
  box: FixBoxInput
  left: number
}

/**
 * 让同一层里的方框两两分开：左边的往左让、右边的往右让（各让一半）。
 * 全部让开了返回 true；被容器边界卡住、怎么都让不开就返回 false（调用方会换一层）。
 */
function relax(row: Placed[], containerWidth: number): boolean {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let moved = false
    for (let i = 0; i < row.length; i += 1) {
      for (let j = i + 1; j < row.length; j += 1) {
        const a = row[i]
        const b = row[j]
        if (!a || !b) continue
        const overlap = overlapOf(a.left, a.box.width, b.left, b.box.width) + FIX_BOX_GAP
        if (overlap <= 0) continue
        // 谁在左谁在右，按**原始锚点的中心**定，不看已经被推到哪里
        const aFirst = centerOf(a.box) <= centerOf(b.box)
        const push = overlap / 2
        a.left = clamp(a.left + (aFirst ? -push : push), 0, maxLeftOf(a.box, containerWidth))
        b.left = clamp(b.left + (aFirst ? push : -push), 0, maxLeftOf(b.box, containerWidth))
        moved = true
      }
    }
    if (!moved) return true
  }
  // 还有没让开的，说明这一层挤不下
  return row.every((item, index) =>
    row.every((other, otherIndex) =>
      index === otherIndex || overlapOf(item.left, item.box.width, other.left, other.box.width) + FIX_BOX_GAP <= 0,
    ),
  )
}

export function placeFixBoxes(boxes: readonly FixBoxInput[], containerWidth: number): FixBoxPlacement[] {
  const placements = new Map<string, FixBoxPlacement>()

  // 按锚定行分组：只有落在同一行的方框才会互相挤
  const lines = new Map<number, FixBoxInput[]>()
  for (const box of boxes) {
    const key = box.anchorTop
    const list = lines.get(key)
    if (list) list.push(box)
    else lines.set(key, [box])
  }

  for (const [anchorTop, lineBoxes] of lines) {
    const ordered = [...lineBoxes].sort((a, b) => centerOf(a) - centerOf(b))
    const rows: Placed[][] = []

    for (const box of ordered) {
      /*
       * 默认居中。被改内容的中心离左边（或右边）不足半个方框宽时会被栏边顶回来——
       * 这是有意的取舍：宁可稍微不居中，也不能让补写的字横着跑出译文栏（栏会把它裁掉）。
       */
      const centered = clamp(centerOf(box) - box.width / 2, 0, maxLeftOf(box, containerWidth))
      let placed = false

      for (let index = 0; index < rows.length; index += 1) {
        const candidate = [...(rows[index] as Placed[]), { box, left: centered }]
        if (relax(candidate, containerWidth)) {
          rows[index] = candidate
          placed = true
          break
        }
      }

      if (!placed) rows.push([{ box, left: centered }])
    }

    /*
     * 位置统一从 rows 回填，不能在第 1 步逐个 set：
     * relax 会把**已经放好的**方框也一起挪动（左右各让一半），
     * 先记下的旧位置就过期了（实测踩过：左边那个纹丝不动、右边那个被推过头）。
     */
    rows.forEach((row, index) => {
      for (const item of row) {
        placements.set(item.box.id, { id: item.box.id, left: item.left, top: 0, row: index })
      }
    })

    // 垂直方向：第 0 层紧贴锚定行上方，再往上一层一层往上叠
    let top = anchorTop
    rows.forEach((row, index) => {
      const height = Math.max(0, ...row.map((item) => item.box.height))
      top -= height + (index === 0 ? FIX_BOX_TOP_GAP : FIX_BOX_ROW_GAP)
      for (const item of row) {
        const placement = placements.get(item.box.id)
        if (placement) placement.top = top
      }
    })
  }

  return boxes.map((box) => placements.get(box.id) ?? { id: box.id, left: 0, top: box.anchorTop, row: 0 })
}