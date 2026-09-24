/**
 * 自定义题：用户自己贴一篇原文进来练，不必等我们出题。
 *
 * 三件事在这里定下来（都是用户明确选过的）：
 *   1. **只贴原文**。译文方向按"有没有汉字"自动判断；文体按一般说明文算；
 *      参考译文留空——批改本来就不需要它（参考译文从不外发，也不会因此多花一分钱）。
 *   2. **按什么题型批改由程序判断**：多个自然段就是文章题（会按段切分、逐段作答），
 *      一段里有两句以上按段落题，很短又没有标点的按术语题，其余按句子题。
 *      篇长硬校验（英译汉 250–350 词那种）**不适用**于自己贴的题——否则随便贴一句就被拦下了。
 *   3. **只留最新一篇**，存在这台浏览器上（与设置、练习记录同一个存法）；刷新还在，换台电脑就没有。
 *
 * 原文另按题号留一份，是为了让**练习记录**翻回旧题时还能显示当时考的是什么
 * （记录里只存批改，不存原文）；只留最近 50 份，免得越攒越多。
 *
 * ## 第 13 轮：不再有"贴一篇"的弹窗，原文就是输入框
 *
 * 用户要求："自定义模式，一进去不弹出窗口要求输入，而是将原文也变成输入栏，
 * 用户自行粘贴原文，自己输入译文。"于是这里配套改了三条：
 *   - `openCustom()`：进自定义栏时拿一篇**现成的**（没贴过就铸一个空白题号），
 *     调用方不再需要弹窗问用户；
 *   - `saveCustomSource()`：**边写边存**，题号不变（每敲一个字换一个题号的话，
 *     作答、批改结果、页状态会全部对不上）；
 *   - `loadCustom()` 允许原文是空的——"还没开始写"是一个正常状态，不该被当成"没贴过"。
 *
 * ⚠️ 一条要留意的后果，以及它的对策（写在 App 的 `updateCustomSource` 里）：
 * 记录里**不存原文**，靠题号回查，因此同一题号下改原文会让**旧记录跟着改口**。
 * 对策是"已经练过这一篇（有记录）之后再改原文，就当成一篇新题、铸新题号"，
 * 于是旧记录仍指向当时那一篇。
 */

import { splitSections } from './sections'
import type { Direction, Exercise, Mode } from './types'

const STORAGE_KEY = 'translation-practice.custom'
const SOURCES_KEY = 'translation-practice.custom-sources'
/** 旧题的原文最多留这么多份（练习记录翻得回去就行） */
const KEEP_SOURCES = 50

export interface CustomExercise {
  id: string
  /** 用户贴进来的原文 */
  source: string
  createdAt: string
}

/** 有汉字就是中译英，否则英译中。 */
export function directionOf(source: string): Direction {
  return /[\u4e00-\u9fff]/.test(source) ? 'zh-to-en' : 'en-to-zh'
}

/** 按长度口径数"多少个单位"：中文按字、英文按词。 */
function unitsOf(source: string, direction: Direction): number {
  const text = source.trim()
  if (direction === 'zh-to-en') return text.replace(/\s+/g, '').length
  return text.split(/\s+/).filter(Boolean).length
}

/** 句末标点的个数（英文的句点要跟着空格或结尾，免得把 e.g. 这类算进去）。 */
function sentenceEndsOf(source: string): number {
  return (source.match(/[。！？!?]|\.(?=\s|$)/g) ?? []).length
}

/**
 * 按哪种题型批改。
 *
 * 判断顺序是有讲究的：段落数最可靠（用户真的敲了空行），其次才是句数，
 * 最后才拿"很短且没有标点"去认术语——术语题在界面上是"按官方术语表判定"的，
 * 认错了顶多是把一句话当术语判，但那句话本来也没有别的结构可言。
 */
export function modeOf(source: string): Mode {
  const text = source.trim()
  if (splitSections(text).length > 1) return 'article'
  if (sentenceEndsOf(text) >= 2) return 'paragraph'
  const direction = directionOf(text)
  const units = unitsOf(text, direction)
  /*
   * "很短"在两边的口径不一样：中文术语常见的也就 2–8 个字（生态文明、高质量发展、碳中和），
   * 英文术语则是 1–4 个词（ecological civilization）。两边都用 4 的话，中文术语会被判成句子题。
   */
  const termLimit = direction === 'zh-to-en' ? 8 : 4
  if (units <= termLimit && !/[。！？!?：:，,；;]/.test(text)) return 'term'
  return 'sentence'
}

/** 建议用时：按每 25 个单位一分钟粗估，最少 5 分钟。 */
function suggestedMinutesOf(source: string, direction: Direction): number {
  const units = unitsOf(source, direction)
  return Math.max(5, Math.round(units / 25))
}

/** 把一份自定义题变成本站通用的题目对象。 */
export function exerciseOf(custom: CustomExercise): Exercise {
  const direction = directionOf(custom.source)
  return {
    id: custom.id,
    direction,
    mode: modeOf(custom.source),
    // 自己贴的题没有文体信息，按最常见的一般说明文算（只影响提示词里对语体的要求）
    genre: 'expository',
    topic: '自定义题目',
    source: custom.source,
    referenceTranslation: '',
    suggestedMinutes: suggestedMinutesOf(custom.source, direction),
  }
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    // 无痕模式、localStorage 被禁用、存的东西不是 JSON——一律当作"没有"
    return null
  }
}

/** 读出当前那一篇自定义题；没贴过或存的东西坏了都返回 null。 */
export function loadCustom(): CustomExercise | null {
  const parsed = readJson(STORAGE_KEY) as Partial<CustomExercise> | null
  // ⚠️ 原文为空**不算**坏数据：第 13 轮起原文是一个输入框，"还没开始写"是正常状态
  if (!parsed || typeof parsed.source !== 'string') return null
  const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString()
  const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : `custom-${Date.parse(createdAt) || Date.now()}`
  return { id, source: parsed.source, createdAt }
}

/**
 * 铸一个**空白**自定义题（题号只铸一次）。
 *
 * 用在两处：进自定义栏时还没贴过任何东西；以及"已经练过这一篇、又被改了原文"
 * 那种当成新题的情形（见文件头最后那段）。
 */
export function newCustom(): CustomExercise {
  const now = new Date()
  return { id: `custom-${now.getTime()}`, source: '', createdAt: now.toISOString() }
}

/** 进自定义栏时用它拿一篇现成的：读过的那一篇，没贴过就铸一个空白题号。 */
export function openCustom(): CustomExercise {
  return loadCustom() ?? newCustom()
}

/**
 * 边写边存：把原文写进"当前这一篇"（**题号不动**），并按题号留一份档。
 *
 * 为什么题号不能动：作答、批改结果、页状态、练习记录全都按题号索引，
 * 每敲一个字换一个题号等于把用户正在写的东西丢掉。
 * 留档只留非空的原文——空串存档没有意义，还会挤掉真正要留的那几篇。
 */
export function saveCustomSource(custom: CustomExercise, source: string): CustomExercise {
  const entry: CustomExercise = { ...custom, source }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
    if (source.trim().length > 0) {
      const history = (readJson(SOURCES_KEY) as Record<string, string> | null) ?? {}
      history[entry.id] = source
      const ids = Object.keys(history)
      for (const old of ids.slice(0, Math.max(0, ids.length - KEEP_SOURCES))) delete history[old]
      localStorage.setItem(SOURCES_KEY, JSON.stringify(history))
    }
  } catch {
    // 存不下就算了：这一次照样能练，只是刷新之后得重贴
  }
  return entry
}

/** 所有贴过的自定义题原文（按题号），供练习记录翻旧题时显示。 */
export function customSources(): Record<string, string> {
  const stored = readJson(SOURCES_KEY)
  return stored && typeof stored === 'object' ? (stored as Record<string, string>) : {}
}
