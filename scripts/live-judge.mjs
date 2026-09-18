/**
 * 用真实 DeepSeek API 跑一次批改，检查提示词与解析器是否真的对得上。
 *
 * 这是开发期的人工检查工具，不进生产路径。它会打印：
 * - 批改用了几次尝试
 * - 分数、错误分类统计、亮点
 * - 每处批注的位置与片段（用来肉眼核对 AI 数序号准不准）
 * - 被丢弃的批注（位置对不上）
 *
 * 用法：node scripts/live-judge.mjs [用例编号 1..4]
 */

import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'node_modules', '.cache', 'live')
const outFile = path.join(outDir, 'live.mjs')

const caseIndex = Number(process.argv[2] ?? '1')

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
    `import { judgeAnswer, DEFAULT_JUDGE_CONFIG } from ${JSON.stringify(path.join(root, 'src/domain/ai.ts'))}`,
    `export { judgeAnswer, DEFAULT_JUDGE_CONFIG }`,
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

const { judgeAnswer, DEFAULT_JUDGE_CONFIG } = await import(pathToFileURL(outFile).href)
await rm(outDir, { recursive: true, force: true })

// 三个真实用例：英文长句、中文政策句、含中文标点的中文句
const CASES = [
  {
    name: '英译中 · 新闻',
    request: {
      direction: 'en-to-zh',
      genre: 'news',
      level: 'polish',
      source:
        'A decade of ecological restoration has turned a once barren coastline into a popular destination for migratory birds, drawing visitors from across the country.',
      referenceTranslation:
        '十年的生态修复让曾经荒芜的海岸线变成候鸟青睐的栖息地，吸引了全国各地的观鸟者。',
      answer:
        '十年生态修复把一个曾经贫瘠的海岸变成候鸟喜欢的到达地, 吸引了来自全国各地的游客。',
    },
  },
  {
    name: '中译英 · 政治文献',
    request: {
      direction: 'zh-to-en',
      genre: 'political',
      level: 'polish',
      source: '中国坚持绿水青山就是金山银山的理念，把生态文明建设放在突出地位。',
      referenceTranslation:
        'China upholds the vision that clear waters and lush mountains are invaluable assets, and gives ecological conservation a prominent place.',
      answer:
        'China insist on idea that green water and green mountains are gold and silver mountains, and put ecological civilization construction in prominent position.',
    },
  },
  {
    name: '中译英 · 政策（含术语与语体问题）',
    request: {
      direction: 'zh-to-en',
      genre: 'political',
      level: 'refine',
      source: '改革开放以来，她坚持自己的梦想，最终实现了它，尽管很多人曾怀疑她能否成功。',
      referenceTranslation:
        'Since the beginning of reform and opening up, she held fast to her dream and eventually made it come true, even though many people had doubted whether she could succeed.',
      answer:
        'In wake of reform, she insist her dream and finally make it come true, even though many people doubt that she can success.',
    },
  },
]

const chosen = CASES[(caseIndex - 1) % CASES.length]
console.log(`\n=== 用例 ${caseIndex}：${chosen.name} ===`)
console.log(`作答（${chosen.request.answer.length} 字符）：${chosen.request.answer}`)

const started = Date.now()
const outcome = await judgeAnswer(chosen.request, { ...DEFAULT_JUDGE_CONFIG, apiKey }, (info) => {
  console.log(`  ↻ 第 ${info.attempt} 次返回未通过校验，正在重试。原因：${info.problems.join('；')}`)
})
const elapsed = ((Date.now() - started) / 1000).toFixed(1)

if (!outcome.ok) {
  console.log(`\n✗ 批改失败（${outcome.kind}，用时 ${elapsed}s）`)
  console.log(`  ${outcome.message}`)
  if (outcome.rawExcerpt) console.log(`  原始返回片段：${outcome.rawExcerpt}`)
  process.exitCode = 1
} else {
  console.log(`\n✓ 批改成功（用时 ${elapsed}s，尝试 ${outcome.attempts} 次）`)
  console.log(`  总分 ${outcome.correction.total}｜术语 ${outcome.correction.dimensions.terminology}｜语法 ${outcome.correction.dimensions.grammar}｜连贯 ${outcome.correction.dimensions.coherence}｜语体 ${outcome.correction.dimensions.register}`)
  console.log(`  总评：${outcome.correction.summary}`)

  console.log(`\n  错误 ${outcome.validated.errors.length} 处：`)
  for (const entry of outcome.validated.errors) {
    const { error, span } = entry
    const where = `[${span.start},${span.end})`
    console.log(
      `    ${error.id} ${error.type}/${error.category} ${where} 「${error.anchor?.snippet ?? error.insertAfter?.snippet ?? ''}」` +
        (error.targetText ? ` → 「${error.targetText}」` : ''),
    )
    console.log(`        ${error.explanation}`)
  }

  console.log(`\n  亮点 ${outcome.validated.highlights.length} 处：`)
  for (const entry of outcome.validated.highlights) {
    console.log(`    ${entry.highlight.id} 「${entry.highlight.anchor.snippet}」—— ${entry.highlight.comment}`)
  }

  if (outcome.repaired.length > 0) {
    console.log(`\n  ⚠ 被丢弃的批注 ${outcome.repaired.length} 处：`)
    for (const item of outcome.repaired) console.log(`    ${item}`)
  }
}
