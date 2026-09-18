/**
 * 冒烟测试的运行器。
 *
 * 为什么不用 node 直接跑 TypeScript：Node 的类型剥离不做路径改写，
 * 而源码里的导入是无后缀写法（这是给浏览器构建用的）。这里先用 esbuild
 * 把测试和它依赖的领域模块打包成一个临时文件，再交给 Node 执行，
 * 这样源码本身不需要为了测试而改变导入风格。
 *
 * 用法：npm run smoke
 */

import { build } from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'node_modules', '.cache', 'smoke')
const outFile = path.join(outDir, 'smoke.mjs')

await mkdir(outDir, { recursive: true })
await writeFile(
  path.join(outDir, 'entry.ts'),
  `import { runSmokeTests } from ${JSON.stringify(path.join(root, 'scripts', 'smoke.ts'))}\n` +
    `const { checks, failures } = await runSmokeTests()\n` +
    `console.log(failures === 0 ? \`\\n\${checks} 项检查全部通过。\` : \`\\n\${checks} 项检查中有 \${failures} 项未通过。\`)\n` +
    `process.exitCode = failures === 0 ? 0 : 1\n`,
  'utf8',
)

await build({
  entryPoints: [path.join(outDir, 'entry.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx' },
  external: ['jsdom', 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  // 界面代码里引用了 CSS，Node 侧不需要它
  plugins: [
    {
      name: 'ignore-css',
      setup(build) {
        build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }))
        build.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }))
      },
    },
  ],
  logLevel: 'warning',
})

try {
  await import(pathToFileURL(outFile).href)
} finally {
  await rm(outDir, { recursive: true, force: true })
}

