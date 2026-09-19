/**
 * 量一次批改到底花多少 token（临时脚本，量完把结论写进 README）。
 *
 * 三件事：
 *   1. 把「模型真正收到的那份文本」按题型拼出来，写成 JSON；
 *   2. 交给官方 tokenizer（deepseek_v4_tokenizer）精确数 token —— 不花钱；
 *   3. `--live` 时再用真实 API 跑一次句子题，读返回里的 usage —— 这是唯一能拿到
 *      "输出 token 到底多少"的办法，一次调用约 0.01–0.03 元。
 *
 * 用法：node scripts/measure-cost.mjs [--live]
 */

import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const cacheDir = path.join(root, 'node_modules', '.cache', 'cost')
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
const entry = path.join(cacheDir, 'entry.ts')
const outfile = path.join(cacheDir, 'out.mjs')

writeFileSync(
  entry,
  [
    `export { MOCK_CASES, fixtureCorrectionFor } from ${JSON.stringify(path.join(root, 'src/domain/mock.ts'))}`,
    `export { splitSections } from ${JSON.stringify(path.join(root, 'src/domain/sections.ts'))}`,
    `export { buildSystemPrompt, buildUserPrompt, buildSectionNote, buildRetryPrompt } from ${JSON.stringify(path.join(root, 'src/domain/prompt.ts'))}`,
    `export { toAiShape } from ${JSON.stringify(path.join(root, 'src/domain/parse.ts'))}`,
    `export { parseCorrection } from ${JSON.stringify(path.join(root, 'src/domain/parse.ts'))}`,
    `export { validateCorrection } from ${JSON.stringify(path.join(root, 'src/domain/validate.ts'))}`,
    `export { DEFAULT_JUDGE_CONFIG } from ${JSON.stringify(path.join(root, 'src/domain/ai.ts'))}`,
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

const mod = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`)
const { MOCK_CASES, fixtureCorrectionFor, splitSections, buildSystemPrompt, buildUserPrompt, buildSectionNote, toAiShape } = mod

const system = buildSystemPrompt()

/** 每种题型取题库里的第一道；文章题逐段拼（整篇原文 + 那一段译文）。 */
const byMode = new Map()
for (const item of MOCK_CASES) {
  const mode = item.exercise.mode
  if (!byMode.has(mode)) byMode.set(mode, item)
}

const prompts = { system, cases: [] }
for (const [mode, testCase] of byMode) {
  const { exercise, sampleAnswer } = testCase
  const base = {
    direction: exercise.direction,
    genre: exercise.genre,
    level: 'polish',
    source: exercise.source,
    answer: sampleAnswer,
  }
  const sections = splitSections(sampleAnswer)
  const correction = fixtureCorrectionFor(exercise.id, sampleAnswer)
  prompts.cases.push({
    mode,
    id: exercise.id,
    answer: sampleAnswer,
    sourceChars: exercise.source.length,
    answerChars: sampleAnswer.length,
    sections: sections.length,
    system,
    user: buildUserPrompt(base),
    // 分段题：每一段的用户消息（整篇原文 + 这一段译文）
    sectionUsers: sections.map((section, index) =>
      buildUserPrompt({ ...base, answer: section.text }, buildSectionNote(index + 1, sections.length)),
    ),
    // 输出侧只能估：用内置示例的字段形状与解释长度当基准（真实返回同形）
    sampleOutput: correction ? JSON.stringify(toAiShape(correction), null, 2) : '',
  })
}

writeFileSync(path.join(cacheDir, 'prompts.json'), JSON.stringify(prompts, null, 2), 'utf8')
console.log(`提示词已写到 ${path.join(cacheDir, 'prompts.json')}`)
console.log(`系统提示 ${system.length} 字符`)
for (const item of prompts.cases) {
  console.log(
    `  ${item.id}（${item.mode}）：原文 ${item.sourceChars} 字符 / 译文 ${item.answerChars} 字符 / ${item.sections} 段` +
      `，用户消息 ${item.user.length} 字符，示例返回 ${item.sampleOutput.length} 字符`,
  )
}

if (process.argv.includes('--live')) {
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

  const target = prompts.cases.find((item) => item.mode === 'sentence') ?? prompts.cases[0]
  /*
   * 思考模式默认是**开着**的（官方文档：thinking 默认 enabled、effort 默认 high），
   * 而思考 token 也按输出 token 计费 —— 一次批改的钱几乎全花在这里。
   * 用 --thinking=disabled 量一遍关掉之后的样子，好知道差多少。
   */
  const thinkingArg = process.argv.find((arg) => arg.startsWith('--thinking='))
  const thinking = thinkingArg ? thinkingArg.slice('--thinking='.length) : 'default'
  const body = {
    model: mod.DEFAULT_JUDGE_CONFIG.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: target.user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    stream: false,
    // 只有明确要求时才带这个参数：默认（不带）就是官方默认的"思考打开"
    ...(thinking === 'default' ? {} : { thinking: { type: thinking } }),
  }

  console.log(`\n真实调用一次（${target.id}，${mod.DEFAULT_JUDGE_CONFIG.model}，thinking=${thinking}）……`)
  const started = Date.now()
  const response = await fetch(`${mod.DEFAULT_JUDGE_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const parsed = JSON.parse(text)
  console.log(`HTTP ${response.status}，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log('usage =', JSON.stringify(parsed.usage ?? parsed.error ?? parsed, null, 2).slice(0, 1200))
  const content = parsed.choices?.[0]?.message?.content ?? ''
  console.log(`返回正文 ${content.length} 字符；finish_reason=${parsed.choices?.[0]?.finish_reason}`)
  writeFileSync(path.join(cacheDir, `live-output-${thinking}.txt`), content, 'utf8')
  writeFileSync(path.join(cacheDir, `live-usage-${thinking}.json`), JSON.stringify(parsed.usage ?? null, null, 2), 'utf8')
}

/*
 * 把已保存的那份真实返回过一遍解析/校验管线：关掉思考之后省下的钱值不值，
 * 取决于它返回的东西还能不能通过校验。不带 --live 也跑（读上次存下的正文），
 * 这样检查本身不花钱。
 */
const targetCase = prompts.cases.find((item) => item.mode === 'sentence') ?? prompts.cases[0]
for (const thinking of ['default', 'enabled', 'disabled']) {
  const file = path.join(cacheDir, `live-output-${thinking}.txt`)
  let content = ''
  try {
    content = await readFile(file, 'utf8')
  } catch {
    continue
  }
  if (!content.trim()) continue
  const check = mod.parseCorrection(content, targetCase.answer)
  console.log(`\n[thinking=${thinking}] ${targetCase.id} 的真实返回过一遍管线：`)
  if (!check.ok) {
    console.log(`  ⚠ 没过解析：${check.problems.join('；')}`)
    continue
  }
  const validated = mod.validateCorrection(check.correction.errors, check.correction.highlights, targetCase.answer)
  console.log(
    `  ✓ 通过解析与校验：${check.correction.errors.length} 处批注，` +
      `其中 ${validated.errors.length} 处位置对得上、${validated.rejections.length} 处被拒`,
  )
}

// 产物留在 node_modules/.cache/cost 里（数 token 的脚本还要读 prompts.json）
console.log(
  `\n产物目录：${cacheDir}\n` +
    `精确数 token：用官方 tokenizer 数 prompts.json（下载 https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip，\n` +
    `pip install tokenizers 之后 Tokenizer.from_file('tokenizer.json') 即可）。\n` +
    `不装 Python 也能用官方换算比例估：英文约 0.3 token/字符、中文约 0.6 token/字符。`,
)
