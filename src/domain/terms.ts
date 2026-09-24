/**
 * 术语库：两个**术语范围**下的机关名称，以及每一条**一并算对的写法**。
 *
 * ## 数据从哪来
 *
 * 用户给的两份材料（仓库根目录的 `国内机构.docx` / `国际机构.docx`），
 * 由 `scripts/build-terms.mjs` 现算成 `terms-data/*.ts`——**不要手写那两个文件**。
 * 143 条：国内机关名称 83 条（17 页）、国际机关名称 60 条（12 页）。
 * 在这个文件里只有类型、范围查询与判分口径；数据一律在生成文件里。
 *
 * ## 为什么答案写死在这里，而不是让 AI 判
 *
 * 这是本项目的一条既有原则（见 scoring.ts）：**分数由程序算，不由 AI 打**。
 * 固定表述有官方译名，让模型去"判断用户译得对不对"会带来两个问题：
 * 同一份答案两次可能不同、用户无法自己核对分数怎么来的。
 * 因此术语题的批改是**完全本地、可复现、可解释**的。
 *
 * ## 判分口径：从"严格对照"放宽到"官方别名算对"（第 13 轮，用户拍板）
 *
 * 归一化仍旧只做"同一个答案的不同写法"层面的归一，**不做同义替换**；
 * 但"同一个答案的不同写法"这次扩大了四处——因为这批材料的英文本身就带这些差异：
 *   1. **官方缩写**：`National People's Congress (NPC)` 的 `NPC` 与全称**一样算对**
 *      （材料里 65 条带缩写，不认缩写等于强迫用户连缩写一起背）；
 *   2. **英美拼写**：`Organisation` / `Organization`、`Labour` / `Labor`、
 *      `Programme` / `Program`、`Centre` / `Center`、`Co-operation` / `Cooperation`。
 *      ⚠️ 这一条**照词给出**（见 `build-terms.mjs` 的 `SPELLING_PAIRS`），**不写通则**：
 *      写成 `-our → -or` 那种通则会把 `four` 也"接受"成 `for`，假放宽比不放宽更坏；
 *   3. **重音符号**：`Fédération Internationale de Football Association` 的重音不计较
 *      （键盘上打不出来）；
 *   4. **开头的 The**：`The Supreme People's Court of the People's Republic of China` 写不写 The 都算对。
 *
 * 另外**一英多中**（`直辖市人民政府` 与 `设区的市人民政府` 的官方英文都是
 * `Municipal People's Government`）在英译中方向下**写哪个都算对**，
 * 屏幕上的标准答案把两个都列出来（用「／」隔开）。
 *
 * ⚠️ 早先的口径是"严格到 `whole-process people's democracy` 与 `whole-process democracy`
 * 只认前者"。那条**仍然成立**（那是同义替换，不放宽），放宽的只是上面这四处——见 ADR 0023。
 */

import type { Direction } from './types'
import { TERM_SCOPES, type TermScope } from './term-scopes'
import { CN_ORG_TERMS } from './terms-data/cn-org'
import { INTL_ORG_TERMS } from './terms-data/intl-org'

/** 一条术语：中文名 + 官方英文名 + 两侧各自"一并算对"的其它写法。 */
export interface Term {
  /** 中文名称（中译英方向下它是题目、英译中方向下它是答案之一） */
  zh: string
  /** 官方英文名称，**照材料原样**（括号已统一成半角）；中译英方向下它是标准译法 */
  en: string
  /**
   * 英译方向一并算对的**其它英文写法**：官方缩写（`NPC`）与英美拼写变体。
   * 空数组就是只有 `en` 一种写法算对。
   */
  enAlt: readonly string[]
  /**
   * 英译中方向一并算对的**其它中文名**（一英多中）。
   * 例：`直辖市人民政府` 的 `zhAlt` 是 `['设区的市人民政府']`——两者的官方英文是同一条。
   */
  zhAlt: readonly string[]
}

/** 术语库按**范围**分组。范围表在 `term-scopes.ts`（与话题领域平行的另一张表）。 */
export const TERMS_BY_SCOPE: Record<TermScope, readonly Term[]> = {
  'cn-org': CN_ORG_TERMS,
  'intl-org': INTL_ORG_TERMS,
}

/** 术语题一页几条。用户要的是「五栏」，所以是 5。 */
export const TERMS_PER_PAGE = 5

/** 某个范围下的全部术语（顺序即材料里的顺序）。 */
export function termsOfScope(scope: TermScope): readonly Term[] {
  return TERMS_BY_SCOPE[scope]
}

/** 全部术语（跨范围）。 */
export function allTerms(): readonly Term[] {
  return TERM_SCOPES.flatMap((scope) => TERMS_BY_SCOPE[scope.id])
}

/** 某个范围一共几页（每页 5 条，末页可能不满）。 */
export function termPageCount(scope: TermScope): number {
  return Math.max(1, Math.ceil(TERMS_BY_SCOPE[scope].length / TERMS_PER_PAGE))
}

/**
 * 某个范围第 `page` 页的那几条（0 基）。
 *
 * ⚠️ **末页可能不满 5 条**（用户拍板："末页照旧五等分，缺的那两行留空、不可填也不计分"）。
 * 因此这里**不补齐**——补齐会让同一个范围里出现重复的题目，也会把那一行算进判分。
 * 界面负责把不足的行画成空框（见 `TermRows`）。
 */
export function termsOfPage(scope: TermScope, page: number): readonly Term[] {
  const pool = TERMS_BY_SCOPE[scope]
  const start = page * TERMS_PER_PAGE
  if (start < 0 || start >= pool.length) return []
  return pool.slice(start, start + TERMS_PER_PAGE)
}

/** 某一条术语属于第几页（记录、收藏要按页对回去）。 */
export function pageOfTerm(scope: TermScope, term: Term): number {
  const index = TERMS_BY_SCOPE[scope].indexOf(term)
  return index < 0 ? 0 : Math.floor(index / TERMS_PER_PAGE)
}

/**
 * 英文主译法：**去掉尾部括号**的那一版。
 *
 * `Central Committee of the Communist Party of China(CPC Central Committee)`
 * 的主译法是 `Central Committee of the Communist Party of China`——
 * 括号里是官方缩写，写不写那句话都算对（见文件头的判分口径）。
 */
export function primaryEnglish(term: Term): string {
  return term.en.replace(/\s*\([^()]*\)\s*$/, '').trim()
}

/**
 * 这一条在**这个方向**下全部算对的写法，**第 0 个即屏幕上显示的标准答案**。
 *
 * 中译英：照材料原样（`National People's Congress (NPC)`）最前，然后是去掉缩写的主译法、
 * 缩写本身、英美拼写变体。显示时用第 0 个，判分时整串都比。
 * 英译中：中文名最前，然后是一英多中的其它中文名（一条以上时界面上用「／」连起来）。
 */
export function acceptedAnswers(term: Term, direction: Direction): readonly string[] {
  const raw =
    direction === 'zh-to-en' ? [term.en, primaryEnglish(term), ...term.enAlt] : [term.zh, ...term.zhAlt]
  const seen = new Set<string>()
  const out: string[] = []
  for (const answer of raw) {
    const text = answer.trim()
    if (text.length === 0) continue
    const key = normalizeAnswer(text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

/** 屏幕上显示的标准答案（中译英是官方英文原名；英译中是全部算对的中文名，用「／」隔开）。 */
export function standardAnswer(term: Term, direction: Direction): string {
  const accepted = acceptedAnswers(term, direction)
  if (direction === 'zh-to-en') return accepted[0] ?? term.en
  return accepted.join('／')
}

/**
 * 归一化，用于**本地对照**判分。
 *
 * 只做"同一个答案的不同写法"层面的归一，绝不做同义替换：
 *   - 大小写、首尾空白；连续空白折叠成一个空格；
 *   - **重音符号**去掉（`Fédération` → `federation`）；
 *   - 弯引号/直引号、全角标点 → 直引号/半角标点（中文输入法下很容易打出来）；
 *   - 各类连字符统一成 `-`；
 *   - 括号两边的空白一律去掉（`United Nations (UN)` 与 `United Nations(UN)` 同一条）；
 *   - **开头的 `the`** 去掉（`The Supreme People's Court` 写不写 The 都算对）。
 *
 * 因此「whole-process people's democracy」与「whole-process democracy」**仍然只认前者**——
 * 那是同义替换，不在放宽之列（用户拍板的口径，见 ADR 0023）。
 */
export function normalizeAnswer(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // 重音符号：é → e
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'") // ‘ ’ ʼ → '
    .replace(/[\u201c\u201d]/g, '"') // “ ” → "
    .replace(/[\u2013\u2014\u2212]/g, '-') // – — − → -
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)) // 全角 → 半角
    .replace(/\u3000/g, ' ') // 全角空格
    .replace(/\s+/g, ' ')
    .replace(/\s*\(/g, '(') // `United Nations (UN)` 与 `United Nations(UN)` 同一条
    .replace(/\s*\)/g, ')')
    .replace(/^the\s+/, '') // 开头的 The 不计较
    .trim()
}

/**
 * 这一条术语的作答是否正确（本地对照，接受官方别名与英美拼写）。
 *
 * 空作答一律算错：正常化之后空串有可能与某条"只有 The 的答案"撞车，这里显式挡一道。
 */
export function isTermCorrect(term: Term, answer: string, direction: Direction): boolean {
  const normalized = normalizeAnswer(answer)
  if (normalized.length === 0) return false
  return acceptedAnswers(term, direction).some((accepted) => normalizeAnswer(accepted) === normalized)
}
