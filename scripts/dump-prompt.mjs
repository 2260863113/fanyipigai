/**
 * 导出送给 AI 的完整提示词，方便直接阅读与逐句修改。
 *
 * 为什么要有这个脚本：提示词里有一部分是代码拼出来的（分类表、五种改法的示例），
 * 只在源码里读会漏掉拼接后的最终形态。这里输出的是**模型真正收到的那份文本**。
 *
 * 用法：
 *   node scripts/dump-prompt.mjs                打印到屏幕（批改 + 出题两套提示词）
 *   node scripts/dump-prompt.mjs --out           同时写入 docs/prompt-system.txt
 *   node scripts/dump-prompt.mjs --generation    只打印 AI 出题的那两段
 */

import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const cacheDir = path.join(root, 'node_modules', '.cache', 'dump-prompt')
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
const entry = path.join(cacheDir, 'entry.ts')
const outfile = path.join(cacheDir, 'out.mjs')

writeFileSync(
  entry,
  [
    `export { buildSystemPrompt, buildUserPrompt, buildSectionNote, buildRetryPrompt, buildGenerationSystemPrompt, buildGenerationUserPrompt } from ${JSON.stringify(
      path.join(root, 'src', 'domain', 'prompt.ts'),
    )}`,
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

const mod = await import(pathToFileURL(outfile).href)
rmSync(cacheDir, { recursive: true, force: true })

const system = mod.buildSystemPrompt()

// 用一份真实的上下文拼出用户消息，让导出结果与线上实际发送的一致
const exampleRequest = {
  source: 'Ecological civilization is a form of human progress in which people and nature coexist in harmony, and it has become an essential component of China’s development strategy.',
  answer:
    '生态文明是人与自然和谐共生的一种进步形式，这是中国式发展策略的关键一环',
  direction: 'en-to-zh',
  genre: 'news',
  level: 'polish',
}

const userFirst = mod.buildUserPrompt(exampleRequest)
const userSection = mod.buildUserPrompt(exampleRequest, mod.buildSectionNote(2, 4))

const banner = (title) => `\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}\n`

// AI 出题走的是另一套提示词（命题而不是改卷），一并导出，免得只在源码里找
const exampleGeneration = {
  direction: 'zh-to-en',
  genre: 'news',
  topic: '生态文明建设',
  mode: 'article',
}
const generationSystem = mod.buildGenerationSystemPrompt()
const generationUser = mod.buildGenerationUserPrompt(exampleGeneration)

const output = [
  banner('系统提示（system）—— 每次批改都会原样发送'),
  system,
  banner('用户消息（user）—— 单段题（句子 / 段落 / 术语）'),
  userFirst,
  banner('用户消息（user）—— 文章题的第 2 段（共 4 段）'),
  userSection,
  banner('重试消息（user）—— 上一次返回未通过校验时追加'),
  mod.buildRetryPrompt(['errors[4] 的 category 缺了这个字段。每一个 error 都必须有 category，取值只能是：…']),
  banner('AI 出题 · 系统提示（system）'),
  generationSystem,
  banner('AI 出题 · 用户消息（user）—— 例：中译英 · 新闻 · 生态文明建设 · 文章题'),
  generationUser,
].join('\n')

// --generation：只想看 AI 出题那两段时用（读起来短，改提示词时不用在一大篇里翻）
if (process.argv.includes('--generation')) {
  console.log([banner('AI 出题 · 系统提示（system）'), generationSystem, banner('AI 出题 · 用户消息（user）'), generationUser].join('\n'))
  process.exit(0)
}

const asFile = process.argv.includes('--out')
if (asFile) {
  const dir = path.join(root, 'docs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'prompt-system.txt'), `${output}\n`, 'utf8')
  console.log('已写入 docs/prompt-system.txt')
}

console.log(output)
