/**
 * 算出截屏/离线演示用的批改结果。
 *
 * 直接复用领域模块与内置示例数据，因此响应体与真实接口**严格同形**（含已校验的区间），
 * 截出来的界面才与真实使用一致。
 *
 * 单独成模块是因为有两个使用者：scripts/visual.ts（随测试生成截屏）
 * 和 scripts/shots.mjs（专门看结果页）。两边都必须拿到同一份假批改。
 */

import { build } from 'esbuild'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

export async function buildFixturePayload(root) {
  const cacheDir = path.join(root, 'node_modules', '.cache', 'fixture-payload')
  rmSync(cacheDir, { recursive: true, force: true })
  mkdirSync(cacheDir, { recursive: true })
  const entry = path.join(cacheDir, 'entry.ts')
  const outfile = path.join(cacheDir, 'entry.mjs')

  const lines = [
    `import { MOCK_CASES, fixtureCorrectionFor } from ${JSON.stringify(path.join(root, 'src', 'domain', 'mock.ts'))}`,
    `import { splitSections } from ${JSON.stringify(path.join(root, 'src', 'domain', 'sections.ts'))}`,
    `import { validateCorrection } from ${JSON.stringify(path.join(root, 'src', 'domain', 'validate.ts'))}`,
    `const first = MOCK_CASES[0]`,
    `const answer = first.sampleAnswer`,
    `const correction = fixtureCorrectionFor(first.exercise.id, answer)`,
    `if (!correction) throw new Error('内置示例与作答对不上，无法构造假批改')`,
    `const checked = validateCorrection(correction.errors, correction.highlights, answer)`,
    // 默认题是分段的文章：截屏脚本需要逐段填入，所以这里把每段文字一起给出去
    `export const answerSections = splitSections(answer).map((s) => s.text)`,
    `export const payload = {`,
    `  ok: true, attempts: 1, repaired: [], sectionCount: answerSections.length,`,
    `  correction: { errors: correction.errors, highlights: correction.highlights },`,
    `  validated: {`,
    `    errors: checked.errors.map((e) => ({ error: e.error, span: e.span, insertPoint: e.insertPoint, reorderSpans: e.reorderSpans, reordered: e.reordered })),`,
    `    highlights: checked.highlights.map((h) => ({ highlight: h.highlight, span: h.span })),`,
    `    rejections: checked.rejections,`,
    `  },`,
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

  const mod = await import(pathToFileURL(outfile).href)
  return { payload: mod.payload, answerSections: mod.answerSections }
}
