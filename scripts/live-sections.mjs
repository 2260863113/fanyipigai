/**
 * 用真实 DeepSeek API 验证「按段并行批改」。
 *
 * 这个脚本专门检验文章模式新机制的两个要点：
 * 1. 整篇原文被拆成多段，每段一次请求并行发出（打印各段耗时，看是否真的并行）
 * 2. 各段返回的段内序号被正确换算到全文坐标（这是最容易错的一步）
 *
 * 用法：node scripts/live-sections.mjs
 */

import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'node_modules', '.cache', 'live-sections')
const outFile = path.join(outDir, 'live.mjs')

const devVars = await readFile(path.join(root, '.dev.vars'), 'utf8').catch(() => '')
const apiKey = devVars
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('DEEPSEEK_API_KEY='))
  .map((line) => line.slice('DEEPSEEK_API_KEY='.length).trim().replace(/^['"]|['"]$/g, ''))[0]

if (!apiKey) {
  console.error('没有在 .dev.vars 里找到 DEEPSEEK_API_KEY')
  process.exit(1)
}

await mkdir(outDir, { recursive: true })
await writeFile(
  path.join(outDir, 'entry.ts'),
  [
    `export { judgeAnswer, DEFAULT_JUDGE_CONFIG } from ${JSON.stringify(path.join(root, 'src/domain/ai.ts'))}`,
    `export { splitSections } from ${JSON.stringify(path.join(root, 'src/domain/sections.ts'))}`,
    `export { MOCK_CASES } from ${JSON.stringify(path.join(root, 'src/domain/mock.ts'))}`,
  ].join('\n'),
  'utf8',
)

await build({
  entryPoints: [path.join(outDir, 'entry.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})

const { judgeAnswer, DEFAULT_JUDGE_CONFIG, splitSections, MOCK_CASES } = await import(pathToFileURL(outFile).href)
await rm(outDir, { recursive: true, force: true })

// 用内置的英译中文章题：它本来就是多段的
const articleCase = MOCK_CASES.find((item) => item.exercise.id === 'article-001')
if (!articleCase) {
  console.error('找不到 article-001')
  process.exit(1)
}

const sourceSections = splitSections(articleCase.exercise.source)
const answerSections = splitSections(articleCase.sampleAnswer)

console.log(`\n=== 文章模式：按段并行批改 ===`)
console.log(`原文 ${sourceSections.length} 段，作答 ${answerSections.length} 段`)
if (sourceSections.length !== answerSections.length) {
  console.error(`段落数不一致（原文 ${sourceSections.length}，作答 ${answerSections.length}），无法一一对应`)
  process.exit(1)
}

const sections = answerSections.map((section) => ({ start: section.start, end: section.end, text: section.text }))
console.log(`并发上限：${DEFAULT_JUDGE_CONFIG.maxConcurrency}，每段最多尝试 ${DEFAULT_JUDGE_CONFIG.maxAttempts} 次\n`)

const started = Date.now()
const outcome = await judgeAnswer(
  {
    request: {
      source: articleCase.exercise.source,
      direction: articleCase.exercise.direction,
      genre: articleCase.exercise.genre,
      level: 'polish',
      referenceTranslation: articleCase.exercise.referenceTranslation,
    },
    sections,
  },
  { ...DEFAULT_JUDGE_CONFIG, apiKey },
  (info) => console.log(`  ↻ 第 ${info.sectionIndex} 段第 ${info.attempt} 次返回未通过校验，正在重试`),
)
const elapsed = ((Date.now() - started) / 1000).toFixed(1)

if (!outcome.ok) {
  console.log(`\n✗ 批改失败（${outcome.kind}，用时 ${elapsed}s）`)
  console.log(`  ${outcome.message}`)
  process.exitCode = 1
} else {
  console.log(`✓ 全篇批改完成，用时 ${elapsed}s（${outcome.sectionCount} 段，各段最多尝试 ${outcome.attempts} 次）`)
  console.log(`  错误 ${outcome.validated.errors.length} 处，亮点 ${outcome.validated.highlights.length} 处`)
  if (outcome.repaired.length > 0) console.log(`  被丢弃 ${outcome.repaired.length} 处`)

  // 关键验证：每处批注的全文序号，必须落在对应段落的区间内
  console.log(`\n  各段区间与落在其中的批注：`)
  sections.forEach((section, index) => {
    const inSection = outcome.validated.errors.filter((entry) => entry.span.start >= section.start && entry.span.end <= section.end)
    console.log(
      `    第 ${index + 1} 段 [${section.start}, ${section.end})　批注 ${inSection.length} 处` +
        (inSection.length > 0 ? `：${inSection.map((entry) => entry.error.category).join('、')}` : ''),
    )
  })

  const outside = outcome.validated.errors.filter(
    (entry) => !sections.some((section) => entry.span.start >= section.start && entry.span.end <= section.end),
  )
  console.log(
    outside.length === 0
      ? `\n  ✓ 所有批注都落在对应的段落区间内，段落起点换算正确`
      : `\n  ✗ 有 ${outside.length} 处批注落在段外，段落起点换算有问题：${outside.map((e) => e.error.id).join('、')}`,
  )
  if (outside.length > 0) process.exitCode = 1
}
