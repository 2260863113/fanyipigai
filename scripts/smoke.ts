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

  // 反向验证：故意把位置写错，校验器必须发现并拒绝
  console.log('\n[反向验证] 故意把批注位置写错')
  const target = MOCK_CASES[0]
  if (target) {
    const correction = fixtureCorrectionFor(target.exercise.id, target.sampleAnswer)

    const offset = correction.errors.find((e) => e.anchor)
    if (offset?.anchor) {
      const shifted = { start: offset.anchor.start + 1, end: offset.anchor.end + 1, snippet: offset.anchor.snippet }
      const reverse = validateCorrection([{ ...offset, anchor: shifted }], [], target.sampleAnswer)
      check(reverse.rejections.length === 1, '位置整体偏移一个字符的批注被拒绝了')
      check(reverse.errors.length === 0, '被拒绝的批注没有被拿去渲染')
      console.log(`    拒绝原因：${reverse.rejections[0]?.message ?? '（无）'}`)
    }

    const mismatched = correction.errors.find((e) => e.anchor)
    if (mismatched?.anchor) {
      const wrong = { ...mismatched, anchor: { ...mismatched.anchor, snippet: '这段文字根本不存在' } }
      const reverse = validateCorrection([wrong], [], target.sampleAnswer)
      check(reverse.rejections.length === 1, '片段与位置不匹配的批注被拒绝了')
    }

    const insert = correction.errors.find((e) => e.insertAfter)
    if (insert?.insertAfter) {
      const wrong = { ...insert, insertAfter: { ...insert.insertAfter, start: 0, end: 0, snippet: 'x' } }
      const reverse = validateCorrection([wrong], [], target.sampleAnswer)
      check(reverse.rejections.length === 1, '插入锚点位置错误的批注被拒绝了')
    }
  }

  // 界面渲染：类型正确不等于能渲染出来，白屏是用户无法自行修复的故障
  console.log('\n[界面渲染] 在 jsdom 中挂载界面并走一遍提交 → 批改 → 点批注')
  try {
    const rendered = await renderApp()
    check(rendered.html.length > 0, '界面渲染出了内容')
    check(rendered.judgeCalls === 1, `提交后调用了批改接口 ${rendered.judgeCalls} 次`)

    const markCount = (rendered.html.match(/class="mk /g) ?? []).length
    check(markCount > 0, `渲染出了 ${markCount} 个批注标记`)

    check(rendered.text.includes('错误归类'), '批改结果里出现了错误归类')
    check(rendered.text.includes('/ 100'), '批改结果里出现了总分')
    check(!rendered.text.includes('未能标出'), '没有批注因位置错误被拒绝')
    check(rendered.html.includes('detail') && rendered.html.includes('说明'), '点击批注后详情面板给出了说明')
    check(rendered.html.includes('官方建议用时'), '题目里显示了官方建议用时')
  } catch (error) {
    check(false, '界面渲染没有抛出异常', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
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
