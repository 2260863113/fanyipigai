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
const exerciseIds = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
if (exerciseIds.length === 0) exerciseIds.push('article-001', 'paragraph-001', 'sentence-002', 'term-001')

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

async function main() {
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

      // 逐段填入示例作答，再点提交（与 visual.ts 的做法一致）
      const outcome = await cdp.evaluate(
        `(async () => {
           const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
           const setValue = (el, value) => {
             const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
             setter.call(el, value);
             el.dispatchEvent(new Event('input', { bubbles: true }));
           };
           const sections = ${JSON.stringify(fixture.answerSections)};
           for (let i = 0; i < sections.length; i++) {
             if (i > 0) {
               const next = [...document.querySelectorAll('.section-nav .btn')]
                 .find((b) => b.textContent.includes('下一段'));
               if (!next) return '第 ' + i + ' 段找不到「下一段」';
               next.click();
               await sleep(250);
             }
             const area = document.querySelector('.answer-input');
             if (!area) return '第 ' + i + ' 段找不到输入框';
             setValue(area, sections[i]);
             await sleep(120);
           }
           const submit = document.querySelector('.pane-answer .btn-primary');
           if (!submit) return '找不到提交按钮';
           if (submit.disabled) return '提交按钮是禁用的';
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
