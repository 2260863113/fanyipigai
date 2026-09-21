/**
 * 用真实 DeepSeek API 跑一次**大改档**，检查那套提示词与解析器是否真的对得上。
 *
 * 大改是另一条链路（整篇逐句重写 + 逐句解释 + AI 总评，见 domain/refine.ts），
 * 提示词、返回格式、解析器都是新的，因此它值得一次**真调用**——
 * 光靠桩测试只能证明"程序接得住一份形状正确的返回"，
 * 证明不了"模型真的会按这个格式返回"。
 *
 * 用法：node scripts/live-refine.mjs [用例编号 1..2]
 */
import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'node_modules', '.cache', 'live-refine')
const outFile = path.join(outDir, 'live-refine.mjs')

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
    `export { refineAnswer, DEFAULT_JUDGE_CONFIG } from ${JSON.stringify(path.join(root, 'src/domain/ai.ts'))}`,
    `export { buildRefineLines, changedSentenceCount } from ${JSON.stringify(path.join(root, 'src/domain/refine.ts'))}`,
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

const { refineAnswer, DEFAULT_JUDGE_CONFIG, buildRefineLines, changedSentenceCount } = await import(
  pathToFileURL(outFile).href
)
await rm(outDir, { recursive: true, force: true })

const CASES = [
  {
    name: '英译中 · 新闻（两句，含语法与表达问题）',
    request: {
      direction: 'en-to-zh',
      genre: 'news',
      level: 'refine',
      source:
        'A decade of ecological restoration has turned a once barren coastline into a popular destination for migratory birds, drawing visitors from across the country.',
      answer: '十年生态修复把一个曾经贫瘠的海岸变成候鸟喜欢的到达地, 吸引了来自全国各地的游客。',
    },
  },
  {
    name: '中译英 · 政治文献（含术语与语法硬伤）',
    request: {
      direction: 'zh-to-en',
      genre: 'political',
      level: 'refine',
      source: '中国坚持绿水青山就是金山银山的理念，把生态文明建设放在突出地位。另一方面，发展的成果要由人民共享。',
      answer:
        'China insist on idea that green water and green mountains are gold and silver mountains, and put ecological civilization construction in prominent position. Beside, the result of development should shared by people.',
    },
  },
]

const chosen = CASES[(caseIndex - 1) % CASES.length]
console.log(`\n=== 用例 ${caseIndex}：${chosen.name} ===`)
console.log(`原文：${chosen.request.source}`)
console.log(`作答（${chosen.request.answer.length} 字符）：${chosen.request.answer}`)

const started = Date.now()
const outcome = await refineAnswer(chosen.request, { ...DEFAULT_JUDGE_CONFIG, apiKey })
const elapsed = ((Date.now() - started) / 1000).toFixed(1)

if (!outcome.ok) {
  console.log(`\n✗ 大改失败（${outcome.kind}，用时 ${elapsed}s）`)
  console.log(`  ${outcome.message}`)
  if (outcome.problems?.length > 0) {
    console.log(`\n  全部失败原因（共 ${outcome.problems.length} 条）：`)
    for (const problem of outcome.problems) console.log(`    - ${problem}`)
  }
  if (outcome.rawExcerpt) console.log(`\n  原始返回片段：\n${outcome.rawExcerpt}`)
  process.exitCode = 1
} else {
  const { refine } = outcome
  console.log(`\n✓ 大改成功（用时 ${elapsed}s，尝试 ${outcome.attempts} 次）`)
  console.log(
    `  AI 总评 ${refine.score} / 100（逐句 ${refine.sentences.length} 条，其中改过 ${changedSentenceCount(refine)} 条）`,
  )
  console.log(`  评语：${refine.comment}`)

  console.log('\n  逐句：')
  for (const sentence of refine.sentences) {
    const mark = sentence.changed ? '改' : '留'
    console.log(`    [${mark}] ${sentence.id} 「${sentence.oldText}」`)
    if (sentence.changed) console.log(`         → 「${sentence.rewritten}」`)
    console.log(`         为什么：${sentence.explanation}`)
  }

  console.log('\n  对照视图会铺成：')
  for (const line of buildRefineLines(refine)) {
    const corrected = line.corrected.map((part) => part.text).join('')
    console.log(`    原译：${line.original}`)
    console.log(`    改后：${corrected}${line.changed ? '' : '（没改）'}`)
  }
}
