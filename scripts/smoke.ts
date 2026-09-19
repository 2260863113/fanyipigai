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
import { CATEGORY_LABEL, CATEGORY_PRIORITY, ERROR_CATEGORY_SPECS, HARD_CATEGORIES } from '../src/domain/types'
import { directionOf, modeOf } from '../src/domain/custom'
import { classifyFailure } from '../vite-plugin-judge-api'
import { clearDir } from './lib/clear-dir'
import { existsSync, readdirSync } from 'node:fs'
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
    const expectedErrors = correction.errors.length
    const result = validateCorrection(correction.errors, correction.highlights, sampleAnswer)

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

  // 批改提示词：不含参考译文
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
    const systemMessage = buildSystemPrompt()
    check(systemMessage.includes('不会给你参考译文'), '系统提示里明确告诉模型：不会给参考译文')
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
    // 领域预设要覆盖"五位一体"，别把学生往偏题上引
    for (const domain of ['经济建设', '政治建设', '文化建设', '社会建设', '生态文明建设']) {
      check(GENERATION_TOPICS.includes(domain), `出题领域预设覆盖五位一体：${domain}`)
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
    )
    if (parsed.ok) {
      const lines = buildCompareLines(
        validateCorrection(parsed.correction.errors, parsed.correction.highlights, answer),
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
  } catch (error) {
    check(false, '对照视图的纯函数可以执行', error instanceof Error ? error.message : String(error))
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
    const rendered = await renderApp()
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
    check(
      rendered.modeTabLabels.join(',') === '文章,段落,句子,术语,自定义,收藏,练习记录',
      `顶部导航有四个题型、自定义、收藏与练习记录：${rendered.modeTabLabels.join(' / ')}`,
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

    // 右下角不再一次性列出全部批注：没点之前只有一句提示
    const noteCount = (rendered.html.match(/class="note-item/g) ?? []).length
    check(noteCount === 0, `没点勾画时右下角不列出批注（当前 ${noteCount} 条）`)
    check(rendered.notesPaneHtml.includes('点右上角'), '没点勾画时右下角给出了怎么用的提示')

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
    // 还原探针改过的全局对象，否则后续依赖 fetch 的检查会误报
    rendered.restore()
    check(typeof globalThis.fetch === 'function', '渲染探针已还原全局 fetch')

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
        it.idleNotes.includes('点右上角') && !it.idleNotes.includes('第 1 处'),
        '没点勾画时右下角只是一句提示，不显示任何一处',
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
      check(
        it.bubbleAfterOutsideClick === '' && !it.notesAfterOutsideClick.includes('第 1 处'),
        '点勾画之外的地方，气泡消失、右下角回到提示',
      )
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
        /ann-bubble-num[^>]*>[①②③]/.test(it.firstBubbleHtml),
        '小卡片里说明的每一行开头带圈号（①②…）',
        (it.firstBubbleHtml.match(/<span class="ann-bubble-num"[^>]*>[^<]*</) ?? ['（没找到圈号）'])[0],
      )
    }

    // 五种改法都要能画在译文上：替换（旧文字勾底色 + 上方小字）、插入、删除、
    // 整句重写、语序调换（配对弧线）。这道句子题的示例正好同时含替换、插入、删除。
    // 记号语言只有一种：**相应颜色的荧光笔底色**，一律不划删除线。
    const sentenceMarks = sentence.answerPaneHtml.match(/class="mk /g) ?? []
    check(sentenceMarks.length >= 3, `右上译文上有 ${sentenceMarks.length} 处标注标记`)
    check(sentence.answerPaneHtml.includes('mk-delete'), '删除类在译文上有标记')
    check(
      /background:\s*var\(--mark-(red|orange)-bg\)/.test(sentence.answerPaneHtml),
      '被改动的内容用相应颜色的底色勾画（荧光笔）',
    )
    check(
      !/line-through/.test(sentence.answerPaneHtml),
      '译文上不再出现删除线（改动的记号一律是底色）',
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
      check(custom.hasRepasteButton, '自己贴的题给的是「重新贴一篇」')
      check(custom.prefill.includes('She held out her hand'), '贴题弹窗里预填着当前这一篇，方便改一改再练')
      check(
        custom.afterPaste.includes('碳达峰与碳中和'),
        '贴一篇新的之后，「原文」栏换成新贴的那一篇',
        custom.afterPaste.slice(0, 60),
      )
      check(
        custom.afterPaste.includes('自动判定'),
        '左上角如实标出"这是按哪种题型批改的"（自己贴的题没有官方建议用时）',
        custom.afterPaste.slice(0, 80),
      )
      check(
        customProbe.html.includes('中译英'),
        '顶栏的方向标签跟着这篇原文变（有汉字就是中译英）',
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
      const wordValidated = validateCorrection(
        wordCorrection.errors,
        wordCorrection.highlights,
        wordOrderCase.sampleAnswer,
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
    )
    if (coercedRewrite.ok) {
      const rewriteLayout = buildLayout(
        validateCorrection(coercedRewrite.correction.errors, coercedRewrite.correction.highlights, rewriteAnswer),
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
    )
    if (spread.ok) {
      const spreadLayout = buildLayout(
        validateCorrection(spread.correction.errors, spread.correction.highlights, spreadAnswer),
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
      const reorderValidated = validateCorrection(
        reorderCorrection.errors,
        reorderCorrection.highlights,
        reorderCase.sampleAnswer,
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
    roundTrip.restore()

    // 段落模式也必须有「换一换」：这是用户明确提过的（此前只有段落-002 有备选）
    console.log('\n[界面渲染 · 换一换] 段落模式的默认题也要能换')
    const paragraphProbe = await renderApp({ exerciseId: 'paragraph-001' })
    check(paragraphProbe.hasRotateButton, '段落题的原文栏有「换一换」按钮')
    check(!paragraphProbe.rotateDisabled, '段落题的「换一换」可用（备选篇目已在 variants.ts 里）')
    paragraphProbe.restore()

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

    // 返回修改 → 查看上次批改（不重新提交）；四栏边界可拖动
    console.log('\n[界面渲染 · 面板] 返回上次结果与拖动边界')
    const panelProbe = await renderApp({ exerciseId: 'sentence-001', checkPanels: true })
    const panels = panelProbe.panels
    check(Boolean(panels), '面板交互探针跑通了')
    if (panels) {
      check(panels.hasSplitter, '四栏之间是可见可拖的分隔条')
      check(panels.manualApplied, '拖动之后切换成手动比例（split-manual）')
      check(panels.editorShown, '点「返回修改」回到作答框')
      check(panels.canReturnToResult, '作答框旁边出现「查看上次批改」')
      check(panels.resultBack, '点它就回到上次的批改结果（内容与之前一致）')
      check(panels.judgeCallsAfterReturn === 1, `回到上次结果没有重新调用接口（调用 ${panels.judgeCallsAfterReturn} 次）`)
    }
    panelProbe.restore()

    // 对照视图 + 设置
    console.log('\n[界面渲染 · 视图与设置] 对照视图与设置项')
    const viewProbe = await renderApp({ exerciseId: 'sentence-001', checkViews: true })
    const views = viewProbe.views
    check(Boolean(views), '视图探针跑通了')
    if (views) {
      check(views.compareLines >= 1, `对照视图按句拆开（${views.compareLines} 句）`)
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
      check(records.record.hasSplitter, '练习记录页的两屏之间有一条可拖动的分隔条')
      check(records.record.manualAfterDrag, '拖过之后按拖出来的比例分（split-manual）')
      check(records.record.autoAfterDoubleClick, '双击分隔条恢复自动')
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
    const { readFileSync, rmSync, existsSync, readdirSync, mkdirSync } = await import('node:fs')
    const path = await import('node:path')

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
    const result = await captureScreens([
      { name: '01-compose', width: 1600, height: 950, action: 'plain' },
      // 点了结果页里的一处勾画：能看到那一行下面的气泡与右下角的单处说明
      { name: '02-result', width: 1600, height: 950, action: 'submit', clickMark: 0 },
      // 再用句子题截一张：它同时含替换、插入、删除三种标记，
      // 默认的文章题只有一处亮点，看不出标注长什么样
      { name: '03-marks', width: 1600, height: 950, action: 'submit', exerciseId: 'sentence-002', clickTab: '句子', clickMark: 0 },
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
    const path = await import('node:path')
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
    check(/line-height:\s*2\.5/.test(annotatedRule), '正文行高基准仍是 2.5（方框需要时再额外加）')

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
    for (const [pattern, label] of [
      [/\.mk-delete\s*\{([^}]*)\}/s, '删除类'],
      [/\.mk-deleted\s*\{([^}]*)\}/s, '替换掉的原文'],
      [/\.mk-rewrite-old\s*\{([^}]*)\}/s, '重写掉的原文'],
    ] as const) {
      const rule = pattern.exec(css)?.[1] ?? ''
      check(!/line-through/.test(rule), `${label}不再划删除线（记号改用底色）`, rule.trim() || '样式表里找不到这条规则')
    }

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
    const badJson = parseCorrection('this is not json at all', 'anything')
    check(!badJson.ok, '坏 JSON 被判为失败')
    if (!badJson.ok) {
      check(
        classifyFailure({ kind: 'bad-output', problems: badJson.problems }, 3) === 'bad-json',
        '「返回里没有 JSON 对象」被归档成 bad-json',
        `实际问题：${badJson.problems.join('；')}`,
      )
    }

    // 生产者：有花括号、但里面是坏 JSON → 走「JSON 解析失败」那条，同样归 bad-json
    const brokenJson = parseCorrection('{ "errors": [, }', 'anything')
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
     */
    const systemPrompt = buildSystemPrompt()
    const missing = ERROR_CATEGORY_SPECS.filter((spec) => !systemPrompt.includes(spec.key))
    check(
      missing.length === 0,
      '每一个分类都出现在系统提示词里',
      missing.length > 0 ? `缺失：${missing.map((spec) => spec.key).join('、')}` : undefined,
    )
    check(
      ERROR_CATEGORY_SPECS.filter((spec) => spec.hard).every((spec) => systemPrompt.includes(spec.label)),
      '硬性分类的中文名都出现在提示词的颜色图例里',
    )
  } catch (error) {
    check(false, '错误分类表的一致性可以验证', error instanceof Error ? error.message : String(error))
  }

  return { checks, failures, skipped }
}
