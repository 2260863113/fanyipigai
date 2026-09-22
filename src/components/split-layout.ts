/**
 * 分割线位置：**走的时候在哪儿，下次回来还在哪儿**（用户要求）。
 *
 * 用户的原话："所有界面可移动分割线的位置需要个性化记忆，下次打开时按照相同位置的分割线展示。"
 * 追问过一次"双击恢复默认算不算数"，答复是一句更硬的话："反正就是，你走的时候什么位置，
 * 下次回来之后，还是在那个位置。"因此**双击恢复默认也要写回存储**——
 * 恢复默认之后的"默认"就是当前位置，下次打开看到的就是它（如果只在内存里恢复，
 * 双击会变成一次性的假动作，下次打开又弹回用户拖过的那一版）。
 *
 * ## 记哪几条
 *
 * 用户拍板**保持现在的共用关系**（练习页的两条竖线共用同一个横向比例，不拆成各调各的），
 * 因此要记的是三组值、五个数字：
 *   - `practice`：练习页 —— 左右比例 + 上下比例（让三条分割线读同一组值）；
 *   - `records-outer`：练习记录页外层 —— 列表/详情的左右比例；
 *   - `records-nested`：练习记录页内层 —— 原文/当时译文的左右与上下比例。
 *
 * 存的是**比例（0–1）**而不是像素：窗口大小变了，比例仍然说得通，像素会把人送到栏外。
 * 值一律夹在 `MIN`–`MAX` 之间——坏数据、旧版本、手改过的存储都不该让界面塌成一栏。
 */

/** 一条分割线定下来的布局比例。`left` 是左栏占比，`top` 是上排占比。 */
export interface SplitState {
  /** 左栏占的横向比例（0–1） */
  left: number
  /** 上排占的纵向比例（0–1） */
  top: number
}

/**
 * 三组位置各有各的名字。
 *
 * 名字是**稳定的存储键**，改名字等于把用户的布局记忆丢掉一次，因此不要随手改。
 */
export type SplitScope = 'practice' | 'records-outer' | 'records-nested'

/** 比例的下限与上限：任一条分割线都不许把某一栏拖到看不见。 */
export const SPLIT_MIN = 0.15
export const SPLIT_MAX = 0.85

const STORAGE_KEY = 'translation-practice.split-layout.v1'

/** 把一个比例夹进允许范围。读存储、拖动、写入三处都走它，免得边界各写各的。 */
export function clampRatio(value: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value))
}

function isSplitState(value: unknown): value is SplitState {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<SplitState>
  return Number.isFinite(entry.left) && Number.isFinite(entry.top)
}

function readAll(): Record<string, SplitState | null> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, SplitState | null> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      /*
       * `null` 是**一个有意义的值**：它表示"这一组现在是自动布局"（用户双击过恢复默认）。
       * 不写进存储就等于"从没拖过"，看起来一样，但语义不同——留着它才能让
       * "你走的时候什么位置"这句话对自动布局也成立。
       */
      if (value === null) result[key] = null
      else if (isSplitState(value)) result[key] = { left: clampRatio(value.left), top: clampRatio(value.top) }
    }
    return result
  } catch {
    // localStorage 被禁用、内容坏了——一律当"没记过"，界面回到自动布局
    return {}
  }
}

function persist(next: Record<string, SplitState | null>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存不下就算了：这一次拖动照常生效，只是刷新之后回到旧位置
  }
}

/** 这一组分割线上次留下的位置；`null` = 自动布局（没拖过，或者用户双击恢复过默认）。 */
export function loadSplit(scope: SplitScope): SplitState | null {
  return readAll()[scope] ?? null
}

/** 记下这一组的位置（`null` = 自动布局，同样要记，见文件头）。 */
export function saveSplit(scope: SplitScope, split: SplitState | null): void {
  const all = readAll()
  all[scope] = split
  persist(all)
}

/**
 * 拖动时每一步都把比例夹一次。
 *
 * 夹在**写状态之前**（而不是只在读取时夹）：拖动过程中一旦越过边界，
 * 屏幕上那一栏当场就该停住不动，而不是先出去再被拉回来。
 */
export function clampSplit(split: SplitState): SplitState {
  return { left: clampRatio(split.left), top: clampRatio(split.top) }
}
