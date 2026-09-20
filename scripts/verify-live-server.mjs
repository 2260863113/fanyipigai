/**
 * 一次性验收：对着**已经在跑的那个** dev server 走一遍真实浏览器提交，确认不再白屏。
 *
 * 为什么不能只用 diagnose-submit.mjs：它默认自己起一个新服务器（5409），
 * 而"开发服务器缓存陈旧"这个类别只出现在既有服务上，新服务永远查不到。
 * 所以这里连的是用户那个 5180，注入接口桩（不花 API 钱），
 * 提交后检查 #root 是否还有内容、以及有没有任何页面异常。
 *
 * 用法：node scripts/verify-live-server.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { buildFixturePayload } from './fixture-payload.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
/** 用哪道题验收：默认选含替换+插入+删除三种标记的那道（会走补写方框的测量代码） */
const exerciseId = process.argv[3] ?? 'sentence-002'
const tabLabel = { article: '文章', paragraph: '段落', sentence: '句子', term: '术语' }[exerciseId.split('-')[0]]
const debugPort = 9233
const root = process.cwd()

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

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.errors = []
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
      if (message.method === 'Runtime.exceptionThrown') {
        const d = message.params.exceptionDetails ?? {}
        this.errors.push('EXCEPTION: ' + (d.exception?.description ?? d.text ?? ''))
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
        this.errors.push('console.error: ' + text)
      }
      if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') {
        const text = message.params.entry.text ?? ''
        if (!text.includes('favicon') && !text.includes('404')) this.errors.push('log.error: ' + text)
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

const browser = findBrowser()
if (!browser) throw new Error('没有找到 Edge 或 Chrome')

const fixture = await buildFixturePayload(root, exerciseId)
const { buildStubSource } = await import('./fixture-stub.mjs')
const stub = buildStubSource([{ answer: fixture.answer, payload: fixture.payload }])

const profileDir = path.join(root, 'node_modules', '.cache', 'verify-live-profile')
/** 逐个删（不能用 rmSync 的 recursive：在受管环境里它是静默空操作，见 lib/clear-dir.ts） */
function removeDir(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) removeDir(full)
    else unlinkSync(full)
  }
  try {
    rmdirSync(dir)
  } catch {
    /* 目录非空或占用时留着 */
  }
}
removeDir(profileDir)

const browserProcess = spawn(
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

/** 逐条打勾并记下结果（与其它验收脚本同一套写法） */
const results = []
function check(ok, label, detail) {
  results.push({ ok })
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
}

try {
  let ready = false
  for (let i = 0; i < 40 && !ready; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      ready = true
    } catch {
      await sleep(300)
    }
  }
  if (!ready) throw new Error('调试端口未就绪')

  const { WebSocket } = await import('ws')
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const target = list.find((t) => t.type === 'page') ?? list[0]
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('连接调试通道失败')))
  })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub })

  await cdp.send('Page.navigate', { url: `${base}/` })
  let mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  if (!mounted) throw new Error('界面没有挂载')
  await sleep(400)

  const outcome = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const setValue = (el, value) => {
         const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
         setter.call(el, value);
         el.dispatchEvent(new Event('input', { bubbles: true }));
       };
       // 先切到这道题所属的题型
       const tabLabel = ${JSON.stringify(tabLabel)};
       if (tabLabel) {
         const tab = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === tabLabel);
         if (!tab) return '找不到题型标签：' + tabLabel;
         tab.click();
         await sleep(450);
       }
       const sections = ${JSON.stringify(fixture.answerSections)};
       /*
        * 逐页批改：填一页 → 点「下一页」（这一页自动交去批改）→ 填下一页；
        * 末页没有「下一页」可点，只能手动按「提交批改」。
        *
        * ⚠️ 每翻一页都要等到**页码真的变了、而且新的一页有输入框**，再接着写。
        *
        * 只等"界面上有输入框"是不够的：点完「下一页」之后，旧那一页的输入框
        * 还在 DOM 里停一会儿（React 还没把它换掉），于是"等到输入框"会立刻满足，
        * 下一页的文字就被写进了**上一页那个正在消失的 textarea**里——
        * 表现是"翻到末页按钮是禁用的"（那一页其实是空的）。
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

       const total = pageNo().count || 1;
       /*
        * 单页题（句子题那种）没有翻页导航，pageNo() 拿到的是 0——那就按一页走。
        * 只断言"页数 ≥ 1"会漏掉这段退让，这里显式写出来：没有导航时不需要点「下一页」。
        */
       const hasNav = !!document.querySelector('.section-nav');
       for (let i = 0; i < total; i++) {
         let area = null;
         for (let k = 0; k < 150 && !area; k++) {
           const onRightPage = total === 1 || pageNo().index === i;
           if (onRightPage) area = document.querySelector('.answer-input');
           if (!area) await sleep(150);
         }
         if (!area) return '第 ' + (i + 1) + ' 页没有等到可写的输入框（页码=' + (pageNo().index + 1) + '）';
         const onScreen = (document.querySelector('.pane-source .source-text')?.textContent || '').trim();
         setValue(area, sections[i] || onScreen);
         await sleep(150);

         if (i === total - 1) break;
         const next = document.querySelector('.section-nav [data-nav="next"]');
         if (!next) return '第 ' + (i + 1) + ' 页找不到「下一页」（导航=' + hasNav + '）';
         next.click();
       }
       const submit = document.querySelector('.pane-answer .btn-primary');
       if (!submit) return '末页找不到提交按钮';
       if (submit.disabled) {
         return '末页的提交按钮是禁用的' + JSON.stringify({
           总页数: total,
           页数文字: (document.querySelector('.section-nav .hint') || {}).textContent || '(无导航)',
           输入框值长度: (document.querySelector('.answer-input')?.value || '').length,
           按钮文案: (submit.textContent || '').trim(),
         });
       }       submit.click();
       await sleep(3500);
       return 'ok';
     })()`,
  )
  console.log('submit 结果 =', outcome)
  await sleep(1200)

  const state = await cdp.evaluate(
    `({
       rootTextLen: (document.getElementById('root')?.innerText || '').length,
       nodes: document.getElementById('root')?.querySelectorAll('*').length ?? -1,
       hasAnnotated: !!document.querySelector('.annotated'),
       fixBoxes: document.querySelectorAll('.fix-text').length,
       score: (document.querySelector('.score-number')?.textContent || ''),
       marks: document.querySelectorAll('.annotated [data-mark-id]').length,
       fallbackShown: (document.getElementById('root')?.innerText || '').includes('界面出错了'),
     })`,
  )
  console.log('页面状态 =', JSON.stringify(state))
  console.log('页面错误 =', JSON.stringify(cdp.errors))

  // 再点一处勾画（补写的字与气泡的测量路径都在这里）
  await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const mark = document.querySelector('.annotated [data-mark-id]');
       if (mark) { mark.click(); await sleep(600); }
       return true;
     })()`,
  )
  const after = await cdp.evaluate(
    `({
       nodes: document.getElementById('root')?.querySelectorAll('*').length ?? -1,
       bubble: !!document.querySelector('.ann-bubble'),
     })`,
  )
  console.log('点过勾画后 =', JSON.stringify(after))
  console.log('页面错误（含交互后）=', JSON.stringify(cdp.errors))

  /*
   * 练习记录页的「译文」也要能切视图（用户要求："练习记录，译文部分也要支持不同视图的分段按钮"）。
   *
   * 为什么在这里验：记录页要有记录才看得出效果，而刚才这一次提交正好留下了一条。
   * 断言的是"两个视图都能真的画出来"——只查按钮在不在是不够的：
   * 切过去变成空白、或者还是勾画视图，按钮照样在。
   */
  console.log('\n=== 练习记录：当时的译文也能切视图 ===')
  const records = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const tab = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '练习记录');
       if (!tab) return { error: '找不到「练习记录」标签' };
       tab.click();
       await sleep(700);
       const item = document.querySelector('.record-item');
       if (!item) return { error: '还没有练习记录' };
       item.click();
       await sleep(800);
       const read = () => ({
         hasSwitch: !!document.querySelector('.pane-answer .view-switch'),
         active: document.querySelector('.pane-answer .view-switch .view-btn-active')?.textContent?.trim() ?? null,
         annotated: document.querySelectorAll('.pane-answer .annotated [data-mark-id]').length,
         compareLines: document.querySelectorAll('.pane-answer .compare-list .compare-line').length,
       });
       const before = read();
       const compareBtn = [...document.querySelectorAll('.pane-answer .view-switch .view-btn')].find((b) => b.textContent.includes('对照视图'));
       if (!compareBtn) return { error: '记录页的译文栏里没有视图分段按钮', before };
       compareBtn.click();
       await sleep(600);
       const after = read();
       const corrected = [...document.querySelectorAll('.pane-answer .compare-corrected')].map((p) => ({
         label: p.querySelector('.compare-label')?.textContent?.trim() ?? '',
         text: (p.textContent || '').trim().slice(0, 40),
       }));
       return { before, after, corrected: corrected.slice(0, 2) };
     })()`,
  )
  console.log('记录页视图 =', JSON.stringify(records))
  check(records.error === undefined, '练习记录页能打开一条记录并看到译文栏', records.error)
  check(records.before?.hasSwitch === true, '译文栏标题里有「批改视图 / 对照视图」分段按钮')
  check(records.before?.annotated > 0, `批改视图里画着勾画（${records.before?.annotated} 处）`)
  check(
    records.after?.compareLines > 0 && records.after?.active === '对照视图',
    `点「对照视图」真的换成逐句对照（${records.after?.compareLines} 行，当前 ${records.after?.active}）`,
  )
  check(
    (records.corrected ?? []).every((line) => line.label === '改后'),
    '对照视图里每句都带「改后」标签（与练习页同一套排版）',
    JSON.stringify(records.corrected),
  )

  const pass =
    outcome === 'ok' &&
    state.hasAnnotated === true &&
    state.rootTextLen > 200 &&
    state.fallbackShown === false &&
    results.every((result) => result.ok) &&
    cdp.errors.length === 0
  console.log(pass ? '\n✓ 验收通过：提交后正常渲染，无异常' : '\n✗ 验收未通过')
  process.exitCode = pass ? 0 : 1

  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
