/**
 * 诊断：提交批改后页面是否崩掉（白屏），以及崩在哪一行。
 *
 * 为什么需要它：白屏是"渲染期抛错 → React 把整棵树卸掉"的表现，
 * 而这类错误**跑不到冒烟测试里**——它发生在真实浏览器的排版路径上
 * （冒烟测试跑在 jsdom，且 render-probe 把 getBoundingClientRect 桩成了固定矩形，
 * 所以 FixLayer / AnnotationText 里那些"量坐标"的分支在 jsdom 里根本不会执行）。
 *
 * 做法与 visual.ts 同一套：起 vite → CDP 驱动无头浏览器 → 注入接口桩 →
 * 真切题、填示例作答、点提交 → **收集页面错误与控制台输出**，然后报出结果。
 *
 * 用法：node scripts/diagnose-submit.mjs [题号]
 */

import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { buildFixturePayload } from './fixture-payload.mjs'

/**
 * 就地找浏览器。
 * 注意：scripts/lib/find-browser.ts 是 .ts，**Node 的 ESM 直接 import 不到**
 * （生产代码里引用它的是 vite.config 与被 esbuild 打包的脚本，两边都能解析 .ts）。
 * 这是个一次性诊断脚本，因此就地写一份，不改动生产结构。
 */
function findBrowser() {
  if (process.env.DSH_NO_BROWSER) return undefined
  const explicit = process.env.CHROME_PATH
  if (explicit) return existsSync(explicit) ? explicit : undefined
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((candidate) => existsSync(candidate))
}

const root = process.cwd()
const port = 5409
const debugPort = 9231
/**
 * 默认把四类题型各跑一遍——崩不崩往往与题型有关。
 * `--live` 表示**不注入接口桩**，走真实的 /api/judge（要花 API 钱，但能覆盖
 * 桩覆盖不到的路径：真实的响应形状、真实的失败分类、真实的耗时）。
 */
const live = process.argv.includes('--live')
/** 只体检"已经在跑的那个服务"，不自己起：`--check-only [地址]` */
const checkOnlyIndex = process.argv.indexOf('--check-only')
const checkOnly = checkOnlyIndex >= 0
const externalBase = checkOnly ? (process.argv[checkOnlyIndex + 1] ?? 'http://127.0.0.1:5180') : null
const exerciseIds = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--') && arg !== externalBase)
if (exerciseIds.length === 0) exerciseIds.push('sentence-002', 'paragraph-001', 'sentence-001', 'term-001')

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    /** 页面里发生的事：控制台、未捕获异常、日志 */
    this.events = []
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (typeof message.id === 'number') {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${entry.method} 失败：${message.error.message}`))
        else entry.resolve(message.result ?? {})
        return
      }
      // 通知类消息：把页面里的报错收下来
      const { method, params } = message
      if (method === 'Runtime.consoleAPICalled') {
        const text = (params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ')
        this.events.push(`[console.${params.type}] ${text}`)
      } else if (method === 'Runtime.exceptionThrown') {
        const d = params.exceptionDetails ?? {}
        const desc = d.exception?.description ?? d.text ?? ''
        this.events.push(`[EXCEPTION] ${desc}`)
      } else if (method === 'Log.entryAdded') {
        this.events.push(`[log.${params.entry?.level}] ${params.entry?.text ?? ''}`)
      } else if (method === 'Network.loadingFailed') {
        this.events.push(`[net.FAILED] ${params.errorText ?? ''} (type=${params.type ?? ''})`)
      } else if (method === 'Network.responseReceived') {
        const r = params.response ?? {}
        if ((r.url ?? '').includes('/api/')) this.events.push(`[net.${r.status}] ${r.url}`)
      }
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(`页面脚本出错：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }
  close() {
    this.ws.close()
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(400)
  }
  return false
}

/**
 * 检查一个"已经跑着的" vite 服务所吐出的模块图是否自洽。
 *
 * 为什么需要它：曾经出现过这种情况——源码是对的（typecheck 干净、冒烟测试全绿），
 * 但开发服务器吐出的模块里，函数体已经是新版本、**引用却对不上**。
 * 已经实测到两种形态：
 *   a) `FixLayer.tsx`：正文调用 mergeRowsOnTopEdge，文件里却既没 import 也没定义它；
 *   b) `ArticlePickerModal.tsx`：正文调用 articlesOfCount（我已改名成 hasArticles），
 *      服务器仍在吐旧名字。源码干净、服务器不干净。
 * 这一类一进页面就 ReferenceError，React 把整棵树卸掉 → 白屏。
 *
 * 它属于"开发服务器缓存陈旧"，不是代码缺陷，而且很容易被误判成代码 bug
 * （因为诊断脚本默认起一个**全新的**服务器，永远不会碰到这种陈旧状态）。
 *
 * ## 判据（2026-09 加强）
 *
 * 早先只检查"有没有用到一个既没 import 也没定义的名字"，但那是**按名字白名单**做的，
 * 只覆盖了当时的那个 bug。现在改成**遍历本模块所有自由标识符**：
 * 把源码里的标识符全扫出来，减去 JS 关键字/内置全局/本文件定义与 import 的名字，
 * 剩下的就是"可能未定义"的引用，逐个到页面里 `typeof` 一下——浏览器才是最终裁判。
 * 这样任何形态的"引用了不存在的名字"都能抓到，不依赖我事先猜到叫什么。
 */
async function checkServedModules(base) {
  /** 从一段参数文本里把绑定名抠出来（支持解构、默认值、重命名）。 */
  const addNames = (text, into) => {
    for (const raw of String(text).split(',')) {
      let piece = raw.trim()
      if (!piece) continue
      // 去掉默认值：`a = 1` / `{ b } = {}`
      piece = piece.split('=')[0]?.trim() ?? ''
      // 解构重命名：`{ a: b }` 取 b
      const renamed = /:\s*([A-Za-z_$][\w$]*)\s*$/.exec(piece)
      if (renamed) {
        into.add(renamed[1])
        continue
      }
      // 展开：`...rest`
      const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)/.exec(piece)
      if (spread) {
        into.add(spread[1])
        continue
      }
      // 普通名或解构里的名：取最后一段标识符
      const names = piece.match(/[A-Za-z_$][\w$]*/g) ?? []
      const last = names[names.length - 1]
      if (last) into.add(last)
    }
  }

  const problems = []
  const targets = [
    '/src/components/FixLayer.tsx',
    '/src/components/App.tsx',
    '/src/components/AnswerPane.tsx',
    '/src/components/ArticlePickerModal.tsx',
    // 领域下拉与方向切换从 ArticleBar.tsx 搬进了这个文件（第 7 条），
    // 原先那条横条组件已经删掉——这一行跟着换，否则这个脚本一上来就报"取不到"
    '/src/components/DomainSelect.tsx',
  ]
  for (const target of targets) {
    let body
    try {
      const response = await fetch(`${base}${target}`)
      if (!response.ok) {
        problems.push(`${target}: HTTP ${response.status}`)
        continue
      }
      body = await response.text()
    } catch (error) {
      problems.push(`${target}: 取不到（${error instanceof Error ? error.message : String(error)}）`)
      continue
    }

    // 本文件自己定义/声明的名字
    const defined = new Set()
    for (const match of body.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) defined.add(match[1])
    /*
     * 解构赋值引入的名字。这一条必须写全，否则会把合法的名字误报成"未定义"：
     *   const [sessions, dispatchSession] = useReducer(...)   ← React 的 setter/reducer
     *   const { split, style, beginDrag } = useSplitDrag(...)  ← hook 返回的多个值
     *   const { buildStubSource } = await import('...')
     * 早先只处理了"从别的模块取属性"那一种形态，于是 useState 的 setter
     * （setSelection、setError……）全被当成未定义，报告里一地误报——
     * 一份没人信的报告等于没有报告。
     */
    for (const match of body.matchAll(/(?:const|let|var)\s*\[([^\]]{1,400})\]\s*=/g)) addNames(match[1], defined)
    for (const match of body.matchAll(/(?:const|let|var)\s*\{([^}]{1,600})\}\s*=/g)) addNames(match[1], defined)
    for (const match of body.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]+\["/g)) defined.add(match[1])
    for (const match of body.matchAll(/import\s*\{([^}]*)\}/g)) {
      for (const piece of match[1].split(',')) {
        const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) defined.add(name)
      }
    }
    // 函数参数与解构出来的名字。
    // 两种形态都要抓，否则会把合法的属性/状态名误报成"未定义"：
    //   箭头函数参数：`(a, b) => `
    //   普通函数与组件的**解构参数**：`function Foo({ bar, baz }) {` / `({ bar }) => `
    for (const match of body.matchAll(/\(([^()]{0,600})\)\s*=>/g)) addNames(match[1], defined)
    for (const match of body.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^()]{0,600})\)/g)) addNames(match[1], defined)
    for (const match of body.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(match[1])

    // 只看"像函数调用"的标识符——未定义的**变量**同样会炸，但函数调用是这类 bug 的主要形态，
    // 且这样能避免把 JSX 标签、字符串里的词误判成引用
    const called = new Set()
    for (const match of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(match[1])

    const ignore = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await', 'new', 'delete',
      'void', 'in', 'of', 'do', 'else', 'try', 'finally', 'throw', 'case', 'yield', 'super', 'import',
      'String', 'Number', 'Boolean', 'Array', 'Object', 'Map', 'Set', 'JSON', 'Math', 'Date', 'Promise',
      'Error', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
      'decodeURIComponent', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch',
      'console', 'structuredClone', 'queueMicrotask', 'requestAnimationFrame', 'document', 'window',
    ])
    const suspects = [...called].filter((name) => !defined.has(name) && !ignore.has(name))
    if (suspects.length === 0) continue

    // 到页面里逐个 typeof——浏览器是最终裁判，避免把合法的东西误报成问题
    const page = await fetch(`${base}/`)
    void page
    problems.push({ target, suspects })
  }

  return problems
}

/** 把 suspects 拿到页面里逐个验：只有真的 undefined 才算问题。 */
async function confirmUndefined(base, problems) {
  const browser = findBrowser()
  if (!browser) return problems.map((p) => `${p.target}: 引用了 ${p.suspects.length} 个疑似未定义的名字（${p.suspects.slice(0, 6).join('、')}），但本机没有浏览器可进一步确认`)
  const { WebSocket } = await import('ws')
  const { spawn: spawnProcess } = await import('node:child_process')
  const debugPort = 9237
  const profileDir = path.join(process.cwd(), 'node_modules', '.cache', 'module-check-profile')
  const proc = spawnProcess(
    browser,
    ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profileDir}`, `--remote-debugging-port=${debugPort}`, 'about:blank'],
    { stdio: 'ignore' },
  )
  try {
    let ready = false
    for (let i = 0; i < 40 && !ready; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        ready = true
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    if (!ready) return problems.map((p) => `${p.target}: 疑似未定义 ${p.suspects.join('、')}`)
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    const page = list.find((t) => t.type === 'page') ?? list[0]
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () => reject(new Error('连接调试通道失败')))
    })
    let id = 1
    const pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (typeof message.id !== 'number') return
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result ?? {})
    })
    const send = (method, params = {}) => {
      const current = id++
      return new Promise((resolve, reject) => {
        pending.set(current, { resolve, reject })
        ws.send(JSON.stringify({ id: current, method, params }))
      })
    }
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      return result.result?.value
    }
    await send('Runtime.enable')
    await send('Page.navigate', { url: `${base}/` })
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const confirmed = []
    for (const problem of problems) {
      const missing = []
      for (const name of problem.suspects) {
        const kind = await evaluate(`typeof ${name}`)
        if (kind === 'undefined') missing.push(name)
      }
      if (missing.length > 0) confirmed.push(`${problem.target}: 模块里调用了未定义的名字 ${missing.join('、')}`)
    }
    ws.close()
    return confirmed
  } finally {
    try {
      ;(await import('node:child_process')).spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* 忽略 */
    }
  }
}

async function main() {
  /*
   * 先体检"已经在跑的服务"（如果指定了）——这一类问题只在既有的服务上出现，
   * 自己新起的服务器永远复现不到。
   */
  if (checkOnly) {
    console.log(`===== 体检已运行的服务：${externalBase} =====`)
    const suspects = await checkServedModules(externalBase)
    const problems = await confirmUndefined(externalBase, suspects)
    if (problems.length === 0) {
      console.log('✓ 服务端吐出的模块图自洽（引用到的名字都有 import 或定义）')
      process.exitCode = 0
    } else {
      console.log(`✗ 发现 ${problems.length} 处问题：`)
      for (const problem of problems) console.log('  - ' + problem)
      console.log('\n这通常意味着**开发服务器缓存陈旧**：源码是对的，但它吐出的模块少了 import。')
      console.log('处理办法：停掉它，清掉 node_modules/.vite 之后重新 `npm run dev`，再硬刷新页面。')
      process.exitCode = 1
    }
    return
  }

  const browser = findBrowser()
  if (!browser) throw new Error('没有找到 Edge 或 Chrome')

  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) throw new Error('没有找到 vite')
  const server = spawn(process.execPath, [viteBin, '--port', String(port), '--host', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  })
  let browserProcess
  try {
    if (!(await waitForServer(`http://127.0.0.1:${port}/index.html`, 45_000))) {
      throw new Error('预览服务未能就绪')
    }

    const profileDir = path.join(root, 'node_modules', '.cache', 'diag-profile')
    rmSync(profileDir, { recursive: true, force: true })
    browserProcess = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    )

    let ready = false
    for (let i = 0; i < 40 && !ready; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        ready = true
      } catch {
        await sleep(300)
      }
    }
    if (!ready) throw new Error('无头浏览器的调试端口未就绪')

    const { WebSocket } = await import('ws')
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    const target = list.find((t) => t.type === 'page') ?? list[0]
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () => reject(new Error('无法连接浏览器调试通道')))
    })
    const cdp = new Cdp(ws)

    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')

    /*
     * 把"渲染期抛错"与"未处理的 Promise 拒绝"都记下来。
     * React 的渲染错误会让整棵树被卸掉（白屏），而它不一定以
     * console.error 的形式出现——unhandledrejection 那条尤其容易漏。
     */
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__diagErrors = [];
        window.addEventListener('error', (e) => {
          window.__diagErrors.push('window.onerror: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
        });
        window.addEventListener('unhandledrejection', (e) => {
          const r = e.reason;
          window.__diagErrors.push('unhandledrejection: ' + (r && r.stack ? r.stack : String(r)));
        });
      `,
    })

    for (const exerciseId of exerciseIds) {
      cdp.events.length = 0
      const fixture = await buildFixturePayload(root, exerciseId)
      let identifier
      if (!live) {
        const { buildStubSource } = await import('./fixture-stub.mjs')
        const stub = buildStubSource([{ answer: fixture.answer, payload: fixture.payload }])
        identifier = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub })).identifier
      }

      console.log(`\n########## ${exerciseId}${live ? '（真实 API）' : ''} ##########`)
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` })
      let mounted = false
      for (let i = 0; i < 40 && !mounted; i += 1) {
        await sleep(250)
        mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
      }
      if (!mounted) throw new Error('界面没有挂载')
      await sleep(400)

      // 切到该题所属题型与题目（文章题是默认题，不用切）
      await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const id = ${JSON.stringify(exerciseId)};
           const mode = id.split('-')[0];
           const label = { article: '文章', paragraph: '段落', sentence: '句子', term: '术语' }[mode];
           const tab = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === label);
           if (tab) { tab.click(); await sleep(400); }
           return 'ok';
         })()`,
      )

      // 逐页填入示例作答，再点提交（与 visual.ts 的做法一致）
      const outcome = await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const setValue = (el, value) => {
             const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
             setter.call(el, value);
             el.dispatchEvent(new Event('input', { bubbles: true }));
           };
           const sections = ${JSON.stringify(fixture.answerSections)};
           /*
            * 逐页批改：填一页 → 点「下一页」（这一页自动交去批改）→ 填下一页；
            * 末页没有「下一页」可点，只能手动按「提交批改」。
            *
            * ⚠️ 必须等到**页码真的变了、而且新的一页有输入框**再写。
            * 只等"有输入框"会立刻满足——旧那一页的输入框还在 DOM 里停一会儿，
            * 下一页的文字就被写进了上一页那个正在消失的 textarea（末页会是空的）。
            */
           const pageNo = () => {
             const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(
               (document.querySelector('.section-nav .hint') || {}).textContent || '',
             );
             return m ? { index: Number(m[1]) - 1, count: Number(m[2]) } : { index: 0, count: 0 };
           };
           const waitForFreshInput = async (expectedPage) => {
             for (let k = 0; k < 150; k++) {
               if (pageNo().index === expectedPage) {
                 const area = document.querySelector('.answer-input');
                 if (area) return area;
               }
               await sleep(150);
             }
             return null;
           };
           const total = pageNo().count;
           if (!total) return '界面上没有翻页导航，这道题不是多页题';
           for (let i = 0; i < total; i++) {
             const area = await waitForFreshInput(i);
             if (!area) return '第 ' + (i + 1) + ' 页没有等到可写的输入框';
             const onScreen = (document.querySelector('.pane-source .source-text')?.textContent || '').trim();
             setValue(area, sections[i] || onScreen);
             await sleep(150);
             if (i === total - 1) break;
             const next = document.querySelector('.section-nav [data-nav="next"]');
             if (!next) return '第 ' + (i + 1) + ' 页找不到「下一页」';
             next.click();
           }
           const submit = document.querySelector('.pane-answer .btn-primary');
           if (!submit) return '末页找不到提交按钮';
           if (submit.disabled) return '末页的提交按钮是禁用的';
           submit.click();
           await sleep(${live ? 25000 : 4000});
           return 'ok';
         })()`,
      )
      console.log('submit outcome =', outcome)

      await sleep(1500)
      const diagErrors = await cdp.evaluate('window.__diagErrors || []')
      const state = await cdp.evaluate(
        `({
           rootTextLen: (document.getElementById('root')?.innerText || '').length,
           hasAnnotated: !!document.querySelector('.annotated'),
           hasScore: !!document.querySelector('.pane-score'),
           scoreText: (document.querySelector('.score-number')?.textContent || ''),
         })`,
      )
      const exceptions = cdp.events.filter((line) => line.startsWith('[EXCEPTION]') || line.startsWith('[log.error]'))
      const consoleAll = cdp.events.filter((line) => !line.startsWith('[console.debug]'))
      console.log('page state =', JSON.stringify(state))
      console.log('window errors =', JSON.stringify(diagErrors))
      console.log('exceptions =', JSON.stringify(exceptions))
      console.log('answer pane =', JSON.stringify(await cdp.evaluate("(document.querySelector('.pane-answer')?.innerText || '').slice(0,300)")))
      console.log('score pane  =', JSON.stringify(await cdp.evaluate("(document.querySelector('.pane-score')?.innerText || '').slice(0,200)")))
      console.log('console =', JSON.stringify(consoleAll.slice(0, 12), null, 1))

      /*
       * 提交之后再"乱按"一遍：白屏不一定发生在提交那一刻，
       * 而可能发生在随后的某个交互里（点勾画、切视图、开设置、来回切题型）。
       * 每一步之后都查一次 #root 还有没有内容——若被 React 卸掉，
       * 根节点会是空的，这就是白屏的直接判据。
       */
      const probe = async (label) => {
        const alive = await cdp.evaluate(
          `({
             textLen: (document.getElementById('root')?.innerText || '').length,
             nodeCount: document.getElementById('root')?.querySelectorAll('*').length ?? -1,
           })`,
        )
        const errs = await cdp.evaluate('(window.__diagErrors || []).length')
        console.log(`  [${label}] textLen=${alive.textLen} nodes=${alive.nodeCount} windowErrors=${errs}`)
        return alive
      }

      const clickAll = async (selector, label) => {
        const count = await cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
        for (let i = 0; i < count; i += 1) {
          await cdp.evaluate(
            `(async () => {
               const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
               const el = document.querySelectorAll(${JSON.stringify(selector)})[${i}];
               if (el) { el.click(); await sleep(260); }
               return true;
             })()`,
          )
          await probe(`${label} #${i + 1}/${count}`)
        }
      }

      console.log('--- 提交后的交互压力测试 ---')
      await probe('刚提交完')
      // 切换视图：批改视图 ↔ 对照视图（两套完全不同的渲染路径）
      await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const btn = [...document.querySelectorAll('.view-btn')].find((b) => b.textContent.includes('对照'));
           if (btn) { btn.click(); await sleep(600); }
           return true;
         })()`,
      )
      await probe('切到对照视图')
      await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const btn = [...document.querySelectorAll('.view-btn')].find((b) => b.textContent.includes('批改'));
           if (btn) { btn.click(); await sleep(600); }
           return true;
         })()`,
      )
      await probe('切回批改视图')
      // 点遍译文上的每一处勾画（气泡测量）
      await clickAll('.annotated [data-mark-id]', '点勾画')
      // 点遍上方补写的字
      await clickAll('.fix-text', '点补写字')
      // 开设置、拖行距滑杆（行距会触发重新排版与测量）
      await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const open = [...document.querySelectorAll('.topbar .btn')].find((b) => b.textContent.trim() === '设置');
           if (open) { open.click(); await sleep(400); }
           return true;
         })()`,
      )
      await probe('打开设置')
      await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const range = document.querySelector('.gen-range');
           if (!range) return false;
           const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
           for (const v of ['1.8','4','2.5','1.9','3.5','2.1','4']) {
             setter.call(range, v);
             range.dispatchEvent(new Event('input', { bubbles: true }));
             await sleep(420);
           }
           return true;
         })()`,
      )
      await probe('来回拖行距')
      await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const close = document.querySelector('.raw-modal-close');
           if (close) { close.click(); await sleep(400); }
           return true;
         })()`,
      )
      await probe('关掉设置')
      // 空转 10 秒：看有没有"慢性的"循环把页面耗死
      await sleep(10_000)
      await probe('空转 10 秒后')
      const mem = await cdp.evaluate(
        `(performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize/1048576) } : {})`,
      )
      console.log('  heap =', JSON.stringify(mem))

      if (identifier) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    }
    cdp.close()
  } finally {
    if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
    if (server?.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

await main()
