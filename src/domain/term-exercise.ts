/**
 * 术语题：从术语库取若干条，让用户一次译一批，**由程序本地对照判分**。
 *
 * ## 为什么是 5 条一组
 *
 * 用户的要求是「原文分成上下五栏，一栏一个术语，一共 5 行，译文区也是相同的五栏，
 * 一次在每一栏里翻译五个术语」。因此一道术语题就是**一组 5 条**，
 * 而不是一条一题——这样一次练习能覆盖更多固定表述，也免得为了练 69 条术语点 69 次。
 *
 * ## 为什么自带批改、不走 AI
 *
 * 术语有唯一正确答案（固定表述的官方译法），判分因此可以完全本地化：
 * 可复现、可解释、不花接口钱。这也符合本项目既有原则——分数由程序算，不由 AI 打
 * （见 scoring.ts）。判分口径与归一化规则在 domain/terms.ts 的 isTermCorrect 里。
 *
 * ## 为什么判分结果复用 Correction 的形状
 *
 * 界面右下的「总体评分 / 逐处批注」是按 Correction + ValidatedCorrection 渲染的。
 * 术语题没有"作答文本里的区间"这回事，但**仍然是一组可逐条展示的对错**，
 * 因此这里把它映射过去：
 *   - 每译错一条 → 一个 errors 项，`oldText` 是用户的答案、`targetText` 是标准译法，
 *     `explanation` 说明标准译法是什么；
 *   - 每译对一条 → 一个 highlights 项（它确实值得肯定）。
 * 复用同一形状的好处是评分、练习记录、收藏这些下游功能一行都不用改。
 */

import { CATEGORY_LABEL, type Correction, type ErrorObject, type Exercise } from './types'
import { TERMS_BY_DOMAIN, isTermCorrect, normalizeAnswer, type Term } from './terms'
import { labelOfDomain, type ArticleDomain } from './articles'
import type { ValidatedCorrection, ValidatedError, ValidatedHighlight } from './validate'

/** 一道术语题一组几条。用户要的是「五栏」，所以是 5。 */
export const TERMS_PER_EXERCISE = 5

/**
 * 从一个领域的术语里，按题号取一组 5 条。
 *
 * 确定性：同一个题号永远得到同一组，刷新、切走再切回都不会变——
 * 否则用户写了一半切出去，回来发现题目换了。分组方式是按题号轮转：
 * 题号尾数 1 → 第 1 组，尾数 2 → 第 2 组……这样同一领域的多道题能覆盖不同术语。
 */
export function termsForExercise(domain: ArticleDomain, sequence: number): readonly Term[] {
  const pool = TERMS_BY_DOMAIN[domain]
  if (pool.length === 0) return []
  const groups = Math.max(1, Math.ceil(pool.length / TERMS_PER_EXERCISE))
  const groupIndex = ((sequence - 1) % groups + groups) % groups
  const start = groupIndex * TERMS_PER_EXERCISE
  const picked = pool.slice(start, start + TERMS_PER_EXERCISE)
  // 最后一组可能不满 5 条，从头补齐，保证总是 5 行
  if (picked.length < TERMS_PER_EXERCISE) {
    const filler = pool.slice(0, TERMS_PER_EXERCISE - picked.length)
    return [...picked, ...filler]
  }
  return picked
}

/**
 * 术语题的题号形如 `term-<领域>-<第几组>`，例如 `term-ecology-2`。
 *
 * 为什么把"第几组"编进题号：题号是本站的通用键——作答、批改结果、练习记录、
 * 收藏全都按它索引。把领域与组号编进去之后，这四样东西一行都不用改就能支持术语库。
 */
export function termExerciseId(domain: ArticleDomain, group: number): string {
  return `term-${domain}-${group}`
}

/** 从题号解析出领域与组号；不是术语库的题号就返回 null。 */
export function parseTermExerciseId(id: string): { domain: ArticleDomain; group: number } | null {
  const match = /^term-([a-z]+)-(\d+)$/.exec(id)
  if (!match) return null
  const domain = match[1] as ArticleDomain
  if (!(domain in TERMS_BY_DOMAIN)) return null
  const group = Number(match[2])
  if (!Number.isInteger(group) || group < 1) return null
  return { domain, group }
}

/**
 * 取某一道术语题的 5 条术语。
 *
 * 确定性：同一个题号永远得到同一组，刷新、切走再切回都不会变——
 * 否则用户写了一半切出去，回来发现题目换了。
 */
export function termsForExerciseId(id: string): readonly Term[] {
  const parsed = parseTermExerciseId(id)
  if (!parsed) return []
  return termsForExercise(parsed.domain, parsed.group)
}

/** 某个领域的术语题一共有几组。 */
export function termGroupCount(domain: ArticleDomain): number {
  const pool = TERMS_BY_DOMAIN[domain]
  return Math.max(1, Math.ceil(pool.length / TERMS_PER_EXERCISE))
}

/**
 * 把一组术语变成本站通用的**题目**对象。
 *
 * `source` 放的是这五条术语本身（用换行分隔）——它是这道题"要译的东西"，
 * 与其它题型放一段原文是同一个位置。界面在术语模式下会把它拆成五行来渲染，
 * 而不是当一段散文显示。
 */
export function exerciseOfTerms(id: string, terms: readonly Term[]): Exercise {
  return {
    id,
    // 术语库给的是中文术语、要求译成英文
    direction: 'zh-to-en',
    mode: 'term',
    // 这些术语绝大多数是政治文献里的固定表述
    genre: 'political',
    topic: labelOfDomain(parseTermExerciseId(id)?.domain ?? 'politics'),
    source: terms.map((term) => term.zh).join('\n'),
    // 参考译文就是标准译法，逐条显示在下方；这里留空，免得与逐条对照重复
    referenceTranslation: '',
    suggestedMinutes: 5,
  }
}

/** 一条术语的判分结果。 */
export interface TermVerdict {
  term: Term
  /** 用户写的答案 */
  answer: string
  correct: boolean
}

/** 逐条判分。 */
export function judgeTerms(terms: readonly Term[], answers: readonly string[]): TermVerdict[] {
  return terms.map((term, index) => {
    const answer = answers[index] ?? ''
    return { term, answer, correct: isTermCorrect(term, answer) }
  })
}

/**
 * 把逐条判分结果映射成 Correction + ValidatedCorrection，好让既有的
 * 评分、练习记录、收藏这些下游功能原样复用。
 *
 * 术语题没有"作答文本里的字符区间"，因此这里的 span 一律是零长度、指向 0——
 * 界面在术语模式下不会去画勾画（没有可勾画的整段文字），只读 span 做展示与计数。
 */
export function correctionFromVerdicts(verdicts: readonly TermVerdict[]): {
  correction: Correction
  validated: ValidatedCorrection
} {
  const errors: ErrorObject[] = []
  const highlights: Correction['highlights'] = []
  const validatedErrors: ValidatedError[] = []
  const validatedHighlights: ValidatedHighlight[] = []

  verdicts.forEach((verdict, index) => {
    const id = `t${index + 1}`
    const span = { start: index, end: index, snippet: '' }
    if (verdict.correct) {
      const highlight = { id: `h${index + 1}`, anchor: { ...span, snippet: verdict.answer }, comment: `「${verdict.term.zh}」译对了：${verdict.term.en}` }
      highlights.push(highlight)
      validatedHighlights.push({ highlight, span: { start: index, end: index } })
      return
    }
    /*
     * 分类固定给 terminology（术语不准）——术语题错了一定是术语问题，
     * 不会有"搭配不当""语序错"这些。
     */
    const empty = normalizeAnswer(verdict.answer).length === 0
    const error: ErrorObject = {
      id,
      type: 'replace',
      category: 'terminology',
      oldText: verdict.answer,
      targetText: verdict.term.en,
      anchor: { ...span, snippet: verdict.answer },
      originalSpan: { ...span, snippet: verdict.answer },
      explanation: empty
        ? `「${verdict.term.zh}」没有作答。标准译法：${verdict.term.en}`
        : `「${verdict.term.zh}」的标准译法是「${verdict.term.en}」，你写的是「${verdict.answer}」。` +
          `术语与固定表述要求一字不差（${CATEGORY_LABEL.terminology}）。`,
    }
    errors.push(error)
    validatedErrors.push({ error, changes: [], span: { start: index, end: index } })
  })

  return {
    correction: { errors, highlights },
    validated: { errors: validatedErrors, highlights: validatedHighlights, rejections: [] },
  }
}
