/**
 * 每一页的界面状态：**草稿、是不是在编辑、正在看第几次批改**，存在浏览器里。
 *
 * ## 为什么它必须与练习记录分开存
 *
 * 练习记录存的是"批过什么"（落盘的存档，一轮一轮攒下来）；这里存的是
 * "这一页此刻长什么样"——写到一半的字、按过没按过「返回编辑」、以及
 * 「批改记录」下拉里选中的那一次。两件事的生命周期完全不同：
 * 记录是事实，界面状态是临时姿势，**刷新一次就该还在，但换原文就该清掉**。
 *
 * ## 用户要的三件事
 *
 * 1. （第 10 条）"切换下一段，再切换回来时……对于批改后的界面，我希望能记住显示的是批改的第几次，
 *    而不是每次都默认回到批改的最新一次的页面。"→ `viewingGradeId` 按「题 + 页」各记各的。
 * 2. （第 10 条追问）"顺便把编辑态与草稿也落盘"→ `unlocked` 与 `draft`。
 * 3. （第 10 条再追问）刷新之后**旧结果不再挂在这一页**："不算了，自己去『批改记录』
 *    下拉栏里重新调出来。"→ 因此 `unlocked` 为真的页在接回会话时**不接记录里的结果**，
 *    只把草稿与"在编辑"这两件事接回来（见 App 里的 restoredPages）。
 *
 * ## 为什么按「题 + 页」而不是按页
 *
 * 页号只在同一道题里有意义：第 3 页在另一篇文章里是另一段文字。
 * 键就用 `题号#页号`，换题、换原文（页数变了）时旧键要么对不上、要么被清掉，
 * 不会把上一篇文章的草稿贴到这一篇上。
 *
 * ## 条数上限
 *
 * 草稿可能很长（一页几百个字），因此在**条数**上封顶：超过 `MAX_PAGES` 条时
 * 丢最久没动过的那些（`updatedAt` 最早）。练习记录有 100 条上限、
 * 这里留 200 条，够覆盖"最近在做的几篇"，也不会把 5MB 的 localStorage 吃掉。
 */

const STORAGE_KEY = 'translation-practice.page-state.v1'

/** 最多留多少页的界面状态（见文件头）。 */
export const MAX_PAGES = 200

export interface StoredPageState {
  /** 这一页作答框里的文字（没写过就是空串） */
  draft: string
  /**
   * 这一页现在是不是"可写的编辑态"。
   *
   * 它记的就是「返回编辑」按过没有：按过之后这一页即使有批改记录也显示作答框。
   * 落盘之后刷新仍然可写——这正是用户要的"编辑态也记住"。
   */
  unlocked: boolean
  /** 「批改记录」下拉里选中的那一次（记录 id）；null = 看最新一次 */
  viewingGradeId: string | null
  /** 最后一次写入时间，只用于上面那个上限的淘汰顺序 */
  updatedAt: string
}

export type PageStateMap = Record<string, StoredPageState>

/** 键入：`题号#页号`。 */
export function pageStateKey(exerciseId: string, sectionIndex: number): string {
  return `${exerciseId}#${sectionIndex}`
}

function isStoredPageState(value: unknown): value is StoredPageState {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<StoredPageState>
  return typeof entry.draft === 'string'
}

function readAll(): PageStateMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: PageStateMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isStoredPageState(value)) continue
      result[key] = {
        draft: value.draft,
        unlocked: value.unlocked === true,
        viewingGradeId: typeof value.viewingGradeId === 'string' ? value.viewingGradeId : null,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      }
    }
    return result
  } catch {
    // 无痕模式、内容坏了——一律当"没有记过"，界面照常
    return {}
  }
}

function persist(map: PageStateMap): PageStateMap {
  const keys = Object.keys(map)
  let kept = map
  if (keys.length > MAX_PAGES) {
    const oldest = keys
      .sort((a, b) => (map[a]?.updatedAt ?? '').localeCompare(map[b]?.updatedAt ?? ''))
      .slice(0, keys.length - MAX_PAGES)
    kept = { ...map }
    for (const key of oldest) delete kept[key]
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
  } catch {
    // 写不下（配额满）就算了：这一次界面上照常，只是刷新之后回到上一次存下来的样子
  }
  return { ...kept }
}

/** 读出全部页状态（App 启动时读一次，之后自己维护这份 state）。 */
export function loadPageStates(): PageStateMap {
  return readAll()
}

/** 某一页的状态；没记过就是 undefined。 */
export function readPageState(
  map: PageStateMap,
  exerciseId: string,
  sectionIndex: number,
): StoredPageState | undefined {
  return map[pageStateKey(exerciseId, sectionIndex)]
}

/**
 * 改某一页的某个字段，顺手落盘。
 *
 * 与 article-progress.ts 同一套做法：**返回新的那份 map**，调用方用它覆盖自己的 state——
 * 让"界面上显示的"与"真的存下来的"永远是同一份。
 */
export function writePageState(
  map: PageStateMap,
  exerciseId: string,
  sectionIndex: number,
  patch: Partial<Omit<StoredPageState, 'updatedAt'>>,
  now = new Date(),
): PageStateMap {
  const key = pageStateKey(exerciseId, sectionIndex)
  const current = map[key]
  const next: StoredPageState = {
    draft: patch.draft ?? current?.draft ?? '',
    unlocked: patch.unlocked ?? current?.unlocked ?? false,
    viewingGradeId: patch.viewingGradeId !== undefined ? patch.viewingGradeId : (current?.viewingGradeId ?? null),
    updatedAt: now.toISOString(),
  }
  /*
   * 什么都没变就**一个字都不写**：这个函数在打字时会被调用（每敲一个字一次），
   * 而 localStorage 是同步写盘。内容相同时直接返回原 map，省掉整份序列化。
   * 时间戳也不更新——否则"最近动过的保留"这条淘汰规则会被"反复打开同一页"牵着走。
   */
  if (
    current &&
    current.draft === next.draft &&
    current.unlocked === next.unlocked &&
    current.viewingGradeId === next.viewingGradeId
  ) {
    return map
  }
  return persist({ ...map, [key]: next })
}

/**
 * 丢掉某道题**全部页**的界面状态。
 *
 * 用途只有一个，但不能漏：**换原文**（「换一换」、AI 出题、重新贴一篇）时，
 * 会话里的作答被清空了（见 session.ts 的 clearedFor）——如果这里不清，
 * 刷新之后旧原文的草稿又贴着新原文回来了，那比丢掉更糟：文字对不上原文，
 * 用户会以为程序把他的字弄乱了。
 */
export function dropPageStates(map: PageStateMap, exerciseId: string): PageStateMap {
  const prefix = `${exerciseId}#`
  const next: PageStateMap = {}
  let changed = false
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(prefix)) {
      changed = true
      continue
    }
    next[key] = value
  }
  return changed ? persist(next) : map
}
