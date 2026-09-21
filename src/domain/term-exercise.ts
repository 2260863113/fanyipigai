/**
 * 术语题：从术语库取若干条，让用户一次译一批，**由程序本地对照判分**。
 *
 * ## 为什么是 5 条一组
 *
 * 用户的要求是「原文分成上下五栏，一栏一个术语，一共 5 行，译文区也是相同的五栏，
 * 一次在每一栏里翻译五个术语」。因此一道术语题就是**一组 5 条**，
 * 而不是一条一题——这样一次练习能覆盖更多固定表述，也免得为了练几十条术语点几十次。
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
 * 术语题虽然一次给五条独立短语，但**仍然是一组可逐条展示的对错**，因此这里把它映射过去：
 *   - 每译错一条 → 一个 errors 项，`oldText` 是用户的答案、`targetText` 是标准译法，
 *     `explanation` 说明标准译法是什么；
 *   - 每译对一条 → 一个 highlights 项（它确实值得肯定）。
 * 复用同一形状的好处是评分、练习记录、收藏、对照视图这些下游功能一行都不用改。
 *
 * 位置也不是占位：五条答案按行拼成一段文字（见 termAnswerText），
 * 每一条在其中的起止位置都是真的，因此"点这一条 → 右下角说清这一条"、
 * "收藏这一条"、"在对照视图里给这一条一行对照"全都走既有的那套代码。
 */

import { CATEGORY_LABEL, type Correction, type ErrorObject, type Exercise } from './types'
import { TERMS_BY_DOMAIN, isTermCorrect, normalizeAnswer, type Term } from './terms'
import { ARTICLE_DOMAINS, labelOfDomain, type ArticleDomain } from './articles'
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
 * 术语题的题号形如 `term-v2-<领域>-<第几组>`，例如 `term-v2-ecology-2`。
 *
 * 为什么把"第几组"编进题号：题号是本站的通用键——作答、批改结果、练习记录、
 * 收藏全都按它索引。把领域与组号编进去之后，这四样东西一行都不用改就能支持术语库。
 *
 * 为什么带 `v2`：领域表从八个收敛到五个、术语库随之删掉 26 条之后，
 * **同一个题号会指向另一组术语**（旧 `term-economy-1` 排出来的是另一批词）。
 * 加了代次标记，旧题号一律解析失败，旧记录不会张冠李戴。
 */
export function termExerciseId(domain: ArticleDomain, group: number): string {
  return `term-v2-${domain}-${group}`
}

/** 从题号解析出领域与组号；不是术语库当前代次的题号就返回 null。 */
export function parseTermExerciseId(id: string): { domain: ArticleDomain; group: number } | null {
  const match = /^term-v2-([a-z]+)-(\d+)$/.exec(id)
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
    // 这些术语绝大多数是政论与官方文献里的固定表述
    genre: 'political',
    // 题号解析不出来时落到第一个板块（社会）；领域表里已经没有 politics 了
    topic: labelOfDomain(parseTermExerciseId(id)?.domain ?? ARTICLE_DOMAINS[0].id),
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

/**
 * 逐条判分。
 */
export function judgeTerms(terms: readonly Term[], answers: readonly string[]): TermVerdict[] {
  return terms.map((term, index) => {
    const answer = answers[index] ?? ''
    return { term, answer, correct: isTermCorrect(term, answer) }
  })
}

/**
 * 五条答案拼成的**一整段文字**（一行一条，用换行分隔）。
 *
 * 为什么要有这么一段文字：术语题本身是五个独立的短语，但本站在别处一律按"一段作答文字"
 * 办事——练习记录存 `answer`、收藏要"这一处所在的整句"、对照视图要切句、右下角说明要
 * 拿区间去译文里取原文。与其为术语题在每一条下游路径上各开一个特例，
 * 不如在这里定义清楚"术语题的作答文字长什么样"，让那些路径原样复用。
 */
export function termAnswerText(answers: readonly string[]): string {
  return answers.join('\n')
}

/** 这一组写了几条（提交按钮够不够格点下去，就看它等不等于 5）。 */
export function answeredTermCount(answers: readonly string[]): number {
  return answers.filter((answer) => answer.trim().length > 0).length
}

/**
 * 第几条的批注编号。
 *
 * 编号必须**只有一处产生**：作答行上挂的 `data-mark-id`、右下角详情、收藏的判重键
 * 全靠它对齐。写错前缀（把错的写成 `h1`）不会报错，只会让"点了没反应"，
 * 因此这里给一个函数，而不是两处各拼一次字符串。
 */
export function termMarkId(index: number, correct: boolean): string {
  return `${correct ? 'h' : 't'}${index + 1}`
}

/**
 * 把逐条判分结果映射成 Correction + ValidatedCorrection，好让既有的
 * 评分、练习记录、收藏、对照视图这些下游功能原样复用。
 *
 * ## 区间是真的（不是零长度占位）
 *
 * 每一条答案在 `termAnswerText(verdicts)` 里都有自己的起止位置，这里就按那个位置给区间，
 * 并且把 `changes` 填成"整条换成标准译法"。这样下游拿到的区间是**可用的**：
 * 右下角说明能取出"你写的是哪一串"、收藏能取到它所在的那一行、
 * 对照视图能给出"原译 / 改后"一行对一行。
 * （早先这里一律给零长度区间，于是术语题的说明里"要改的是"永远是空的。）
 *
 * 为什么不走 `validateError` 走一遍：位置是**程序自己算的**（不是模型报的），
 * 本来就准；而它要求锚点必须有非空片段，未作答那一条没有字可取，会被它拒掉。
 * 因此这里直接构造校验结果，`rejections` 恒为空——没有"被拦下的批注"这回事。
 *
 * 术语题错了一定是术语问题（不会有"搭配不当""语序错"），分类固定给 terminology；
 * 一条术语只有对错两态、没有"只改一半"，所以整条一起标，不按词缩窄。
 */
export function correctionFromVerdicts(verdicts: readonly TermVerdict[]): {
  correction: Correction
  validated: ValidatedCorrection
} {
  const errors: ErrorObject[] = []
  const highlights: Correction['highlights'] = []
  const validatedErrors: ValidatedError[] = []
  const validatedHighlights: ValidatedHighlight[] = []

  /*
   * 逐行累加出每一条在整段文字里的起点：`+ 1` 是行与行之间那个换行，
   * 于是这些位置与 `termAnswerText` 拼出来的那段文字**严格对得上**。
   */
  let cursor = 0
  verdicts.forEach((verdict, index) => {
    const start = cursor
    const end = start + verdict.answer.length
    cursor = end + 1
    const span = { start, end, snippet: verdict.answer }
    const id = termMarkId(index, verdict.correct)

    if (verdict.correct) {
      const highlight = {
        id,
        anchor: { ...span },
        comment: `「${verdict.term.zh}」译对了：${verdict.term.en}`,
      }
      highlights.push(highlight)
      validatedHighlights.push({ highlight, span: { start, end } })
      return
    }

    const empty = normalizeAnswer(verdict.answer).length === 0
    const error: ErrorObject = {
      id,
      type: 'replace',
      category: 'terminology',
      oldText: verdict.answer,
      targetText: verdict.term.en,
      anchor: { ...span },
      originalSpan: { ...span },
      explanation: empty
        ? `「${verdict.term.zh}」没有作答；标准译法：${verdict.term.en}`
        : `「${verdict.term.zh}」的标准译法是「${verdict.term.en}」；你写的是「${verdict.answer}」；` +
          `术语与固定表述要求一字不差（${CATEGORY_LABEL.terminology}）。`,
    }
    errors.push(error)
    validatedErrors.push({
      error,
      // 未作答那一条没有字可划，就不给改动项（界面上只说"没作答"）
      changes: empty ? [] : [{ start, end, to: verdict.term.en }],
      span: { start, end },
      // 术语写错一律算硬性错误（红）：固定译法要求一字不差，没有"轻重"可言
      hard: true,
    })
  })

  return {
    correction: { errors, highlights },
    validated: { errors: validatedErrors, highlights: validatedHighlights, rejections: [] },
  }
}

