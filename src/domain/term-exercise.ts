/**
 * 术语题：一个**范围**按每页 5 条切好，用户一页一页译，**由程序本地对照判分**。
 *
 * ## 一道术语题 = 一整个范围（不是一个五条的小组）
 *
 * 用户第 13 轮拍板要"像文章模式一样一页一页翻，每页五个术语"。因此题号的粒度与文章题对齐：
 * **一道术语题 = 一个范围**（国内机关名称 17 页 / 国际机关名称 12 页），页号就是 `sectionIndex`。
 * 这么定的直接好处是**下游一行都不用改**：作答、批改结果、练习记录、收藏、页状态、
 * 文章进度、翻页控件全都按「题 + 页」办事，术语题于是白拿了整套逐页批改的规则
 * （翻页不提交、批过的页只读、返回编辑、批改记录下拉、从没批完的那一页继续）。
 *
 * 早先术语题的粒度是"一组 5 条"，题号里带着组号；现在同一个题号下有多页，
 * 于是题号形如 `term-v3-<范围>-<方向>`（见 `termExerciseId`）。
 *
 * ## 为什么自带批改、不走 AI
 *
 * 术语有官方译名，判分因此可以完全本地化：可复现、可解释、不花接口钱、不用等。
 * 这也符合本项目既有原则——分数由程序算，不由 AI 打（见 scoring.ts）。
 * 判分口径与归一化规则在 domain/terms.ts。
 *
 * ## 方向两侧都有，因此两侧都能练
 *
 * 每条术语两侧都有（中文名 + 官方英文名），所以术语栏的「中译英 / 英译中」两段按钮
 * **永远都可点**——不像文章栏那样会按"这一格有没有材料"禁用。
 * 中译英时题干是中文、标准答案是官方英文；英译中时反过来，且标准答案可能是**两个中文**
 * （一英多中，见 terms.ts 的 `zhAlt`）。
 *
 * ## 作答怎么存：**一页一段文字**（这正是"五条全塞进第一个框"的修法）
 *
 * 界面上是五个独立输入框，但存储一律是**一页一段文字**（`termAnswerText` 把五条用换行拼起来）：
 * 练习记录存 `answer`、收藏要"这一处所在的整行"、对照视图要逐行对照，下游全都按一段文字办事。
 * 反过来，**回到编辑态时按行拆回五个框**（`splitTermAnswers`）。
 * ⚠️ 早先这里按"行号 0..4"直接占用了 `drafts` 的下标——而 `drafts` 是**按页号**索引的，
 * 两者撞在一起，于是落盘的整段文字被当成"第 1 行"塞回去，五条全挤进第一个框（用户报的正是这个）。
 * 现在只有一个存储位（第几页），行是按需拆出来的，撞车不可能再发生。
 *
 * ## 为什么判分结果复用 Correction 的形状
 *
 * 界面右下的「总体评分 / 逐处批注」是按 Correction + ValidatedCorrection 渲染的。
 * 术语题虽然一次给五条独立短语，但**仍然是一组可逐条展示的对错**，因此这里把它映射过去：
 * 每译错一条 → 一个 errors 项；每译对一条 → 一个 highlights 项。
 * 复用同一形状的好处是评分、练习记录、收藏、对照视图这些下游功能一行都不用改。
 *
 * 位置也不是占位：五条答案按行拼成一段文字，每一条在其中的起止位置都是真的，
 * 因此"点这一条 → 右下角说清这一条"、"收藏这一条"、"在对照视图里给这一条一行对照"
 * 全都走既有的那套代码。
 */

import type { Direction } from './types'
import { CATEGORY_LABEL, type Correction, type ErrorObject, type Exercise } from './types'
import {
  TERMS_PER_PAGE,
  acceptedAnswers,
  isTermCorrect,
  normalizeAnswer,
  standardAnswer,
  termPageCount,
  termsOfPage,
  type Term,
} from './terms'
import { isTermScope, labelOfScope, type TermScope } from './term-scopes'
import type { ValidatedCorrection, ValidatedError, ValidatedHighlight } from './validate'

/** 一页几条（用户要的是「五栏」）。真实的条数在 `terms.ts` 里定义，这里只是转出来给界面用。 */
export const TERMS_PER_EXERCISE = TERMS_PER_PAGE

/**
 * 术语题的题号形如 `term-v3-<范围>-<方向>`，例如 `term-v3-cn-org-zh-to-en`。
 *
 * 为什么把方向也编进题号：同一条术语在两个方向下是**两道不同的题**
 * （题干与标准答案都不同），作答、记录、页状态、进度全都要分开存。
 *
 * 为什么带 `v3`：术语库整批换成了两份机关名称材料，同一个题号会指向完全不同的内容
 * （旧 `term-v2-…` 排出来的是政论固定表述）。加了代次标记，旧题号一律解析失败，
 * 旧记录不会张冠李戴；而用户对旧记录的处理是"一次性清掉"，见 `isLegacyTermExerciseId`。
 */
export function termExerciseId(scope: TermScope, direction: Direction): string {
  return `term-v3-${scope}-${direction}`
}

/** 从题号解析出范围与方向；不是术语库当前代次的题号就返回 null。 */
export function parseTermExerciseId(id: string): { scope: TermScope; direction: Direction } | null {
  const match = /^term-v3-(.+)-(zh-to-en|en-to-zh)$/.exec(id)
  if (!match) return null
  const scope = match[1]
  const direction = match[2]
  if (scope === undefined || direction === undefined) return null
  if (!isTermScope(scope)) return null
  return { scope, direction: direction as Direction }
}

/**
 * 这是**换代之前**的术语题号吗（`term-v2-<领域>-<第几组>`）。
 *
 * 只有一个用处：一次性清理旧记录与旧收藏（用户拍板"删掉我之前留下的术语记录，
 * 未来我留下的术语记录不会被自动删掉"）。判据是**旧代次前缀**，因此
 * 新代次的记录在结构上不可能被它碰到——"以后永不再删"是这条判据保证的，不是靠自觉。
 */
export function isLegacyTermExerciseId(id: string): boolean {
  return /^term-v2-/.test(id)
}

/** 某一道术语题（=一个范围）的全部术语。 */
export function termsForExerciseId(id: string): readonly Term[] {
  const parsed = parseTermExerciseId(id)
  if (!parsed) return []
  const pages = termPageCount(parsed.scope)
  return Array.from({ length: pages }, (_, page) => termsOfPage(parsed.scope, page)).flat()
}

/** 某一道术语题**第 `page` 页**的那几条（界面上就是这五行）。 */
export function termsForPageOfExercise(id: string, page: number): readonly Term[] {
  const parsed = parseTermExerciseId(id)
  if (!parsed) return []
  return termsOfPage(parsed.scope, page)
}

/** 某一道术语题一共几页。 */
export function termPagesOfExercise(id: string): number {
  const parsed = parseTermExerciseId(id)
  return parsed ? termPageCount(parsed.scope) : 0
}

/** 题干那一侧的文字（中译英给中文名，英译中给官方英文名）。 */
export function questionSideOf(term: Term, direction: Direction): string {
  return direction === 'zh-to-en' ? term.zh : term.en
}

/**
 * 整道题的原文：**页与页之间空一行，页内一行一条**。
 *
 * 为什么长这样：本站的"分页"只有一份实现（`splitSections` 按空行切段），
 * 文章题就是靠它把一篇切成一段一段。术语题用同一个形状，
 * 于是"原文栏一次只显示一页"、"上一页／下一页"、"提交的是这一页"
 * 全都是既有代码，不需要为术语题另写一套分页。
 */
export function termSourceText(scope: TermScope, direction: Direction): string {
  const pages = termPageCount(scope)
  return Array.from({ length: pages }, (_, page) =>
    termsOfPage(scope, page)
      .map((term) => questionSideOf(term, direction))
      .join('\n'),
  ).join('\n\n')
}

/**
 * 把一组术语变成本站通用的**题目**对象。
 *
 * `source` 是整道题的原文（见 `termSourceText`）；界面在术语模式下把它按页显示、
 * 页内再拆成五行来渲染，而不是当一段散文显示。
 */
export function exerciseOfTerms(id: string): Exercise {
  const parsed = parseTermExerciseId(id)
  const scope: TermScope = parsed?.scope ?? 'cn-org'
  const direction: Direction = parsed?.direction ?? 'zh-to-en'
  return {
    id,
    direction,
    mode: 'term',
    // 这批材料是机关与官方机构的名称
    genre: 'political',
    topic: labelOfScope(scope),
    source: termSourceText(scope, direction),
    // 标准答案就是官方译名，逐条显示在下方；这里留空，免得与逐条对照重复
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
  /**
   * 这一条在**这个方向**下全部算对的写法。
   * `standard` 是屏幕上显示的那一个（英译中可能用「／」连着两个中文）。
   */
  accepted: readonly string[]
  standard: string
}

/** 逐条判分。 */
export function judgeTerms(
  terms: readonly Term[],
  answers: readonly string[],
  direction: Direction,
): TermVerdict[] {
  return terms.map((term, index) => {
    const answer = answers[index] ?? ''
    return {
      term,
      answer,
      correct: isTermCorrect(term, answer, direction),
      accepted: acceptedAnswers(term, direction),
      standard: standardAnswer(term, direction),
    }
  })
}

/**
 * 一页答案拼成的**一整段文字**（一行一条，用换行分隔）。
 *
 * 界面上五个框是分开的，但本站别处一律按"一段作答文字"办事，因此这里定义清楚
 * "术语题的作答文字长什么样"，让下游原样复用。
 */
export function termAnswerText(answers: readonly string[]): string {
  return answers.join('\n')
}

/**
 * 一段作答文字**拆回各个框**——「返回编辑」与刷新之后靠它把五条各就各位。
 *
 * 输入框是单行的，因此我们自己写下去的每一行都不可能含换行，按 `\n` 拆是无损的。
 * 但对**别处来的**文字（旧记录、用户真粘了多行）要留一手：
 * 多出来的行并进最后一行、缺的行补空串，宁可挤一点也不要悄悄丢掉用户写过的字。
 */
export function splitTermAnswers(text: string, count: number): string[] {
  if (count <= 0) return []
  const lines = text.split('\n')
  const rows = lines.slice(0, count)
  while (rows.length < count) rows.push('')
  if (lines.length > count) rows[count - 1] = lines.slice(count - 1).join(' ')
  return rows
}

/**
 * 单个框的输入值：**换行一律折成空格**。
 *
 * 存储是"一行一条"，框里若真出现换行，五条与行的对应关系就断了。
 * 用户粘贴一长串带换行的东西时，这里悄悄折平比事后报错好。
 */
export function sanitizeTermRow(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

/** 这一组写了几条（提交按钮够不够格点下去，就看它等不等于这一页的真实条数）。 */
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
 * 每一条答案在 `termAnswerText(...)` 里都有自己的起止位置，这里就按那个位置给区间，
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
        comment: `「${verdict.term.zh}」译对了：${verdict.standard}`,
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
      targetText: verdict.standard,
      anchor: { ...span },
      originalSpan: { ...span },
      explanation: empty
        ? `「${verdict.term.zh}」没有作答；标准译法：${verdict.standard}`
        : `「${verdict.term.zh}」的标准译法是「${verdict.standard}」；你写的是「${verdict.answer}」；` +
          `官方译名要求与之一致（${CATEGORY_LABEL.terminology}）。`,
    }
    errors.push(error)
    validatedErrors.push({
      error,
      // 未作答那一条没有字可划，就不给改动项（界面上只说"没作答"）
      changes: empty ? [] : [{ start, end, to: verdict.standard }],
      span: { start, end },
      // 术语写错一律算硬性错误（红）：官方译名不能含糊，没有"轻重"可言
      hard: true,
    })
  })

  return {
    correction: { errors, highlights },
    validated: { errors: validatedErrors, highlights: validatedHighlights, rejections: [] },
  }
}
