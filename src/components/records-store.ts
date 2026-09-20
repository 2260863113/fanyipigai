/**
 * 练习记录的本地存档。
 *
 * 原来练习记录只存在内存里（App 里一个 useState），**刷新即失**——这对"练习记录"
 * 这个功能是致命的：它的全部意义就是"回头看清当时哪里错了"。
 * 现在与设置、收藏、自定义题同一个存法：存这台浏览器的 localStorage。
 *
 * ## 存什么、不存什么
 *
 * 存：作答、批改、校验结果（含每处的绝对区间）、AI 原样返回的文本、以及题目上下文
 *    （哪道题 / 第几页 / 题型 / 方向 / 领域 / 第几次 / 修改风格）。
 * 不存：题目原文。记录里靠**题号**去题库里找原文（见 RecordsView 的回退逻辑：
 *    先在 EXERCISE_SOURCES 里找，再在 customSources 里找）。这样一条记录不会
 *    因为抄了一份原文而翻倍变大；代价是题库改了题目、或自定义题被覆盖之后，
 *    旧记录可能找不到原文——那时界面会如实说"未保存题干"，而不是编一个出来。
 *
 * ## 为什么要有条数上限，以及"写不下就丢最旧的"
 *
 * 一条记录包含作答、每处批改、校验区间与 AI 原文，长文章一条就可能有几十 KB，
 * 而 localStorage 通常只有 5 MB。因此：
 *   1. 只留最近 MAX_RECORDS 条；
 *   2. 即使在上限之内，也可能因为别的键（收藏、自定义题）占满而写不下——
 *      这时**从最旧的开始丢**再重试，直到写得下或只剩一条。
 *      宁少存几条，也不要"整个键写失败、结果一条也没存上"。
 *
 * ## v2：为什么换掉了存储键（旧记录直接作废）
 *
 * v1 里一条记录 = **一整篇**的作答与批改；逐页批改之后，一条记录 = **一页**。
 * 两者的 `answer` 含义完全不同（整篇 vs 一页），旧记录又没有页号，
 * 读回来只能当成"第 1 页的作答里有整篇文章"——那比丢掉更糟：界面会显示得理直气壮，
 * 而分数、勾画位置全都对不上。
 *
 * 用户对这一点明确说了"已有的旧记录直接作废"，因此这里换了键名。
 * v1 那份**留在浏览器里不动**（不主动删别人的数据），只是不再读它。
 */

import type { RecordView } from './RecordsView'

const STORAGE_KEY = 'translation-practice.records.v2'

/** 最多留多少条。练习记录是回顾用的，不是仓库。 */
export const MAX_RECORDS = 100

/** 落盘用的形状：createdAt 存 ISO 字符串（Date 过一遍 JSON 会变成字符串，读回来要显式转）。 */
interface StoredRecord extends Omit<RecordView, 'createdAt'> {
  createdAt: string
}

function isStoredRecord(value: unknown): value is StoredRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredRecord>
  return (
    typeof record.id === 'string' &&
    typeof record.exerciseId === 'string' &&
    typeof record.answer === 'string' &&
    typeof record.createdAt === 'string' &&
    /*
     * 页号也在校验之列：逐页批改之后它是**必填**的。
     * 没有它就无法判断这段作答属于哪一页，界面只能瞎猜一个（见文件头 v2 的说明）。
     */
    typeof record.sectionIndex === 'number' &&
    Number.isInteger(record.sectionIndex) &&
    record.sectionIndex >= 0 &&
    typeof record.correction === 'object' &&
    record.correction !== null
  )
}

/**
 * 读出全部记录。
 *
 * 顺序与界面状态一致：**最旧的在前**（RecordsView 显示时会 reverse 一遍）。
 * 这一点必须写死并对齐，否则刷新一次列表顺序就颠倒了。
 *
 * 坏数据一律**逐条跳过**而不是整份丢弃：一份里坏了一条，不该把其余几十条一起弄没。
 */
export function loadRecords(): RecordView[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredRecord).map((record) => ({
      ...record,
      createdAt: new Date(record.createdAt),
    }))
  } catch {
    // 无痕模式、localStorage 被禁用、内容不是 JSON——一律当作"没有"
    return []
  }
}

/**
 * 落盘。返回**实际存下来的**那份列表（可能与传入的不同：写不下时会丢最旧的）。
 *
 * 调用方应当用返回值覆盖自己的状态，否则界面显示的与真正存下来的会不一致——
 * 下次刷新就会"少了几条"，而用户不知道为什么。
 *
 * 传入顺序必须是**最旧的在前**；超出上限时丢的正是开头那几条（最旧的）。
 */
export function saveRecords(records: readonly RecordView[]): RecordView[] {
  let kept = records.slice(-MAX_RECORDS)

  for (;;) {
    const payload: StoredRecord[] = kept.map((record) => ({
      ...record,
      createdAt: record.createdAt.toISOString(),
    }))
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      return kept
    } catch {
      /*
       * 写不下：丢掉最旧的几批再试。
       *
       * 每次都会真的变短（`Math.ceil(n * 0.2)` 至少是 1）——这不只是效率问题：
       * 早先用 `Math.floor` 时，2 条的 20% 是 0，于是原地打转，最后把**没能存进去**
       * 的那份当成存下来了返回给界面（界面显示几条、一刷新就没了）。测试抓到了这一点。
       *
       * 一条都写不下时返回空数组：**不谎报**。界面据此显示"没能存下"，
       * 而不是显示一份下次刷新就消失的记录。
       */
      if (kept.length <= 1) return []
      kept = kept.slice(Math.max(1, Math.ceil(kept.length * 0.2)))
    }
  }
}

/** 清空（记录页暂时没有这个入口，留给将来）。 */
export function clearRecords(): RecordView[] {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 清不掉就算了 */
  }
  return []
}
