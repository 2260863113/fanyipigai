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
import { renderApp } from './render-probe'

// 本文件由 scripts/run-smoke.mjs 用 esbuild 打包后交给 Node 运行，
// 因此这里沿用与前端一致的无后缀导入写法。

let failures = 0
let checks = 0

function check(condition: boolean, label: string, detail?: string): void {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
    return
  }
  failures += 1
  console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
}

/** 检查同优先级的标注是否互相重叠；插入是零长度落点，允许与区间边界重合。 */
function findOverlaps(segments: TextSegment[]): string[] {
  const annotated = segments.filter((s) => s.errorId || s.highlightId)
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

export async function runSmokeTests(): Promise<{ checks: number; failures: number }> {
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
    check(rendered.composeStageHadInput, '提交前右屏是作答输入框')

    // 布局要求：左边整页原文，右边整页作答；提交后结果在右边同一个位置替换掉输入框
    check(
      rendered.modeTabLabels.join(',') === '文章,段落,句子,术语,练习记录',
      `顶部导航有四个题型与练习记录：${rendered.modeTabLabels.join(' / ')}`,
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

    const noteCount = (rendered.html.match(/class="note-item/g) ?? []).length
    check(noteCount > 0, `右下角列出了 ${noteCount} 条批注`)

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
    // 默认题是文章，示例里只有一处亮点，没有 errors 条目可点，验不了"点批注看解释"。
    console.log('\n[界面渲染 · 批注交互] 换成句子题重跑一遍')
    const sentence = await renderApp({ exerciseId: 'sentence-001' })
    check(sentence.judgeCalls === 1, '句子题也走通了提交 → 批改')
    check(sentence.answerPaneText.includes('i is'), '句子题提交后右上角显示了作答')
    const sentenceNotes = (sentence.html.match(/class="note-item/g) ?? []).length
    check(sentenceNotes >= 3, `句子题的右下角列出了 ${sentenceNotes} 条批注`)
    check(sentence.html.includes('说明'), '点击批注后详情面板给出了说明')
    check(!sentence.notesPaneHtml.includes('annotated-lines'), '句子题的右下清单里也没有重排译文')
    check(sentence.answerPaneHtml.includes('annotated-lines'), '句子题的右上译文上有批注')

    // 五种改法都要能画在译文上：替换（划掉 + 上方小字）、插入、删除（划掉）、
    // 整句重写、语序调换（配对弧线）。这道句子题的示例正好同时含替换、插入、删除。
    const sentenceMarks = sentence.answerPaneHtml.match(/class="mk /g) ?? []
    check(sentenceMarks.length >= 3, `右上译文上有 ${sentenceMarks.length} 处标注标记`)
    check(sentence.answerPaneHtml.includes('mk-delete'), '删除类在译文上有划线')
    check(
      sentence.answerPaneHtml.includes('mk-replace') && sentence.answerPaneHtml.includes('mk-fix'),
      '替换类划掉了原文并在上方给出正确写法',
    )

    // 插入类单独用那道插入题验证（sentence-002 的示例是漏介词与冠词）
    const insert = await renderApp({ exerciseId: 'sentence-002' })
    check(insert.answerPaneHtml.includes('mk-insert'), '插入类在译文上标出了补入位置')
    check(insert.answerPaneHtml.includes('mk-fix-inline'), '插入类给出了要补入的内容')
    insert.restore()

    // 调序弧线单独用那道语序题验证
    const reorder = await renderApp({ exerciseId: 'sentence-004' })
    check(
      reorder.answerPaneHtml.includes('mk-reorder') || reorder.answerPaneHtml.includes('data-reorder-owner'),
      '语序题在译文上标出了要调换的片段',
    )
    check(reorder.html.includes('arc-svg'), '语序题画出了配对弧线')
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
    sentence.restore()
  } catch (error) {
    check(false, '界面渲染没有抛出异常', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  }

  // 失败存档：这是后续优化提示词的主要依据，必须证明它真的会写下来
  console.log('\n[失败存档] 模拟一次 AI 返回坏 JSON，检查是否存档')
  try {
    const { judgeAnswer, DEFAULT_JUDGE_CONFIG } = await import('../src/domain/ai')
    const { FailureCollector, archiveFailure } = await import('../src/domain/archive')
    const { readFileSync, rmSync, existsSync, readdirSync } = await import('node:fs')
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
      referenceTranslation: '生态文明是一种人类进步形态。',
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

    const dir = path.join(process.cwd(), '.ai-failures')
    const before = existsSync(dir) ? new Set(readdirSync(dir).filter((n) => n.endsWith('.json'))) : new Set<string>()
    const saved = await archiveFailure(request, 'test-model', 'bad-json', collector, answerText, '冒烟测试写入')
    check(saved === undefined, '失败存档写入成功', saved ? `写入失败：${saved}` : undefined)

    const after = readdirSync(dir).filter((n) => n.endsWith('.json'))
    const created = after.find((name) => !before.has(name))
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
      rmSync(path.join(dir, created), { force: true })
    }
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
      { name: '02-result', width: 1600, height: 950, action: 'submit' },
      // 再用句子题截一张：它同时含替换、插入、删除三种标记，
      // 默认的文章题只有一处亮点，看不出标注长什么样
      { name: '03-marks', width: 1600, height: 950, action: 'submit', exerciseId: 'sentence-002', clickTab: '句子' },
      { name: '04-mobile', width: 420, height: 900, action: 'plain' },
    ])
    check(result.ok, result.ok ? `生成了 ${result.files.length} 张截屏` : `截屏未完成：${result.note ?? ''}`)
    for (const file of result.files) console.log(`    ${file}`)
  } catch (error) {
    check(false, '截屏流程可以执行', error instanceof Error ? error.message : String(error))
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

  return { checks, failures }
}
