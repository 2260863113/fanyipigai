/**
 * 术语库：五个**板块**（术语范围）下的官方译名，以及每一条**一并算对的写法**。
 *
 * ## 数据从哪来
 *
 * 材料进仓库的路子有两条，都由脚本现算成 `terms-data/*.ts`——**不要手写那些文件**：
 *   - 机关名称：仓库根目录的两份 docx（`国内机构.docx` / `国际机构.docx`），
 *     83 条（每页 10 条 → 9 页）与 60 条（6 页），生成器是 `scripts/build-terms.mjs`；
 *   - 手册那三块（当代术语／必背核心术语／必背用典）：`handbook-src/` 里整理好的
 *     《理解当代中国 核心术语学习手册》条目，生成器是 `scripts/build-handbook-terms.mjs`。
 * ⚠️ 五个板块现在**都有材料**；`hasTermData` 与界面上那句「暂无分组」是留给**下一个**
 * 还没材料的板块的（表仍然写成"每个范围都必须有一项"的形状，加板块时先给个空数组）。
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
import { TERM_SCOPES, groupLabel, perGroupOfScope, type TermScope } from './term-scopes'
import { CN_ORG_TERMS } from './terms-data/cn-org'
import { INTL_ORG_TERMS } from './terms-data/intl-org'
import { MODERN_TERM_TERMS } from './terms-data/modern-term'
import { CORE_TERM_TERMS } from './terms-data/core-term'
import { CLASSICS_TERMS } from './terms-data/classics'

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

/**
 * 术语库按**范围**分组。范围表在 `term-scopes.ts`（与话题领域平行的另一张表）。
 *
 * ⚠️ 第 14 条起这张表有**五个板块**，而**第 15 条之后五个都有材料了**：
 * 后三个（当代术语／必背核心术语／必背用典）来自《理解当代中国 核心术语学习手册》，
 * 材料在 `handbook-src/`、由 `scripts/build-handbook-terms.mjs` 生成
 * （那份手册是扫描件，最上游是 OCR；整理经过见 `terms-data/modern-term.ts` 的文件头）。
 * 全库此刻 1001 条：国内 83 ＋ 国际 60 ＋ 当代 718 ＋ 核心 60 ＋ 用典 80。
 *
 * 表仍然写成 `Record<TermScope, …>`：**每个范围都必须有一项**，
 * 哪天再添一个还没材料的板块，就按老办法给一个空数组，界面照样列出那一行、
 * 明说「暂无分组」（见 `hasTermData` 与 `groupsOfScope`）——不藏起来，也不假装有内容。
 */
export const TERMS_BY_SCOPE: Record<TermScope, readonly Term[]> = {
  'cn-org': CN_ORG_TERMS,
  'intl-org': INTL_ORG_TERMS,
  'modern-term': MODERN_TERM_TERMS,
  'core-term': CORE_TERM_TERMS,
  'classics': CLASSICS_TERMS,
}

/**
 * 术语题**一页**几条（用户第 14 条：一页显示 10 个术语，早先是 5 个）。
 *
 * ⚠️ 它与"一组几条"是**两个数**，而且后者**逐板块不同**（见 `term-scopes.ts` 的 `perGroup`）：
 * 国内／国际机关名称每 20 条一组（正好两页），当代术语每 50 条一组（正好五页）。
 * 判分、末页不满的行数、题号里的分页全都只认**这一个**页长。
 */
export const TERMS_PER_PAGE = 10

/** 这个板块现在有没有材料。没有的话界面上只能显示「暂无分组」（见 term-scopes.ts 的文件头）。 */
export function hasTermData(scope: TermScope): boolean {
  return termsOfScope(scope).length > 0
}

/** 某个范围下的全部术语（顺序即材料里的顺序）；没有材料的板块是空数组。 */
export function termsOfScope(scope: TermScope): readonly Term[] {
  return TERMS_BY_SCOPE[scope] ?? []
}

/** 全部术语（跨范围）。没有材料的板块不贡献任何一条。 */
export function allTerms(): readonly Term[] {
  return TERM_SCOPES.flatMap((scope) => termsOfScope(scope.id))
}

/**
 * 某个范围一共几页（每页 10 条，末页可能不满）。
 *
 * 没有材料的板块是 **0 页**（而不是"1 页空页"）：界面上"共 1 页"是句假话，
 * 而 0 正好让调用方一眼看出"这个板块还没法练"。
 */
export function termPageCount(scope: TermScope): number {
  return Math.ceil(termsOfScope(scope).length / TERMS_PER_PAGE)
}

/**
 * 某个范围第 `page` 页的那几条（0 基）。
 *
 * ⚠️ **末页可能不满 10 条**（用户拍板："末页照旧十等分，缺的那几行留空、不可填也不计分"）。
 * 因此这里**不补齐**——补齐会让同一个范围里出现重复的题目，也会把那一行算进判分。
 * 界面负责把不足的行画成空框（见 `TermRows`）。
 */
export function termsOfPage(scope: TermScope, page: number): readonly Term[] {
  const pool = termsOfScope(scope)
  const start = page * TERMS_PER_PAGE
  if (start < 0 || start >= pool.length) return []
  return pool.slice(start, start + TERMS_PER_PAGE)
}

/** 某一条术语属于第几页（记录、收藏要按页对回去）。 */
export function pageOfTerm(scope: TermScope, term: Term): number {
  const index = termsOfScope(scope).indexOf(term)
  return index < 0 ? 0 : Math.floor(index / TERMS_PER_PAGE)
}

/**
 * 一个**分组**在界面上要用的全部事实。
 *
 * 用户第 14 条要的是"在这个板块里选分组"，因此弹窗里每一组都得说清
 * "第几条到第几条、共几页"，而"点确定之后落到哪一页"（`firstPage`）也由这里算，
 * 免得界面自己去推"每条一组 / 每页几条"这套除法。
 */
export interface TermGroup {
  /** 组号，0 基（与页号同一套口径） */
  index: number
  /** 屏幕上的名字：`国内机关名称|第1组（1-20）`（命名风格见 term-scopes.ts） */
  label: string
  /** 这一组的第一条在整库里的序号（**1 基**，与材料里的序号一致） */
  from: number
  /** 最后一条的序号（1 基，所以 from > to 是不可能的） */
  to: number
  count: number
  /** 这一组占几页（按**这个板块**的组大小与全站的页长算出来，不写死） */
  pages: number
  /** 这一组的第一页（0 基）——点「确定」就落到它 */
  firstPage: number
}

/**
 * 按**条数**切分组：`total` 条、每"这个板块自己的 perGroup"条一组（末组可能不满）。
 *
 * ⚠️ 组大小**逐板块**取（`perGroupOfScope`），因此当代术语是每 50 条一组、
 * 其余四个板块是每 20 条一组——**不要**在这里读全局的 `TERMS_PER_GROUP`，
 * 那会把当代术语切成 36 个小碎块（用户对它的口径是 15 组）。
 *
 * ⚠️ 分组是按**条数**切的，不是按页切的：一组 20 条正好两页、一组 50 条正好五页，
 * 但那只是因为 20 与 50 都能被 10 整除。因此 `firstPage` / `pages` 一律按页算术算出来，
 * 不写死"一组两页"——末组不满时页数自然少。
 *
 * ⚠️ 为什么把条数做成**显式参数**（而不是只留 `groupsOfScope`）：有两类边界必须能断言，
 * 而它们在真实数据上不一定碰得到——"这个板块一条都没有"（界面上要显示「暂无分组」）
 * 与"一组 50 条怎么落到页上、末组只有 18 条时算几页"。验收脚本直接喂这两个数即可，
 * 于是**不必**为了可测在生产代码里塞一个 `if (import.meta.env.TEST)` 之类的分支。
 */
export function groupsOfCount(scope: TermScope, total: number): TermGroup[] {
  const perGroup = perGroupOfScope(scope)
  const groups: TermGroup[] = []
  if (perGroup <= 0 || total <= 0) return groups
  for (let start = 0; start < total; start += perGroup) {
    const count = Math.min(perGroup, total - start)
    const firstPage = Math.floor(start / TERMS_PER_PAGE)
    const lastPage = Math.floor((start + count - 1) / TERMS_PER_PAGE)
    groups.push({
      index: groups.length,
      label: groupLabel(scope, groups.length, start + 1, start + count),
      from: start + 1,
      to: start + count,
      count,
      pages: lastPage - firstPage + 1,
      firstPage,
    })
  }
  return groups
}

/** 某个板块的全部**分组**（条数取自真实数据；切法与边界一律见 `groupsOfCount`）。 */
export function groupsOfScope(scope: TermScope): TermGroup[] {
  return groupsOfCount(scope, termsOfScope(scope).length)
}

/**
 * 某一页**属于哪一组**（界面上用它标出"正在练的那一组"）。
 *
 * 越界的页返回 null（0 基页号，末页之后就是没有）。没有材料的板块自然也返回 null。
 */
export function groupOfPage(scope: TermScope, page: number): TermGroup | null {
  if (page < 0 || page >= termPageCount(scope)) return null
  return (
    groupsOfScope(scope).find(
      (group) => page >= group.firstPage && page < group.firstPage + group.pages,
    ) ?? null
  )
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
 * 屏幕上显示的**标准译法**：把"只差句末标点"的那几条并掉之后的 `standardAnswer`。
 *
 * 手册那三块的条目多是整句，而**句末句号写不写都算对**（口径见文件头），
 * 生成器因此把"去掉句号的那一版"登记进了 `zhAlt`（必背用典里 45 条都有这一项）。
 * 那是判分口径没错，但**摆在屏幕上很难看**：`标准答案` 会变成
 * 「不困在于早虑，不穷在于早豫。／不困在于早虑，不穷在于早豫」——
 * 读起来像两个不同的答案，而它其实只是在说"句号可以省"。
 *
 * 因此显示时把这类"只差末尾标点"的重复项去掉，**真正的**一英多中照旧用「／」全列出来
 * （`直辖市人民政府／设区的市人民政府` 那种：两条中文名是两个不同的机关级别）。
 * ⚠️ 判分**一个字都没放宽也没收紧**：`acceptedAnswers` 照旧把两种写法都算对，
 * 这里动的是"写在屏幕上的那一串"。
 */
export function standardWriting(term: Term, direction: Direction): string {
  const accepted = acceptedAnswers(term, direction)
  if (direction === 'zh-to-en') return accepted[0] ?? term.en
  const trimmed = (text: string): string => normalizeAnswer(text.replace(/[。．.]+$/u, '').trim())
  const distinct: string[] = []
  for (const answer of accepted) {
    if (distinct.some((kept) => normalizeAnswer(kept) !== normalizeAnswer(answer) && trimmed(kept) === trimmed(answer))) {
      continue
    }
    distinct.push(answer)
  }
  return distinct.join('／')
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
