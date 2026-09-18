/**
 * 把批注渲染成纯文本，用来直观检查"划掉的内容"与"上方写的内容"有没有重复。
 *
 * 为什么需要它：DOM 结构再正确，读起来是否重复只有把文本摊平才看得清。
 * 每个片段按渲染后的样子打印：
 *   [[划掉的旧文字]]⟦上方写的正确写法⟧   或   ｛补入的内容｝   或   ＋亮点＋
 *
 * 走的是与界面完全相同的路径（示例经 fixtureCorrectionFor → 校验 → 排版），
 * 因此这里看到的重复，就是界面上会看到的重复。
 *
 * 用法：node scripts/inspect-marks.mjs
 */

import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = process.cwd()
const cacheDir = path.join(root, 'node_modules', '.cache', 'inspect-marks')
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
const entry = path.join(cacheDir, 'entry.ts')
const outfile = path.join(cacheDir, 'out.mjs')

writeFileSync(
  entry,
  [
    `import { MOCK_CASES, fixtureCorrectionFor } from ${JSON.stringify(path.join(root, 'src/domain/mock.ts'))}`,
    `import { validateCorrection } from ${JSON.stringify(path.join(root, 'src/domain/validate.ts'))}`,
    `import { buildLayout } from ${JSON.stringify(path.join(root, 'src/domain/layout.ts'))}`,
    `export function prepare() {`,
    `  return MOCK_CASES.map((testCase) => {`,
    `    const answer = testCase.sampleAnswer`,
    `    try {`,
    `      const correction = fixtureCorrectionFor(testCase.exercise.id, answer)`,
    `      if (!correction) return { id: testCase.exercise.id, error: '示例解析失败（返回空）' }`,
    `      const validated = validateCorrection(correction.errors, correction.highlights, answer)`,
    `      return { id: testCase.exercise.id, correction, layout: buildLayout(validated, answer) }`,
    `    } catch (e) {`,
    `      return { id: testCase.exercise.id, error: String(e && e.message ? e.message : e) }`,
    `    }`,
    `  })`,
    `}`,
  ].join('\n'),
  'utf8',
)

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})

const { prepare } = await import(pathToFileURL(outfile).href)
rmSync(cacheDir, { recursive: true, force: true })

function flatten(segments) {
  return segments
    .map((segment) => {
      switch (segment.kind) {
        case 'delete':
          return `[[${segment.deletedText ?? segment.text}]]`
        case 'replace':
        case 'rewrite':
          return `[[${segment.deletedText ?? segment.text}]]⟦${segment.targetText ?? ''}⟧`
        case 'insert':
          return `｛${segment.targetText ?? ''}｝`
        case 'highlight':
          return `＋${segment.text}＋`
        default:
          return segment.text
      }
    })
    .join('')
}

let problems = 0

for (const item of prepare()) {
  if (item.error) {
    problems += 1
    console.log(`\n=== ${item.id} ===\n  ✗ ${item.error}`)
    continue
  }

  const { id, correction, layout } = item
  if (correction.errors.length === 0) continue

  const flat = flatten(layout.segments)
  console.log(`\n=== ${id} ===`)
  console.log(flat)

  for (const error of correction.errors) {
    const from = error.changed?.from ?? ''
    const to = error.changed?.to ?? ''
    // 划掉的文字里若含"上方要写的内容"，就是重复
    if (from && to && to.length >= 2 && from.includes(to)) {
      problems += 1
      console.log(`  ⚠ ${error.id}：划掉「${from}」，上方「${to}」——划掉的里含上方要写的内容`)
    }
  }

  // 渲染结果里出现连续重复的词（如 "on  on"）也算重复
  const repeated = flat.match(/([\p{L}\p{N}]{2,})(\s+\1\b)/gu)
  if (repeated) {
    problems += 1
    console.log(`  ⚠ 渲染结果里出现连续重复：${JSON.stringify(repeated)}`)
  }
}

console.log(problems === 0 ? '\n没有发现重复。' : `\n共发现 ${problems} 处可疑重复。`)
