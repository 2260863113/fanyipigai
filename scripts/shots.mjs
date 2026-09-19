/**
 * 单独生成界面截屏（与 npm run smoke 里跑的是同一套代码）。
 *
 * 用法：node scripts/shots.mjs
 * 产物：.screenshots/ 下的三张图（已 gitignore）。
 *
 * 说明：第二张是**真的点了提交按钮之后**的界面——脚本会在页面里注入一个接口桩，
 * 把 /api/judge 的响应换成本地假批改，所以截屏不花 API 钱，
 * 但走的是与真实批改完全相同的校验与渲染代码。
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

// 用 esbuild 打包后再跑，这样能直接复用 src/domain 里的 TypeScript 模块
const { build } = await import('esbuild')
const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
const { pathToFileURL } = await import('node:url')

const cacheDir = path.join(root, 'node_modules', '.cache', 'shots')
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
const entry = path.join(cacheDir, 'entry.ts')
const outfile = path.join(cacheDir, 'entry.mjs')

writeFileSync(
  entry,
  [
    `import { captureScreens } from ${JSON.stringify(path.join(root, 'scripts', 'visual.ts'))}`,
    `const result = await captureScreens([`,
    `  { name: '01-compose', width: 1600, height: 950, action: 'plain' },`,
    `  { name: '02-result', width: 1600, height: 950, action: 'submit', clickMark: 0 },`,
    `  { name: '03-marks', width: 1600, height: 950, action: 'submit', exerciseId: 'sentence-002', clickTab: '句子', clickMark: 0 },`,
    `  { name: '04-mobile', width: 420, height: 900, action: 'plain' },`,
    `])`,
    `if (!result.ok) { console.log('截屏未完成：' + (result.note ?? '未知原因')); process.exitCode = 1 }`,
    `for (const file of result.files) console.log('  ' + file)`,
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
  external: ['ws', 'esbuild'],
  logLevel: 'warning',
})

const run = spawnSync(process.execPath, [outfile], { cwd: root, stdio: 'inherit' })
rmSync(cacheDir, { recursive: true, force: true })
rmSync(path.join(root, 'node_modules', '.cache', 'fixture-payload'), { recursive: true, force: true })
process.exitCode = run.status ?? 1
