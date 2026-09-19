/**
 * 算出截屏/离线演示用的批改结果。
 *
 * 直接复用领域模块与内置示例数据，因此响应体与真实接口**严格同形**（含已校验的区间），
 * 截出来的界面才与真实使用一致。
 *
 * 默认算的是题库第一道题（打开页面时的那一篇）；也可以指定题目编号，
 * 这样切到别的题型截图时能拿到对应那道题的批改。
 */

import { build } from 'esbuild'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

export async function buildFixturePayload(root, exerciseId) {
  const cacheDir = path.join(root, 'node_modules', '.cache', 'fixture-payload')
  rmSync(cacheDir, { recursive: true, force: true })
  mkdirSync(cacheDir, { recursive: true })
  const entry = path.join(cacheDir, 'entry.ts')
  const outfile = path.join(cacheDir, 'entry.mjs')

  const lines = [
    `import { MOCK_CASES, fixtureCorrectionFor } from ${JSON.stringify(path.join(root, 'src', 'domain', 'mock.ts'))}`,
    `import { splitSections } from ${JSON.stringify(path.join(root, 'src', 'domain', 'sections.ts'))}`,
    `import { validateCorrection } from ${JSON.stringify(path.join(root, 'src', 'domain', 'validate.ts'))}`,
    `import { toAiShape } from ${JSON.stringify(path.join(root, 'src', 'domain', 'parse.ts'))}`,
    `const wanted = ${JSON.stringify(exerciseId ?? null)}`,
    `const testCase = wanted ? MOCK_CASES.find((c) => c.exercise.id === wanted) : MOCK_CASES[0]`,
    `if (!testCase) throw new Error('找不到题目：' + wanted)`,
    `export const answer = testCase.sampleAnswer`,
    `const correction = fixtureCorrectionFor(testCase.exercise.id, answer)`,
    `if (!correction) throw new Error('内置示例与作答对不上，无法构造假批改')`,
    `const checked = validateCorrection(correction.errors, correction.highlights, answer)`,
    // 分段题需要逐段填入，所以这里把每段文字一起给出去
    `export const answerSections = splitSections(answer).map((s) => s.text)`,
    `export const payload = {`,
    `  ok: true, attempts: 1, repaired: [], sectionCount: answerSections.length,`,
    `  correction: { errors: correction.errors, highlights: correction.highlights },`,
    `  validated: {`,
    `    errors: checked.errors.map((e) => ({ error: e.error, changes: e.changes, span: e.span, insertPoint: e.insertPoint, reorderSpans: e.reorderSpans, reordered: e.reordered })),`,
    `    highlights: checked.highlights.map((h) => ({ highlight: h.highlight, span: h.span })),`,
    `    rejections: checked.rejections,`,
    `  },`,
    `  raw: JSON.stringify(toAiShape(correction), null, 2),`,
    `}`,
  ]
  writeFileSync(entry, `${lines.join('\n')}\n`, 'utf8')

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
  })

  // 必须在 URL 上加一个每次不同的查询参数：
  // bundle 固定写到同一个 outfile，而 Node 会按 URL 缓存已导入的模块，
  // 于是第二次调用会拿到第一次的导出（实际踩过——切成句子题却仍拿到文章的 4 段作答）。
  const mod = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${Math.random()}`)
  return { payload: mod.payload, answerSections: mod.answerSections, answer: mod.answer ?? null }
}
