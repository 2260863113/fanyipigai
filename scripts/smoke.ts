/**
 * 冒烟测试：直接运行领域逻辑，验证三件事。
 * 1. 假数据里的批注位置能否通过位置校验（校验器本身是否有效）
 * 2. 排版计算能否把批改结果转成片段序列，且不丢失内容、不产生重叠
 * 3. 校验器能否拒绝位置错误的批注（反向验证）
 *
 * 运行：npm run smoke
 */

import { MOCK_CASES, fixtureCorrectionFor } from '../src/domain/mock'
import { validateCorrection } from '../src/domain/validate'
import { buildLayout } from '../src/domain/layout'
import type { TextSegment } from '../src/domain/layout'
import { parseCorrection } from '../src/domain/parse'
import { GENERATION_TOPICS, LENGTH_RULE, measureLength, parseGenerated, sliceForMode } from '../src/domain/generate'
import { buildGenerationSystemPrompt, buildSystemPrompt, buildUserPrompt } from '../src/domain/prompt'
import { placeFixBoxes, type FixBoxInput } from '../src/domain/fix-layout'
import { buildCompareLines, splitSentences } from '../src/domain/compare'
import { renderApp } from './render-probe'
import { DIRECTION_LABEL, KIND_LABEL, type Direction, type Mode } from '../src/domain/types'
import { ARTICLE_DOMAINS } from '../src/domain/articles'
import { CATEGORY_LABEL, CATEGORY_PRIORITY, ERROR_CATEGORY_SPECS, HARD_CATEGORIES } from '../src/domain/types'
import { directionOf, loadCustom, modeOf } from '../src/domain/custom'
import { classifyFailure } from '../vite-plugin-judge-api'
import { clearDir } from './lib/clear-dir'
// 探针那份"按顶边归并成行"的实现（注入页面去跑的那一份）。
// 与 src/domain/row-merge.ts 是刻意的两份实现，由下面的断言保证它们一致。
import { mergeRowsOnTopEdge as mergePageRows } from './lib/row-merge.mjs'
import { mergeRowsOnTopEdge } from '../src/domain/row-merge'
import { INITIAL_SESSIONS, pageResultOf, sessionOf, sessionReducer, type ExerciseSession } from '../src/components/session'
import type { RecordView } from '../src/components/RecordsView'
import type { Env } from '../src/server/http'
import path from 'node:path'

// 本文件由 scripts/run-smoke.mjs 用 esbuild 打包后交给 Node 运行，
// 因此这里沿用与前端一致的无后缀导入写法。

let failures = 0
let checks = 0
/** 环境不具备而跳过的项数（不是失败，但要如实报出来，免得"跳过"变成静悄悄的缺失） */
let skipped = 0

function check(condition: boolean, label: string, detail?: string): void {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
    return
  }
  failures += 1
  console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
}

/**
 * 清空一个目录（不存在就什么都不做）。
 *
 * 实现在 scripts/lib/clear-dir.ts —— 那里的注释说明了为什么不能用
 * `rmSync(dir, { recursive: true, force: true })`（在某些受管环境里它是静默的空操作，
 * 正是"冒烟测试写完存档、清理却从未生效"的真凶）。
 */

/** 检查同优先级的标注是否互相重叠；插入是零长度落点，允许与区间边界重合。 */
function findOverlaps(segments: TextSegment[]): string[] {  const annotated = segments.filter((s) => s.errorId || s.highlightId)
  const problems: string[] = []
  for (let i = 0; i < annotated.length; i += 1) {
    for (let j = i + 1; j < annotated.length; j += 1) {
      const a = annotated[i]
      const b = annotated[j]
      if (!a || !b) continue
      if (a.kind === 'insert' || b.kind === 'insert') continue
      if (a.start < b.end && b.start < a.end) {
        problems.push(`${a.errorId ?? a.highlightId} 与 ${b.errorId ?? b.highlightId} 重叠`)
      }
    }
  }
  return problems
}

export async function runSmokeTests(): Promise<{ checks: number; failures: number; skipped: number }> {
  for (const testCase of MOCK_CASES) {
    const { exercise, sampleAnswer } = testCase
    console.log(`\n[${exercise.id}] ${exercise.direction} · ${exercise.genre} · ${exercise.topic}`)

    const correction = fixtureCorrectionFor(exercise.id, sampleAnswer)
    check(correction !== null, `${exercise.id} 的示例作答能取到内置批改结果`)
    if (!correction) continue
    const expectedErrors = correction.errors.length
    const result = validateCorrection(correction.errors, correction.highlights, sampleAnswer, exercise.direction)

    check(
      result.rejections.length === 0,
      `全部 ${expectedErrors + correction.highlights.length} 处批注的位置都通过校验`,
      result.rejections.map((r) => `${r.id}: ${r.message}`).join('\n      '),
    )
    check(result.errors.length === expectedErrors, `错误数量与假数据一致（${result.errors.length}/${expectedErrors}）`)
    check(result.highlights.length === correction.highlights.length, '亮点全部通过校验')

    const layout = buildLayout(result, sampleAnswer)

    const covered = layout.segments.filter((s) => s.kind !== 'insert' && s.text.length > 0)
    check(covered.length > 0, '排版产出了可渲染的片段')

    let cursor = 0
    for (const segment of covered) cursor = Math.max(cursor, segment.end)
    check(cursor === sampleAnswer.length, `片段覆盖整篇作答（覆盖到第 ${cursor} 字符，共 ${sampleAnswer.length}）`)

    const overlaps = findOverlaps(layout.segments)
    check(overlaps.length === 0, '批注之间没有互相重叠', overlaps.join('\n      '))

    const kinds = [...new Set(layout.segments.filter((s) => s.kind !== 'plain' && s.kind !== 'highlight').map((s) => s.kind))]
    const drawn = layout.segments.filter((s) => s.errorId || s.highlightId).length
    console.log(
      `    改法类型：${kinds.join('、') || '（无）'}｜画出的标注片段 ${drawn} 个（含亮点）` +
        `｜重叠丢弃 ${layout.droppedCount} 处｜被拒绝 ${layout.rejectedIds.length} 处`,
    )
  }

  // 最小修改：模型圈的范围常比实际改动大，必须收窄到真正变化的文字
  console.log('\n[最小修改] 检查差异算法（每条都会把结果应用回原文验证）')
  try {
    const { checkMinimal } = await import('../src/domain/minimal-cases')
    const results = checkMinimal()
    for (const result of results) {
      check(result.ok, result.name, result.detail)
    }
    const failed = results.filter((result) => !result.ok).length
    if (failed === 0) console.log(`    共 ${results.length} 条用例全部通过`)
  } catch (error) {
    check(false, '最小修改用例可以执行', error instanceof Error ? error.message : String(error))
  }

  /*
   * 收藏里的"整句"断句：**句末标点跟着引号**时也要在那里断开。
   *
   * 用户报过的那一条。他给的原例里，句末那个点号后面跟的是引号而不是空格，
   * 而且**引号后面紧跟着下一个句子的第一个词**（`."someone says.`），
   * 因此两个方向都要验：
   *   ① 直引号「左引号 + 空格 + 内容 + 点号 + 右引号 + 紧跟下一个词」
   *   ② 直引号、但句末跟着的是**左引号**（用户实际敲出来的样子，他左右不分）
   */
  console.log('\n[收藏断句] 句末标点跟着引号时也要断开')
  try {
    const { sentenceAround, splitSentenceSpans } = await import('../src/domain/favorites')
    const samples = [
      { label: '直引号·句末跟右引号', text: 'sgadgg ds  ds ." sdf  fds ."someone says.' },
      // 用户实际敲出来的样子：句末那个点号后面跟的是**左引号**（他左右不分），也要能切
      { label: '直引号·句末跟左引号', text: 'sgadgg ds  ds ." sdf  fds .“someone says.' },
      { label: '弯引号', text: 'sgadgg ds  ds .“ sdf  fds .”someone says.' },
    ]
    for (const sample of samples) {
      const spans = splitSentenceSpans(sample.text)
      const pieces = spans.map((span) => sample.text.slice(span.from, span.to))
      check(pieces.length === 3, `${sample.label}：拆成 3 句（实际 ${pieces.length}：${JSON.stringify(pieces)}）`)
      check(
        pieces.join('') === sample.text,
        `${sample.label}：三句首尾相接、合起来正好是原文（不重不漏不丢字）`,
        JSON.stringify(pieces),
      )
      const second = sample.text.indexOf('sdf')
      const third = sample.text.indexOf('someone')
      const mid = sentenceAround(sample.text, second, second + 3)
      const last = sentenceAround(sample.text, third, third + 4)
      check(mid.includes('sdf') && mid.includes('fds'), `${sample.label}：第二处落在引号里那句（实际：${JSON.stringify(mid)}）`, mid)
      check(last === 'someone says.', `${sample.label}：第三处落在 someone says.（实际：${JSON.stringify(last)}）`, last)
    }
    check(
      sentenceAround('It costs 3.5 euros in total. Then we left.', 10, 13) === 'It costs 3.5 euros in total.',
      '小数点不会被切碎',
    )
    /*
     * 逗号也算一句的结尾（用户要求"相当于按 , 。 " 来分"）。
     * 因此收藏里的"那一截"是**逗号之间的一小段**，而不是语法意义上的完整句子。
     */
    {
      const comma = 'A decade of work, which began in 2016, has turned the coast into a park.'
      const pieces = splitSentenceSpans(comma).map((span) => comma.slice(span.from, span.to))
      check(pieces.length === 3, `逗号也断句（实际 ${pieces.length} 段：${JSON.stringify(pieces)}）`)
      check(pieces.join('') === comma, '按逗号切出来仍然是首尾相接、不重不漏', JSON.stringify(pieces))
      const inSecond = sentenceAround(comma, comma.indexOf('began'), comma.indexOf('began') + 5)
      check(
        inSecond.includes('began') && !inSecond.includes('A decade'),
        `落到第二段时只取那一小截（实际：${JSON.stringify(inSecond)}）`,
        inSecond,
      )
      const zh = '过去十年，中国新增光伏装机超过世界其他地区，这一变化压低了不少成本。'
      const zhPieces = splitSentenceSpans(zh).map((span) => zh.slice(span.from, span.to))
      check(zhPieces.length === 3, `中文逗号也断句（实际 ${zhPieces.length} 段）`, JSON.stringify(zhPieces))
    }
    check(
      sentenceAround('He said "stop." Then we left.', 9, 17).includes('stop'),
      '引号里的整句仍然是自足的一句',
      JSON.stringify(sentenceAround('He said "stop." Then we left.', 9, 17)),
    )
  } catch (error) {
    check(false, '收藏断句可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 对照视图的分句必须与收藏**同出一套判据**。
   *
   * 用户报过两次同一件事：第一次报了收藏，第二次报的是"对照模式下也要注意
   * `xxxxx  "xxxx."someone says` 这种分句"。根因不是某处判据写错，而是**判据有两份**：
   * 引号那条规则只补进了收藏那份，对照视图那份照旧。现在两份都调 domain/sentences.ts，
   * 因此这一组断言的重点是"两边给出的切点完全一致"。
   */
  console.log('\n[对照视图] 分句与收藏同一套判据（句末标点跟着引号也要断开）')
  try {
    const { splitSentenceSpans } = await import('../src/domain/favorites')
    const cases = ['sgadgg ds  ds ." sdf  fds ."someone says.', 'sgadgg ds  ds .“ sdf  fds .”someone says.']
    for (const text of cases) {
      const layout = splitSentences(text).map((item) => text.slice(item.start, item.end))
      check(layout.length === 3, `对照视图里切成 3 句（实际 ${layout.length}：${JSON.stringify(layout)}）`)
      check(layout.join('') === text, '对照视图切出来的句子首尾相接、不重不漏', JSON.stringify(layout))
      const favorite = splitSentenceSpans(text).map((item) => text.slice(item.from, item.to))
      check(
        JSON.stringify(layout) === JSON.stringify(favorite),
        '对照视图与收藏的切点完全一致（同一个判据）',
        `对照 ${JSON.stringify(layout)} ／ 收藏 ${JSON.stringify(favorite)}`,
      )
    }
    /*
     * 收藏按逗号切、对照视图不按逗号切——这是两者唯一该有的差别。
     * 断言两边都写上，免得日后"统一判据"时顺手把逗号也统一掉。
     */
    const comma = 'A decade of work, which began in 2016, has turned the coast into a park.'
    check(splitSentences(comma).length === 1, '对照视图里逗号**不**断句（要的是句子）')
    check(
      splitSentenceSpans(comma).length === 3,
      '收藏里逗号断句（要的是"那一小截"）',
    )
    /*
     * 句号后面**漏了空格**时也必须断开（用户第三次报的那条）。
     *
     * 用户给的是他自己那段译文，三句话的句号全粘在下一个句子的首字母上
     * （`…livelihood.The meeting…`、`…cities and villages.Meanwhile,…`），
     * 于是对照视图上整段被当成**一句**，看上去"还是一段一段的"。
     *
     * 判据必须与提示词的口径一致：提示词里写着"逗号、句号后面与下一个词之间有没有空格，
     * 一律忽略"（见 domain/prompt.ts，AI 不许因为少一个空格扣分），
     * 那么程序自己也不该因为少一个空格就把三句读成一句。
     */
    const glued =
      "In March, 2026, the fourth session of the 14th National People's Congress held a press meeting themed people's livelihood." +
      'The meeting introduced that the number of senior meal assistance spots had reached 82,000,' +
      'offering meal assistance services to 4 million old people daily, and initially formed a meal assistance services network covering cities and villages.' +
      'Meanwhile, the relevant department propose to raise the coverage rate of community elderly care services institutions and facilities to over 70 percent during the 15th Five-Year period.'
    {
      const pieces = splitSentences(glued).map((item) => glued.slice(item.start, item.end))
      check(
        pieces.length === 3,
        `句号后面漏了空格也切得开（用户报的那一段，实际 ${pieces.length} 句）`,
        JSON.stringify(pieces.map((piece) => piece.slice(0, 24))),
      )
      check(pieces.join('') === glued, '切开之后首尾相接、不重不漏', JSON.stringify(pieces))
      check(
        pieces[1]?.startsWith('The meeting introduced') === true,
        `第二句从 The meeting introduced 开始（实际 ${JSON.stringify(pieces[1]?.slice(0, 24))}）`,
      )
      check(
        pieces[2]?.startsWith('Meanwhile') === true,
        `第三句从 Meanwhile 开始（实际 ${JSON.stringify(pieces[2]?.slice(0, 24))}）`,
      )
      // 与"本来是带空格的正常文本"给出完全一样的切点——漏空格不该改变任何结果
      //（带空格那版的下一句会以那个空格开头，因此两边都 trim 掉再比）
      const spaced = glued.replace(/\.([A-Z])/g, '. $1')
      check(
        JSON.stringify(splitSentences(spaced).map((item) => spaced.slice(item.start, item.end).trim())) ===
          JSON.stringify(pieces.map((piece) => piece.trim())),
        '同一段加上空格之后切出来的句子与不加空格时一致',
        JSON.stringify(splitSentences(spaced).map((item) => spaced.slice(item.start, item.end).trim().slice(0, 20))),
      )
    }
    /*
     * 反过来：**缩写不能被切开**——漏空格那条规则不能伤到 `U.S.` 这类写法。
     * 判据落在"点号前面是不是小写字母/数字"上，因此这里正反各量一次。
     */
    check(splitSentences('The U.S.A is a country.The next sentence.').length === 2, 'U.S.A 里的点不算句末，而 livelihood.The 后面那个算')
    check(splitSentences('It costs 3.5 euros.The total is 5.5 dollars.').length === 2, '小数点不会被当成句末（3.5 / 5.5）')
    /*
     * 收藏按逗号断句，但**数字里的千位分隔符不算**（`82,000`）。
     * 用户那段里正好有 `82,000,offering`：以前会收下一截以 `82,` 结尾的碎片。
     */
    {
      const withNumber = 'The number of senior meal assistance spots had reached 82,000,offering services daily.'
      const cuts = splitSentenceSpans(withNumber).map((span) => withNumber.slice(span.from, span.to))
      check(cuts.join('') === withNumber, '带千位分隔符的那段按逗号切开之后仍然不重不漏', JSON.stringify(cuts))
      check(
        cuts.some((piece) => piece.includes('82,000')),
        `千位分隔符完整地留在同一截里（实际 ${JSON.stringify(cuts)}）`,
        JSON.stringify(cuts),
      )
      // 修之前第一截会停在 `…had reached 82,` 上——数字被从中间截断
      check(
        cuts.every((piece) => !/82,$/.test(piece)),
        '没有一截停在"82,"上（数字没有被逗号截断）',
        JSON.stringify(cuts),
      )
    }
  } catch (error) {
    check(false, '对照视图的分句可以验证', error instanceof Error ? error.message : String(error))
  }

  // 批改提示词：不含参考译文，并且**明确要求忽略标点后的空格**（用户要求）
  console.log('\n[提示词] 参考译文不发给模型；标点后的空格不必管；两个方向的自查遍数不同')
  try {
    const systemMessage = buildSystemPrompt('en-to-zh')
    check(
      systemMessage.includes('逗号、句号后面与下一个词之间有没有空格，一律忽略'),
      '提示词里明确要求：逗号/句号后面有没有空格一律忽略',
    )
    check(
      systemMessage.includes('不要为"少了一个空格"或"多了一个空格"标任何东西'),
      '提示词里把这句写成了"不要标"（而不只是"注意"）',
    )
    /*
     * explanation 的写法（用户要求："让 ai 给出修改原因时，告诉他要用；分号分隔每一小点"）。
     * 界面上的小卡片就是按分号断行、逐条编号的（见 AnnotationText.tsx 的 withSemicolonBreaks），
     * 因此提示词里必须把这条规矩说清楚，否则卡片里永远是一条读不到头的流水线。
     */
    check(
      systemMessage.includes('每一小点之间一律用全角分号'),
      '提示词要求 explanation 的每一小点之间用「；」隔开',
    )
    check(
      systemMessage.includes('一个分号 = 一个小点'),
      '提示词把"一个分号 = 一个小点"这条口径写死了（界面按它断行）',
    )
    check(
      systemMessage.includes('explanation 里说了两件以上的事时'),
      '交卷自查里也列了这条（模型最后一遍会再核一次）',
    )

    /*
     * ── 第 14 条：英译中·精修改成五遍，顺序是用户点名的那个 ──
     *
     * 用户的原话："对于英译中的精修批改，更新提示词，要求先检查'漏译'，再检查'术语错误'，
     * 再检查'啰嗦部分'，再检查'更好的表达''更好用词'"。语法与标点**不能被丢掉**，
     * 因此它排在最后一遍（追问过：用户选的是"五遍，语法标点排最后"）。
     */
    const zhToEnSystem = buildSystemPrompt('zh-to-en')
    check(systemMessage.includes('分遍自查'), '提示词里仍有"分遍自查"这一节')
    check(systemMessage.includes('走 5 遍'), '英译中·精修是**五遍**（用户第 14 条）')
    check(zhToEnSystem.includes('走 4 遍'), '中译英·精修仍是**四遍**（用户明确"只给英译中"用新顺序）')
    check(
      /第 1 遍[^\n]*漏译/.test(systemMessage),
      '英译中的第 1 遍查的是漏译与多译',
    )
    check(/第 2 遍[^\n]*术语/.test(systemMessage), '第 2 遍查术语')
    check(/第 3 遍[^\n]*啰嗦/.test(systemMessage), '第 3 遍查啰嗦')
    check(/第 4 遍[^\n]*更好的/.test(systemMessage), '第 4 遍查"更好的表达、更好的用词"')
    check(
      /第 5 遍[^\n]*语法/.test(systemMessage) && /第 5 遍[^\n]*标点/.test(systemMessage),
      '第 5 遍查语法与标点（语法标点没有被丢掉，只是排到最后）',
    )
    /* 「啰嗦」是第 14 条新加的分类，两个方向都要能取到它（分类表是共享的） */
    check(
      systemMessage.includes('verbosity') && zhToEnSystem.includes('verbosity'),
      '两个方向的分类表里都有 verbosity（啰嗦）',
    )
    check(
      systemMessage.includes('检查顺序 ≠ 归类优先级'),
      '提示词说清了"检查顺序"与"归类优先级"是两件事（否则语法错会被归成啰嗦/表达）',
    )
    check(
      systemMessage.includes('绝不能因为"读着别扭、不够地道、有点啰嗦"就把语法错误写成橙色的分类'),
      '并写明：不能因为"啰嗦"就把语法错误标成橙色',
    )

    /*
     * ── 第 1 条：两个方向都要给 sourceText（点批注 → 原文标色）──
     */
    check(
      systemMessage.includes('中译英尤其要给'),
      '第 1 条：提示词点名要求**中译英也要给 sourceText**（那一侧原文是中文）',
    )
    check(
      systemMessage.includes('green mountains are gold mountains'),
      '并给了一个中译英的例子（否则模型不知道"原文那一侧"该写中文）',
    )
    check(
      systemMessage.includes('一处批注**只给一段**原文'),
      '一处批注只给一段原文（用户第 1 条追问的口径）',
    )
  } catch (error) {
    check(false, '提示词的标点口径可以验证', error instanceof Error ? error.message : String(error))
  }

  console.log('\n[提示词] 参考译文不发给模型')
  try {
    const userMessage = buildUserPrompt({
      source: 'Ecological civilization is a form of human progress.',
      answer: '生态文明是人类进步的一种形态。',
      direction: 'en-to-zh',
      genre: 'news',
      level: 'polish',
    })
    check(!userMessage.includes('参考译文'), '批改的用户消息里没有"参考译文"这一节')
    const systemMessage = buildSystemPrompt('en-to-zh')
    check(systemMessage.includes('不会给你参考译文'), '系统提示里明确告诉模型：不会给参考译文')
    /*
     * 档位说明要**按方向分叉**：老口径那句"能读懂的表达不要为了更好去改"与英译中第 4 遍
     * （"更好的表达/用词"）直接冲突，共用一条文案会让模型把第 4 遍整遍跳过。
     */
    check(
      userMessage.includes('换个更好的说法') && !userMessage.includes('能读懂的表达不要为了"更好"去改'),
      '英译中·精修的档位说明明说"换个更好的说法也算这一档的活儿"',
    )
    const zhToEnUser = buildUserPrompt({
      source: '生态文明是人类进步的一种形态。',
      answer: 'Ecological civilization is a form of human progress.',
      direction: 'zh-to-en',
      genre: 'news',
      level: 'polish',
    })
    check(
      zhToEnUser.includes('能读懂的表达不要为了"更好"去改'),
      '中译英·精修仍然是老口径（"不要为了更好去改"）',
    )
  } catch (error) {
    check(false, '批改提示词可以生成', error instanceof Error ? error.message : String(error))
  }

  // AI 出题：提示词 → 解析 → 篇长硬校验 → 按题型截取，全是不碰网络的纯函数
  console.log('\n[AI 出题] 检查篇幅口径、篇长校验与按题型截取')
  try {
    const paragraph = (text: string): string => text
    const article = {
      topic: '生态文明建设',
      genre: 'news' as const,
      paragraphs: [
        { source: paragraph('第一段。'), translation: 'First paragraph.' },
        { source: paragraph('第二段。'), translation: 'Second paragraph.' },
      ],
      terms: [{ source: '湿地修复', translation: 'wetland restoration' }],
    }
    const full = sliceForMode('article', article)
    check(full.source.includes('第一段') && full.source.includes('第二段'), '文章题拿到的是全文')
    check(sliceForMode('paragraph', article).source === '第一段。', '段落题截取第一个自然段')
    check(sliceForMode('sentence', article).source === '第一段。', '句子题截取第一个句子')
    check(sliceForMode('term', article).source === '湿地修复', '术语题取文章里的关键术语')

    /*
     * 用户报过的**真实案例**：共同前缀 / 后缀都在，却整段标红。
     *
     * 根因是差异算法在"词序被打乱"的长串上对齐得支离破碎，退回"整段替换"，
     * 连带把共同的两头也标了。修法是先按**词的边界**剥掉共同的前缀与后缀，
     * 只把中间那段交给差异算法（见 minimal.ts 的 minimizeChange）。
     */
    {
      const { minimizeChange } = await import('../src/domain/minimal')
      const oldText = 'the Director-general of Statistics Department of Comprehensive National Economy'
      const newText = 'the Director General of the Department of Comprehensive Statistics of the National Economy'
      const changes = minimizeChange(oldText, newText)
      const marked = (changes ?? []).map((change) => oldText.slice(change.startOffset, change.endOffset)).join('｜')
      check(
        (changes?.length ?? 0) >= 1 && !marked.includes('the Director-'),
        `共同前缀「the Director」没有被标进去（实际标了「${marked}」）`,
        marked,
      )
      check(
        !marked.includes('National Economy'),
        `共同后缀「National Economy」没有被标进去（实际标了「${marked}」）`,
        marked,
      )
      // 标出来的部分必须真的覆盖了变化：把改动应用回去要等于改法
      const rebuilt = (changes ?? []).reduce(
        (text, change) => text.slice(0, change.startOffset) + change.to + text.slice(change.endOffset),
        oldText,
      )
      check(rebuilt === newText, '把标出的最小改动应用回去，正好得到模型的改法', JSON.stringify(rebuilt))
    }

    /*
     * 命题依据必须写进提示词里：模型不联网，不知道"外研社·国才杯"是什么比赛。
     * 规格一旦从提示词里掉了，出题就会飘（题材偏、文体不对、埋不进术语）。
     * 这里逐条盯住，并核对篇幅数字与程序硬校验用的是同一份 LENGTH_RULE。
     */
    const genSystem = buildGenerationSystemPrompt()
    const specChecks: Array<[string, string]> = [
      ['赛制规格', '赛制规格整块附在提示词里'],
      ['中国时政／国情话语外译', '一句话点明命题底色（中国时政/国情话语外译）'],
      ['优美的文学翻译', '点明"不是优美的文学翻译"'],
      ['译后编辑', '提到高阶会出现的国际传播型任务'],
      ['五位一体', '点明主题域是"五位一体"'],
      ['习近平新时代中国特色社会主义思想的核心概念', '点明主题域含习思想核心概念'],
      ['不要越界', '主题域明确写"不要越界"'],
      ['核心术语学习手册', '素材来源含《核心术语学习手册》'],
      ['教育强国纲要', '素材来源含教育强国纲要'],
      ['政治含义不跑偏', '评分看重点明"政治含义不跑偏"'],
      ['不要出这四类之外的体裁', '明确只考四种文体'],
      ['政治文献', '列出文体：政治文献'],
      ['新闻编译', '列出文体：新闻编译'],
      ['文学作品选篇', '列出文体：文学作品选篇'],
      ['一般说明文', '列出文体：一般说明文'],
      ['术语是主要考点', '点明术语是主要考点'],
      ['理解当代中国', '点明素材来源（《理解当代中国》系列教材）'],
      ['习近平谈治国理政', '点明素材来源（《习近平谈治国理政》）'],
      ['术语与固定表述必须一字不差', '附上判分尺子第 1 条'],
      ['不得漏译', '附上判分尺子第 3 条'],
      ['不要偏题怪题', '明确要求不出偏题怪题'],
      ['不能联网', '提醒模型不联网、不要编造出处'],
    ]
    for (const [needle, label] of specChecks) {
      check(genSystem.includes(needle), label, `提示词里找不到「${needle}」`)
    }
    // 领域预设要覆盖站里的五个板块，别把学生往偏题上引
    for (const domain of ['社会', '经济', '文化', '生态', '科技']) {
      check(GENERATION_TOPICS.includes(domain), `出题领域预设覆盖五大板块：${domain}`)
    }
    // 预设与文章库的**话题领域**表必须**完全一致**：两处口径不一样，用户会看到两个领域清单
    {
      const { ARTICLE_BANK_DOMAINS, EXAM_DOMAINS, TOPIC_DOMAINS } = await import('../src/domain/articles')
      const labels = TOPIC_DOMAINS.map((item) => item.label)
      check(
        labels.length === GENERATION_TOPICS.length && labels.every((label) => GENERATION_TOPICS.includes(label)),
        `出题领域预设与文章库的话题领域表逐个对齐（预设 ${GENERATION_TOPICS.join('/')} ／ 文章库 ${labels.join('/')}）`,
      )
      // 真题/样题是**文章栏独有**的两类：不混进话题领域表，也不进 AI 出题的预设（见 ADR 0029）
      check(
        EXAM_DOMAINS.length === 2 && EXAM_DOMAINS.map((item) => item.label).join(',') === '真题,样题',
        `文章库另有两类卷子领域：${EXAM_DOMAINS.map((item) => item.label).join('/')}`,
      )
      check(
        ARTICLE_BANK_DOMAINS.length === TOPIC_DOMAINS.length + EXAM_DOMAINS.length &&
          GENERATION_TOPICS.every((topic) => ARTICLE_BANK_DOMAINS.some((domain) => domain.label === topic)),
        `文章栏的领域表 = 五个话题领域 + 真题 + 样题（共 ${ARTICLE_BANK_DOMAINS.length} 项：${ARTICLE_BANK_DOMAINS.map((item) => item.label).join('/')}）`,
      )
      check(
        !GENERATION_TOPICS.includes('真题') && !GENERATION_TOPICS.includes('样题'),
        '真题与样题**没有**混进 AI 出题的预设领域',
      )

      /*
       * 生成出来的真题/样题正文再验一遍。
       * 生成脚本本身有三条硬校验，但 `articles-data/exams.ts` 与其它数据文件一样
       * 是"自动生成、不要手改"的——这里盯的就是**有人手改过它**：
       * 段数不再对齐、来源丢了、领域被改成了社会/经济…，都会在这里立刻红。
       */
      const { EXAM_ARTICLES } = await import('../src/domain/articles-data/exams')
      const examIds = new Set<string>(EXAM_DOMAINS.map((item) => item.id))
      check(
        EXAM_ARTICLES.length > 0 && EXAM_ARTICLES.every((item) => examIds.has(item.domain)),
        `真题/样题共 ${EXAM_ARTICLES.length} 篇，领域只有 past-paper / sample`,
      )
      // 标题格式（用户指定）：真题 2025 省赛 经济领域 | 简要概括的内容
      const titlePattern = /^(真题|样题) \d{4}( [^ ]+)? (社会|经济|文化|生态|科技)领域 \| .+$/
      const badTitles = EXAM_ARTICLES.filter((item) => !titlePattern.test(item.title))
      check(
        badTitles.length === 0,
        '每篇的标题都是「真题/样题 年份 场次 话题领域 | 概括」这个形状',
        badTitles.map((item) => item.title).join(' ／ '),
      )
      check(
        EXAM_ARTICLES.every((item) =>
          item.domain === 'past-paper' ? item.title.startsWith('真题 ') : item.title.startsWith('样题 '),
        ),
        '标题开头的「真题/样题」与它所在的领域一致',
      )
      const brokenParity = EXAM_ARTICLES.filter(
        (item) =>
          item.reference.length > 0 &&
          item.reference.split(/\n{2,}/).length !== item.text.split(/\n{2,}/).length,
      )
      check(
        brokenParity.length === 0,
        '原文与参考译文的段数一致（有译文的那些）',
        brokenParity.map((item) => item.id).join('、'),
      )
      check(
        EXAM_ARTICLES.every((item) => item.units > 50),
        '每篇都有真实篇幅（units > 50）',
      )
    }

    for (const direction of ['en-to-zh', 'zh-to-en'] as const) {
      const rule = LENGTH_RULE[direction]
      check(
        genSystem.includes(`${rule.min}-${rule.max}`),
        `提示词里的篇幅与硬校验一致（${direction}：${rule.min}-${rule.max} ${rule.unit}）`,
      )
    }

    check(
      measureLength('en-to-zh', 'one two three') === 3,
      `英译中按词数：'one two three' 数出 ${measureLength('en-to-zh', 'one two three')} 词`,
    )
    check(measureLength('zh-to-en', '生态文明 建设') === 6, '中译英按字符数（不含空白）')

    const tooShort = parseGenerated(
      JSON.stringify({ topic: 'x', genre: 'news', paragraphs: [{ source: 'Two words.', translation: '两个词。' }] }),
      { direction: 'en-to-zh', genre: 'news', topic: 'x' },
    )
    check(!tooShort.ok, '篇幅不达标的出题结果会被拒绝')
    if (!tooShort.ok) {
      check(tooShort.problems[0]?.includes('250') === true, `拒绝原因说清了要求：${tooShort.problems[0] ?? ''}`)
    }

    // 造一篇刚好达标的英文原文：按口径数出来，而不是写死一份文本
    const unit = 'Wetland restoration is slow and costly, and the benefits are shared far more widely than the costs. '
    let body = ''
    while (measureLength('en-to-zh', body) < 300) body += unit
    const ok = parseGenerated(
      JSON.stringify({
        topic: '生态文明建设',
        genre: 'news',
        paragraphs: [{ source: body.trim(), translation: '湿地修复见效慢、花钱多。' }],
        terms: [{ source: 'wetland restoration', translation: '湿地修复' }],
      }),
      { direction: 'en-to-zh', genre: 'news', topic: '生态文明建设' },
    )
    check(ok.ok, `刚好达标的出题结果能通过（${measureLength('en-to-zh', body)} 词）`)
  } catch (error) {
    check(false, 'AI 出题的纯函数可以执行', error instanceof Error ? error.message : String(error))
  }

  // 填补方框的摆放：默认居中、挤了左右分开、分不开就往上加一层
  console.log('\n[填补方框] 检查不互相覆盖的摆放规则')
  try {
    const mkBox = (id: string, anchorLeft: number, width = 80): FixBoxInput => ({
      id,
      anchorLeft,
      anchorWidth: 40,
      anchorTop: 100,
      width,
      height: 18,
    })

    const single = placeFixBoxes([mkBox('a', 200)], 600)
    check(single[0]?.left === 180, `单个方框居中于被修改内容（left=${single[0]?.left}，期望 180）`)
    check(single[0]?.row === 0, '单个方框就在第 0 层（紧贴文字上方）')
    // 上下间隔：第 0 层的底边直接落在锚定行内容区的顶边上，中间不再多留一道缝
    // （留了就会"飘"在被改文字上方半空里——实测过 6px 的版本）
    check(
      single[0]?.top === 82,
      `第 0 层紧贴锚定行上方（top=${single[0]?.top}，期望 82＝锚定行顶 100 − 框高 18）`,
    )

    const pair = placeFixBoxes([mkBox('left', 100), mkBox('right', 130)], 600)
    const leftBox = pair.find((item) => item.id === 'left')
    const rightBox = pair.find((item) => item.id === 'right')
    const overlap =
      Math.min((leftBox?.left ?? 0) + 80, (rightBox?.left ?? 0) + 80) - Math.max(leftBox?.left ?? 0, rightBox?.left ?? 0)
    check(overlap + 6 <= 0, `挨得近的两个方框不重叠（实际间隙 ${-overlap}px）`)
    check((leftBox?.left ?? 0) < 80, `左边那个向左让了（left=${leftBox?.left}）`)
    check((rightBox?.left ?? 0) > 110, `右边那个向右让了（left=${rightBox?.left}）`)
    check(leftBox?.row === 0 && rightBox?.row === 0, '能让开的就留在同一层')
    check(
      pair.every((item) => item.top === 82),
      '同一层的两个方框被摆在同一高度上',
    )

    const crowd = placeFixBoxes([mkBox('c1', 0, 120), mkBox('c2', 5, 120), mkBox('c3', 10, 120)], 200)
    check(crowd.some((item) => item.row > 0), `挤不下时会往上加一层（层级：${crowd.map((item) => item.row).join('/')}）`)
    check(
      crowd.every((item) => item.left >= 0 && item.left + 120 <= 200.01),
      '方框不会跑出容器左右边界',
    )
    const rowZero = crowd.filter((item) => item.row === 0)
    check(
      rowZero.every((a, index) =>
        rowZero.slice(index + 1).every((b) => Math.min(a.left + 120, b.left + 120) - Math.max(a.left, b.left) <= 0),
      ),
      '同一层里的方框之间没有重叠',
    )
  } catch (error) {
    check(false, '填补方框的摆放算法可以执行', error instanceof Error ? error.message : String(error))
  }

  // 对照视图：切句 + 把改动拼成"修改后的完整那句"
  console.log('\n[对照视图] 切句与逐句改写')
  try {
    const sentences = splitSentences('I am a student. He is a teacher! 你呢？')
    check(sentences.length === 3, `按句末标点切成 3 句（实际 ${sentences.length}）`)
    check(
      splitSentences('China has afforested 70 million hectares.').length === 1,
      '小数点/数字里的点不会被当成句末（70 million 不切）',
    )

    const answer = 'i is a form of human progress. it became a important part.'
    const parsed = parseCorrection(
      JSON.stringify({
        errors: [
          { id: 'c1', type: 'replace', category: 'grammar', oldText: 'i is', targetText: 'I am', explanation: 'x' },
          {
            id: 'c2',
            type: 'replace',
            category: 'grammar',
            oldText: 'became a important',
            targetText: 'become an important',
            explanation: 'y',
          },
        ],
        highlights: [],
      }),
      answer,
      'en-to-zh',
    )
    if (parsed.ok) {
      const lines = buildCompareLines(
        validateCorrection(parsed.correction.errors, parsed.correction.highlights, answer, 'en-to-zh'),
        answer,
      )
      check(lines.length === 2, `两句各出一行对照（实际 ${lines.length}）`)
      const first = lines[0]?.corrected.map((part) => part.text).join('') ?? ''
      check(first === 'I am a form of human progress.', `第一句改成「${first}」`)
      check(lines[0]?.corrected.some((part) => part.color === 'red') === true, '改动过的字带颜色（红）')
      check(lines[0]?.original === 'i is a form of human progress.', '原文那一句原样保留')
    } else {
      check(false, '对照视图用例可以被解析', parsed.problems.join('；'))
    }

    /*
     * 用户报的那一段（句号后面漏了空格）**在对照视图里必须是三行**。
     *
     * 他当时看到的是"一整段占一行"，据此怀疑"是不是把一段误认为一句"——诊断下来正是：
     * 段里两个句号都粘在下一句的首字母上（`…livelihood.The meeting…`），
     * 断句那一层把三句读成了一句，于是对照视图只有一行。
     * 这一组直接从**对照行**上验，而不是只验断句函数（那一步已经在上面验过）。
     */
    {
      const gluedAnswer =
        "In March, 2026, the fourth session of the 14th National People's Congress held a press meeting themed people's livelihood." +
        'The meeting introduced that the number of senior meal assistance spots had reached 82,000,offering meal assistance services to 4 million old people daily.' +
        'Meanwhile, the relevant department propose to raise the coverage rate to over 70 percent during the 15th Five-Year period.'
      const gluedParsed = parseCorrection(
        JSON.stringify({
          errors: [
            {
              id: 'g1',
              type: 'replace',
              category: 'grammar',
              oldText: 'the relevant department propose',
              targetText: 'the relevant department proposed',
              explanation: '主谓一致',
            },
          ],
          highlights: [],
        }),
        gluedAnswer,
        'zh-to-en',
      )
      if (gluedParsed.ok) {
        const gluedLines = buildCompareLines(
          validateCorrection(gluedParsed.correction.errors, gluedParsed.correction.highlights, gluedAnswer, 'zh-to-en'),
          gluedAnswer,
        )
        check(
          gluedLines.length === 3,
          `句号漏空格的那一段在对照视图里出三行（实际 ${gluedLines.length} 行）`,
          JSON.stringify(gluedLines.map((line) => line.original.slice(0, 26))),
        )
        check(
          gluedLines[2]?.original.startsWith('Meanwhile') === true &&
            gluedLines[2]?.corrected.some((part) => part.color !== undefined) === true,
          '那一处改动落在第三行上（不是落在整段上）',
          JSON.stringify(gluedLines[2]),
        )
        check(
          gluedLines[1]?.original.includes('82,000') === true,
          '第二行完整地含 82,000（千位分隔符没把它截断）',
          JSON.stringify(gluedLines[1]?.original),
        )
      } else {
        check(false, '漏空格那段用例可以被解析', gluedParsed.problems.join('；'))
      }
    }
  } catch (error) {
    check(false, '对照视图的纯函数可以执行', error instanceof Error ? error.message : String(error))
  }

  /*
   * 术语题：本地判分映射成 Correction 之后，**每一条的区间必须是真的**。
   *
   * 用户要求"术语提交后，需要按照像文章模式一样，进行对比后，颜色批注和修改"。
   * "颜色批注"要成立，下游三件事都得拿到真的区间：右下角说明要据此取出"你写的是哪一串"、
   * 收藏要据此取到它所在的那一行、对照视图要据此给出一条"改后"。
   * 早先这里给的是一串零长度占位（`start === end === 下标`），于是术语题的说明里
   * "要改的是"永远是空的——映射与下游对不上，就是这种不报错的坏味道。
   */
  console.log('\n[术语题] 本地判分映射出的区间是真的（说明 / 收藏 / 对照视图都靠它）')
  try {
    const { answeredTermCount, correctionFromVerdicts, judgeTerms, termAnswerText, termMarkId } = await import(
      '../src/domain/term-exercise'
    )
    const { termsOfScope } = await import('../src/domain/terms')
    const { sentencePair } = await import('../src/domain/favorites')
    const terms = termsOfScope('cn-org').slice(0, 5)
    check(terms.length === 5, `术语库能取到一组 5 条（实际 ${terms.length}）`)
    const first = terms[0]
    const fourth = terms[3]
    const fifth = terms[4]
    // 取不到就没什么可验的：直接抛出去，让上面那个 catch 报出来（不静悄悄地跳过）
    if (!first || !fourth || !fifth) throw new Error(`术语库里只取到 ${terms.length} 条，验不了这一组`)
    const answers = [first.en, 'definitely wrong here', '', fourth.en, `${fifth.en} xyz`]
    const verdicts = judgeTerms(terms, answers, 'zh-to-en')
    check(
      verdicts.map((verdict) => verdict.correct).join(',') === 'true,false,false,true,false',
      `判分口径：照标准写的对、胡写与漏写的错（实际 ${verdicts.map((v) => (v.correct ? '✓' : '✗')).join('')}）`,
    )
    check(answeredTermCount(answers) === 4, '写了几条由 answeredTermCount 数出来（提交按钮够不够格看它）')
    check(
      termAnswerText(answers) === answers.join('\n'),
      '五条答案拼成的"整段作答文字"就是逐行用换行连接（下游一律按它办事）',
    )

    const { correction, validated } = correctionFromVerdicts(verdicts)
    check(
      correction.errors.length === 3 && correction.highlights.length === 2,
      `三条错、两条对（实际 ${correction.errors.length} 错 / ${correction.highlights.length} 对）`,
    )
    check(
      correction.errors.map((error) => error.id).join(',') === 't2,t3,t5',
      `编号由 termMarkId 统一给（实际 ${correction.errors.map((error) => error.id).join(',')}）`,
    )
    check(
      correction.highlights.map((highlight) => highlight.id).join(',') === 'h1,h4',
      `译对的那两条编号也成对（实际 ${correction.highlights.map((h) => h.id).join(',')}）`,
    )
    const text = termAnswerText(answers)
    let spansReal = true
    let detail = ''
    for (const [index, verdict] of verdicts.entries()) {
      const id = termMarkId(index, verdict.correct)
      const entry = validated.errors.find((item) => item.error.id === id)
      if (!entry) continue
      const shown = text.slice(entry.span.start, entry.span.end)
      if (shown !== verdict.answer) {
        spansReal = false
        detail = `${id} 指向「${shown}」，应当是「${verdict.answer}」`
      }
    }
    check(spansReal, '每一处错的区间都**真的指向那一条答案**（不是零长度占位）', detail)
    const empty = validated.errors.find((entry) => entry.error.id === 't3')
    check(
      empty?.changes.length === 0,
      '没作答的那条没有可划的字，就不给改动项（界面上只说"没作答"）',
      JSON.stringify(empty?.changes ?? []),
    )
    check(
      validated.errors.every((entry) => entry.changes.every((change) => change.to.length > 0)),
      '有作答而写错的：改动项写明了标准译法（这就是界面上的"改后"）',
    )

    // 收藏：这一条所在的"整句"就是它自己那一行——靠的正是上面那个真区间
    const firstError = validated.errors[0]
    const standard = firstError?.error.targetText ?? ''
    const pair = sentencePair(text, firstError?.span ?? { start: 0, end: 0 }, standard)
    check(
      pair.before === 'definitely wrong here',
      `收藏里取到的是这一条那一行（实际 ${JSON.stringify(pair.before)}）`,
    )
    check(pair.after === standard, `"改后"是这条的标准译法（实际 ${JSON.stringify(pair.after)}）`)

    // 对照视图：每一条各占一行（没作答那条是空行，按规矩不出行）
    const termLines = buildCompareLines(validated, text)
    check(
      termLines.length === 4,
      `对照视图里每一条各占一行（空的那条不出行，实际 ${termLines.length}）`,
      JSON.stringify(termLines.map((line) => line.original)),
    )
    check(
      termLines[0]?.corrected.map((part) => part.text).join('').trim() === first.en,
      '译对的那条在"改后"里原样保留',
    )
    check(
      termLines[1]?.corrected.map((part) => part.text).join('').trim() === terms[1]?.en,
      '写错的那条在"改后"里换成标准译法',
      JSON.stringify(termLines[1]?.corrected.map((part) => part.text).join('')),
    )
  } catch (error) {
    check(false, '术语判分的映射可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 第 13 轮：术语库整批换成两份机关名称材料，判分口径放宽了四处，题号换代，
   * 一个范围按每页五条分页。这一组盯的就是那几件事——它们全是**口径**，
   * 一旦漂掉，用户看到的是"我答对了却被判错"或者"五条译文挤进一个框"。
   */
  console.log('\n[术语库换代] 两个范围、每页五条、官方别名与英美拼写都算对')
  try {
    const {
      TERMS_PER_PAGE,
      acceptedAnswers,
      isTermCorrect,
      normalizeAnswer,
      standardAnswer,
      termPageCount,
      termsOfPage,
      termsOfScope,
      primaryEnglish,
    } = await import('../src/domain/terms')
    const {
      isLegacyTermExerciseId,
      parseTermExerciseId,
      splitTermAnswers,
      termAnswerText,
      termExerciseId,
      termSourceText,
    } = await import('../src/domain/term-exercise')
    const { TERM_SCOPES } = await import('../src/domain/term-scopes')
    const { pageCountOf, pageSourceOf } = await import('../src/domain/exercise-source')

    check(TERM_SCOPES.length === 2, `术语范围就两张表（实际 ${TERM_SCOPES.length}）`)
    check(
      TERM_SCOPES.map((scope) => scope.label).join(',') === '国内机关名称,国际机关名称',
      `两张表的名字与顺序（实际 ${TERM_SCOPES.map((scope) => scope.label).join(',')}）`,
    )

    const cn = termsOfScope('cn-org')
    const intl = termsOfScope('intl-org')
    check(cn.length === 83, `国内机关名称 83 条（实际 ${cn.length}）`)
    check(intl.length === 60, `国际机关名称 60 条（实际 ${intl.length}）`)
    check(termPageCount('cn-org') === 17, `国内 17 页（实际 ${termPageCount('cn-org')}）`)
    check(termPageCount('intl-org') === 12, `国际 12 页（实际 ${termPageCount('intl-org')}）`)
    check(
      termsOfPage('cn-org', 16).length === 3 && termsOfPage('intl-org', 11).length === 5,
      `末页真实的条数：国内剩 3 条、国际正好 5 条（实际 ${termsOfPage('cn-org', 16).length} / ${termsOfPage('intl-org', 11).length}）`,
    )
    check(termsOfPage('intl-org', 12).length === 0, '越界的页取不到术语（不补齐、不报错）')

    // 判分口径放宽的四件事：官方缩写、英美拼写、重音、开头的 The
    const npc = cn.find((term) => term.zh === '全国人民代表大会')
    if (!npc) throw new Error('国内那一份里找不到「全国人民代表大会」')
    check(npc.en.includes('(NPC)'), `括号已统一成半角（实际 ${npc.en}）`)
    check(isTermCorrect(npc, 'NPC', 'zh-to-en'), '只写官方缩写算对')
    check(
      isTermCorrect(npc, 'National People\u2019s Congress', 'zh-to-en'),
      '写全称（不带括号）也算对',
    )
    check(isTermCorrect(npc, npc.en, 'zh-to-en'), '连括号一起照抄也算对')
    check(!isTermCorrect(npc, 'National Congress', 'zh-to-en'), '少一个词仍然算错（不是无脑放宽）')

    const oecd = intl.find((term) => term.zh === '经济合作与发展组织')
    if (!oecd) throw new Error('国际那一份里找不到「经济合作与发展组织」')
    check(
      isTermCorrect(oecd, 'Organization for Economic Cooperation and Development', 'zh-to-en'),
      '英美拼写与连字符都不计较',
    )
    /*
     * `Programme / Program` 这一对单独盯一条：写变体的判据一度是 `includes`，
     * 而 `Program` 是 `Programme` 的**子串**，于是两个方向都不成立、这一对**永远不触发**——
     * 写美式的人被判错，而代码与文档里都写着"英美拼写算对"（`check-terms.mjs` 也是这么发现的）。
     * 修法是把判据换成按字母边界判整词（见 build-terms.mjs 的 `hasWord`）。
     */
    const wfp = intl.find((term) => term.zh === '世界粮食计划署')
    if (!wfp) throw new Error('国际那一份里找不到「世界粮食计划署」')
    check(
      isTermCorrect(wfp, 'World Food Program (WFP)', 'zh-to-en') &&
        isTermCorrect(wfp, 'World Food Program', 'zh-to-en'),
      'Programme 与 Program 互相算对（子串陷阱：判据写成 includes 时这一对永不生效）',
    )
    const fifa = intl.find((term) => term.zh === '国际足球联合会')
    if (!fifa) throw new Error('国际那一份里找不到「国际足球联合会」')
    check(
      isTermCorrect(fifa, 'Federation Internationale de Football Association', 'zh-to-en'),
      '重音符号不计较（Fédération 打不出来也算对）',
    )
    const spc = cn.find((term) => term.zh === '中华人民共和国最高人民法院')
    if (!spc) throw new Error('国内那一份里找不到「最高人民法院」')
    check(
      isTermCorrect(spc, 'Supreme People\u2019s Court of the People\u2019s Republic of China', 'zh-to-en'),
      '开头的 The 写不写都算对',
    )
    check(
      normalizeAnswer('  THE  United Nations (UN) ') === 'united nations(un)',
      `归一化：大小写 / 空白 / 开头的 The / 括号两边的空格一起归（实际 ${normalizeAnswer('  THE  United Nations (UN) ')})`,
    )

    // 一英多中：同一条官方英文对应两个中文，写哪个都算对，标准答案两个都列
    const municipal = cn.find((term) => term.zh === '直辖市人民政府')
    if (!municipal) throw new Error('国内那一份里找不到「直辖市人民政府」')
    check(
      municipal.zhAlt.includes('设区的市人民政府'),
      `一英多中登记上了（实际 ${JSON.stringify(municipal.zhAlt)}）`,
    )
    check(isTermCorrect(municipal, '设区的市人民政府', 'en-to-zh'), '英译中写另一个中文也算对')
    check(
      standardAnswer(municipal, 'en-to-zh') === '直辖市人民政府／设区的市人民政府',
      `英译中的标准答案把两个中文都列出来（实际 ${standardAnswer(municipal, 'en-to-zh')}）`,
    )
    check(
      acceptedAnswers(municipal, 'zh-to-en').length >= 1 &&
        acceptedAnswers(municipal, 'zh-to-en')[0] === "Municipal People's Government",
      '中译英的标准答案仍是那一条官方英文',
    )
    check(primaryEnglish(npc) === "National People's Congress", `主译法去掉了尾部括号（实际 ${primaryEnglish(npc)}）`)

    // 题号换代：旧代次认得出、新代次解析得出，且新代次不会被"旧代次"判据命中
    const id = termExerciseId('cn-org', 'en-to-zh')
    check(id === 'term-v3-cn-org-en-to-zh', `题号形如 term-v3-<范围>-<方向>（实际 ${id}）`)
    check(
      parseTermExerciseId(id)?.scope === 'cn-org' && parseTermExerciseId(id)?.direction === 'en-to-zh',
      '题号能解析回范围与方向',
    )
    check(!isLegacyTermExerciseId(id), '新代次题号不会被"该清理的旧题号"判据命中（这就是"以后永不再删"的保证）')
    check(isLegacyTermExerciseId('term-v2-society-1'), '旧代次题号认得出（term-v2-…）')
    check(parseTermExerciseId('term-v2-society-1') === null, '旧代次题号解析不出内容')
    check(parseTermExerciseId('term-v3-society-zh-to-en') === null, '不存在的范围解析失败')

    // 分页：题干在源文里就是"每页五行、页间空一行"，页数与每页条数与术语表对得上
    check(pageCountOf(id) === 17, `整道题 17 页（实际 ${pageCountOf(id)}）`)
    const page16 = pageSourceOf(id, 16)
    check(page16.split('\n').length === 3, `末页的题干就是 3 行（实际 ${page16.split('\n').length}）`)
    const source = termSourceText('cn-org', 'zh-to-en')
    check(source.split('\n\n').length === 17, `题干按页切成 17 段（实际 ${source.split('\n\n').length}）`)
    check(
      source.split('\n\n')[1]?.split('\n').length === TERMS_PER_PAGE,
      `中间那一页正好 5 行（实际 ${source.split('\n\n')[1]?.split('\n').length}）`,
    )

    // 五条答案"拆得回去"——这正是"五条全塞进第一个框"那个 bug 的修法
    const rows = ['A', 'B', 'C', '', '']
    check(splitTermAnswers(termAnswerText(rows), 5).join('|') === 'A|B|C||', '整段文字按行拆回五个框')
    check(
      splitTermAnswers('a\nb\nc\nd\ne\n多的行', 5).join('|') === 'a|b|c|d|e 多的行',
      '行数多出来时并进最后一行（不悄悄丢掉用户写过的字）',
    )
    check(splitTermAnswers('a', 3).join('|') === 'a||', '行数不够时补空格子')
  } catch (error) {
    check(false, '术语库换代后的数据与口径可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 漏译 / 多译的**轻重**：用户的口径是"漏 0~2 个单位算橙色，漏三个单位以上算红色"，
   * 由程序按字数判（见 domain/severity.ts）。
   *
   * 这一条要盯住三件事：
   *   1. 单位取**译文那一侧**的口径——中译英的译文是英文，所以数**词**（这里最容易搞反）；
   *   2. 线画在 2 与 3 之间：**正好 3 个单位就算严重**；
   *   3. 颜色变了，**扣分跟着变**（红扣 8、橙扣 3），否则页面上的颜色与分数会互相矛盾。
   */
  console.log('\n[漏译/多译的轻重] 按字数判红橙，0~2 个单位橙、3 个单位以上红')
  try {
    const { MINOR_UNITS_LIMIT, isHardError, severityUnits } = await import('../src/domain/severity')
    const { scoreCorrection } = await import('../src/domain/scoring')

    check(MINOR_UNITS_LIMIT === 2, `轻重线是 2 个单位（实际 ${MINOR_UNITS_LIMIT}）`)

    const omission = (targetText: string): import('../src/domain/types').ErrorObject => ({
      id: 'e1',
      type: 'insert',
      category: 'omission',
      insertAfter: { start: 0, end: 0, snippet: 'x' },
      targetText,
      explanation: 'x',
    })
    const addition = (oldText: string): import('../src/domain/types').ErrorObject => ({
      id: 'e2',
      type: 'delete',
      category: 'addition',
      oldText,
      explanation: 'x',
    })

    // 中译英：译文是英文 → 数词
    check(severityUnits(omission('the'), 'zh-to-en') === 1, '中译英漏一个小品词 = 1 个单位')
    check(isHardError(omission('the'), 'zh-to-en') === false, '漏一个词 → 橙（表达问题）')
    check(isHardError(omission('a national strategy'), 'zh-to-en') === true, '漏三个词 → 红')
    check(isHardError(omission('reform and opening up'), 'zh-to-en') === true, '漏一整个固定表述 → 红')

    // 英译中：译文是中文 → 数汉字（口径与原文那一侧**相反**，这里最容易搞反）
    check(severityUnits(omission('的'), 'en-to-zh') === 1, '英译中漏一个汉字 = 1 个单位')
    check(isHardError(omission('和谐'), 'en-to-zh') === false, '漏 2 个字 → 橙（正好在线上）')
    check(isHardError(omission('人与自然和谐共生'), 'en-to-zh') === true, '漏 3 个字以上 → 红')

    // 多译同理，量的是**要划掉的那段**
    check(isHardError(addition('等'), 'en-to-zh') === false, '多一个"等"字 → 橙')
    check(isHardError(addition('，这一点非常重要'), 'en-to-zh') === true, '多出一整句 → 红')

    // 其它分类仍按分类判，不受字数影响
    check(
      isHardError({ id: 'e3', type: 'replace', category: 'grammar', oldText: 'a', targetText: 'b', explanation: 'x' }, 'en-to-zh') === true,
      '语法错与字数无关，永远红',
    )
    check(
      isHardError({ id: 'e4', type: 'replace', category: 'word-choice', oldText: 'a', targetText: 'b', explanation: 'x' }, 'en-to-zh') === false,
      '用词不当与字数无关，永远橙',
    )

    /*
     * 颜色与扣分：**颜色仍按字数判**（轻微橙、严重红），但**扣分改成按字数扣**了
     * （用户第 13 条："漏译的扣分单独算，按照漏多少字（单词），扣多少分"，
     * 而且明确选了"完全按字数扣、不再另扣固定分"）。
     *
     * 因此这里量三件事：
     *   1. 轻微漏译仍记在"表达问题"里、严重漏译仍记在"硬性错误"里（图例的处数含漏译）；
     *   2. 扣分 = 漏掉的单位数（这里两个用例各漏 1 个词与 4 个词）；
     *   3. 那个数**不再**是固定分（不是 3、也不是 8）。
     */
    const minorScore = scoreCorrection({ errors: [omission('the')], highlights: [] }, 'Some answer here.', 'zh-to-en')
    const majorScore = scoreCorrection({ errors: [omission('a national strategy')], highlights: [] }, 'Some answer here.', 'zh-to-en')
    check(minorScore.softCount === 1 && minorScore.hardCount === 0, '轻微漏译记在"表达问题"里（图例含漏译）')
    check(majorScore.hardCount === 1 && majorScore.softCount === 0, '严重漏译记在"硬性错误"里')
    check(
      minorScore.omissionUnits === 1 && minorScore.omissionPenalty === 1,
      `漏 1 个词扣 1 分（实际单位 ${minorScore.omissionUnits}、扣 ${minorScore.omissionPenalty}）`,
    )
    check(
      majorScore.omissionUnits === 3 && majorScore.omissionPenalty === 3,
      `漏 3 个词扣 3 分（实际单位 ${majorScore.omissionUnits}、扣 ${majorScore.omissionPenalty}）`,
    )
    check(
      minorScore.total === 99 && majorScore.total === 97,
      `扣分**按字数**：轻微漏 1 个词 → 99 分，严重漏 3 个词 → 97 分（实际 ${minorScore.total} / ${majorScore.total}）`,
      `${minorScore.total} / ${majorScore.total}`,
    )
    /*
     * 与"每处固定分"划清界限：同样一处漏译，漏得多扣得多。
     * 这条是防回归的——一旦有人把它改回"漏译按红/橙扣 8 或 3"，这里立刻红。
     */
    const tiny = scoreCorrection({ errors: [omission('one')], highlights: [] }, 'Some answer here.', 'zh-to-en')
    const huge = scoreCorrection(
      { errors: [omission('one two three four five six seven eight nine ten')], highlights: [] },
      'Some answer here.',
      'zh-to-en',
    )
    check(
      tiny.total === 99 && huge.total === 90 && (tiny.total as number) !== (huge.total as number),
      `漏得越多扣得越多（漏 1 个词 ${tiny.total} 分、漏 10 个词 ${huge.total} 分）`,
    )
    /*
     * 其它错误照旧按"每处"扣：一处语法错（红）扣 8、一处用词问题（橙）扣 3。
     * 漏译改了扣法，不该顺手把别人也改了。
     */
    const mixed = scoreCorrection(
      {
        errors: [
          { id: 'e1', type: 'replace', category: 'grammar', oldText: 'a', targetText: 'b', explanation: 'x' },
          { id: 'e2', type: 'replace', category: 'word-choice', oldText: 'a', targetText: 'b', explanation: 'x' },
        ],
        highlights: [],
      },
      'Some answer here.',
      'zh-to-en',
    )
    check(mixed.total === 100 - 8 - 3, `其它错误照旧每处 8 / 3（实际扣了 ${100 - mixed.total}）`)
    check(mixed.omissionPenalty === 0, '没有漏译时那一行不出现（扣 0 分）')
  } catch (error) {
    check(false, '漏译轻重可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 大改档：**整篇逐句重写 + 逐句解释 + AI 总评**（见 domain/refine.ts）。
   *
   * 用户对这一档的要求与原话："让 ai 将整个翻译重新写，修改单位为每句，
   * 让 AI 说明他修改的某一句对应的是哪一句……不统计，不逐处批改，
   * 但是让 AI 给一个最终分数和解释。"
   *
   * 这里盯住四件事：
   *   1. 解析：分数、评语、逐句三个字段缺一不可，格式不对就整份重试；
   *   2. **定位**：原句由程序按文字找位置（AI 不数序号），找不到就报错重试；
   *   3. 对照行：一句原译、一句改后、下面跟着这一句的解释；
   *   4. **颜色一律橙色**：大改不分类，没有依据说哪一处算硬性错误。
   */
  console.log('\n[大改档] 整篇逐句重写：解析、定位、对照行')
  try {
    const { parseRefine, buildRefineLines, changedSentenceCount } = await import('../src/domain/refine')

    const answer = 'i is a form of human progress. it became a important part.'
    /** 这一页的原文：sourceText 要拿它去定位（第 4 条新加的"一句原文"） */
    const source =
      'Ecological civilization is a form of human progress. It became an important part of the national strategy.'
    const sent = (original: string, rewritten: string, explanation: string, sourceText?: string) => ({
      original,
      rewritten,
      explanation,
      ...(sourceText === undefined ? null : { sourceText }),
    })
    const ok = parseRefine(
      JSON.stringify({
        sentences: [
          sent(
            'i is a form of human progress.',
            'I am a form of human progress.',
            'I 要大写；主语 I 用 am。',
            'Ecological civilization is a form of human progress.',
          ),
          sent(
            'it became a important part.',
            'It became an important part.',
            '句首大写；important 前用 an。',
            'It became an important part of the national strategy.',
          ),
        ],
      }),
      answer,
      source,
    )
    check(ok.ok, '一份合法的大改返回能解析出来', ok.ok ? '' : ok.problems.join('；'))
    if (ok.ok) {
      /*
       * 大改**不再要分数、也不再要总评**（用户拍板：分数只有精修档有，总评也去掉）。
       * 这条断言是"结果里根本没有这两个字段"——不是"值为 0"，而是**没有**。
       */
      check(
        !Object.prototype.hasOwnProperty.call(ok.refine, 'score') &&
          !Object.prototype.hasOwnProperty.call(ok.refine, 'comment'),
        '大改的结果里既没有分数也没有总评（这一档不打分，见 ADR 0020）',
      )
      check(ok.refine.sentences.length === 2, `逐句两条（实际 ${ok.refine.sentences.length}）`)
      check(changedSentenceCount(ok.refine) === 2, '两句都算"改过"')
      check(
        ok.refine.sentences[0]!.anchor.start < ok.refine.sentences[1]!.anchor.start,
        '句子按原句在译文里的先后排好',
      )
      check(
        ok.refine.sentences[0]!.anchor.snippet === 'i is a form of human progress.',
        '原句的区间是程序按文字定位出来的（AI 不数序号）',
      )
      /* 第 4 条：每一句还要给出对应的**原文**，并且拿它去原文里定位 */
      check(
        ok.refine.sentences[0]!.sourceText === 'Ecological civilization is a form of human progress.' &&
          ok.refine.sentences[0]!.sourceMatched === true,
        '这一句对应的原文收下来了，而且确实在原文里找到了',
      )
      check(
        ok.refine.sentences[0]!.sourceAnchor?.start === 0,
        `它在原文里的位置也是程序定位出来的（起点 ${ok.refine.sentences[0]!.sourceAnchor?.start}）`,
      )

      const lines = buildRefineLines(ok.refine)
      check(lines.length === 2, `对照两行（实际 ${lines.length}）`)
      check(
        lines[0]?.original === 'i is a form of human progress.' &&
          lines[0]?.corrected.map((part) => part.text).join('') === 'I am a form of human progress.',
        '一行我的译文、一行修改译文',
      )
      check(
        lines[0]?.source === 'Ecological civilization is a form of human progress.' &&
          lines[0]?.sourceMatched === true,
        '每一组最上面还有一行"原文"（用户第 4 条：一句原文、一句我的译文、一句修改译文、一段说明）',
      )
      check(lines[0]?.note === 'I 要大写；主语 I 用 am。', '这一句的解释跟着这一组一起给出来')
      check(
        lines[0]?.corrected.some((part) => part.color === 'orange') === true,
        '改动过的字带橙色（大改不分类，一律按"表达问题"显示）',
      )
      check(
        lines.every((line) => line.corrected.every((part) => part.color !== 'red')),
        '大改里不会出现红色（那一档没有"硬性错误"这回事）',
      )
    }

    /*
     * 第 4 条的边界：**原句对不上不算失败**。
     * 用户对精修那边的口径是"找不到就不标"（宁少勿错），但对大改这一行，
     * 排出来远比整份重试划算——因此照实显示 AI 那句、并标成"与原文对不上"。
     */
    const sourceMismatch = parseRefine(
      JSON.stringify({
        sentences: [
          sent(
            'i is a form of human progress.',
            'I am a form of human progress.',
            'I 要大写。',
            '这一句原文里根本没有，是模型自己编的。',
          ),
        ],
      }),
      answer,
      source,
    )
    check(sourceMismatch.ok, '原句对不上**不影响解析**（宁可显示出来加个标记，也不整份重试）')
    if (sourceMismatch.ok) {
      const line = buildRefineLines(sourceMismatch.refine)[0]
      check(sourceMismatch.refine.sentences[0]!.sourceMatched === false, '那一句被标成"与原文对不上"')
      check(line?.sourceMatched === false, '对照视图那一行也带着这个标记（界面上会标一下）')
      check(
        line?.source === '这一句原文里根本没有，是模型自己编的。',
        '显示的是模型给的那句（找不到原文时只能照它说的排）',
      )
    }

    // 模型没给 sourceText：**不排那一行**，但整份照旧能解析（旧记录里也没有这个字段）
    const noSourceGiven = parseRefine(
      JSON.stringify({ sentences: [sent('i is', 'I am', 'x')] }),
      answer,
      source,
    )
    check(noSourceGiven.ok, '没给 sourceText 也能解析（旧记录、或者模型偷懒）')
    if (noSourceGiven.ok) {
      check(
        buildRefineLines(noSourceGiven.refine)[0]?.source === undefined,
        '没给原文时**不排空白的"原文"那一行**（渲染器按有没有这个字段决定）',
      )
    }

    // 模型仍然给了 score/comment（提示词已经不要了）：照收不误，但结果里不会带上它们
    const legacyScore = parseRefine(
      JSON.stringify({
        score: 88,
        comment: '旧格式的总评。',
        sentences: [sent('i is', 'I am', 'x')],
      }),
      answer,
      source,
    )
    check(legacyScore.ok, '旧格式带 score/comment 的返回也照收（不至于因为多了两个字段就重试）')
    check(
      legacyScore.ok && !Object.prototype.hasOwnProperty.call(legacyScore.refine, 'score'),
      '但收下来的结果里没有分数（界面不显示、下拉里标"不打分"）',
    )

    // 没改的句子：照抄一遍，changed=false，仍然出现在对照里
    const unchanged = parseRefine(
      JSON.stringify({
        sentences: [sent('i is a form of human progress.', 'i is a form of human progress.', '这一句不必改。')],
      }),
      answer,
      source,
    )
    check(unchanged.ok && changedSentenceCount(unchanged.refine) === 0, '一字不差的那一句不算"改过"')
    check(
      unchanged.ok && buildRefineLines(unchanged.refine)[0]?.changed === false,
      '它仍然出在对照里（没改的句子也要照抄一遍，程序才对得齐整篇）',
    )

    /*
     * **只染真正不同的字**（用户明确要求："原译文和修改后的译文不同处才标颜色"）。
     *
     * 批注那边的口径是"最多切 2 项、超过就整段替换"，因此"整句重写"给的是一整段。
     * 对照视图另有 COMPARE_MAX_CHANGES（99），把那一整段再切细。判据取"有没有大片没染色的字"：
     * 整句重写最容易退化成"一整句都染上"，而那正是用户抱怨的画面。
     */
    const longBefore = '十年生态修复把一个曾经贫瘠的海岸变成候鸟喜欢的到达地, 吸引了来自全国各地的游客。'
    const longAfter = '十年生态修复使一片曾经荒芜的海岸线，变成了候鸟青睐的热门栖息地，吸引着来自全国各地的游客。'
    const longRefine = parseRefine(
      JSON.stringify({ sentences: [sent(longBefore, longAfter, '整句都改写了')] }),
      longBefore,
    )
    if (longRefine.ok) {
      const line = buildRefineLines(longRefine.refine)[0]
      const colored = (line?.originalSpans ?? []).filter((part) => part.color !== undefined)
      const plain = (line?.originalSpans ?? []).filter((part) => part.color === undefined && part.text.trim().length > 0)
      check(colored.length > 1, `整句重写也切成细块（实际染了 ${colored.length} 块）`)
      check(
        plain.length > 0,
        `整句重写仍然留有大片没染色的字（${plain.length} 块原样）——这才叫"不同处才标颜色"`,
        JSON.stringify(line?.originalSpans.map((part) => `${part.color ?? '—'}:${part.text.slice(0, 8)}`)),
      )
    } else {
      check(false, '整句重写的用例能解析出来', longRefine.problems.join('；'))
    }

    /*
     * **写得好的句子标绿**（用户要求：大改也让 AI 分析表达很好的句子）。
     * 判据取"整句标绿 + 下面那一行说明说的是它好在哪"。
     */
    const praised = parseRefine(
      JSON.stringify({
        sentences: [
          sent('i is a form of human progress.', 'I am a form of human progress.', 'I 要大写；be 动词用 am。'),
          {
            original: 'it became a important part.',
            rewritten: 'it became a important part.',
            explanation: '这一句按原样保留。',
            praise: '用词与原文一一对应；节奏自然，不必改。',
          },
        ],
      }),
      answer,
    )
    if (praised.ok) {
      const lines = buildRefineLines(praised.refine)
      check(praised.refine.sentences[1]?.praise.startsWith('用词与原文') === true, 'AI 给的 praise 收下来了')
      check(
        lines[1]?.originalSpans.some((part) => part.color === 'green') === true &&
          lines[1]?.corrected.some((part) => part.color === 'green') === true,
        '写得好的那一句整句标绿（两行都绿）',
      )
      check(lines[1]?.note === '用词与原文一一对应；节奏自然，不必改。', '绿色那一行的说明写的是"好在哪"')
      check(
        lines[0]?.originalSpans.every((part) => part.color !== 'green') === true,
        '改过的那一句不标绿（改了就不算"好"）',
      )
    } else {
      check(false, '带 praise 的用例能解析出来', praised.problems.join('；'))
    }

    /*
     * 缺字段 / 原句定位不上：都要报出具体原因（回去重试）。
     * ⚠️ 这里**不再有"缺分数"这一条**了——大改不打分（用户拍板，见 ADR 0020）。
     */
    const badAnchor = parseRefine(
      JSON.stringify({ sentences: [sent('这段文字根本不在译文里', 'x', 'x')] }),
      answer,
    )
    check(!badAnchor.ok, '原句定位不上就整份重试（缺了几句的对照比明确失败更糟）')
    const emptyExplanation = parseRefine(
      JSON.stringify({ sentences: [sent('i is', 'I am', '')] }),
      answer,
    )
    check(!emptyExplanation.ok, '少一句解释也算不合格（用户要求每一句都给解释）')
    const noSentences = parseRefine(JSON.stringify({ sentences: [] }), answer)
    check(noSentences.ok, '一句都没有时不算失败（空段落的极少数情形，界面显示"没有可对照的句子"）')
  } catch (error) {
    check(false, '大改档的解析与对照可以验证', error instanceof Error ? error.message : String(error))
  }


  /*
   * 文章**分页**：用户的口径是「把每个文章进行分段，文章模式下，一段一段的出」，
   * 外加"不足 50 单位就算太短、与相邻段并"。
   *
   * 为什么值得单测：分页决定了"用户一次看到多少原文"。这一轮的规则比上一轮简单，
   * 但**边界更硬**，两条都要钉住：
   *   - 够长的自然段必须**独占一页**（那正是"一段一段出"本身）；
   *   - 不足下限的自然段**不许独自成页**（否则会出现一行就翻页的碎片）。
   * 整库 48 篇都靠这两条把关（见 scripts/check-articles.mjs），这里用小样本把边界固定下来。
   */
  /*
   * 「翻译前的那段原文」：AI 在新字段 `sourceText` 里给出这一处批注对应的原文片段，
   * 程序把它定位到**原文**上（`error.sourceAnchor`），界面据此在原文栏里标同色。
   *
   * 两条要盯住：定位得上要准；**定位不上绝不能算失败**——那会白花一次重试，
   * 而丢的只是一处高亮（语法、表达类问题本来就常常给不出对应的原文片段）。
   */
  console.log('\n[原文标记] AI 给的 sourceText 要定位到原文上，定位不上不算失败')
  try {
    const { parseCorrection } = await import('../src/domain/parse')
    const source = 'China has planted trees across more than 70 million hectares since 2015.'
    const translation = '中国自 2015 年以来已在超过 7000 万公顷的土地上种树。'
    const build = (sourceText: string) =>
      JSON.stringify({
        errors: [
          {
            id: 'e1',
            type: 'replace',
            category: 'word-choice',
            oldText: '种树',
            targetText: '植树造林',
            explanation: 'x；y。',
            sourceText,
          },
        ],
        highlights: [],
      })

    const hit = parseCorrection(build('planted trees'), translation, 'en-to-zh', source)
    check(hit.ok, '带 sourceText 的返回能解析', hit.ok ? '' : hit.problems.join('；'))
    if (hit.ok) {
      const anchor = hit.correction.errors[0]?.sourceAnchor
      check(anchor?.snippet === 'planted trees', `sourceText 定位到了原文里（${anchor?.snippet ?? '没定位到'}）`)
      check(
        anchor !== undefined && source.slice(anchor.start, anchor.end) === 'planted trees',
        '区间落在原文上是准的（这是标色要用的坐标）',
      )
    }

    const miss = parseCorrection(build('这段文字根本不在原文里'), translation, 'en-to-zh', source)
    check(miss.ok, '定位不上时**不算失败**（只是少一处高亮，不值得让整份重试）')
    check(
      miss.ok && miss.correction.errors[0] !== undefined && miss.correction.errors[0]?.sourceAnchor === undefined,
      '定位不上就安静地丢掉这个字段，批注本身照样留着',
    )

    const absent = parseCorrection(
      JSON.stringify({
        errors: [
          { id: 'e1', type: 'replace', category: 'grammar', oldText: '种树', targetText: '植树', explanation: 'x；y。' },
        ],
        highlights: [],
      }),
      translation,
      'en-to-zh',
      source,
    )
    check(absent.ok && absent.correction.errors[0]?.sourceAnchor === undefined, '没给 sourceText 时也不报错（它是可选字段）')
  } catch (error) {
    check(false, '原文标记可以验证', error instanceof Error ? error.message : String(error))
  }

  console.log('\n[文章分页] 一页 = 一个自然段，不足 50 单位的与相邻段合并')
  try {
    const { countUnits, paginateArticle, splitSections, PAGE_RULE } = await import('../src/domain/sections')
    const { articleById, articlesOf } = await import('../src/domain/articles')

    check(countUnits('The report said the economy grew.', 'en-to-zh') === 6, '英译中按词数计（标点不算词）')
    check(countUnits('绿水青山就是金山银山。GDP 增长 5%。', 'zh-to-en') === 12, '中译英按汉字数计（标点、数字、字母都不算）')

    // 三段短段落（各 22 字）→ 并成一页（用户的"不足下限就与相邻段并"）
    const short = Array.from({ length: 3 }, () => '生态文明的说明文字占位符大约三十个汉字凑一凑。').join('\n\n')
    const shortPages = paginateArticle(short, '', 'zh-to-en')
    check(
      shortPages.length === 1,
      `三段都不到 ${PAGE_RULE.mergeBelow} 字 → 并成一页（实际 ${shortPages.length} 页）`,
      JSON.stringify(shortPages.map((page) => countUnits(page.text, 'zh-to-en'))),
    )

    // 整篇的硬约束：页边界落在自然段上、首尾相接、text 与区间自洽、译文逐段对齐
    const article = articleById('art-economy-en-to-zh-1') ?? articlesOf('economy', 'en-to-zh')[0]
    check(Boolean(article), '文章库里取得到一篇文章')
    if (article) {
      const paragraphs = splitSections(article.text)
      const pages = paginateArticle(article.text, article.reference, article.direction)
      const units = pages.map((page) => countUnits(page.text, article.direction))
      check(pages.length >= 2, `这一篇切成了多页（${pages.length} 页：[${units.join(', ')}]）`)
      check(
        pages.every((page) => page.pairs.length === splitSections(page.text).length),
        '每一页的"原文/译文对"数与该页的自然段数一致',
      )
      check(
        pages.every(
          (page) =>
            page.pairs.map((pair) => pair.source).join(' ').replace(/\s+/g, ' ').trim() ===
            page.text.replace(/\s+/g, ' ').trim(),
        ),
        '把每一页的对拼起来就是这一页的原文（「对照」铺的就是它们）',
      )
      check(
        pages.every((page) => page.pairs.every((pair) => pair.reference.length > 0)),
        '每一页的每一段都有对应的参考译文（文章库的译文与原文逐段对齐）',
      )
      /*
       * 两条硬约束：够长的段独占一页、太短的段不独自成页。
       * 判据用**自然段本身的单位数**去比，而不是页的单位数——页的单位数是被并过之后的，
       * 拿它比等于把结论当条件。
       */
      const longAlone = paragraphs.every((paragraph) => {
        const size = countUnits(paragraph.text, article.direction)
        if (size < PAGE_RULE.mergeBelow) return true
        return pages.some(
          (page) => page.pairs.length === 1 && page.pairs[0]?.source === paragraph.text,
        )
      })
      check(longAlone, `每个够 ${PAGE_RULE.mergeBelow} 单位的自然段都独占一页`)
      const noTinyPage =
        paragraphs.length === 1 ||
        pages.every((page) => countUnits(page.text, article.direction) >= PAGE_RULE.mergeBelow)
      check(noTinyPage, `没有不足 ${PAGE_RULE.mergeBelow} 单位的小页（不该出现"一行就翻页"）`)
      check(
        pages.every((page) => page.text === article.text.slice(page.start, page.end)),
        '每一页的 text 与它的 start/end 自洽（批注序号换算靠这个）',
      )
      /*
       * 页与页之间只允许隔**空白**（原文里的空行与缩进）。
       * 段落本身是按空行切的，因此"上一段的结尾"到"下一段的开头"之间确实有一小段空白——
       * 那不是丢内容：rebuildFromSections 会把这段空白补成空格，序号换算仍然对得上。
       */
      check(
        pages.every((page, index) =>
          index === 0 || /^\s*$/.test(article.text.slice(pages[index - 1]?.end ?? 0, page.start)),
        ),
        '页与页之间只隔空白（没有正文掉在缝里）',
      )
      check(
        pages
          .map((page) => page.text.replace(/\s+/g, ' ').trim())
          .join(' ') === article.text.replace(/\s+/g, ' ').trim(),
        '所有页拼起来（空白归一之后）正好是整篇原文，一个字都不丢',
        `${pages.length} 页`,
      )
    }

    /*
     * 长自然段**不切**：本轮的口径里"页"就是自然段，没有上限那回事了
     * （旧口径"超过 300 按句切"已随 ADR 0010 作废）。
     */
    const longParagraph = Array.from({ length: 30 }, (_, index) => `这是第${index + 1}句话用来占位置说明情况。`).join('')
    const longPages = paginateArticle(longParagraph, '', 'zh-to-en')
    check(longPages.length === 1, `一段超长的自然段原样当一页，不从中间切开（实际 ${longPages.length} 页）`)
    check(
      longPages[0]?.text === longParagraph,
      `那一页就是这一段本身（${countUnits(longParagraph, 'zh-to-en')} 字，没有被切）`,
    )
  } catch (error) {
    check(false, '分页可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 文章进度：哪几页批过。两条用户要求全靠它——
   * "下次打开从没批完的那一段继续"、"练完的文章不主动显示、换一换留到最后"。
   */
  console.log('\n[文章进度] 记下批过哪几页，据此续做与排序')
  try {
    const { clearGraded, firstUngraded, gradedCount, isCompleted, markGraded, orderForPicker } = await import(
      '../src/components/article-progress'
    )
    const { pageReferenceOf, pageSourceOf, pageCountOf } = await import('../src/domain/exercise-source')
    const { articleById } = await import('../src/domain/articles')

    let map = {}
    check(isCompleted(map, 'x', 3) === false && firstUngraded(map, 'x', 3) === 0, '没练过：不算完成，从第 0 页开始')
    map = markGraded(map, 'x', 2)
    map = markGraded(map, 'x', 0)
    check(gradedCount(map, 'x', 3) === 2, `批过两页就报两页（实际 ${gradedCount(map, 'x', 3)}）`)
    check(firstUngraded(map, 'x', 3) === 1, `从没批完的那一页继续：第 ${firstUngraded(map, 'x', 3)} 页`)
    check(isCompleted(map, 'x', 3) === false, '还差一页就不算练完')
    map = markGraded(map, 'x', 1)
    check(isCompleted(map, 'x', 3) === true, '三页都批过 = 练完了')
    map = clearGraded(map, 'x', 1)
    check(isCompleted(map, 'x', 3) === false && firstUngraded(map, 'x', 3) === 1, '「返回编辑」把那一页撤回后，它又成了"没做完的那一段"')
    check(
      JSON.stringify(map) === JSON.stringify(markGraded(map, 'x', 2)),
      '同一页重复提交不会记两笔',
    )

    const articleA = articleById('art-economy-zh-to-en-1')
    const articleB = articleById('art-economy-zh-to-en-2')
    if (articleA && articleB) {
      const totalA = pageCountOf(articleA.id)
      let done = {}
      for (let index = 0; index < totalA; index += 1) done = markGraded(done, articleA.id, index)
      const ordered = orderForPicker([articleA, articleB], done, (item) => pageCountOf(item.id))
      check(ordered[0]?.id === articleB.id, `练完的排到最后（第一张是 ${ordered[0]?.id}）`)
      check(ordered[ordered.length - 1]?.id === articleA.id, '练完的那一篇落在末尾')
      check(
        isCompleted(done, articleA.id, totalA) && !isCompleted(done, articleB.id, pageCountOf(articleB.id)),
        '一篇练完、另一篇没练完（界面据此决定打开哪一篇）',
      )
    }

    // 记录页/收藏页的"原文"：文章题取**那一页**，句子题取那一句
    const page0 = pageSourceOf('art-economy-zh-to-en-1', 0)
    const page1 = pageSourceOf('art-economy-zh-to-en-1', 1)
    const whole = articleA?.text ?? ''
    check(page0.length > 50 && whole.length > page0.length, `文章题取到的是"那一页"而不是整篇（第 1 页 ${page0.length} 字 ／ 全文 ${whole.length} 字）`)
    check(page1.length > 50 && page1 !== page0, `第 2 页与第 1 页不是同一段（${page1.length} 字）`)
    check(
      articleA !== undefined && pageSourceOf(articleA.id, 0) === page0,
      '同一页取两次永远是同一段文字（分页是纯函数）',
    )
    /*
     * 记录页还要显示**这一段对应的参考译文**（用户要求）。文章库自带逐段对齐的译文，
     * 因此整篇有译文；而"这一段"的译文必须**短于整篇**、且与这一段对得上。
     */
    const ref0 = pageReferenceOf('art-economy-zh-to-en-1', 0)
    check(
      ref0.length > 0 && articleA !== undefined && ref0.length < articleA.reference.length,
      `文章题取到的是"这一段的参考译文"（第 1 页 ${ref0.length} 字 ／ 全文 ${articleA?.reference.length ?? 0} 字）`,
    )
    check(pageReferenceOf('不存在的题号', 0) === '', '认不出来的题号不瞎给译文')
    check(
      pageSourceOf('sentence-v2-economy-1', 0).length > 0 && pageSourceOf('sentence-v2-economy-1', 0).length < 400,
      '句子题取到的是那一句本身（没有分页可言）',
    )
    check(pageSourceOf('不存在的题号', 0) === '', '认不出来的题号返回空串，不瞎猜')
  } catch (error) {
    check(false, '进度可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 标色遵循**最小匹配**：修改前后相同的前缀 / 后缀 / 中间某一段**都不标色**，
   * 也不算进"修改后的内容"里（用户要求）。
   *
   * 这一条由 parse.ts 的 resolveChanged 保证（它调 minimal.ts 的 minimizeChange，
   * 按字符级差异 + 词的边界求出最小的那块），这里把它钉在几个具体形状上：
   * 共同前缀、共同后缀、中间相同的一段、只有中间不同的情况。
   */
  console.log('\n[最小匹配] 标色只圈真正变化的那一块')
  try {
    const cases: Array<{ name: string; answer: string; oldText: string; targetText: string; expectMarked: string; expectTo: string }> = [
      {
        name: '共同前缀不标',
        answer: 'the farmer works hard',
        oldText: 'the farmer',
        targetText: 'the farmers',
        expectMarked: 'farmer',
        expectTo: 'farmers',
      },
      {
        name: '共同后缀不标',
        answer: 'a big problem appears',
        oldText: 'a big problem',
        targetText: 'a huge problem',
        expectMarked: 'big',
        expectTo: 'huge',
      },
      {
        name: '中间相同的一段不标（只标两端真正变的那部分）',
        answer: 'people and nature coexist here',
        oldText: 'people and nature coexist',
        targetText: 'people with nature coexisting',
        // and → with、coexist → coexisting：两处各自最小，中间的 " nature " 完全不动
        expectMarked: 'and',
        expectTo: 'with',
      },
      {
        name: '只多一个词时一个字都不标',
        answer: 'he visited the past year',
        oldText: 'the past year',
        targetText: 'the past years',
        expectMarked: 'year',
        expectTo: 'years',
      },
    ]
    const { parseCorrection: parse } = await import('../src/domain/parse')
    for (const item of cases) {
      const outcome = parse(
        JSON.stringify({
          errors: [
            { id: 'c1', type: 'replace', category: 'grammar', oldText: item.oldText, targetText: item.targetText, explanation: 'x' },
          ],
          highlights: [],
        }),
        item.answer,
      'zh-to-en',
      )
      if (!outcome.ok) {
        check(false, `最小匹配：${item.name}`, outcome.problems.join('；'))
        continue
      }
      const error = outcome.correction.errors[0]
      const firstChange = error?.changed?.[0]
      const marked = firstChange ? item.answer.slice(firstChange.start, firstChange.end) : '(没算出改动)'
      check(
        marked === item.expectMarked,
        `最小匹配：${item.name} → 标的是 ${JSON.stringify(item.expectMarked)}（实际 ${JSON.stringify(marked)}）`,
        JSON.stringify(error?.changed),
      )
      check(
        firstChange?.to === item.expectTo,
        `最小匹配：${item.name} → 写的是 ${JSON.stringify(item.expectTo)}（实际 ${JSON.stringify(firstChange?.to)}）`,
      )
    }
  } catch (error) {
    check(false, '最小匹配可以验证', error instanceof Error ? error.message : String(error))
  }

  // 反向验证：故意给出译文里没有的文字，定位器必须拒绝并说清原因
  console.log('\n[反向验证] 让定位器面对它找不到、或分不清的文字')
  try {
    const { locate } = await import('../src/domain/locate')
    const target = MOCK_CASES[0]
    if (target) {
      const answer = target.sampleAnswer
      // 从当前默认题的作答里取一段真实存在的文字，避免把断言写死在某一篇上
      const present = answer.slice(10, 30)

      const missing = locate(answer, { text: '这段文字根本不在译文里' })
      check(!missing.ok, '定位器拒绝了译文里不存在的片段')
      if (!missing.ok) console.log(`    拒绝原因：${missing.reason}`)

      const exact = locate(answer, { text: present })
      check(exact.ok, `定位器找到了确实存在的片段「${present.slice(0, 12)}…」`)

      // 同一片段出现多次时必须要求消歧，而不是随便挑一处
      const repeated = 'the cat and the dog'
      const ambiguous = locate(repeated, { text: 'the ' })
      check(!ambiguous.ok, '片段出现多次且没有上下文时，定位器拒绝猜')
      if (!ambiguous.ok) console.log(`    拒绝原因：${ambiguous.reason}`)

      const disambiguated = locate(repeated, { text: 'the ', contextAfter: 'dog' })
      check(disambiguated.ok, '补上上下文后定位器能分出是哪一处')
      if (disambiguated.ok) {
        check(disambiguated.value.start === 12, `定位到的是第 12 个字符处（实际 ${disambiguated.value.start}）`)
      }

      const byOrder = locate(repeated, { text: 'the ', occurrence: 2 })
      check(byOrder.ok && byOrder.value.start === 12, '也可以用"第几次出现"来指定')
    }
  } catch (error) {
    check(false, '定位器反向验证可以执行', error instanceof Error ? error.message : String(error))
  }

  // 界面渲染：类型正确不等于能渲染出来，白屏是用户无法自行修复的故障
  console.log('\n[界面渲染] 在 jsdom 中挂载界面并走一遍提交 → 批改 → 点批注')
  try {
    /*
     * 用一道**句子库**的题：探针切到句子栏、把屏幕上的原文当作答打进去。
     * 作答不属于任何内置示例，因此接口桩会回一份与提交文字自洽的批改
     * （见 render-probe 里的说明），结构断言照样有效。
     */
    const rendered = await renderApp({
      exerciseId: `sentence-${ARTICLE_DOMAINS[0]?.id ?? 'economy'}-1`,
      mode: 'sentence',
    })
    check(rendered.html.length > 0, '界面渲染出了内容')
    check(rendered.judgeCalls === 1, `提交后调用了批改接口 ${rendered.judgeCalls} 次`)

    /*
     * 参考译文**不发给模型**：请求体里既不能有那个字段，也不能出现参考译文的原文。
     * 发过去会让模型退化成"逐字对照标准答案"，与"允许合理意译"直接打架。
     */
    check(
      !rendered.judgeRequestBody.includes('referenceTranslation'),
      '发给批改接口的请求里没有参考译文这个字段',
    )
    // 取参考译文的**中段**比对：开头可能正好与某篇原文撞车
    // （built-in 示例里 paragraph-001 的译文与 article-001 的原文都以 Over the past decade, China has 开头）
    const referenceLeak = MOCK_CASES.map((item) => item.exercise.referenceTranslation)
      .filter((reference) => reference.length > 40)
      .map((reference) => reference.slice(Math.floor(reference.length / 2), Math.floor(reference.length / 2) + 30))
      .filter((middle) => rendered.judgeRequestBody.includes(middle))
    check(referenceLeak.length === 0, '请求体里也没有任何一段参考译文的正文', referenceLeak[0])
    check(rendered.composeStageHadInput, '提交前右屏是作答输入框')

    // 布局要求：左边整页原文，右边整页作答；提交后结果在右边同一个位置替换掉输入框
    // 「段落」栏已从导航撤掉（文章题本来就按自然段切、逐段作答，另开一栏是重复），
    // 因此导航上是六个：四类题型去掉段落 + 自定义 + 收藏 + 练习记录
    check(
      rendered.modeTabLabels.join(',') === '文章,句子,术语,自定义,收藏,练习记录,留言板',
      `顶部导航有文章/句子/术语、自定义、收藏、练习记录与留言板（实际：${rendered.modeTabLabels.join(' / ')}）`,
    )
    check(rendered.sampleIds.length >= 4, `题库覆盖 ${rendered.sampleIds.length} 道示例，四类题型都有题`)

    // 四栏 2×2 布局：左上原文、右上译文、左下计分、右下批注
    // 注意：这里是在 HTML 文本里找类名，所以不带选择器的点号
    for (const [className, label] of [
      ['pane-source', '左上：原文'],
      ['pane-answer', '右上：我的译文'],
      ['pane-score', '左下：总体评分'],
      ['pane-notes', '右下：逐处批注'],
    ] as const) {
      check(rendered.html.includes(className), `四栏布局里有${label}`)
    }
    check(
      rendered.html.includes('split-row-top') && rendered.html.includes('split-row-bottom'),
      '上下两排各自成行（高度可以按内容互相让位，而不是钉死的比例）',
    )

    // 右下角不再一次性列出全部批注：没点之前**什么都不显示**（那段用法提示已被用户点名去掉）
    const noteCount = (rendered.html.match(/class="note-item/g) ?? []).length
    check(noteCount === 0, `没点勾画时右下角不列出批注（当前 ${noteCount} 条）`)
    check(
      !rendered.notesPaneHtml.includes('点右上角'),
      '没点勾画时右下角不再写那段用法提示（用户要求去掉）',
    )

    // 右上角「我的译文」在提交后必须显示**带批注的**作答。
    // 这一栏出过两个问题：整栏空白（渲染时漏了内容）、只显示纯文本而没有标注。
    check(rendered.answerPaneText.trim().length > 20, `右上角显示了作答（${rendered.answerPaneText.trim().length} 字）`)
    check(rendered.html.includes('annotated-lines'), '右上角渲染的是带批注的译文，不是纯文本')
    const paneAnswerMarks = (rendered.answerPaneHtml.match(/class="mk /g) ?? []).length
    check(paneAnswerMarks > 0, `右上角译文上有 ${paneAnswerMarks} 处标注`)
    check(rendered.hasRotateButton, '左上角原文栏有「换一换」按钮')

    // 右下角是逐条清单，不重复排版译文（带批注的译文在右上角）
    check(!rendered.notesPaneHtml.includes('annotated-lines'), '右下角的清单里没有把译文重排一遍')

    check(rendered.text.includes('错误归类'), '左下角里出现了错误归类')
    check(rendered.text.includes('/ 100'), '左下角里出现了分数')
    check(rendered.text.includes('系统计分'), '分数旁说明了计分规则')
    check(rendered.text.includes('硬性错误'), '左下角区分了硬性错误')
    check(rendered.text.includes('表达问题'), '左下角区分了表达问题')
    check(!rendered.html.includes('总体评语'), '批改结果里没有 AI 写的总体评语')
    check(!rendered.html.includes('分项评语'), '批改结果里没有 AI 写的分项评语')

    /*
     * 逐页批改：填一页 → 交一页 → 翻一页。
     * 上面那次渲染已经按这套流程走过一遍，这里核对它留下的观察数据。
     * 这道题只有一页，因此"翻页"那几条要在下面用一篇多段的原文另跑一遍。
     */
    check(rendered.perPage.length > 0, `逐页流程走通了（${rendered.perPage.length} 页）`)
    check(
      rendered.judgeCalls === rendered.perPage.length,
      `每一页各交了一次（${rendered.perPage.length} 页 / 批改调用 ${rendered.judgeCalls} 次）`,
    )
    check(rendered.revisit.showsResult, '提交完这一页，右上角显示的就是带批注的译文')
    check(!rendered.revisit.hasInput, '批过之后是只读的，输入框不在了')
    check(
      rendered.revisit.judgeCalls === 0,
      `翻回已批过的页没有重新提交（多调用了 ${rendered.revisit.judgeCalls} 次）`,
    )

    // 还原探针改过的全局对象，否则后续依赖 fetch 的检查会误报
    rendered.restore()
    check(typeof globalThis.fetch === 'function', '渲染探针已还原全局 fetch')

    console.log('\n[界面渲染 · 逐页批改] 一篇多段原文：填一页 / 交一页 / 翻一页')
    const multiPageText = [
      '生态文明建设是一场涉及生产方式、生活方式、思维方式和价值观念的深刻变革，需要全社会共同行动、久久为功。党的十八大以来，我们把绿色发展摆在更加突出的位置，推动产业结构和能源结构加快调整，让良好生态环境成为经济社会高质量发展的支撑点，也让绿色成为新时代中国发展最鲜明的底色。',
      '在具体实践中，各地坚持山水林田湖草沙一体化保护和系统治理，统筹推进重要生态系统保护和修复重大工程，持续加强生物多样性保护，坚决打好污染防治攻坚战。这些年空气质量与地表水质量连年改善，长江黄河干流水质稳定达标，人民群众对生态环境的获得感明显增强。',
      '下一步将健全生态保护补偿机制，完善相关法律法规，让保护者受益、使用者付费、破坏者赔偿真正落到实处。同时把绿色低碳理念融入生产生活的方方面面，推动形成人人、事事、时时崇尚生态文明的社会新风尚，让美丽中国建设成果更多更公平地惠及全体人民。',
    ].join('\n\n')
    /*
     * 多段原文从**界面**贴进去（走「自定义」那一栏的贴题流程）：
     * 探针会点「重新贴一篇」→ 填文本 → 「开始练习」，然后停在那道题上。
     * 这样不依赖"探针挂载之前先把存档写好"这种时序假设——
     * `useState(() => loadCustom())` 只在挂载那一刻读一次存档。
     */
    /*
     * 逐页批改的**多页**那一半：上面那道题只有一页，翻页这件事根本没被走到。
     * 自己贴一篇三段原文来跑——它按自然段切、自动判成文章题。
     *
     * ⚠️ 三段都必须**够长**（各 50 字以上）：分页规则是"不足 50 单位就与相邻段并成一页"
     * （见 domain/sections.ts 的 paginateArticle），段落太短的话整篇会被并成**一页**，
     * 翻页这件事就一步都走不到了（这条断言实际这么红过一次）。
     *
     * ⚠️ `judgeDelayMs` 是这一轮新增的：真实批改要十几秒，而"批改中"那段时间里的界面
     * （等待弹窗、翻页照样能走、别处不能提交、批完的通知）正是这一轮要守住的规矩。
     * 桩默认立刻返回 = 那段时间宽度为零，测不到，因此这里把它拖慢。
     */
    const multi = await renderApp({ checkCustom: multiPageText, judgeDelayMs: 30 })
    check(multi.perPage.length === 3, `这篇原文分成 ${multi.perPage.length} 页`)
    check(
      multi.perPage.every((page) => page.state.includes('待批改')),
      '每一页交出去之前都是"待批改"（还没批过就是还没批过）',
      multi.perPage.map((page) => `${page.page}:${page.state}`).join(' | '),
    )
    /*
     * 「点下一页时把刚写完的这一页交出去批」这条老规矩已经**取消**了
     * （用户要求：翻页不触发提交、草稿留着）。下面这一组就是新规矩的验收：
     * 每一页都要"翻页不提交 + 草稿还在"，而记录与调用次数仍然一页各一次。
     */
    check(
      multi.submits.length === 3,
      `三页各提交了一次（观测到 ${multi.submits.length} 次提交）`,
    )
    check(
      multi.submits.every((entry) => entry.viaNav === 0),
      '点「下一页」不触发提交批改（三页都没有偷偷多交一次）',
      multi.submits.map((entry) => `第${entry.page + 1}页:${entry.viaNav}`).join(' | '),
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.draftKeptAfterRoundTrip),
      '翻走再翻回来，草稿还在（可以接着往下写）',
      multi.submits.map((entry) => `第${entry.page + 1}页:${entry.draftKeptAfterRoundTrip}`).join(' | '),
    )
    check(
      multi.perPage.slice(0, 2).every((page) => page.stateAfterLeave.includes('待批改')),
      '翻走再回来，那一页如实显示"待批改"（没交出去就不该写着已批改）',
      multi.perPage.map((page) => `${page.page}:${page.stateAfterLeave}`).join(' | '),
    )
    /*
     * 提交之后的等待提示（用户指定：两个按钮「停留此页」「进入下一页」）。
     * 末页不该弹：后面没有下一页可去。
     */
    check(
      multi.submits[0]?.modal.join('/') === '停留此页/进入下一页' &&
        multi.submits[1]?.modal.join('/') === '停留此页/进入下一页',
      '提交之后弹出等待提示，两个按钮都在',
      multi.submits.map((entry) => `第${entry.page + 1}页:[${entry.modal.join('/')}]`).join(' | '),
    )
    check(
      multi.submits[2]?.modal.length === 0,
      '最后一页提交时不弹等待提示（后面没有下一页可去）',
      `[${multi.submits[2]?.modal.join('/') ?? ''}]`,
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.duringJudge?.wentNext === true),
      '点「进入下一页」真的翻到了下一页',
      multi.submits.map((entry) => `${entry.page}:${entry.duringJudge?.wentNext}`).join(' | '),
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.duringJudge?.pageAfterNext === entry.page + 1),
      '批改还没回来就已经翻到了下一页（批改中可以继续翻译）',
      multi.submits.map((entry) => `${entry.page}→${entry.duringJudge?.pageAfterNext}`).join(' | '),
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.duringJudge?.judgingLabel === '批改中…'),
      '交出去之后按钮上写着"批改中…"',
      multi.submits.map((entry) => entry.duringJudge?.judgingLabel ?? '').join(' | '),
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.duringJudge?.judgingDisabled === true),
      '正在批的这一页按不动提交（同一次不会交两遍）',
      multi.submits.map((entry) => `${entry.page}:${entry.duringJudge?.judgingDisabled}`).join(' | '),
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.duringJudge?.answerReadOnly === true),
      '交出去之后这一页立刻只读（这一刻改字，回来的批注就画错了）',
      multi.submits.map((entry) => `${entry.page}:${entry.duringJudge?.answerReadOnly}`).join(' | '),
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.duringJudge?.submitDisabled === true),
      '批改进行中（哪怕翻到别的页、写上了字）也提交不了——一次只批一页',
      multi.submits.map((entry) => `${entry.page}:${entry.duringJudge?.submitDisabled}`).join(' | '),
    )
    check(
      multi.submits.slice(0, 2).every((entry) => entry.duringJudge?.elsewhereTitle.includes('一次只批一页')),
      '按不动的理由写在悬停说明里（不是"没写东西"）',
      multi.submits.map((entry) => entry.duringJudge?.elsewhereTitle ?? '').join(' | '),
    )
    check(
      multi.submits.every((entry) => entry.toastText.includes(`第 ${entry.page + 1} 页已经批改完成`)),
      '每批完一页，右下角都弹出"第 x 页已经批改完成"',
      multi.submits.map((entry) => entry.toastText).join(' | '),
    )
    check(
      multi.submits.every((entry) => entry.toastRouted && entry.routedPage === entry.page),
      '点那条通知直接路由到批完的那一页',
      multi.submits.map((entry) => `${entry.page}→${entry.routedPage}`).join(' | '),
    )
    check(
      multi.submits.every((entry) => entry.toastGoneAfterRoute),
      '跳过去之后通知自己消失（人已经站在那一页上了）',
      multi.submits.map((entry) => `${entry.page}:${entry.toastGoneAfterRoute}`).join(' | '),
    )
    /*
     * 记录里有哪几页，仍然用**练习记录**来验：逐页批改下一条记录 = 一页，
     * 因此"每一页都留下了自己的那条记录"就等于"每一页都被提交过一次"。
     *
     * 为什么不去读界面上那句状态：那句话要等 React 再画一帧才更新，
     * 探针读到的往往是上一帧，拿它做断言会间歇性地假红。落盘的记录没有这个时机问题。
     */
    {
      const { loadRecords: loadForMulti } = await import('../src/components/records-store')
      const multiRecords = loadForMulti().filter((record) => record.exerciseId === loadCustom()?.id)
      const recordedPages = multiRecords.map((record) => record.sectionIndex).sort((a, b) => a - b)
      check(
        recordedPages.join(',') === '0,1,2',
        `三页各留下了一条持久化记录（实际页号：${recordedPages.join(',') || '(无)'}）`,
        JSON.stringify(multiRecords.map((record) => ({ page: record.sectionIndex, answer: record.answer.slice(0, 12) }))),
      )
      check(
        new Set(multiRecords.map((record) => record.answer)).size === multiRecords.length,
        '每一页记录里的作答各不相同（说明每页各写各的，没有串页）',
      )
    }
    check(
      multi.perPage.at(-1)?.stateAfterLeave === '(末页，翻不过去)',
      '末页没有「下一页」可点（那一页只能自己按「提交批改」）',
      multi.perPage.at(-1)?.stateAfterLeave,
    )
    check(
      multi.judgeCalls === 3,
      `三页各交一次、不多不少（批改调用 ${multi.judgeCalls} 次）`,
    )
    check(multi.revisit.showsResult && !multi.revisit.hasInput, '翻回第 1 页看到的是当时的结果，且是只读的')
    check(
      multi.revisit.judgeCalls === 0,
      `翻回已批过的页没有重新提交（多调用了 ${multi.revisit.judgeCalls} 次）`,
    )
    /*
     * 用户要求："假如当前页面处于批改后的状态，那么切换其他页，再切换回来时，
     * 也需要在批改界面，不能回到编辑界面。"
     *
     * 两个方向都量：按过「返回编辑」但**一个字没改**就翻走 → 回来仍是批改界面；
     * 改过字再翻走 → 回来是作答框（那时结果已经作废，它是一道待提交的题）。
     */
    check(
      multi.unlockRoundTrip?.unlockedShown === true,
      '按「返回编辑」之后这一页确实变成了作答框（前置条件成立）',
    )
    check(
      multi.unlockRoundTrip?.gradingBack === true,
      `没改字就翻走再翻回来，看到的是批改界面而不是作答框（实际状态：${multi.unlockRoundTrip?.stateAfterBack}）`,
      JSON.stringify(multi.unlockRoundTrip),
    )
    check(
      multi.editedRoundTrip?.hasInput === true && multi.editedRoundTrip?.hasResult === false,
      '改过字再翻走又翻回来，仍是作答框（那一页的结果已经作废了）',
      JSON.stringify(multi.editedRoundTrip),
    )
    multi.restore()

    // 再用一道有批注的句子题单独验批注交互：
    // 默认题是文章，示例里只有一处亮点，没有 errors 条目可点。
    console.log('\n[界面渲染 · 批注交互] 换成句子题重跑一遍')
    const sentence = await renderApp({ exerciseId: 'sentence-001' })
    check(sentence.judgeCalls === 1, '句子题也走通了提交 → 批改')
    check(sentence.answerPaneText.includes('i is'), '句子题提交后右上角显示了作答')
    check(!sentence.notesPaneHtml.includes('annotated-lines'), '句子题的右下栏里没有重排译文')
    check(sentence.answerPaneHtml.includes('annotated-lines'), '句子题的右上译文上有批注')

    const it = sentence.interaction
    check(Boolean(it), '在译文里找到了可点的勾画')
    if (it) {
      check(it.markCount >= 3, `译文上有 ${it.markCount} 处可点的勾画`)
      check(
        !it.idleNotes.includes('点右上角') && !it.idleNotes.includes('第 1 处'),
        '没点勾画时右下角没有用法提示、也不显示任何一处（那段提示用户要求去掉）',
        JSON.stringify(it.idleNotes.slice(0, 80)),
      )
      check(it.firstBubble.length > 0, `点第一处勾画后，那一行下面浮出气泡：${JSON.stringify(it.firstBubble.slice(0, 28))}…`)
      check(it.firstBubble.includes('完整说明见右下角'), '气泡尾部指向右下角的完整说明')
      check(!it.firstBubble.includes('…'), '气泡显示的是完整内容，没有截断')
      check(
        it.firstNotes.includes('说明') && !it.firstNotes.includes('点右上角'),
        '点第一处勾画后，右下角换成了这一处的说明',
      )
      check(it.selectedDetailCount === 1, `右下角只有 ${it.selectedDetailCount} 张卡片（只显示选中的那一处）`)
      check(
        it.secondNotes !== it.firstNotes,
        '再点另一处，右下角内容跟着换成那一处（不是全量清单）',
      )
      check(it.secondBubble !== it.firstBubble, '再点另一处，气泡内容也跟着换')
      /*
       * 用户要求："点击任意卡片都不会关掉这两个卡片，当且仅当点击这两个卡片之外的地方才消失。"
       * 点**卡片正文**（不是按钮）也必须在——早先只放行了卡片里的标题与按钮，点正文就算点外面。
       */
      check(
        it.bubbleAfterInsideBubble.length > 0 && it.notesAfterInsideBubble.includes('说明'),
        '点小卡片的正文，小卡片与右下角那张卡片都还在（不算点外面）',
        JSON.stringify(it.bubbleAfterInsideBubble.slice(0, 24)),
      )
      check(
        it.bubbleAfterInsideDetail.length > 0 && it.notesAfterInsideDetail.includes('说明'),
        '点右下角那张卡片的正文，两张卡片也都还在',
        JSON.stringify({ 气泡: it.bubbleAfterInsideDetail.slice(0, 16) }),
      )
      check(
        it.bubbleOutsideRoot,
        '小卡片挂在 document.body 上（不在译文栏那棵子树里，因此不会被滚动容器剪掉、也不会被下面两栏压住）',
      )
      /*
       * 卡片必须**落在视口之内**：它是固定定位的，算错了就会整块画到屏幕外面
       * （真实浏览器验收里量到过：卡片中心落在视口之外，用户看到的就是"卡片没出来"）。
       * 放不下时它会翻到那一行上面——`bubbleFlipped` 记录走的是哪条路。
       */
      check(
        it.bubbleTop >= 0 && it.bubbleTop <= it.bubbleViewportHeight - 8,
        `小卡片的 top 落在视口之内（top ${it.bubbleTop}，视口高 ${it.bubbleViewportHeight}）`,
      )
      check(
        it.bubbleAfterOutsideClick === '' && !it.notesAfterOutsideClick.includes('第 1 处'),
        '点两张卡片**之外**的地方，气泡消失、右下角回到提示',
      )
      /*
       * 原文栏里"这一处对应的地方"（用户要求）：点译文上的某一处 → 原文里对应那一段标同色；
       * 收起卡片 → 标记消失。区间来自 AI 给的 sourceText（探针按真实形状补了一个）。
       */
      check(
        it.sourceMarkText.length > 0,
        `点一处批改之后，原文栏里对应那一段也标了色（「${it.sourceMarkText}」）`,
      )
      check(it.sourceMarkAfterOutsideClick === '', '收起小卡片之后，原文里那处标记随之消失')
      check(it.hasRawLink, '右下角有「点击查看 AI 完整返回内容」')
      check(
        it.rawModalText.includes('"errors"') && it.rawModalText.includes('explanation'),
        '点开后弹窗里是 AI 的完整返回（未解析、未收窄）',
      )

      /*
       * 点**上方补写的字**也算选中这一处（判定范围只是扩大了，语义没变）。
       * 之前文档级那句"点外面就收起来"把它当成外面，点上去等于没反应。
       */
      check(
        it.bubbleAfterFixClick.length > 0 && !it.notesAfterFixClick.includes('点右上角译文里的任意一处勾画'),
        '点上方补写的字，小卡片照常打开、右下角也换到那一处',
        it.bubbleAfterFixClick || '（气泡没出来）',
      )
      /*
       * 卡片里的说明按分号断行：AI 常把两三个分句挤在一句里，卡片又窄。
       * 光看文字是看不出来的（<br> 不产生字符），所以查 HTML。
       */
      check(
        it.firstBubbleHtml.includes('<br>'),
        '小卡片里的「说明」遇到「；」会断行',
        it.firstBubbleHtml.slice(0, 160),
      )
      // 收藏：点卡片下方那颗按钮 → 文案变「已收藏」→ 内容存进浏览器
      check(
        /ann-bubble-order[^>]*color:\s*var\(--mark-(red|orange|green)\)[^>]*>（\d+）/.test(it.firstBubbleHtml),
        '小卡片里的序号是彩色的（1）（2）形式（用这一处自己的颜色）',
        (it.firstBubbleHtml.match(/<span class="ann-bubble-order"[^>]*>[^<]*</) ?? ['（没找到序号）'])[0],
      )
      check(
        it.firstBubbleHtml.length > 0 && !it.firstBubbleHtml.includes('ann-bubble-change'),
        '小卡片里不再抄一遍「某某 → 某某」（译文上本来就画着）',
        it.firstBubbleHtml.slice(0, 160),
      )
      check(it.firstFavoriteButton === '收藏', `卡片下方有「收藏」按钮（实际「${it.firstFavoriteButton}」）`)
      check(it.favoriteButtonAfterClick === '已收藏', '点过之后按钮变成「已收藏」')
      const stored = it.favoriteStored[0]
      check(
        it.favoriteStored.length === 1 && Boolean(stored?.why) && Boolean(stored?.sentenceBefore) && Boolean(stored?.sentenceAfter),
        `收藏里存下了改前整句 / 改后整句 / 原因（${it.favoriteStored.length} 条）`,
        JSON.stringify(stored ?? {}).slice(0, 240),
      )
      check(
        (stored?.beforeEnd ?? 0) > (stored?.beforeStart ?? 0) || (stored?.afterEnd ?? 0) > (stored?.afterStart ?? 0),
        '收藏里记下了"改前那句标哪一段、改后那句标哪一段"（只标这一处）',
        `改前 ${stored?.beforeStart}–${stored?.beforeEnd} ／ 改后 ${stored?.afterStart}–${stored?.afterEnd}`,
      )
      check(
        /explain-num[^>]*>[①②③]/.test(it.firstBubbleHtml),
        '小卡片里说明的每一行开头带圈号（①②…）',
        (it.firstBubbleHtml.match(/<span class="explain-num"[^>]*>[^<]*</) ?? ['（没找到圈号）'])[0],
      )
    }

    // 五种改法都要能画在译文上：替换（旧文字勾底色 + 上方小字）、插入、删除、
    // 整句重写、语序调换（配对弧线）。这道句子题的示例正好同时含替换、插入、删除。
    /*
     * 记号语言是"相应颜色的荧光笔底色"，**只有纯删除额外加一道横线**
     * （用户要求："如果原文需要删掉（但是无更换内容），那么标色后，再加上横线划掉"）。
     * 因此这里断言的是"删除有横线、而替换与重写没有"——不是"一律没有删除线"。
     */
    const sentenceMarks = sentence.answerPaneHtml.match(/class="mk /g) ?? []
    check(sentenceMarks.length >= 3, `右上译文上有 ${sentenceMarks.length} 处标注标记`)
    check(sentence.answerPaneHtml.includes('mk-delete'), '删除类在译文上有标记')
    check(
      /background:\s*var\(--mark-(red|orange)-bg\)/.test(sentence.answerPaneHtml),
      '被改动的内容用相应颜色的底色勾画（荧光笔）',
    )
    check(
      /class="mk-deleted"[^>]*>/.test(sentence.answerPaneHtml) &&
        sentence.answerPaneHtml.includes('mk-delete'),
      '删除类把文字包在 mk-deleted 里（横线画在这一层，横线与文字同色）',
    )
    check(
      sentence.answerPaneHtml.includes('mk-replace') && sentence.answerPaneHtml.includes('mk-deleted'),
      '替换类把原文标了出来（class 仍是 mk-replace/mk-deleted）',
    )
    check(
      /class="fix-text"[^>]*>[^<]*I am/.test(sentence.answerPaneHtml),
      '替换的正确写法写在填补层里（i is → I am）',
    )
    check(
      /class="fix-text"[^>]*data-fix-for="fix-\d+"/.test(sentence.answerPaneHtml),
      '方框带着"属于哪一处填补、是第几段"的标记（量坐标的脚本靠它对号入座）',
    )

    // 插入类单独用那道插入题验证（sentence-002 的示例是漏介词与冠词）
    const insert = await renderApp({ exerciseId: 'sentence-002' })
    check(insert.answerPaneHtml.includes('mk-insert'), '插入类在译文上标出了补入位置')
    check(
      insert.answerPaneHtml.includes('mk-slot') && !insert.answerPaneHtml.includes('mk-caret'),
      '插入点画成一块空位，那根零宽的小竖线已经不用了',
    )
    check(
      /class="mk-slot"[^>]*background:\s*var\(--mark-(red|orange)-bg\)/.test(insert.answerPaneHtml),
      '插入空位用相应颜色的荧光笔底色',
      (insert.answerPaneHtml.match(/<span class="mk-slot"[^>]*>/) ?? ['（没找到空位）'])[0],
    )
    check(insert.answerPaneHtml.includes('fix-text'), '补入的内容写在填补层里')
    check(insert.answerPaneHtml.includes('fix-layer'), '填补内容画在独立的层上')
    check(
      /<span[^>]*class="fix-text"/.test(insert.answerPaneHtml) &&
        !/<button[^>]*class="fix-text"/.test(insert.answerPaneHtml),
      '填补内容用的是 span 而不是 button（button 会带出浏览器默认的底色与边框）',
    )
    insert.restore()

    /*
     * 「自定义」那一栏：用户自己贴一篇原文就能练，不用等我们出题。
     * 只贴原文——方向和题型由程序判断（有汉字就是中译英；段落数/句数决定按哪种题型批改）。
     */
    const customGuesses: Array<[string, Mode, Direction]> = [
      ['生态文明建设', 'term', 'zh-to-en'],
      ['高质量发展', 'term', 'zh-to-en'],
      ['The quick brown fox jumps over the lazy dog.', 'sentence', 'en-to-zh'],
      ['She held fast to her dream. Later she made it come true.', 'paragraph', 'en-to-zh'],
      ['First paragraph of my own text.\n\nSecond paragraph of my own text.', 'article', 'en-to-zh'],
    ]
    for (const [source, expectMode, expectDirection] of customGuesses) {
      const short = source.replace(/\s+/g, ' ').slice(0, 20)
      check(
        directionOf(source) === expectDirection,
        `自定义题按文字判方向：${JSON.stringify(short)} → ${DIRECTION_LABEL[expectDirection]}`,
      )
      check(
        modeOf(source) === expectMode,
        `自定义题按长短判题型：${JSON.stringify(short)} → ${KIND_LABEL[expectMode]}`,
      )
    }
    const customProbe = await renderApp({
      seedCustom: 'She held out her hand and waited there for a while.',
      checkCustom: '碳达峰与碳中和是中国向世界作出的庄严承诺。',
    })
    const custom = customProbe.custom
    check(Boolean(custom), '「自定义」那一栏能渲染出来')
    if (custom) {
      check(custom.navHasCustom, `导航栏里有「自定义」：${custom.tabs.join(' / ')}`)
      check(
        custom.shownSource.includes('She held out her hand'),
        '点「自定义」能切到上次贴过的那一篇',
        custom.shownSource.slice(0, 60),
      )
      check(!custom.hasReference, '自己贴的题没有参考译文那一栏（批改并不需要它）')
      check(!custom.hasAiButton && !custom.hasRotateButton, '自己贴的题不给「AI 出题」「换一换」（贴哪篇就练哪篇）')
      check(custom.hasSourceInput, '原文栏本身就是一个输入框（第 13 轮：不再弹窗问）')
      check(!custom.hasPasteModal, '进自定义栏**不弹**任何要求输入的窗口')
      check(custom.prefill.includes('She held out her hand'), '输入框里预填着上次写的那一篇，直接改就行')
      check(
        custom.afterType.includes('碳达峰与碳中和'),
        '往输入框里写完新的一篇，「原文」栏就是新那一篇',
        custom.afterType.slice(0, 60),
      )
      check(
        custom.afterType.includes('自动判定'),
        '左上角如实标出方向与题型（自己贴的题没有官方建议用时）',
        custom.afterType.slice(0, 80),
      )
      /*
       * 第 9 条把顶栏那三枚小标签（方向 / 文体 / 话题）删掉了，因此这条断言反过来量：
       * **它们确实不再出现**。以前它量的是"方向标签跟着原文变"，
       * 而那枚标签现在整站都没有了（方向在原文标题栏的开关里）。
       * 只看顶栏那一段 HTML：这三样字样在别处（练习记录、选文章弹窗）本来就该有。
       */
      const topbarHtml = (() => {
        const start = customProbe.html.indexOf('class="topbar"')
        const end = customProbe.html.indexOf('</header>', start)
        return start >= 0 && end > start ? customProbe.html.slice(start, end) : ''
      })()
      check(
        topbarHtml.length > 0 &&
          !topbarHtml.includes('中译英') &&
          !topbarHtml.includes('英译中') &&
          !topbarHtml.includes('新闻编译') &&
          !topbarHtml.includes('社会'),
        '顶栏不再挂方向/文体/话题三枚标签（第 9 条）',
        topbarHtml.slice(0, 120),
      )
      check(custom.storedSource.includes('碳达峰与碳中和'), '贴进来的原文存进了浏览器（刷新后还在）')
      check(custom.historyCount >= 1, '按题号留了档，练习记录翻旧题时显示得出原文')
    }
    customProbe.restore()

    // 「批注不改变换行位置」：文字流必须与提交的作答逐字相同
    const flow = sentence.flow
    check(Boolean(flow), '拿到了译文文字流')
    if (flow) {
      check(
        flow.matches,
        `批注没有改动译文本身的文字（文字流 ${flow.text.length} 字 vs 作答 ${flow.answer.length} 字）`,
        flow.matches ? undefined : `文字流：${JSON.stringify(flow.text.slice(0, 60))}\n作答：${JSON.stringify(flow.answer.slice(0, 60))}`,
      )
    }

    /*
     * 「漏了一个词」是最容易画错的一类：模型常把它报成"替换"（made → has made），
     * 于是画面上变成"划掉 made、上方写 has made"，看着像整个词被换掉。
     * 按单词求最小不同项之后应当是**纯插入**：一个字都不划，只补 has。
     */
    const wordOrderCase = MOCK_CASES.find((item) => item.exercise.id === 'sentence-003')
    if (wordOrderCase) {
      const wordCorrection = fixtureCorrectionFor('sentence-003', wordOrderCase.sampleAnswer)
      check(wordCorrection !== null, 'sentence-003 的示例作答能取到内置批改结果')
      if (!wordCorrection) throw new Error('sentence-003 缺少内置批改结果')
      const wordValidated = validateCorrection(
        wordCorrection.errors,
        wordCorrection.highlights,
        wordOrderCase.sampleAnswer,
        wordOrderCase.exercise.direction,
      )
      const wordLayout = buildLayout(wordValidated, wordOrderCase.sampleAnswer)
      const missed = wordLayout.segments.find((segment) => segment.errorId === 's3-e2')
      check(missed?.kind === 'insert', `漏了一个词时画成插入、不划任何字（实际 ${missed?.kind ?? '没画出来'}）`)
      check(missed?.targetText === 'has ', `补入的内容是「has 」（实际 ${JSON.stringify(missed?.targetText)}）`)
    }

    /*
     * 模型把它报成「整句重写」时也不能整句划掉：只有"整段都换了"才算重写，
     * 按词求最小不同项之后只剩一处词级改动，就该按普通替换画。
     */
    const rewriteAnswer = ' China has plant trees more than 70 million hectares.'
    const coercedRewrite = parseCorrection(
      JSON.stringify({
        errors: [
          {
            id: 'rw-1',
            type: 'rewrite',
            category: 'word-choice',
            oldText: 'China has plant trees more than 70 million hectares.',
            targetText: 'China has afforested trees more than 70 million hectares.',
            explanation: 'plant 用作动词不准确，afforest 才是"植树造林"。',
          },
        ],
        highlights: [],
      }),
      rewriteAnswer,
      'en-to-zh',
    )
    if (coercedRewrite.ok) {
      const rewriteLayout = buildLayout(
        validateCorrection(coercedRewrite.correction.errors, coercedRewrite.correction.highlights, rewriteAnswer, 'en-to-zh'),
        rewriteAnswer,
      )
      const marks = rewriteLayout.segments.filter((segment) => segment.errorId === 'rw-1')
      check(
        marks.every((segment) => segment.kind !== 'rewrite'),
        `只改一个词时不会被整句划掉（实际画成 ${marks.map((s) => s.kind).join('/') || '没画出来'}）`,
      )
      check(
        marks.map((segment) => segment.deletedText).join('') === 'plant',
        `划掉的只有那一个词（实际划「${marks.map((s) => s.deletedText).join('')}」）`,
      )
    } else {
      check(false, '「报成整句重写但只改一个词」的用例可以被解析', coercedRewrite.problems.join('；'))
    }

    /*
     * 一处错误横跨两个词（farmer and herder → farmers and herders）：
     * 译文上要**各画各的**（两个词分别划掉、分别改正），中间没错的 and 不划；
     * 但它们必须共用同一个编号——逻辑上仍是同一处错误，点哪一边选中的都是它。
     */
    const spreadAnswer = ' the farmer and herder are here.'
    const spread = parseCorrection(
      JSON.stringify({
        errors: [
          {
            id: 'spread-1',
            type: 'replace',
            category: 'function-word',
            oldText: 'farmer and herder',
            targetText: 'farmers and herders',
            explanation: '两个名词都要用复数。',
          },
        ],
        highlights: [],
      }),
      spreadAnswer,
      'en-to-zh',
    )
    if (spread.ok) {
      const spreadLayout = buildLayout(
        validateCorrection(spread.correction.errors, spread.correction.highlights, spreadAnswer, 'en-to-zh'),
        spreadAnswer,
      )
      const marks = spreadLayout.segments.filter((segment) => segment.errorId === 'spread-1')
      check(marks.length === 2, `一处错误横跨两个词时画成 ${marks.length} 处勾画（期望 2 处）`)
      check(
        marks.every((segment) => segment.kind === 'replace') &&
          marks.map((segment) => segment.deletedText).join(' + ') === 'farmer + herder',
        `两侧各改各的、and 不被划掉（实际划「${marks.map((s) => s.deletedText).join(' + ')}」）`,
      )
      check(
        marks.map((segment) => segment.targetText).join(' + ') === 'farmers + herders',
        '两侧各自写上正确的词',
      )
      const struck = marks.map((segment) => segment.deletedText ?? segment.text).join('+')
      check(!struck.includes('and'), `没错的词（and）没有被划掉（实际划掉「${struck}」）`)
    } else {
      check(false, '一处错误横跨两个词的用例可以被解析', spread.problems.join('；'))
    }

    // 调序弧线单独用那道语序题验证
    const reorder = await renderApp({ exerciseId: 'sentence-004' })
    check(
      reorder.answerPaneHtml.includes('mk-reorder') || reorder.answerPaneHtml.includes('data-reorder-owner'),
      '语序题在译文上标出了要调换的片段',
    )

    const reorderCase = MOCK_CASES.find((item) => item.exercise.id === 'sentence-004')
    if (reorderCase) {
      const reorderCorrection = fixtureCorrectionFor('sentence-004', reorderCase.sampleAnswer)
      check(reorderCorrection !== null, 'sentence-004 的示例作答能取到内置批改结果')
      if (!reorderCorrection) throw new Error('sentence-004 缺少内置批改结果')
      const reorderValidated = validateCorrection(
        reorderCorrection.errors,
        reorderCorrection.highlights,
        reorderCase.sampleAnswer,
        reorderCase.exercise.direction,
      )
      const reorderLayout = buildLayout(reorderValidated, reorderCase.sampleAnswer)

      /*
       * 关键回归：DOM 上写的 data-reorder-index 必须是**片段序号**（sourceIndex），
       * 而不是片段在译文里的字符位置。
       * 曾经就是写成了字符位置——弧线查找用的是序号，两边永远对不上，
       * 结果一条弧线都画不出来；而"页面里有没有 <svg>"这种断言依然是绿的。
       */
      let keyMismatch: string | null = null
      for (const group of reorderLayout.reorderGroups) {
        const pattern = new RegExp(`data-reorder-owner="${group.errorId}"[^>]*data-reorder-index="(\\d+)"`, 'g')
        const drawn = [...reorder.answerPaneHtml.matchAll(pattern)].map((match) => Number(match[1])).sort((a, b) => a - b)
        const expected = group.parts.map((part) => part.sourceIndex).sort((a, b) => a - b)
        if (drawn.join(',') !== expected.join(',')) {
          keyMismatch = `${group.errorId}：DOM 里是 [${drawn.join(', ')}]，排版结果要的是 [${expected.join(', ')}]`
        }
      }
      check(keyMismatch === null, '弧线配对用的片段序号与排版结果一致（不是字符位置）', keyMismatch ?? undefined)

      const arcs = (reorder.answerPaneHtml.match(/class="arc-path"/g) ?? []).length
      check(arcs > 0, `语序题真的画出了 ${arcs} 条配对弧线`)
    }
    reorder.restore()

    // 切换页面不能丢东西：写一段独有文字 → 切到别的题型 → 切回来，内容必须还在
    console.log('\n[界面渲染 · 切换不丢] 切走再切回来检查作答是否保留')
    const roundTrip = await renderApp({ exerciseId: 'sentence-001', checkTabRoundTrip: true })
    const survived = roundTrip.survivedTabRoundTrip
    check(Boolean(survived), '拿到了切换前后的对照数据')
    if (survived) {
      check(survived.typed.length > 0, `切换前写入了 ${survived.typed.length} 字`)
      check(
        survived.afterReturn === survived.typed,
        `切到别的题型再切回来，作答原样保留（回来是 ${survived.afterReturn.length} 字：${JSON.stringify(survived.afterReturn.slice(0, 24))}）`,
      )
    }
    /*
     * 切走再切回来，**批改结果**必须原样还在。
     *
     * 用户的报告就是这一条："只要切换导航栏，切换回来发现之前的批改内容清除了"。
     * 因此这里核对的不只是作答文字，而是界面上那份批改本身：
     * 带批注的译文、分数、右下角的说明——三样都在，才算"批改没被清掉"。
     */
    const trip = roundTrip.tabRoundTripResult
    check(Boolean(trip), '拿到了切换前后的对照数据')
    if (trip) {
      check(trip.before.annotatedChars > 0, `切换前译文上是带批注的（${trip.before.annotatedChars} 字）`)
      check(
        trip.after.annotatedChars === trip.before.annotatedChars && trip.after.annotatedChars > 0,
        `切走再切回来，带批注的译文原样还在（前 ${trip.before.annotatedChars} 字 / 后 ${trip.after.annotatedChars} 字）`,
      )
      check(
        trip.after.score === trip.before.score && trip.after.score !== '',
        `分数没变（前 ${trip.before.score} / 后 ${trip.after.score}）`,
      )
      check(
        trip.after.notesChars === trip.before.notesChars && trip.after.notesChars > 0,
        `右下角的批注说明也还在（前 ${trip.before.notesChars} 字 / 后 ${trip.after.notesChars} 字）`,
      )
    }
    /*
     * 同一条要求的另一半：他切走时如果正在**看某一次历史批改**，切回来也得还在那一次上。
     * 用户原话是"切换之后切换回来，看到的东西不变"——这一条把"看到的东西"具体化到
     * 「我正在看第几次」上（判据是下拉上那行字）。
     */
    const history = roundTrip.historyView
    check(Boolean(history), '拿到了"正在看哪一次"的切换前后对照')
    if (history) {
      check(history.picked, `从「批改记录」下拉里选中了一次（切栏前写着 ${JSON.stringify(history.viewingBefore)}）`)
      check(
        history.viewingBefore !== history.before && history.viewingBefore.includes('第'),
        '选中之后下拉如实写着"正在看第几次"',
        JSON.stringify({ before: history.before, after: history.viewingBefore }),
      )
      check(
        history.viewingAfter === history.viewingBefore,
        `切到别的栏再切回来，看的还是那一次（前 ${JSON.stringify(history.viewingBefore)} / 后 ${JSON.stringify(history.viewingAfter)}）`,
      )
      /*
       * 切回来时右栏仍是那一次的批注，而且标题栏那颗按钮写「返回编辑」——
       * 用户第 6 条把「回到作答」删掉了，出口收在这一颗上（点它就离开历史视图、回到作答框）。
       */
      check(
        history.resultShown && history.returnToEditAfter,
        `切回来时右栏还是那一次的批注，按钮写「返回编辑」（实际 ${JSON.stringify(history.returnToEditAfter)}）`,
      )
      check(
        history.backToWritingGone === true,
        '「回到作答」已经删掉了（第 6 条：出口收在「返回编辑」那一颗上）',
      )
    }
    roundTrip.restore()

    /*
     * 「换一换」的可达性改从**文章栏**验：「段落」栏已从导航撤掉（文章题本来就按自然段
     * 逐段作答，另开一栏是重复），而文章栏由文章库供题，每个「领域 × 方向」下
     * 正好 3 篇，因此「换一换」必然可用。
     */
    console.log('\n[界面渲染 · 换一换] 文章栏的题也要能换')
    const rotateProbe = await renderApp({ exerciseId: 'sentence-001' })
    check(rotateProbe.hasRotateButton, '原文栏有「换一换」按钮')
    rotateProbe.restore()

    // AI 出题：选领域 → 生成 → 自动切到新题并留存
    console.log('\n[界面渲染 · AI 出题] 走一遍出题流程')
    const generateProbe = await renderApp({ exerciseId: 'sentence-001', checkGenerate: true })
    const gen = generateProbe.generated
    check(Boolean(gen), '找到了「AI 出题」按钮并点开')
    if (gen) {
      check(gen.dialogOpened, '点「AI 出题」弹出了选择领域的面板')
      check(gen.dialogClosed, '生成完成后弹窗自动关闭')
      check(gen.sourceChanged, '原文换成了刚生成的那一篇')
    }
    generateProbe.restore()

    // 逐页批改：批过的页只读、「返回编辑」才放开、放开后不再自动提交；四栏边界可拖动
    console.log('\n[界面渲染 · 逐页批改] 只读的批阅态、返回编辑、拖动边界')
    const panelProbe = await renderApp({ exerciseId: 'sentence-001', checkPanels: true })
    const panels = panelProbe.panels
    check(Boolean(panels), '面板交互探针跑通了')
    if (panels) {
      check(panels.hasSplitter, '四栏之间是可见可拖的分隔条')
      check(panels.manualApplied, '拖动之后切换成手动比例（split-manual）')
      check(panels.canReturnToResult, '批过的页是只读的（没有输入框），而那颗按钮原地写着「返回编辑」')
      check(
        panels.submitVisibleInGraded === false,
        '批改后的视图下**看不到「提交批改」**（第 4 条：那一档不该能点提交）',
      )
      check(panels.editorShown, '点「返回编辑」回到作答框，可以接着改')
      check(
        panels.submitLabelAfterUnlock.trim() === '提交批改',
        `还没动字时按钮是普通的「提交批改」（实际 ${JSON.stringify(panels.submitLabelAfterUnlock)}）`,
      )
      /*
       * 「返回编辑」之后靠**「批改记录」下拉**回看那一次批改（用户要求把「查看上次批改」按钮删掉）。
       * 关键差别：下拉读的是**落盘的练习记录**，因此**改过字之后它照样在**——
       * 旧按钮只在"一个字都没改"时才出现，一改就再也看不到上次批的是哪儿了。
       */
      check(
        panels.historyItemCount >= 1,
        `「返回编辑」之后「批改记录」下拉里能看到那一次（${panels.historyItemCount} 条）`,
      )
      check(panels.pickedFromHistory, '下拉里点一条，真的把右栏切成了当时那份批改')
      check(
        panels.backToResult.有批注译文 && panels.backToResult.又是只读,
        '看了那一次之后是带批注的只读译文，而且这一页重新只读',
        JSON.stringify(panels.backToResult),
      )
      check(
        panels.backToResult.新增调用 === 0,
        `回看历史**不是**重新提交（多发 ${panels.backToResult.新增调用} 次请求）`,
      )
      check(
        panels.resultBack,
        '改过字之后按钮仍是「提交批改」，要自己按（翻页不会替他交）',
      )
      check(panels.historyKeptAfterEdit, '改过字之后「批改记录」下拉还在（这是它比旧按钮强的地方）')
      /*
       * 回归：手动提交之后必须**重新变回只读并显示新结果**。
       * 曾经这一页永远回不到"已批改"那一档——用户改完提交了，界面还停在作答框上，
       * 而结果明明已经存下来了。
       */
      check(
        panels.manualSubmitShowsResult && panels.manualSubmitReadOnly,
        '改过之后手动提交：这一页重新只读，并把刚批出来的结果摆出来',
        JSON.stringify({ 有批注: panels.manualSubmitShowsResult, 只读: panels.manualSubmitReadOnly }),
      )
      check(
        panels.judgeCallsAfterReturn === 0,
        `改过又翻页（来回都翻了），一个批改调用都没多发（多调用了 ${panels.judgeCallsAfterReturn} 次）`,
      )
    }
    panelProbe.restore()

    /*
     * 大改档在**真界面**里走一遍：整篇逐句重写 + 逐句解释 + 每句对应的原文，而且只给对照。
     *
     * 为什么必须走界面：这一档有一串"只有跑起来才看得见"的约定——
     * 提交打的是 /api/refine 而不是 /api/judge、视图开关**保留但禁用**并注明原因、
     * 分数栏写着"大改档不打分"（用户拍板取消了分数与总评）、右下角说清"不逐处批改"。
     */
    console.log('\n[界面渲染 · 大改档] 逐句重写 + 每句原文 + 只给对照（不打分）')
    const refineProbe = await renderApp({ exerciseId: 'sentence-001', checkRefine: true })
    const refine = refineProbe.refine
    check(Boolean(refine), '大改档探针跑通了')
    if (refine) {
      check(refine.reUnlock && refine.editorBack, '先按「返回编辑」放开这一页（作答还在），再换档位')
      check(refine.levelPicked && refine.activeLevel === '大改', `档位切到大改（实际 ${refine.activeLevel}）`)
      check(refine.refineCalls === 1, `大改那一次提交打到 /api/refine 一次（实际 ${refine.refineCalls} 次）`)
      check(refine.refineRequestBody.includes('answerSections'), '大改的请求形状与批改同源（照旧发分段）')
      check(refine.hasCompareList && !refine.hasAnnotatedLines, '只给对照：对照列表在、勾画不在')
      check(refine.lineCount >= 1, `一句我的译文、一句修改译文（${refine.lineCount} 组）`)
      /* 第 4 条：每一组最上面还要有一行"原文" */
      check(
        refine.sourceLineCount >= 1 && refine.sourceLabel === '原文',
        `每一组最上面有一行「原文」（${refine.sourceLineCount} 行，行首标签 ${JSON.stringify(refine.sourceLabel)}）`,
      )
      check(
        refine.originalLabel === '我的译文' && refine.correctedLabel === '修改译文',
        `另两行的标签是「我的译文」「修改译文」（实际 ${JSON.stringify([refine.originalLabel, refine.correctedLabel])}）`,
      )
      check(
        refine.noteText.includes('句首字母'),
        `这一句的解释就印在那一组下面（实际 ${JSON.stringify(refine.noteText)}）`,
      )
      check(
        refine.correctedText.length > 0 && refine.correctedText !== refine.noteText,
        '修改译文那一行是重写后的文字',
      )
      check(refine.viewButtonsDisabled, '「批改视图 / 对照视图」保留但禁用（它只是不给用，不是不见了）')
      /*
       * ⚠️ 大改**不打分、也没有总评**（用户拍板，见 ADR 0020）。
       * 判据两头都要量：那一栏写着"大改档不打分"，而且**一个数字都没有**
       * （留着旧分数的位置会让人以为是加载失败）。
       */
      check(
        refine.scorePaneText.includes('大改档不打分'),
        `分数栏写着「大改档不打分」（实际 ${JSON.stringify(refine.scorePaneText.slice(0, 40))}）`,
      )
      check(
        !/\d/.test(refine.scorePaneText) && !refine.scorePaneText.includes('为什么是这个分数'),
        '分数栏里既没有数字、也没有"为什么是这个分数"那段总评',
        refine.scorePaneText.slice(0, 80),
      )
      check(
        refine.scoreChip.join('／').includes('不打分'),
        `分数栏挂着「不打分」的标记（${refine.scoreChip.join('／')}）`,
      )
      check(
        refine.notesPaneText.includes('大改说明') && refine.notesPaneText.includes('没有"逐处批注"可点'),
        '右下角说清"大改不逐处批改"',
      )
      check(
        !refine.paneHtml.includes('mk-replace') && !refine.paneHtml.includes('fix-text'),
        '译文栏里一处勾画、一处补写都没有（这正是"不逐处批改"）',
      )
      /*
       * 大改的解释也要**按分号断行、每行带圈号**（用户要求）。
       * 桩里那句解释是"句首字母要大写；其余保持不变。"——一个分号，因此两行、一个换行，
       * 圈号从 ① 开始。判据与小卡片那份同一个（explain-lines.tsx）。
       */
      check(
        refine.noteLineCount >= 2 && refine.noteBreaks >= 1 && refine.noteCircled[0] === '①',
        `大改的逐句解释按分号断成带圈号的行（${refine.noteLineCount} 行，圈号 ${refine.noteCircled.join('')}）`,
        JSON.stringify({ 行数: refine.noteLineCount, 换行: refine.noteBreaks, 圈号: refine.noteCircled }),
      )
      check(
        refine.noteCircled[1] === '②',
        `第二行也带圈号（实际 ${JSON.stringify(refine.noteCircled[1] ?? '(没有)')}）`,
      )
    }
    refineProbe.restore()

    // 对照视图 + 设置
    console.log('\n[界面渲染 · 视图与设置] 对照视图与设置项')
    const viewProbe = await renderApp({ exerciseId: 'sentence-001', checkViews: true })
    const views = viewProbe.views
    check(Boolean(views), '视图探针跑通了')
    if (views) {
      check(views.compareLines >= 1, `对照视图按句拆开（${views.compareLines} 句）`)
      /*
       * 版式（用户要求）：一句译文、一句修改后译文**交替排版，各占一行**。
       * 因此每一组里应当是「原译」标签行 + 「改后」标签行，两者上下相邻、都占整行。
       */
      check(
        /compare-label[^>]*>原译/.test(views.compareHtml) && /compare-label[^>]*>改后/.test(views.compareHtml),
        '对照视图里「原译 / 改后」两句都带行首标签，交替排版',
      )
      const rowsInOrder = [...views.compareHtml.matchAll(/class="compare-(original|corrected)"/g)].map((match) => match[1])
      check(
        rowsInOrder.length >= 2 && rowsInOrder.every((kind, index) => (index % 2 === 0 ? kind === 'original' : kind === 'corrected')),
        `每一组都是"先原译、后改后"两行（实际顺序：${rowsInOrder.join(' → ')}）`,
        rowsInOrder.join(' → '),
      )
      check(
        views.compareRowsFullWidth,
        '那两行各自独占一行（同属一个纵向列表，不是排成左右两列）',
      )
      check(views.marksInCompareView === 0, '对照视图里没有任何勾画（不划线、不填补）')
      check(views.coloredSpans >= 1, `对照视图保留了颜色区分（${views.coloredSpans} 处着色）`)
      check(
        /<span[^>]*class="compare-mark"/.test(views.compareHtml),
        '着色用的是行内 span 而不是 button（长内容才会在内部自动折行）',
      )
      check(views.compareText.includes('I am'), '对照视图下方给出的是"修改后的完整那句"')
      /*
       * 荧光只出现在**原文那一行**：原文里被改过的那一段带底色（compare-mark-original），
       * 而"修改后的那句"只染文字颜色、不带底色。两行分开数，别混在一起。
       */
      const originalMarks = (views.compareHtml.match(/class="compare-mark compare-mark-original"/g) ?? []).length
      const originalTinted = (views.compareHtml.match(/compare-mark-original"[^>]*background:\s*var\(--mark-/g) ?? []).length
      const correctedTinted = (views.compareHtml.match(/class="compare-mark"[^>]*background:/g) ?? []).length
      check(originalMarks >= 1, `对照视图的原文那一行也标出了改动（${originalMarks} 处）`)
      check(originalTinted >= 1, '原文那一行的改动带荧光底色（荧光出现在原译文里）')
      check(correctedTinted === 0, '改后那一行只标字体颜色、不加荧光底色')
      check(views.settingsOpened, '导航栏的「设置」能打开设置面板')
      check(views.toggledBoxes && views.boxesBefore && !views.boxesAfter, '关掉「显示填补的正确写法」后填补文字消失')
      check(
        /line-height/.test(views.lineHeightStyle),
        `行距由设置控制（.annotated-lines 的行内样式：${views.lineHeightStyle}）`,
      )
    }
    viewProbe.restore()

    console.log('\n[界面渲染 · 练习记录] 打开一条记录，检查译文上还带着勾画')
    const records = await renderApp({ exerciseId: 'sentence-001', checkRecords: true })
    check(Boolean(records.record), '练习记录页能打开一条记录')
    if (records.record) {
      check(records.record.hasAnnotatedLines, '记录里的译文是带勾画的，不是纯文本')
      check(records.record.marks >= 3, `记录里的译文上有 ${records.record.marks} 处标注`)
      // 左右两屏的分隔条也能拖（双击恢复自动），与练习页同一套
      check(Boolean(records.record.hasSplitter), '练习记录页的两屏之间有一条可拖动的分隔条')
      check(Boolean(records.record.manualAfterDrag), '拖过之后按拖出来的比例分（split-manual）')
      check(Boolean(records.record.autoAfterDoubleClick), '双击分隔条恢复自动')
      check(
        (records.record.favoritesCount ?? 0) >= 1 &&
          (records.record.favoritesText ?? '').includes('改前') &&
          (records.record.favoritesText ?? '').includes('改后'),
        `「收藏」那一栏里看得到刚才收藏的那一条（改前 / 改后整句都在，${records.record.favoritesCount ?? 0} 条）`,
        (records.record.favoritesText ?? '').slice(0, 200),
      )
    }
    records.restore()
    sentence.restore()
  } catch (error) {
    check(false, '界面渲染没有抛出异常', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  }

  // 失败存档：这是后续优化提示词的主要依据，必须证明它真的会写下来
  console.log('\n[失败存档] 模拟一次 AI 返回坏 JSON，检查是否存档')
  try {
    const { judgeAnswer, DEFAULT_JUDGE_CONFIG } = await import('../src/domain/ai')
    const { FailureCollector, archiveFailure } = await import('../src/domain/archive')
    const { readFileSync, existsSync, readdirSync, mkdirSync } = await import('node:fs')

    const originalFetch = globalThis.fetch
    // 故意造一个坏 JSON：少了一个逗号，解析一定失败
    const badJson = '{"errors": [{"id": "e1", "type": "replace", "category": "function-word",,}], "highlights": []}'
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: badJson }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown as typeof fetch

    const request = {
      source: 'Ecological civilization is a form of human progress.',
      direction: 'en-to-zh' as const,
      genre: 'news' as const,
      level: 'polish' as const,
    }
    const answerText = '生态文明是人类进步的一种形态。'
    const sections = [{ start: 0, end: answerText.length, text: answerText }]

    const collector = new FailureCollector()
    const outcome = await judgeAnswer(
      { request, sections },
      { ...DEFAULT_JUDGE_CONFIG, apiKey: 'test-key', maxAttempts: 1 },
      undefined,
      collector,
    )
    globalThis.fetch = originalFetch

    check(!outcome.ok, '坏 JSON 的返回被判为失败')
    check(collector.attempts.length === 1, `收集到 ${collector.attempts.length} 次失败尝试`)

    /*
     * 写进**自己的临时目录**，绝不碰项目根目录的 .ai-failures/。
     *
     * 那个目录是 scripts/failures.mjs 做提示词迭代分诊的地方。原先测试也往那儿写，
     * 结果 178 份记录里 177 份是测试产生的假数据（model=test-model、note=冒烟测试写入），
     * 从那张表得出的任何结论都是噪声；而且原有的清理逻辑只删"它自以为是新建的那个文件"，
     * 实测从未生效，文件堆了 177 份。
     * 现在测试目录独立、跑完整个删掉，两者互不干扰。
     */
    const dir = path.join(process.cwd(), 'node_modules', '.cache', 'smoke-failures')
    clearDir(dir)
    mkdirSync(dir, { recursive: true })

    const saved = await archiveFailure(
      request,
      'test-model',
      'bad-json',
      collector,
      answerText,
      '冒烟测试写入',
      dir,
    )
    check(saved === undefined, '失败存档写入成功', saved ? `写入失败：${saved}` : undefined)

    const created = readdirSync(dir).find((name) => name.endsWith('.json'))
    check(Boolean(created), '存档目录里出现了新的记录文件')

    if (created) {
      const record = JSON.parse(readFileSync(path.join(dir, created), 'utf8')) as {
        kind: string
        request: { answer: string }
        history: Array<{ raw: string; problems: string[] }>
      }
      check(record.kind === 'bad-json', `记录的分类是 ${record.kind}`)
      check(record.history[0]?.raw === badJson, '记录里保留了原始返回的全文（未被截断）')
      check((record.history[0]?.problems.length ?? 0) > 0, '记录里保存了失败原因')
      check(record.request.answer === answerText, '记录里保存了当时的作答，便于复现')
      check(!JSON.stringify(record).includes('test-key'), '存档里没有写入 API 密钥')
    }

    // 跑完就清掉，不留文件
    clearDir(dir)
    const leftover = existsSync(dir) ? readdirSync(dir) : []
    check(leftover.length === 0, '测试用的存档临时目录已清理干净', `残留：${JSON.stringify(leftover)}（目录 ${dir}）`)

    /*
     * 回归护栏：项目根目录的 .ai-failures/ 里不该再有测试写下的记录。
     * 判据是 note 字段（测试写的是"冒烟测试写入"），而不是文件名——
     * 文件名不含这个标记，按名字找会永远通过，等于没测。
     */
    const realDir = path.join(process.cwd(), '.ai-failures')
    const leftovers = existsSync(realDir)
      ? readdirSync(realDir)
          .filter((name) => name.endsWith('.json'))
          .filter((name) => {
            try {
              const parsed = JSON.parse(readFileSync(path.join(realDir, name), 'utf8')) as { note?: string }
              return (parsed.note ?? '').includes('冒烟测试写入')
            } catch {
              return false
            }
          })
      : []
    check(
      leftovers.length === 0,
      '项目根目录的 .ai-failures/ 里没有测试写入的记录',
      leftovers.length > 0 ? `残留 ${leftovers.length} 份：${leftovers.slice(0, 3).join('、')}…` : undefined,
    )
  } catch (error) {
    check(false, '失败存档流程可以执行', error instanceof Error ? error.message : String(error))
  }

  // 真实浏览器截屏：结构断言证明不了"看起来对不对"。
  // 生成的图留给人看（不做自动比对），浏览器不存在时自动跳过，不阻塞测试。
  console.log('\n[真实截屏] 用无头浏览器渲染三个画面')
  try {
    const { captureScreens } = await import('./visual')
    /*
     * 三条提交截图都打**同一个题号**（句子库的第一道）。
     *
     * 为什么不用内置题：内置句子题不再从界面可达（句子栏由文章库供题），
     * 而截图脚本要靠"题目编号 → 示例作答"的表来填答；句子库那道题的作答由脚本自动填屏幕原文。
     * 三条用同一个题号还有一个好处：接口桩只需准备一份响应，切题型也不会拿到不相干的批改。
     */
    const shotExerciseId = `sentence-${ARTICLE_DOMAINS[0]?.id ?? 'economy'}-1`
    const result = await captureScreens([
      { name: '01-compose', width: 1600, height: 950, action: 'plain', clickTab: '句子' },
      { name: '02-result', width: 1600, height: 950, action: 'submit', exerciseId: shotExerciseId, clickTab: '句子', clickMark: 0 },
      { name: '03-marks', width: 1600, height: 950, action: 'submit', exerciseId: shotExerciseId, clickTab: '句子', clickMark: 0 },
      { name: '04-mobile', width: 420, height: 900, action: 'plain' },
    ])
    /*
     * 环境不具备时**跳过**，不算失败：
     * 这台机器没装 Edge/Chrome（或没有 vite）不是本项目的缺陷，不该让测试变红——
     * 否则这套测试在 Linux 与 CI 上永远绿不了。
     * 但"浏览器在、截图流程却出 bug"仍然是真失败，照旧报红（见下方的 else 分支）。
     */
    if (result.skipped) {
      skipped += 1
      console.log(`  ⊘ 已跳过（${result.note ?? '环境不具备'}）`)
    } else {
      check(result.ok, result.ok ? `生成了 ${result.files.length} 张截屏` : `截屏未完成：${result.note ?? ''}`)
      for (const file of result.files) console.log(`    ${file}`)
    }
  } catch (error) {
    check(false, '截屏流程可以执行', error instanceof Error ? error.message : String(error))
  }

  /*
   * 「没有浏览器时跳过、而不是报错」这条行为本身要有断言守着。
   *
   * 为什么需要它：任何装了 Edge 的机器（比如开发机）上，跳过分支都**执行不到**——
   * 于是"注释说会跳过、代码其实在报错"这个 bug 曾经长期存在却没人发现。
   * 这里用 DSH_NO_BROWSER 把环境伪装成"没装浏览器"，真的走一遍那条分支。
   */
  try {
    const { captureScreens } = await import('./visual')
    process.env.DSH_NO_BROWSER = '1'
    let stub: Awaited<ReturnType<typeof captureScreens>>
    try {
      stub = await captureScreens([{ name: 'never', width: 800, height: 600, action: 'plain' }])
    } finally {
      delete process.env.DSH_NO_BROWSER
    }
    check(stub.skipped === true, '伪装成没有浏览器时，截屏走「跳过」而不是失败')
    check(stub.files.length === 0, '跳过时不产出任何截图文件')
    check(
      typeof stub.note === 'string' && stub.note.length > 0,
      '跳过时给出了原因',
      stub.note,
    )
  } catch (error) {
    check(false, '「没有浏览器时跳过」可以验证', error instanceof Error ? error.message : String(error))
  }

  // 启动脚本的编码护栏。
  // 这两个文件必须只有 ASCII：cmd.exe 按系统代码页（中文 Windows 是 GBK）读取 .bat，
  // 而 Windows PowerShell 5.1 会把无 BOM 的 .ps1 当 ANSI 读。
  // 只要文件里出现非 ASCII 字符，字符串字面量就会被解码错乱、脚本语法报错，
  // 而用户看到的现象是"双击后窗口闪退"——极难排查。所以在这里直接拦住。
  console.log('\n[启动脚本] 检查编码与语法护栏')
  try {
    const { readFileSync } = await import('node:fs')
    const { execFileSync } = await import('node:child_process')
    // path 用顶层的那个 import（这里不再另行动态引入，避免遮蔽）
    // 注意：本文件会被 esbuild 打包到 node_modules/.cache 下执行，
    // 因此 import.meta.dirname 指向的是缓存目录。npm run smoke 的当前目录才是项目根。
    const root = process.cwd()

    // 标记的视觉约定：绿色是"做得好"，用波浪线；删除/替换才是横线。
    // jsdom 不套用 CSS，只能直接读样式表来守住这条约定。
    const css = readFileSync(path.join(root, 'src/styles.css'), 'utf8')
    // 上下两排的高度规则：默认一半、下方最多一半、最少 180px
    const bottomRowRule = /\.split-row-bottom\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(/max-height:\s*50%/.test(bottomRowRule), '下方两栏最多顶到一半处（再多就自己滚动）', bottomRowRule.trim())
    check(/min-height:\s*180px/.test(bottomRowRule), '下方两栏最少留 180px（顶到头就不动了）', bottomRowRule.trim())
    const topRowRule = /\.split-row-top\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(/min-height:\s*200px/.test(topRowRule), '上方两排也有下限，不会被下方顶没', topRowRule.trim())

    /*
     * 填补方框的字号必须与正文一致（曾经缩到 0.78em，看起来像被压扁了），
     * 行高也不能用正文那个 2.5（那是给标记留的空白，照搬会把方框撑得虚高）。
     */
    const fixLayerRule = /\.fix-layer\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    // .annotated-lines 在样式表里出现多次（另一处只改 padding），取带 font-size 的那条
    const annotatedRule =
      [...css.matchAll(/\.annotated-lines\s*\{([^}]*)\}/gs)].map((match) => match[1] ?? '').find((rule) => /font-size/.test(rule)) ?? ''
    const fixLayerSize = /font-size:\s*([\d.]+)px/.exec(fixLayerRule)?.[1] ?? ''
    const annotatedSize = /font-size:\s*([\d.]+)px/.exec(annotatedRule)?.[1] ?? ''
    check(
      fixLayerSize !== '' && fixLayerSize === annotatedSize,
      `方框的字号与正文一致（方框 ${fixLayerSize}px / 正文 ${annotatedSize}px）`,
      `fix-layer: ${fixLayerRule.trim()}`,
    )
    const fixTextRule = /\.fix-text\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(/font-size:\s*0\.78em/.test(fixTextRule), '填补文字用之前那档小字（0.78em）', fixTextRule.trim())
    check(/line-height:\s*1\.6/.test(fixTextRule), '填补文字行高 1.6（不再是压扁的 1.35）', fixTextRule.trim())
    // 只留文字：不许有边框、底色、阴影、内边距
    check(
      !/box-shadow/.test(fixTextRule) && !/padding/.test(fixTextRule),
      '填补内容没有阴影、没有内边距',
      fixTextRule.trim(),
    )
    check(
      !/font-weight:\s*(bold|[6-9]00)/.test(fixTextRule),
      '填补内容不加粗',
      fixTextRule.trim(),
    )
    // 背景透明、没有边框线条（用 span 才不会带出浏览器默认的按钮底色）
    check(/background:\s*none/.test(fixTextRule), '填补内容的背景是透明的', fixTextRule.trim())
    check(/border:\s*none/.test(fixTextRule), '填补内容没有边框线条', fixTextRule.trim())
    /*
     * 方框**永不折行**：需要更多地方时，靠 FixLayer 把荧光带用空白继续拓宽
     * （带子总宽 = 补写内容一行排完的宽度 + 左右各 4 个空格），而不是让补写内容自己折。
     */
    check(/white-space:\s*nowrap/.test(fixTextRule), '填补方框永不折行（地方不够就拓宽荧光带）', fixTextRule.trim())
    /*
     * 插入空位：一块 inline-block 的荧光笔空格，宽度由 FixLayer 量出补写内容的宽度后写上去。
     * CSS 里那个 0.6em 只是兜底——关掉「显示填补的正确写法」时量不到宽度，
     * 插入点也不该整个消失。
     */
    const slotRule = /\.mk-slot\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(/display:\s*inline-block/.test(slotRule), '插入空位是 inline-block（不会被折行切开）', slotRule.trim() || '样式表里找不到 .mk-slot')
    check(/width:\s*0\.6em/.test(slotRule), '插入空位有兜底宽度（关掉方框也看得见）', slotRule.trim())

    /*
     * 被改内容**允许在词与词之间断开换行**（放不下时才断）。
     * 曾经 `.mk-replace` 被锁了 `white-space: nowrap`，于是行尾放不下时它整块被顶到下一行去——
     * 用户要的正是"需要时可以被拆到两行上"（词内部仍然不拆，那靠正常的断行规则）。
     */
    const replaceRule = /\.mk-replace\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(!/nowrap/.test(replaceRule), '替换类不再锁死不许换行（放不下时可以在词间断开）', replaceRule.trim() || '样式表里找不到 .mk-replace')
    const compareMarkRule = /\.compare-mark\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(
      !/font-weight:\s*(bold|[6-9]00)/.test(compareMarkRule),
      '对照视图里改动过的字也不加粗',
      compareMarkRule.trim(),
    )
    const noteToRule = /\.note-to\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(!/font-weight:\s*(bold|[6-9]00)/.test(noteToRule), '清单里"改成什么"也不加粗', noteToRule.trim())
    const bubbleToRule = /\.ann-bubble-to\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(!/font-weight:\s*(bold|[6-9]00)/.test(bubbleToRule), '气泡里"改成什么"也不加粗', bubbleToRule.trim())
    /*
     * CSS 里那条 line-height 是**初始值**：真正生效的是 `.annotated-lines` 身上的行内样式
     * （由设置里的行距算出来）。这里只要求它是个合法数值，别再钉死某个具体系数——
     * 用户会按自己的喜好拖动滑杆，而默认值也在 settings.ts 里改过一次（2.5 → 3）。
     */
    check(/line-height:\s*\d/.test(annotatedRule), '正文行高的 CSS 初始值是个合法数值', annotatedRule.trim())
    check(
      /lineHeight:\s*1\.6\b/.test(readFileSync(path.join(root, 'src/components/settings.ts'), 'utf8')),
      '默认行距是 1.6（用户指定；范围 1–3）',
    )

    /*
     * 记号的视觉语言只有一种：**相应颜色的荧光笔底色**。
     * 红橙两色的"被改动内容"都靠底色（底色挂在最外层，补写的字更长时会被撑成等宽的带子），
     * 绿色亮点同样用底色，波浪线已去掉；三者的删除线/下划线一律不许再有。
     */
    const highlightRule = /\.mk-highlight\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(
      /background:\s*var\(--mark-green-bg\)/.test(highlightRule) && !/text-decoration/.test(highlightRule),
      '绿色亮点用底色勾画，波浪线已去掉',
      highlightRule.trim() || '样式表里找不到 .mk-highlight',
    )
    /*
     * 删除线只允许出现在**纯删除**上（用户要求）：
     *   删除类 = 底色 + 一道横线   → 横线挂在 `.mk-delete > .mk-deleted` 上；
     *   替换/重写掉的原文 = 只有底色，不加横线（上方会写正确写法，横线会和方框搅在一起）。
     */
    const deleteInnerRule = /\.mk-delete\s*>\s*\.mk-deleted\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(
      /text-decoration:\s*line-through/.test(deleteInnerRule),
      '纯删除：底色之上再加一道横线（用户要求）',
      deleteInnerRule.trim() || '样式表里找不到 .mk-delete > .mk-deleted',
    )
    for (const [pattern, label] of [
      [/\.mk-deleted\s*\{([^}]*)\}/s, '替换掉的原文'],
      [/\.mk-rewrite-old\s*\{([^}]*)\}/s, '重写掉的原文'],
    ] as const) {
      const rule = pattern.exec(css)?.[1] ?? ''
      check(!/line-through/.test(rule), `${label}不划删除线（只勾底色）`, rule.trim() || '样式表里找不到这条规则')
    }

    /*
     * 小卡片的**层级与事件**（这一轮的两条用户要求，都是样式问题，只能在这里验）。
     *
     * ① "小卡片应该位于最上层，不能被下面的区域栏目所挡住"：
     *    它从前画在译文栏里（absolute），而译文栏的正文盒子是 `overflow-y: auto`——
     *    滚动容器会**剪掉**超出它的内容，所以靠近栏底的气泡会被切口截断。
     *    现在它挂到 body 上、用固定定位，并且 z-index 高过四栏。
     * ② "点击任意卡片都不会关掉这两个卡片"：卡片必须**收得到**点击，
     *    否则那一击会穿过它落到下面的元素上，判定看来就是"点了外面"。
     */
    const bubbleRule = /\.ann-bubble\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(/position:\s*fixed/.test(bubbleRule), '小卡片是固定定位（挂在 body 上，不被译文栏的滚动容器剪掉）', bubbleRule.trim())
    check(/pointer-events:\s*auto/.test(bubbleRule), '小卡片整张收鼠标事件（点它才不会算成"点外面"）', bubbleRule.trim())
    {
      const zIndex = Number(/z-index:\s*(\d+)/.exec(bubbleRule)?.[1] ?? '0')
      check(zIndex > 5, `小卡片的层级高过四栏与填补层（z-index ${zIndex}）`, bubbleRule.trim())
      const modalRule = /\.raw-modal-backdrop\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
      const modalZ = Number(/z-index:\s*(\d+)/.exec(modalRule)?.[1] ?? '0')
      check(
        modalZ > zIndex,
        `弹窗仍然压在小卡片之上（弹窗 ${modalZ} > 卡片 ${zIndex}）`,
        modalRule.trim(),
      )
    }
    /*
     * 卡片里那颗「收藏」必须真的点得动（用户报过两次"点不了"）。
     *
     * ⚠️ 这个 bug 用浏览器探针抓不到：jsdom 不做命中测试，`pointer-events` 在它那里
     * 形同不存在，脚本点那颗按钮照样"成功"（verify-per-page.mjs 就一直是绿的）。
     * 能守住它的只有这条样式表断言——现在整张卡片都是 auto，因此按钮自然也在里面。
     */
    check(
      /pointer-events:\s*auto/.test(bubbleRule),
      '卡片里的「收藏」点得动（整张卡片收事件，包括脚下那一行）',
      bubbleRule.trim(),
    )

    /*
     * 术语题的两条版式（用户要求）：
     *   - 输入框**不画边框**（上下已经有分割线了，再加方框就是三道线挤在一起）；
     *   - 提交按钮挪进了标题栏，作答区里那行 `已写 0 / 5 条…` 与按钮一起删掉了。
     */
    const termInputRule = /\.term-input\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    check(/border:\s*none/.test(termInputRule), '术语输入框没有边框（用户要求）', termInputRule.trim())
    check(
      !/\.term-actions\s*\{/.test(css),
      '作答区里那行按钮/提示（含"已写 0 / 5 条…"）已经删掉，按钮在标题栏',
    )

    /*
     * 撑宽用的是**真空档**（padding），**不许**再用负 margin 把它抵消掉。
     *
     * 两种做法的差别就在用户要的那一条上：加负 margin 时原文一个字都不挪、
     * 带子于是压在相邻文字上（实测按像素数：空档里数得出 201 个字的像素，也就是"相邻文字在荧光里"）；
     * 不加负 margin 时空档真的占地方，相邻文字被推到带子两侧，空档里 0 个字的像素。
     * 这条在 jsdom 里量不出来（jsdom 不排版），只能在源码层面守住。
     */
    const fixLayerSource = readFileSync(path.join(root, 'src/components/FixLayer.tsx'), 'utf8')
    check(
      /style\.paddingLeft\s*=/.test(fixLayerSource) && !/style\.marginLeft\s*=/.test(fixLayerSource),
      '撑宽用的是真空档（相邻文字被推开，不会压在荧光里）',
    )

    for (const file of ['start.ps1', '启动.bat']) {
      const full = path.join(root, file)
      let bytes: Buffer
      try {
        bytes = readFileSync(full)
      } catch {
        check(false, `${file} 存在`)
        continue
      }
      const badBytes: number[] = []
      for (const [index, byte] of bytes.entries()) {
        if (byte > 127) badBytes.push(index)
      }
      check(
        badBytes.length === 0,
        `${file} 只有 ASCII 字符（非 ASCII 字节 ${badBytes.length} 个）`,
        badBytes.length > 0
          ? `首个非 ASCII 字节在第 ${badBytes[0]} 个位置。这两个文件必须保持纯 ASCII，` +
            `中文提示请放在网页界面里，不要放进启动脚本。`
          : undefined,
      )
    }

    // 在没有 BOM 的前提下检查 PowerShell 语法：这正是用户机器上的真实情形
    const scriptPath = path.join(root, 'start.ps1')
    const command =
      "$e=$null;$t=$null;" +
      `[void][System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}',[ref]$t,[ref]$e);` +
      "if($e.Count -gt 0){$e|ForEach-Object{$_.Message};exit 1}"
    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'pipe' })
      check(true, 'start.ps1 的语法检查通过（按无 BOM 读取）')
    } catch (error) {
      const detail = error instanceof Error && 'stdout' in error ? String((error as { stdout?: Buffer }).stdout) : ''
      check(false, 'start.ps1 的语法检查通过（按无 BOM 读取）', detail.slice(0, 400))
    }
  } catch (error) {
    check(false, '启动脚本检查可以执行', error instanceof Error ? error.message : String(error))
  }

  /*
   * 失败归档的分类。
   *
   * 这里曾经有一个**长期无人发现**的 bug：归档函数靠字符串匹配一句早已不存在的散文
   * （'位置都与学生译文对不上'）来判断"位置对不上"这一类失败，
   * 于是这条分支永远命中不了——实测 178 份存档里 anchor-mismatch 一个都没有，
   * 真正的定位失败全被误归成"格式不合法"，把维护者送去修 JSON 格式。
   *
   * 断言的价值在于**把生产者的真实输出喂给消费者**：
   * 只要 parse.ts / validate.ts 改了文案而归档判断没跟上，这里立刻变红。
   * 用硬编码字符串自己喂自己则测不出这件事。
   */
  try {
    /*
     * 生产者：批注声称要改的文字在译文里根本不存在 → 定位失败。
     *
     * 注意真实文案来自 locate.ts（「译文里找不到片段…请逐字复制译文中的原文」），
     * 由 parse.ts 加上 `errors[0]：` 前缀转发出来——
     * **不是**那条同名常量：PROBLEM_NO_ANCHOR_MATCH 所在的分支被上一行的
     * `if (problems.length > 0) return` 遮住了，实际走不到（见该处注释）。
     */
    const notFound = parseCorrection(
      JSON.stringify({
        errors: [
          {
            id: 'e1',
            type: 'replace',
            category: 'grammar',
            oldText: '这段文字在译文里根本不存在',
            targetText: 'whatever',
            explanation: '测试用',
          },
        ],
        highlights: [],
      }),
      'Ecological civilization is a form of human progress.',
      'en-to-zh',
    )
    check(!notFound.ok, '定位全部失败时，解析被判为失败')
    if (!notFound.ok) {
      check(
        notFound.problems.some((problem) => problem.includes('找不到片段')),
        '定位失败的原因是「找不到片段」，并回传了可操作的重试提示',
        `实际问题：${notFound.problems.join('；')}`,
      )
      check(
        classifyFailure({ kind: 'bad-output', problems: notFound.problems }, 3) === 'anchor-mismatch',
        '「位置对不上」被归档成 anchor-mismatch（而不是 bad-json）',
        `实际问题：${notFound.problems.join('；')}`,
      )
    }

    // 生产者：返回里连 JSON 对象都没有（花括号都找不到）→ 应当归到 bad-json
    const badJson = parseCorrection('this is not json at all', 'anything', 'en-to-zh')
    check(!badJson.ok, '坏 JSON 被判为失败')
    if (!badJson.ok) {
      check(
        classifyFailure({ kind: 'bad-output', problems: badJson.problems }, 3) === 'bad-json',
        '「返回里没有 JSON 对象」被归档成 bad-json',
        `实际问题：${badJson.problems.join('；')}`,
      )
    }

    // 生产者：有花括号、但里面是坏 JSON → 走「JSON 解析失败」那条，同样归 bad-json
    const brokenJson = parseCorrection('{ "errors": [, }', 'anything', 'en-to-zh')
    check(!brokenJson.ok, '花括号里是坏 JSON 时被判为失败')
    if (!brokenJson.ok) {
      check(
        classifyFailure({ kind: 'bad-output', problems: brokenJson.problems }, 3) === 'bad-json',
        '「JSON 解析失败」被归档成 bad-json',
        `实际问题：${brokenJson.problems.join('；')}`,
      )
    }

    // 其余两类不走解析器，直接给 kind
    check(
      classifyFailure({ kind: 'truncated', problems: [] }, 3) === 'truncated',
      '被截断归成 truncated',
    )
    check(
      classifyFailure({ kind: 'unauthorized', problems: [] }, 3) === 'bad-json',
      '密钥无效归成 bad-json（非模型输出问题）',
    )
  } catch (error) {
    check(false, '失败归档分类可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 错误分类表的一致性。
   *
   * 这一份原先手工维护了五份平行列表（联合类型、CATEGORY_PRIORITY、CATEGORY_LABEL、
   * HARD_CATEGORIES，以及 prompt.ts 里另一份），**而没有任何测试断言它们一致**。
   * 失败模式不对称且致命：只加进提示词而漏了联合类型，parse.ts 会把该类错误全部拒掉
   * → 解析失败 → 重试三次 → 整批批改作废。
   *
   * 现在四份都由 ERROR_CATEGORY_SPECS 派生，这里把"派生正确"这件事固定下来，
   * 同时守住与提示词之间的对应关系。
   */
  try {
    check(
      CATEGORY_PRIORITY.length === ERROR_CATEGORY_SPECS.length,
      `判定优先级涵盖全部分类（${CATEGORY_PRIORITY.length} 项）`,
    )
    check(
      CATEGORY_PRIORITY.every((key, index) => key === ERROR_CATEGORY_SPECS[index]?.key),
      'CATEGORY_PRIORITY 的顺序与 ERROR_CATEGORY_SPECS 一致',
    )
    check(
      ERROR_CATEGORY_SPECS.every((spec) => CATEGORY_LABEL[spec.key] === spec.label),
      'CATEGORY_LABEL 与 ERROR_CATEGORY_SPECS 的标签一致',
    )
    check(
      ERROR_CATEGORY_SPECS.every((spec) => HARD_CATEGORIES.includes(spec.key) === spec.hard),
      'HARD_CATEGORIES 与 ERROR_CATEGORY_SPECS 的硬性档位一致',
    )
    check(
      new Set(CATEGORY_PRIORITY).size === CATEGORY_PRIORITY.length,
      '判定优先级里没有重复项',
    )

    /*
     * 分类表必须真的出现在提示词里：模型只能照提示词选分类，
     * 少写一个就等于那个分类永远不会被用上。
     * 两个方向都查：分类表虽然共享，但两边的"分几遍自查"里各自列了用哪些分类。
     */
    const systemPrompt = buildSystemPrompt('en-to-zh')
    const zhToEnPrompt = buildSystemPrompt('zh-to-en')
    const missing = ERROR_CATEGORY_SPECS.filter(
      (spec) => !systemPrompt.includes(spec.key) || !zhToEnPrompt.includes(spec.key),
    )
    check(
      missing.length === 0,
      '每一个分类都出现在**两个方向**的系统提示词里',
      missing.length > 0 ? `缺失：${missing.map((spec) => spec.key).join('、')}` : undefined,
    )
    check(
      ERROR_CATEGORY_SPECS.filter((spec) => spec.hard).every((spec) => systemPrompt.includes(spec.label)),
      '硬性分类的中文名都出现在提示词的颜色图例里',
    )
  } catch (error) {
    check(false, '错误分类表的一致性可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 行归并的两份实现必须一致。
   *
   * "把矩形按顶边归并成行"这个算法要跑在两个地方：组件里（算方框摆哪）
   * 和探针注入页面的脚本里（量像素核对）。探针那份在 CDP 的模板字符串里跑，
   * **结构上没法 import 组件那份**，所以只能是两份实现。
   *
   * 原先它是四份（组件 1 + 探针 3），靠"与组件里 shapeOf 的算法一致"这种注释维持——
   * 抄歪了没有任何机制会响，而探针是"补写内容与荧光带对齐"这个高风险特性的唯一证据，
   * 拿一套不同的规则去量组件，量出来的 ✓ 毫无意义。
   *
   * 现在把两份喂同一批矩形，输出必须逐项相同。
   */
  try {
    const rect = (top: number, width: number, left = 0): { top: number; width: number; left: number } => ({ top, width, left })
    const cases: Array<{ name: string; input: Array<{ top: number; width: number; left: number }> }> = [
      // 嵌套元素把同一行报两遍：应当并成一行，并取更宽的那个
      { name: '同一行报两遍', input: [rect(100, 40, 0), rect(100, 90, 5)] },
      // 零宽矩形要丢掉（range 在空片段上会给出零宽）
      { name: '含零宽矩形', input: [rect(100, 0, 0), rect(100, 50, 0), rect(120, 30, 0)] },
      // 顶边差 0.5px：亚像素取整的余量之内，应当并成一行
      { name: '差 0.5px（并）', input: [rect(100, 50, 0), rect(100.5, 70, 0), rect(120, 30, 0)] },
      /*
       * 下面是**专门用来卡住容差取值**的用例。
       *
       * 起初这里只有"差 0.9px"这类间隔 ≤1px 的输入，结果把探针那份实现的容差
       * 从 1 改成 3 之后断言**依然通过**——也就是说那些用例对容差根本不敏感，
       * 等于没测。各组输入的最小间隔必须跨过容差本身（1px），才能真正判出差别：
       *   差 2px：容差 1 → 两行；容差 2 或 3 → 一行
       *   差 4px：容差 1/2/3 → 都是两行
       */
      { name: '差 2px（容差 1 时分开）', input: [rect(100, 50, 0), rect(102, 70, 0)] },
      { name: '差 4px（都分开）', input: [rect(100, 50, 0), rect(104, 70, 0)] },
      // 乱序输入也要得到同样结果（函数自己会排序）
      { name: '乱序输入', input: [rect(120, 30, 0), rect(100, 50, 0), rect(100, 80, 0)] },
      // 一行里混着零宽与重复矩形
      { name: '含零宽与重复', input: [rect(100, 0, 0), rect(100, 40, 0), rect(100, 90, 0), rect(102, 20, 0)] },
      { name: '空输入', input: [] },
    ]
    let mismatches = 0
    for (const testCase of cases) {
      const ours = mergeRowsOnTopEdge(testCase.input)
      const theirs = mergePageRows(testCase.input)
      const same =
        ours.length === theirs.length &&
        ours.every((row, index) => row.top === theirs[index]?.top && row.width === theirs[index]?.width)
      if (!same) {
        mismatches += 1
        console.log(
          `      不一致（${testCase.name}）：组件 ${JSON.stringify(ours.map((r) => [r.top, r.width]))} ` +
            `vs 探针 ${JSON.stringify(theirs.map((r) => [r.top, r.width]))}`,
        )
      }
    }
    check(mismatches === 0, `行归并的两份实现结果一致（${cases.length} 组代表性输入）`)
  } catch (error) {
    check(false, '行归并的两份实现可以比对', error instanceof Error ? error.message : String(error))
  }

  /*
   * 会话 reducer（"每一道题各自的状态"）。
   *
   * 这个 reducer 取代了原先六个按题号索引的 useState 与三处手写的"清空清单"，
   * 因此它必须自己被固定住：跨题互不影响、换原文只清当前这道、
   * 以及**逐页批改**那几条规矩（结果按页存、翻页不该动别人的结果、改过的页不再自动提交）。
   */
  try {
    let sessions = INITIAL_SESSIONS
    const at = (id: string): ExerciseSession => sessionOf(sessions, id)

    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: '第一页' })
    check(at('a').drafts[0] === '第一页', '写入作答进 drafts')

    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 2 })
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: '第三页' })
    check(at('a').drafts[2] === '第三页', '换页之后的作答写进那一页')
    check(at('a').drafts[0] === '第一页', '先写的那一页没被覆盖')

    /*
     * 真实交互的顺序是「点下一页 → 在新的一页里打字」，而不是「先切页、再打字」。
     * 第一版 reducer 的 `answerChanged` 复用了"换原文"那套清空逻辑，顺手把页号也归零，
     * 于是每打一个字人就被弹回第一页：界面显示"第 2 / 4 页"，但写进去的却是第 1 页，
     * 四页永远填不满、提交按钮一直禁用。
     *
     * 上面那两条断言**抓不到**它——它们先切页、紧接着就打字，把页号归零这一步给"用掉了"。
     * 下面这条专门盯住它：切页之后先再打一次字，页号必须纹丝不动。
     */
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 3 })
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: '第四页' })
    check(at('a').sectionIndex === 3, '在新的一页里打字后，页号不会被弹回第一页')
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: '第四页改' })
    check(at('a').sectionIndex === 3, '在同一页里连续打字，页号保持不动')
    check(at('a').drafts[3] === '第四页改', '连续打字覆盖的是同一页，而不是写回第一页')
    check(at('a').drafts[2] === '第三页', '第三页的内容没有被后面的打字冲掉')

    // 跨题目互不影响：这正是原先六个 useState 要各自维护、容易漏的地方
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'b', text: '另一道题' })
    check(at('a').drafts[0] === '第一页', '另一道题的改动不影响这一道')
    check(at('b').drafts[0] === '另一道题', '另一道题自己存住了')
    check(at('c').drafts !== undefined, '没碰过的题号返回空会话而不是 undefined')

    // 提交结果 → 结果记在**提交的那一页**上（不是"这道题的一个结果"）
    const draft = {
      correction: { errors: [], highlights: [] },
      validated: { errors: [], highlights: [], rejections: [] },
      level: 'polish' as const,
      source: 'live' as const,
      sectionCount: 1,
      raw: '{}',
    }
    sessions = sessionReducer(sessions, {
      type: 'pageGraded',
      exerciseId: 'a',
      sectionIndex: 3,
      draft,
      answer: '第四页改',
    })
    check(pageResultOf(at('a'), 3) !== undefined, '提交后结果记在那一页上')
    check(pageResultOf(at('a'), 0) === undefined, '别的页没有结果（不会被这一页的提交牵连）')
    check(pageResultOf(at('a'), 3)?.answer === '第四页改', '结果里存着**提交当时**那段文字（改过之后批注还认得它）')

    /*
     * 逐页批改的规矩都在下一页身上：
     *   1. 翻页**不动**已提交的结果——否则用户翻回去看时只能重新提交（十几秒 + 结果可能不一样）；
     *   2. 「返回编辑」**只放开这一页，不把结果扔掉**。
     *
     * ⚠️ 第 2 条是这一轮改掉的：原先 `pageUnlocked` 会把结果从 pages 里挪进一个暂存区
     * （openResults），那套东西存在的唯一理由是"自动提交的年代要判断这一页该不该交"。
     * 自动提交取消之后它就没用了，而且**有害**：翻页现在只是翻页，用户完全可能
     * 放开看一眼、一个字不改又翻回来——结果留着，他回来点一下就能看到那一次；
     * 扔掉的话，那一次调用白花了。真正该作废的时机只有一个：**他动了一个字**
     * （见下面 answerChanged 那两条）。
     */
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 0 })
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 3 })
    check(pageResultOf(at('a'), 3) !== undefined, '翻走再翻回来，那一页的结果还在（不需要重新提交）')

    sessions = sessionReducer(sessions, { type: 'pageUnlocked', exerciseId: 'a' })
    check(pageResultOf(at('a'), 3) !== undefined, '「返回编辑」不扔掉那一页的结果（一个字没改，随时能回头看）')
    check(at('a').unlocked.includes(3), '这一页记下"已放开"，界面上据此显示作答框而不是结果')
    check(at('a').drafts[3] === '第四页改', '「返回编辑」之后作答还留着（人是回来改字的）')

    /*
     * 一动字就作废：批注是按**提交当时**那段文字画的，
     * 画在新的草稿上必然错位，留着只会骗人（判据是"与那份结果里的 answer 是否一字不差"）。
     */
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: '第四页再改' })
    check(pageResultOf(at('a'), 3) === undefined, '放开之后**改了一个字**，那一页的结果随之作废')
    check(at('a').drafts[3] === '第四页再改', '放开之后能接着写')
    check(at('a').unlocked.includes(3), '接着写不会把"已放开"这条标记弄丢')
    check(pageResultOf(at('a'), 0) === undefined, '放开这一页不影响别的页')
    /*
     * 反过来也要成立：**没动字**时结果不会因为放开与否而丢。
     * （上一条已经把它删了，因此这里重新批一次再放开一次。）
     */
    sessions = sessionReducer(sessions, {
      type: 'pageGraded',
      exerciseId: 'a',
      sectionIndex: 3,
      draft,
      answer: '第四页再改',
    })
    sessions = sessionReducer(sessions, { type: 'pageUnlocked', exerciseId: 'a' })
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: '第四页再改' })
    check(
      pageResultOf(at('a'), 3) !== undefined,
      '放开之后**原样写回同一段文字**，结果不算作废（判据是内容，不是"打没打过字"）',
    )
    // 提交成功 → 收回只读（pageLocked）：这一页重新显示结果，不再可写
    sessions = sessionReducer(sessions, { type: 'pageLocked', exerciseId: 'a', sectionIndex: 3 })
    check(!at('a').unlocked.includes(3), '提交成功之后这一页收回只读（回到"已批改"那一档）')
    check(pageResultOf(at('a'), 3) !== undefined, '收回只读之后结果还在')

    /*
     * 换栏也算"离开这一页"（pageLeft）：按过「返回编辑」没改字就去看了一眼练习记录，
     * 回来时也该看到那份批改——页号不动，只把放开标记收回来。
     */
    sessions = sessionReducer(sessions, { type: 'pageUnlocked', exerciseId: 'a' })
    sessions = sessionReducer(sessions, { type: 'pageLeft', exerciseId: 'a' })
    check(
      !at('a').unlocked.includes(3) && at('a').sectionIndex === 3,
      '换栏（pageLeft）也会把"没改字就离开"的那一页收回只读，而且页号不动',
    )

    /*
     * 把**落盘的练习记录**接回会话（sessionRestored）：刷新之后批改过的页仍显示那次批改。
     *
     * 用户报的"回到当前段落，批改页面回退到编辑界面"，在会话被刷新掉时就是这个样子：
     * 记录还在、会话没了 → 页面变回一张空作答框，而左侧进度还写着"已批 N 页"。
     */
    sessions = sessionReducer(sessions, { type: 'sourceRotated', exerciseId: 'z', variantIndex: 0 })
    sessions = sessionReducer(sessions, {
      type: 'sessionRestored',
      exerciseId: 'z',
      restored: [{ sectionIndex: 2, draft, answer: '第二页的译文' }],
      drafts: [],
    })
    check(pageResultOf(at('z'), 2) !== undefined, '接回来的那一页有结果（于是界面显示批改，而不是空作答框）')
    check(at('z').drafts[2] === '第二页的译文', '草稿也一并接回来（按「返回编辑」面对的是一张有字的框，不是空的）')
    check(at('z').sectionIndex === 0, '接回记录不动页号（页号仍由"上次的界面 / 没批完的那一页"决定）')
    // 会话里已经有结果的那一页，不被记录覆盖（本次刚批出来的更新）
    sessions = sessionReducer(sessions, {
      type: 'sessionRestored',
      exerciseId: 'z',
      restored: [{ sectionIndex: 2, draft, answer: '记录里的旧版本' }],
      drafts: [],
    })
    check(pageResultOf(at('z'), 2)?.answer === '第二页的译文', '会话里已有的结果不被旧记录盖掉')
    // 用户正在写的那一页：草稿不动
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'z', text: '我自己正在写的' })
    sessions = sessionReducer(sessions, {
      type: 'sessionRestored',
      exerciseId: 'z',
      restored: [{ sectionIndex: 0, draft, answer: '记录里的老作答' }],
      drafts: [],
    })
    check(at('z').drafts[0] === '我自己正在写的', '正在写的草稿不会被接回来的记录冲掉')

    /*
     * 用户要求："假如当前页面处于批改后的状态，那么切换其他页，再切换回来时，
     * 也需要在批改界面，不能回到编辑界面。"
     *
     * 他说的情况是：按过「返回编辑」、**一个字都没改**就翻走了，回来却停在作答框上——
     * 而那一页的批改结果明明还在（结果只在"真的改了一个字"时才作废）。
     * 于是「返回编辑」的语义收紧成一句好懂的话：**它只管你人还站在这一页上的时候**。
     */
    sessions = sessionReducer(sessions, { type: 'pageUnlocked', exerciseId: 'a' })
    check(at('a').unlocked.includes(3), '按「返回编辑」之后这一页是可写的')
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 0 })
    check(
      !at('a').unlocked.includes(3),
      '没改字就翻走：「返回编辑」这个标记被收回（回来时该看到批改结果，而不是作答框）',
    )
    check(pageResultOf(at('a'), 3) !== undefined, '翻走时那一页的结果也还在')
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 3 })
    check(
      !at('a').unlocked.includes(3) && pageResultOf(at('a'), 3) !== undefined,
      '翻回来仍是"已批改"那一档（用户报的正是这里回到了编辑界面）',
    )
    /*
     * 反过来：**改过字**再翻走，这一页就该保持可写——那时结果已经作废，
     * 它是一道真正待提交的题，把标记收回会让人回来时对着只读的空壳。
     */
    sessions = sessionReducer(sessions, { type: 'pageUnlocked', exerciseId: 'a' })
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: '第四页又改' })
    check(pageResultOf(at('a'), 3) === undefined, '改过字之后结果作废')
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 0 })
    check(at('a').unlocked.includes(3), '改过字再翻走：这一页保持可写（回来接着改）')
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 3 })
    check(at('a').drafts[3] === '第四页又改', '翻回来草稿还在')

    /*
     * 术语栏的「重新作答」要的是**另一件事**：把这一页的结果真的丢掉。
     * 两件事必须分开，因为术语栏"显示输入框还是显示判分"就由"这一页有没有结果"决定
     * （见 App 里 termVerdicts 的判据）——结果留着，按了等于没按。
     * 这一条是回归：改成"放开重写一律保留结果"之后，术语栏的重新作答实际失效过一次
     * （verify-term-mode.mjs 的第 5 节抓到的）。
     */
    sessions = sessionReducer(sessions, { type: 'pageResultDropped', exerciseId: 'a', sectionIndex: 3 })
    check(pageResultOf(at('a'), 3) === undefined, '「重新作答」把这一页的结果丢掉了')
    check(at('a').unlocked.includes(3), '丢掉结果之后这一页重新可写')
    check(pageResultOf(at('a'), 0) === undefined, '丢掉这一页不影响别的页')

    // 换原文 → 只清当前这道题的作答与结果，别的题不受影响
    sessions = sessionReducer(sessions, { type: 'sourceRotated', exerciseId: 'a', variantIndex: 1 })
    check(at('a').variantIndex === 1, '换原文后记下用的是第几份')
    check(Object.keys(at('a').drafts).length === 0, '换原文后这道题的作答已清空')
    check(Object.keys(at('a').pages).length === 0, '换原文后这道题的逐页结果已清空')
    check(at('a').unlocked.length === 0, '换原文后"已放开"的页也清了（旧页号没有意义）')
    check(at('b').drafts[0] === '另一道题', '换原文不影响别的题')

    // 用一篇 AI 生成的题：存进池子、切过去、清掉旧的作答
    const generated = {
      article: { topic: 't', genre: 'news' as const, paragraphs: [], terms: [] },
      source: '生成的原文',
      referenceTranslation: '',
      topic: '生成',
      genre: 'news' as const,
    }
    sessions = sessionReducer(sessions, {
      type: 'generatedApplied',
      exerciseId: 'a',
      generated,
      variantIndex: 1,
    })
    check(at('a').generated.length === 1, '生成的题存进了池子（以后「换一换」翻得回来）')
    check(Object.keys(at('a').drafts).length === 0, '用新生成的题之后旧作答已清空')

    // sectionChanged 不该顺手把作答清掉
    sessions = sessionReducer(sessions, { type: 'answerChanged', exerciseId: 'a', text: 'x' })
    sessions = sessionReducer(sessions, { type: 'sectionChanged', exerciseId: 'a', sectionIndex: 1 })
    check(at('a').drafts[0] === 'x', '仅切换页不会清掉已写的作答')
  } catch (error) {
    check(false, '会话 reducer 可以验证', error instanceof Error ? error.message : String(error))
  }

  try {
    const diag = await renderApp({})
    check(diag.sectionNavTrace.length > 0, '分段导航的诊断数据拿到了')
  } catch (error) {
    check(false, '分段导航诊断可以执行', error instanceof Error ? error.message : String(error))
  }

  /*
   * 兜底界面（ErrorBoundary）必须真的拦得住渲染错误。
   *
   * 为什么要有这条：用户看到过"提交后白屏、只能刷新"——那是 React 在渲染期
   * 遇到未捕获错误时把整棵树卸掉的结果。加了兜底界面却没人验证过它拦不拦得住，
   * 它就只是心理安慰。这里故意让子组件在渲染期抛错，检查界面上出现的是
   * 一句能读的报错，而不是空白。
   */
  try {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
    const previousWindow = (globalThis as { window?: unknown }).window
    const previousDocument = (globalThis as { document?: unknown }).document
    ;(globalThis as { window?: unknown }).window = dom.window
    ;(globalThis as { document?: unknown }).document = dom.window.document

    const { createRoot } = await import('react-dom/client')
    const { createElement, Component } = await import('react')
    const { act } = await import('react')
    const { ErrorBoundary } = await import('../src/components/ErrorBoundary')

    class Boom extends Component {
      override render(): never {
        throw new Error('故意抛出的渲染错误')
      }
    }

    const container = dom.window.document.getElementById('root')
    if (!container) throw new Error('没有挂载点')
    const root = createRoot(container)
    // React 会把渲染错误同时打到 console.error，这里静音掉免得刷屏
    const originalError = console.error
    console.error = () => undefined
    try {
      await act(async () => {
        root.render(createElement(ErrorBoundary, null, createElement(Boom)))
      })
    } finally {
      console.error = originalError
    }

    const text = container.textContent ?? ''
    check(text.includes('界面出错了'), '子组件渲染抛错时，显示的是兜底界面而不是空白', text.slice(0, 120))
    check(text.includes('故意抛出的渲染错误'), '兜底界面里带着错误信息（能直接复制报告）')
    check(text.includes('组件栈') || text.includes('没有组件栈'), '兜底界面里给出了组件栈的位置')

    await act(async () => {
      root.unmount()
    })
    ;(globalThis as { window?: unknown }).window = previousWindow
    ;(globalThis as { document?: unknown }).document = previousDocument
  } catch (error) {
    check(false, '兜底界面可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 练习记录落盘：写进去、读回来、超上限裁剪、写不下时丢最旧的。
   *
   * 为什么值得单独测：这块以前只在内存里，刷新即失。改成 localStorage 之后，
   * 最容易出错的两处是 ①顺序（界面按"最旧的在前"存、显示时 reverse，颠倒就会翻车）
   * ②写不下时怎么办（一条记录可能几十 KB，而 localStorage 通常只有 5 MB）。
   */
  try {
    const { loadRecords, saveRecords, removeRecord, MAX_RECORDS } = await import('../src/components/records-store')
    const makeRecord = (n: number, exerciseId = 'x-1'): RecordView => ({
      id: `record-test-${n}`,
      exerciseId,
      mode: 'sentence',
      direction: 'en-to-zh',
      topic: '测试',
      attempt: n,
      // 逐页批改：一条记录 = 一页，页号是必填的（记录里没有它就不知道该归到哪一页）
      sectionIndex: 0,
      level: 'polish',
      answer: `第 ${n} 次作答`,
      correction: { errors: [], highlights: [] },
      validated: { errors: [], highlights: [], rejections: [] },
      source: 'live',
      raw: '{}',
      createdAt: new Date(2026, 0, 1, 0, n),
    })

    // 干净起点
    window.localStorage.removeItem('translation-practice.records.v2')

    const three = [makeRecord(1), makeRecord(2), makeRecord(3)]
    const stored = saveRecords(three)
    check(stored.length === 3, `三条记录都存下来了（实际 ${stored.length}）`)

    const readBack = loadRecords()
    check(readBack.length === 3, `读回来还是三条（实际 ${readBack.length}）`)
    check(
      readBack.map((r) => r.attempt).join(',') === '1,2,3',
      `顺序保持"最旧的在前"（实际 ${readBack.map((r) => r.attempt).join(',')}）`,
    )
    check(readBack[0]?.createdAt instanceof Date, 'createdAt 读回来是真正的 Date（不是字符串）')
    check(readBack[0]?.answer === '第 1 次作答', '作答内容原样存住')
    check(readBack[0]?.validated !== undefined, '校验结果也一起存了（记录页要靠它画勾画）')

    // 超过上限：只留最近的 MAX_RECORDS 条，且丢的是**最旧的**
    const many = Array.from({ length: MAX_RECORDS + 20 }, (_, index) => makeRecord(index + 1))
    const trimmed = saveRecords(many)
    check(trimmed.length === MAX_RECORDS, `超过上限后只留 ${MAX_RECORDS} 条（实际 ${trimmed.length}）`)
    check(trimmed[0]?.attempt === 21, `丢的是最旧的（第一条变成第 21 次，实际第 ${trimmed[0]?.attempt} 次）`)
    check(
      trimmed[trimmed.length - 1]?.attempt === MAX_RECORDS + 20,
      '最新那条仍然留着',
    )

    // 坏数据：整份不是数组 / 某一条坏掉
    window.localStorage.setItem('translation-practice.records.v2', '{不是 JSON')
    check(loadRecords().length === 0, '内容不是 JSON 时当作"没有记录"，不抛错')
    window.localStorage.setItem('translation-practice.records.v2', JSON.stringify({ a: 1 }))
    check(loadRecords().length === 0, '内容不是数组时也当作"没有记录"')
    window.localStorage.setItem(
      'translation-practice.records.v2',
      JSON.stringify([
        {
          id: 'ok',
          exerciseId: 'x',
          answer: 'a',
          sectionIndex: 0,
          createdAt: new Date().toISOString(),
          correction: {},
          validated: {},
        },
        { id: 'bad' },
      ]),
    )
    const filtered = loadRecords()
    check(filtered.length === 1 && filtered[0]?.id === 'ok', '坏的那一条被跳过，好的那条留住')
    /*
     * 缺页号的那一条也算坏数据：逐页批改之后"这是哪一页"是必填的，
     * 猜一个页号会让人翻回记录时看到一段对不上的译文。
     */
    window.localStorage.setItem(
      'translation-practice.records.v2',
      JSON.stringify([
        {
          id: 'no-page',
          exerciseId: 'x',
          answer: 'a',
          createdAt: new Date().toISOString(),
          correction: {},
          validated: {},
        },
      ]),
    )
    check(loadRecords().length === 0, '没有页号的旧记录被当作坏数据丢掉（而不是瞎猜一页）')

    /*
     * 写不下时**丢掉最旧的再重试**，而且返回的必须是真写进去的那些（不谎报）。
     *
     * 前两次写入一律失败、第三次起放行：因此 store 必须至少丢过一次才写得下，
     * 成功时留下的条数必然少于 20。
     *
     * 补丁要打在**原型**上：jsdom 的 localStorage 是宿主对象，
     * 给实例赋值（`ls.setItem = ...`）或 defineProperty 到实例上都**不生效且不报错**——
     * 第一版就这么写的，测试"通过"了却什么也没验证到。
     */
    const storageProto = Object.getPrototypeOf(window.localStorage)
    const originalSetItem = storageProto.setItem
    const failAlways = (): never => {
      const error = new Error('quota exceeded') as Error & { name: string }
      error.name = 'QuotaExceededError'
      throw error
    }
    let writes = 0
    storageProto.setItem = function patched(this: Storage, key: string, value: string): void {
      if (key === 'translation-practice.records.v2') {
        writes += 1
        if (writes <= 2) failAlways()
      }
      originalSetItem.call(this, key, value)
    } as typeof storageProto.setItem

    const manyAgain = Array.from({ length: 20 }, (_, index) => makeRecord(index + 1))
    const afterQuota = saveRecords(manyAgain)
    storageProto.setItem = originalSetItem

    check(writes >= 3, `确实重试了（写入尝试 ${writes} 次，前两次是故意失败的）`)
    check(
      afterQuota.length > 0 && afterQuota.length < 20,
      `写不下时丢掉最旧的再重试，而不是整个失败（存下 ${afterQuota.length} / 20 条）`,
    )
    check(
      afterQuota[afterQuota.length - 1]?.attempt === 20,
      `丢的时候保住最新那条（最后一条是第 ${afterQuota[afterQuota.length - 1]?.attempt} 次）`,
    )
    check(
      afterQuota[0]?.attempt !== 1,
      `丢的是最旧的（第一条已经不是第 1 次，而是第 ${afterQuota[0]?.attempt} 次）`,
    )
    // 关键：返回的必须是**真的写进去了**的那些，不能谎报
    check(
      loadRecords().length === afterQuota.length,
      `返回的条数与真正落盘的一致（返回 ${afterQuota.length}，落盘 ${loadRecords().length}）`,
    )

    /*
     * 一条都写不下时返回空——**不谎报**。
     * 谎报的后果是界面显示几条记录、一刷新就没了，用户会以为记录功能坏了。
     */
    let attempts = 0
    storageProto.setItem = function alwaysFail(this: Storage): void {
      attempts += 1
      failAlways()
    } as typeof storageProto.setItem
    const nothing = saveRecords(manyAgain)
    storageProto.setItem = originalSetItem
    check(nothing.length === 0, `一条都写不下时返回空（不谎报存下了），实际 ${nothing.length}`)
    check(attempts > 1, `确实做了多次重试（尝试了 ${attempts} 次）`)

    /*
     * 删掉一条（第 11 条）：练习记录与「批改记录」下拉读的是同一份数据，
     * 因此"删一处 = 两处都没了"这件事就落在 removeRecord 上——它必须真的落盘。
     */
    window.localStorage.removeItem('translation-practice.records.v2')
    const forDelete = saveRecords([makeRecord(1), makeRecord(2), makeRecord(3)])
    const target = forDelete[1]
    const afterDelete = target ? removeRecord(forDelete, target.id) : []
    check(afterDelete.length === forDelete.length - 1, `删掉一条之后少一条（${forDelete.length} → ${afterDelete.length}）`)
    check(
      target ? !afterDelete.some((record) => record.id === target.id) : false,
      '被删的那一条不在了',
    )
    check(
      loadRecords().length === afterDelete.length && !loadRecords().some((record) => record.id === target?.id),
      '删是**真落盘**的（重新读回来也没有它）——所以练习记录与下拉会一起消失',
    )
    check(
      afterDelete.every((record) => record.id !== target?.id) && afterDelete.length === 2,
      '其余两条原样留着（删一条不该动别的）',
    )
  } catch (error) {
    check(false, '练习记录落盘可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 提交前那两道门（第 3 条）。
   *
   * 用户的原话："每次提交批改需要进行检测才能提交，要求字数必须大于30字（英文30个单词），
   * 且不能与这一段之前任意一次提交内容100%相同（防止重复提交），一旦违反，
   * 用吐司提示用户，并不提交批改。"
   *
   * 这里量四件事：门槛是"**多于** 30"（也就是至少 31）、中文数汉字而英文数词、
   * 只管文章题与段落题、以及重复判定的口径（去掉首尾空白后逐字符）。
   */
  try {
    const { checkSubmit, countAnswerUnits, SUBMIT_MIN_UNITS, gatedByLength } = await import(
      '../src/domain/submit-gate'
    )
    const words = (n: number, word = 'word'): string => Array.from({ length: n }, () => word).join(' ')
    const chars = (n: number): string => '译'.repeat(n)

    check(SUBMIT_MIN_UNITS === 30, `篇幅下限就是 30（实际 ${SUBMIT_MIN_UNITS}）`)
    check(
      gatedByLength('article') && gatedByLength('paragraph') && !gatedByLength('sentence') && !gatedByLength('term'),
      '门槛只管文章题与段落题（句子题、术语题不拦）',
    )

    // 中译英：作答是英文，数**词**
    check(countAnswerUnits(words(31), 'zh-to-en') === 31, '中译英数的是单词（31 个词就是 31）')
    check(countAnswerUnits(chars(40), 'en-to-zh') === 40, '英译中数的是汉字（40 个汉字就是 40）')
    check(
      !checkSubmit({ mode: 'article', direction: 'zh-to-en', answer: words(30), previousAnswers: [] }).ok,
      '30 个词不行（要求"大于 30"，也就是至少 31）',
    )
    check(
      checkSubmit({ mode: 'article', direction: 'zh-to-en', answer: words(31), previousAnswers: [] }).ok,
      '31 个词可以交',
    )
    check(
      !checkSubmit({ mode: 'article', direction: 'en-to-zh', answer: chars(30), previousAnswers: [] }).ok,
      '30 个汉字不行',
    )
    check(checkSubmit({ mode: 'article', direction: 'en-to-zh', answer: chars(31), previousAnswers: [] }).ok, '31 个汉字可以交')
    // 短句在句子题上照旧能交（门槛不管它）
    check(
      checkSubmit({ mode: 'sentence', direction: 'en-to-zh', answer: '很短的一句', previousAnswers: [] }).ok,
      '句子题不受篇幅门槛约束（否则短句永远交不出去）',
    )
    check(
      checkSubmit({ mode: 'term', direction: 'en-to-zh', answer: '术语', previousAnswers: [] }).ok,
      '术语题同样不受门槛约束',
    )

    // 提示语要能读：说清"还差多少"
    const short = checkSubmit({ mode: 'article', direction: 'zh-to-en', answer: words(12), previousAnswers: [] })
    check(
      !short.ok && short.message.includes('12') && short.message.includes('31'),
      '拦下来的那句提示里写着"现在多少个、要多少个"',
      short.ok ? '' : short.message,
    )

    // 重复：去掉首尾空白后逐字符相同就算重复
    /*
     * ⚠️ 拿来测重复的这段作答必须**自己先过篇幅那道门**（40 个词），
     * 否则拦下它的是篇幅、而不是重复——那样这两条断言看着是绿的，其实什么都没测到。
     */
    const longForDup = words(40)
    const history = [`  ${longForDup}  `]
    const same = checkSubmit({
      mode: 'article',
      direction: 'zh-to-en',
      answer: longForDup,
      previousAnswers: history,
    })
    check(!same.ok, '与之前某次提交一字不差（只差首尾空白）→ 拦下')
    check(
      !same.ok && same.message.includes('重复'),
      '提示语说的是"重复提交"这件事（而不是"太短"）',
      same.ok ? '' : same.message,
    )
    check(
      checkSubmit({
        mode: 'article',
        direction: 'zh-to-en',
        answer: `${longForDup}.`,
        previousAnswers: history,
      }).ok,
      '改了一个标点就不算重复（口径是逐字符，不做标点归一）',
    )
    check(
      checkSubmit({
        mode: 'article',
        direction: 'zh-to-en',
        answer: longForDup.toUpperCase(),
        previousAnswers: history,
      }).ok,
      '只改大小写不算重复（大小写敏感）',
    )

    /*
     * 探针与截屏脚本共用的那份"合格作答"必须真的过这道门。
     *
     * 这条断言是**防漂移**的：那把造作答的函数在 scripts/lib/probe-answer.mjs 里
     * （截屏要把它的源码塞进页面执行，因此它不能 import 任何东西），
     * 与这里测的判据是两份实现。门一改（比如下限从 30 调到 50），
     * 这里就会当场变红，而不是等到"截图里看不到批改结果"才发现。
     */
    const { answerForPage } = await import('./lib/probe-answer.mjs')
    check(
      checkSubmit({
        mode: 'article',
        direction: 'zh-to-en',
        answer: answerForPage('这是一段中文原文', 0),
        previousAnswers: [],
      }).ok,
      '探针给中译英造的假作答过得了门（词数够）',
    )
    check(
      checkSubmit({
        mode: 'article',
        direction: 'en-to-zh',
        answer: answerForPage('This is an English source sentence.', 0),
        previousAnswers: [],
      }).ok,
      '探针给英译中造的假作答过得了门（汉字够）',
    )
  } catch (error) {
    check(false, '提交前的两道门可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 每一页的界面状态（第 10 条）：草稿、在编辑、正在看第几次批改。
   *
   * 用户要的是三件事：切段再切回来看到的是**那一次**（不是最新一次）、
   * 刷新之后草稿与编辑态还在、以及换原文时这些状态一起清掉
   * （否则旧原文的草稿会贴着新原文回来，比丢掉更糟）。
   */
  try {
    const { loadPageStates, readPageState, writePageState, dropPageStates, MAX_PAGES } = await import(
      '../src/components/page-state'
    )
    const key = 'translation-practice.page-state.v1'
    window.localStorage.removeItem(key)

    let map = loadPageStates()
    check(Object.keys(map).length === 0, '没记过时是空的')

    map = writePageState(map, 'art-a', 1, { draft: '第一页的字' }, new Date(2026, 0, 1, 10))
    map = writePageState(map, 'art-a', 2, { draft: '第二页的字', unlocked: true }, new Date(2026, 0, 1, 11))
    map = writePageState(map, 'art-b', 0, { draft: '别的题' }, new Date(2026, 0, 1, 12))
    check(readPageState(map, 'art-a', 2)?.draft === '第二页的字', '按「题 + 页」各存各的（第 2 页的字没被第 1 页盖掉）')
    check(readPageState(map, 'art-a', 2)?.unlocked === true, '「这一页在编辑」也记住了')
    check(readPageState(map, 'art-a', 1)?.unlocked === false, '没按过「返回编辑」的页不会被顺手记成在编辑')

    // 正在看第几次：这是第 10 条的核心
    map = writePageState(map, 'art-a', 2, { viewingGradeId: 'record-7' })
    check(readPageState(loadPageStates(), 'art-a', 2)?.viewingGradeId === 'record-7', '「正在看第几次」落盘了（刷新之后还认得出）')
    check(readPageState(loadPageStates(), 'art-a', 1)?.viewingGradeId === null, '别的页不受影响（每页各记各的）')

    // 内容没变就不写：打字时每敲一个字都会调它，别动不动整份序列化
    const before = window.localStorage.getItem(key)
    const same = writePageState(map, 'art-a', 2, { draft: '第二页的字' })
    check(same === map, '内容没变时一个字都不写（返回的是同一份 map）')
    check(window.localStorage.getItem(key) === before, '存储也没被动过')

    // 换原文：那道题的页状态全部丢掉，别的题不动
    const dropped = dropPageStates(map, 'art-a')
    check(readPageState(dropped, 'art-a', 1) === undefined && readPageState(dropped, 'art-a', 2) === undefined, '换原文把这道题的页状态清光')
    check(readPageState(dropped, 'art-b', 0)?.draft === '别的题', '别的题不受影响')
    check(Object.keys(loadPageStates()).length === 1, '清也是真落盘的')

    // 条数上限：草稿可能很长，不能让它无限堆在 5MB 的 localStorage 里
    window.localStorage.removeItem(key)
    let capped = loadPageStates()
    for (let index = 0; index < MAX_PAGES + 20; index += 1) {
      capped = writePageState(capped, 'art-c', index, { draft: `第 ${index} 页` }, new Date(2026, 0, 1, 0, 0, index))
    }
    check(
      Object.keys(loadPageStates()).length <= MAX_PAGES,
      `超过上限时按"最久没动过的先丢"裁剪（留下 ${Object.keys(loadPageStates()).length} ≤ ${MAX_PAGES}）`,
    )
    check(
      readPageState(loadPageStates(), 'art-c', MAX_PAGES + 19)?.draft === `第 ${MAX_PAGES + 19} 页`,
      '最新那一页一定留着（裁的是最旧的）',
    )
    window.localStorage.removeItem(key)
  } catch (error) {
    check(false, '每一页的界面状态可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 分割线位置（第 5 条）：**走的时候在哪儿，下次回来还在哪儿**。
   *
   * 用户对"双击恢复默认算不算数"的答复是"反正就是，你走的时候什么位置，
   * 下次回来之后，还是在那个位置"——因此自动布局（null）也要记。
   */
  try {
    const { loadSplit, saveSplit, clampSplit, SPLIT_MIN, SPLIT_MAX } = await import('../src/components/split-layout')
    const key = 'translation-practice.split-layout.v1'
    window.localStorage.removeItem(key)

    check(loadSplit('practice') === null, '没拖过时是自动布局')
    saveSplit('practice', { left: 0.3, top: 0.7 })
    saveSplit('records-nested', { left: 0.2, top: 0.8 })
    check(loadSplit('practice')?.left === 0.3, '拖过的位置记下来了')
    check(loadSplit('records-nested')?.top === 0.8, '三组位置各记各的（互不覆盖）')
    check(loadSplit('records-outer') === null, '没动过的那一组仍是自动布局')

    // 双击恢复默认：写的是 null，也必须记得住
    saveSplit('practice', null)
    check(loadSplit('practice') === null, '双击恢复默认之后仍是自动布局')
    check(loadSplit('records-nested')?.left === 0.2, '恢复某一组不影响别组')

    // 坏数据：越界的比例要夹回来，不能把某一栏拖到看不见
    window.localStorage.setItem(key, JSON.stringify({ practice: { left: 5, top: -3 }, junk: '嗨' }))
    const clamped = loadSplit('practice')
    check(
      clamped?.left === SPLIT_MAX && clamped?.top === SPLIT_MIN,
      `越界的比例被夹进 ${SPLIT_MIN}–${SPLIT_MAX}（否则栏会塌掉）`,
    )
    check(clampSplit({ left: 9, top: 0.5 }).left === SPLIT_MAX, 'clampSplit 与读取时同一套口径')

    window.localStorage.setItem(key, '{不是 JSON')
    check(loadSplit('practice') === null, '存储坏了就当没记过（回到自动布局，不把界面弄崩）')
    window.localStorage.removeItem(key)
  } catch (error) {
    check(false, '分割线位置可以验证', error instanceof Error ? error.message : String(error))
  }

  /* 明暗主题（第 9 条）：跟随系统是默认，手动切过之后就不再听系统的。 */
  try {
    const { resolveTheme, DEFAULT_SETTINGS } = await import('../src/components/settings')
    check(DEFAULT_SETTINGS.theme === 'system', '默认主题是"跟随系统"')
    check(resolveTheme('system', true) === 'dark', '跟随系统：系统深色就是深色')
    check(resolveTheme('system', false) === 'light', '跟随系统：系统浅色就是浅色')
    check(resolveTheme('light', true) === 'light', '手动选过浅色之后，系统再深也不跟（否则那颗按钮看着是坏的）')
    check(resolveTheme('dark', false) === 'dark', '手动选过深色之后同理')
  } catch (error) {
    check(false, '主题口径可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 服务端那一半：三个端点的"路由这一层"接得上，以及**两个宿主共用一份实现**。
   *
   * 这一段不发网络请求、也不花钱：刻意不配 DEEPSEEK_API_KEY，因此最远只走到 503。
   *
   * ⚠️ 这里原先还有三十来项口令门与登录凭证的检查。用户要求"去掉进入口令这一环节，
   * 任何人都可以访问"之后，那道门整个拆掉了（连同 `gate.ts` / `session.ts` /
   * `login.ts` / `logout.ts`，见 ADR 0027），这些检查也跟着删——留着只会变成
   * "测一个已经不存在的东西"，而那种检查最坏的结果是让人以为门还在。
   */
  try {

    /*
     * Pages 端的三个端点：用假的 Request 直接调，验证"路由这一层"接得上。
     * 这里刻意不配 DEEPSEEK_API_KEY，因此最远只走到 503——**不会真的花钱调 API**，
     * 但足以证明"请求进得来、共用实现调得到、缺密钥时那句话是线上那一版"。
     */
    if (typeof Request === 'undefined' || typeof Response === 'undefined') {
      skipped += 1
      console.log('  – 跳过 Pages 端点的检查（这个运行时里没有 Request/Response）')
    } else {
      const { onRequest } = await import('../functions/api/judge')
      /*
       * 账号接口要 D1，而这一段只验批改端点的"路由这一层"。
       * 给一个**碰库就报错**的桩：万一哪次改动让它走到了数据库，这里会立刻炸，
       * 而不是悄悄通过（那才是"测试测了个寂寞"）。
       */
      const noDb = (overrides: Partial<Env> = {}): Env => ({
        DB: {
          prepare() {
            throw new Error('这个检查不该碰数据库')
          },
        } as never,
        ...overrides,
      })
      const callEndpoint = (method: string, body?: unknown, env: Partial<Env> = {}) =>
        onRequest({
          request: new Request('https://fanyipigai.pages.dev/api/judge', {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
          env: noDb(env),
          next: async () => new Response('不该走到这里', { status: 200 }),
          params: {},
        })

      check((await callEndpoint('GET')).status === 405, 'GET /api/judge → 405（不是落回一坨 HTML）')
      const badShape = await callEndpoint('POST', {})
      check(badShape.status === 400, '请求形状不对 → 400')
      check(
        ((await badShape.json()) as { kind?: string }).kind === 'bad-request',
        '400 的 kind 是 bad-request（前端靠它分辨错误类型）',
      )

      const mismatched = await callEndpoint('POST', {
        source: 'Because of heavy rain, the match was put off.',
        direction: 'en-to-zh',
        genre: 'news',
        level: 'polish',
        sourceSections: [{ start: 0, text: 'Because of heavy rain, the match was put off.' }],
        answerSections: [
          { start: 0, text: '因为大雨，比赛被推迟了。' },
          { start: 12, text: '多出来的一段' },
        ],
      })
      check(
        mismatched.status === 400,
        '原文段数与作答段数对不上 → 400（真实故障：这样发出去每次提交都批不了）',
      )

      const noKey = await callEndpoint(
        'POST',
        {
          source: 'Because of heavy rain, the match was put off.',
          direction: 'en-to-zh',
          genre: 'news',
          level: 'polish',
          sourceSections: [{ start: 0, text: 'Because of heavy rain, the match was put off.' }],
          answerSections: [{ start: 0, text: '因为大雨，比赛被推迟了。' }],
        },
        {},
      )
      const noKeyBody = (await noKey.json()) as { kind?: string; message?: string }
      check(noKey.status === 503, '没配 DeepSeek 密钥 → 503（而不是含糊的 500）')
      check(noKeyBody.kind === 'missing-key', '503 的 kind 是 missing-key')
      check(
        (noKeyBody.message ?? '').includes('Cloudflare') && (noKeyBody.message ?? '').includes('DEEPSEEK_API_KEY'),
        '线上那句提示指向 Cloudflare 的环境变量（本地那句指向 .dev.vars，两边不能张冠李戴）',
      )

      /*
       * 两个宿主**必须是同一份实现**：这里比的是函数身份而不是行为。
       * 行为测试过不了"抄了一份、恰好还没改坏"这种情形，而项目真正怕的正是抄一份——
       * 改提示词时只改了本地那半边，线上悄悄跑着旧逻辑（见 src/server/api.ts 顶部）。
       */
      const shared = await import('../src/server/api')
      const plugin = await import('../vite-plugin-judge-api')
      check(
        plugin.isCorrectionRequest === shared.isCorrectionRequest,
        '本地接口用的是共用实现里的请求判据（不是另抄一份）',
      )
      check(plugin.classifyFailure === shared.classifyFailure, '本地接口用的是共用实现里的失败归类')
    }
  } catch (error) {
    check(false, '服务端那一半可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 账号那一套（复用自「地图记忆」，见 ADR 0028）：纯函数与几个安全细节。
   *
   * 这里能钉住的是"不碰数据库就能验"的部分——用户名归一化、密码哈希结构、
   * 头像与改密码的校验、留言长度、以及**会话 token 在库里存的是摘要而不是明文**。
   * 真正的注册/登录/留言/管理整条链路由 `wrangler pages dev` + 本地 D1 验（见 README）。
   */
  try {
    const { cleanUsername, normalizePasswordHash } = await import('../src/server/validate')
    const { resolveAvatar, resolvePassword } = await import('../src/server/profile')
    const { cleanBoardText, parseLimit, parsePositiveInt, DEFAULT_LIMIT, MAX_LIMIT } = await import('../src/server/board')
    const { sha256Hex, randomToken, createSession } = await import('../src/server/auth')
    const { MAX_POST_LEN, MAX_AVATAR_SIZE } = await import('../src/server/limits')

    check(cleanUsername('  冉  云天 ') === '冉 云天', '用户名归一化：去首尾空白、把中间连续空白压成一个')
    check(cleanUsername('x'.repeat(40)).length === 24, '用户名截到 24 个字符（前后端同一口径）')
    check(cleanUsername(123) === '', '用户名不是字符串时归一化成空串（交给调用方报 400）')

    const goodHash = {
      algorithm: 'PBKDF2-SHA-256',
      salt: 'MDEyMzQ1Njc4OWFiY2RlZg==',
      hash: 'q83vIhFmNP2buqo0Fk9yCAp0Q2SEyrTXoYWLGkz3jE8=',
      iterations: 120000,
    }
    check(normalizePasswordHash(goodHash).iterations === 120000, '合法的密码哈希结构能通过')
    for (const [label, bad] of [
      ['算法名不对', { ...goodHash, algorithm: 'plain' }],
      ['盐不是 base64', { ...goodHash, salt: 'not base64!!' }],
      ['迭代次数过低', { ...goodHash, iterations: 1000 }],
      ['整体不是对象', null],
    ] as Array<[string, unknown]>) {
      let threw = false
      try {
        normalizePasswordHash(bad)
      } catch {
        threw = true
      }
      check(threw, `密码哈希：${label} → 拒收（迭代次数下限是这套方案的地基）`)
    }

    check(resolveAvatar({}, 'keep') === 'keep', '头像：这次没传就沿用原值')
    check(resolveAvatar({ avatar: null }, 'keep') === null, '头像：显式传 null 表示清空')
    const smallAvatar = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: 'a.png', size: 100, type: 'image/png' }
    check(
      (resolveAvatar({ avatar: smallAvatar }, null) ?? '').includes('iVBORw0KGgo='),
      '头像：合法的 dataUrl 存进库里',
    )
    for (const [label, bad] of [
      ['不是 data:image 前缀', { ...smallAvatar, dataUrl: 'https://example.com/a.png' }],
      ['自报体积超上限', { ...smallAvatar, size: MAX_AVATAR_SIZE + 1 }],
      ['dataUrl 实际长超上限', { ...smallAvatar, dataUrl: `data:image/png;base64,${'A'.repeat(50 * 1024)}` }],
    ] as Array<[string, unknown]>) {
      let threw = false
      try {
        resolveAvatar({ avatar: bad as never }, null)
      } catch {
        threw = true
      }
      check(threw, `头像：${label} → 拒收（只信自报的 size 会让超大文本绕过限制）`)
    }

    const stored = { password_salt: 'S', password_hash: 'H', password_iterations: 120000 }
    check(
      resolvePassword(stored, {}).hash === 'H',
      '改密码：两个哈希都没传 = 本次不改密码',
    )
    let halfOnly = false
    try {
      resolvePassword(stored, { oldPasswordHash: goodHash })
    } catch {
      halfOnly = true
    }
    check(halfOnly, '改密码：只传一半 → 明确报错（静默不改会让用户以为改成功了）')
    let wrongOld = false
    try {
      resolvePassword(stored, { oldPasswordHash: goodHash, newPasswordHash: goodHash })
    } catch {
      wrongOld = true
    }
    check(wrongOld, '改密码：旧密码哈希对不上 → 拒绝（光有 token 不该能改掉密码）')
    const matching = resolvePassword(
      { password_salt: goodHash.salt, password_hash: goodHash.hash, password_iterations: goodHash.iterations },
      { oldPasswordHash: goodHash, newPasswordHash: { ...goodHash, salt: 'bmV3c2FsdA==', hash: 'bmV3aGFzaA==' } },
    )
    check(matching.salt === 'bmV3c2FsdA==' && matching.hash === 'bmV3aGFzaA==', '改密码：旧密码对得上就换成新哈希')

    check(cleanBoardText('  今天练了一段  ', MAX_POST_LEN) === '今天练了一段', '留言内容去首尾空白')
    check(cleanBoardText('   ', MAX_POST_LEN) === null, '留言内容全是空白 = 空')
    check(cleanBoardText('汉'.repeat(MAX_POST_LEN), MAX_POST_LEN) !== null, `留言正好 ${MAX_POST_LEN} 个汉字可以通过`)
    check(cleanBoardText('汉'.repeat(MAX_POST_LEN + 1), MAX_POST_LEN) === null, '超一个字就拒（按字符数，不按字节）')
    check(cleanBoardText('a'.repeat(MAX_POST_LEN + 1), MAX_POST_LEN) === null, '英文同样按字符数算')

    check(parseLimit('999') === MAX_LIMIT, `分页 limit 超上限被钳到 ${MAX_LIMIT}`)
    check(parseLimit('abc') === DEFAULT_LIMIT, '分页 limit 不合法时回默认值')
    let badId = false
    try {
      parsePositiveInt('0', '帖子ID')
    } catch {
      badId = true
    }
    check(badId, '帖子/回复 id 必须是正整数（0 与负数一律拒）')

    check(
      (await sha256Hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'sha256Hex 与标准结果一致（会话摘要靠它）',
    )
    const tokenA = randomToken()
    check(/^[0-9a-f]{64}$/.test(tokenA) && tokenA !== randomToken(), 'token 是 32 字节随机十六进制，两次不同')

    // 会话写库：**存的是摘要**这条要钉死——它决定"库被看到也拿不到能用的登录态"
    let bound: unknown[] = []
    const captureDb = {
      prepare: () => ({
        bind: (...values: unknown[]) => {
          bound = values
          return { run: async () => ({ success: true, meta: {} }) }
        },
      }),
    }
    const issued = await createSession({ DB: captureDb as never }, 7, 1_800_000_000)
    const [writtenHash, writtenUser, writtenAt, writtenExpires] = bound as [string, number, number, number]
    check(/^[0-9a-f]{64}$/.test(writtenHash) && writtenHash !== issued, '会话写库时存的是摘要，不是 token 明文')
    check(writtenHash === (await sha256Hex(issued)), '库里那个摘要正是这次发出的 token 的 SHA-256')
    check(writtenUser === 7 && writtenAt === 1_800_000_000, '会话记在正确的用户与时间上')
    check(writtenExpires - writtenAt === 30 * 24 * 60 * 60 * 1000, '会话有效期 30 天（与 README 的口径一致）')
  } catch (error) {
    check(false, '账号这一套可以验证', error instanceof Error ? error.message : String(error))
  }

  /*
   * 登录门（用户要求）：**没登录时按「提交批改」要提交失败**——不发请求、不标记批改中，
   * 只把登录/注册窗口弹出来，并写清为什么。
   *
   * 探针默认是"已登录"（见 renderApp 的 guest 参数），因此这里显式以游客身份再渲染一次：
   * `judgeCalls === 0` 是这条要求的硬指标——**一次接口都不能调**，
   * 否则"没登录也能提交"就是真的漏了。
   */
  try {
    const guest = await renderApp({ guest: true })
    /*
     * ⚠️ 这里**不断言"弹窗此刻开着"**：探针在提交之后还会继续点别处，
     * 其中点到弹窗外面的地方会顺手把它关掉——那本来就是弹窗该有的行为
     * （Modal.tsx 的 backdrop 上挂的就是"点外面关闭"）。
     * 因此这一段只钉住"拦下来了"（一次接口都没调）+ "入口在"，
     * 而"按下去确实弹了登录窗"由真实浏览器那一步验（README 的验收清单里那条）。
     */
    check(guest.judgeCalls === 0, `没登录时按「提交批改」一次批改接口都没调（实际 ${guest.judgeCalls} 次）`)
    // 注意：`guest.text` 只是左下分数栏 + 右下批注栏那两块，顶栏要看 html
    check(guest.html.includes('登录 / 注册'), '顶栏上出现了「登录 / 注册」入口')
    check(guest.composeStageHadInput, '被拦下时作答框还在（用户写的东西一个字没丢）')
    check(guest.html.includes('留言板'), '留言板入口在游客身份下也可见（能看、不能发言）')
    guest.restore()
  } catch (error) {
    check(false, '登录门可以验证', error instanceof Error ? error.message : String(error))
  }

  return { checks, failures, skipped }
}
