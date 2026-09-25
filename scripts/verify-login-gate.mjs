/**
 * 真实浏览器验收「登录门」：没登录时按「提交批改」必须**拦住并弹出登录窗**，
 * 注册/登录之后同一次点击才会真的把请求发出去。
 *
 * 为什么要有它（而不是只靠冒烟）：这条要求的一半是**界面行为**——
 * "按下去弹出了登录/注册窗"。探针里断言不了它：探针提交之后还会继续点别处，
 * 顺手会把弹窗关掉（那本来就是弹窗该有的行为），快照里因此看不到它。
 * 只有真浏览器里"点一下、立刻看 DOM"才验得准。
 *
 * 跑法（默认对着本地 workerd + 本地 D1，见 README 的"本地把线上那一半也跑起来"）：
 *
 *   npm run build
 *   npx wrangler pages dev dist --port 8788
 *   node scripts/verify-login-gate.mjs                # 默认 http://127.0.0.1:8788
 *   node scripts/verify-login-gate.mjs https://fanyipigai.pages.dev
 *
 * ⚠️ 它**不会真的调 AI**：批改那一条被 CDP 拦截，用桩回一个 503。
 * 因此"请求发出去了没有"能验准，而**不花一分钱**（这一点与 verify-per-page.mjs 同一套做法）。
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] ?? process.env.VERIFY_BASE ?? 'http://127.0.0.1:8788'
const debugPort = 9241
const profileDir = path.join(process.cwd(), 'node_modules', '.cache', 'verify-login-profile')

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
    this.handlers = []
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
      for (const handler of this.handlers) handler(message)
    })
  }
  on(handler) {
    this.handlers.push(handler)
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
}

const results = []
function check(ok, label, detail) {
  results.push(Boolean(ok))
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`)
}

const browser = findBrowser()
if (!browser) {
  console.log('  – 跳过：这台机器上没找到 Edge/Chrome（可以用 CHROME_PATH 指定）')
  process.exit(0)
}

try {
  if (existsSync(profileDir)) {
    try {
      for (const entry of readdirSync(profileDir)) unlinkSync(path.join(profileDir, entry))
      rmdirSync(profileDir)
    } catch {
      /* 目录非空或占用时留着 */
    }
  }
} catch {
  /* 忽略 */
}

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

/** 这次会话里发往 /api/judge 的请求（用来说明"门拦住时一次都没发"） */
const judgeRequests = []
/** 所有请求（诊断用：第二次点击之后到底发了什么） */
const allRequests = []

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
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const page = targets.find((item) => item.type === 'page')
  if (!page) throw new Error('没有可用的页面目标')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const cdp = new Cdp(ws)

  // 记下所有 /api/judge 请求；批改那一条就地回一个 503 桩，**不花钱**
  cdp.on((message) => {
    if (message.method === 'Network.requestWillBeSent') {
      const url = message.params.request.url
      allRequests.push(url)
      if (url.includes('/api/judge')) judgeRequests.push(url)
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      if (request.url.includes('/api/judge')) {
        /*
         * ⚠️ 判据取这里而不是 Network.requestWillBeSent：请求被 Fetch 域拦下时，
         * Network 那条事件**不一定会发**（实测：应用真发了请求，Network 侧一次都没上报）。
         * `Fetch.requestPaused` 是"这个请求确实到达了浏览器网络层"的权威信号。
         */
        judgeRequests.push(request.url)
        cdp
          .send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 503,
            responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }],
            body: Buffer.from(
              JSON.stringify({ ok: false, kind: 'missing-key', message: '（验收桩：没有真的调用 AI）' }),
              'utf8',
            ).toString('base64'),
          })
          .catch(() => {})
      } else {
        cdp.send('Fetch.continueRequest', { requestId }).catch(() => {})
      }
    }
  })

  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  /*
   * ⚠️ 必须先定视口：headless 的默认窗口又小又矮，弹窗上的按钮会落到视口**外面**，
   * 真实鼠标点到的是别处（实测：点到背景上，把弹窗关掉了，于是"注册没成功"看起来像注册失败）。
   * 这一条与 verify-per-page.mjs 里量几何之前那次 setDeviceMetricsOverride 是同一个道理。
   */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Network.enable')
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] })

  await cdp.send('Page.navigate', { url: `${BASE}/` })
  let mounted = false
  for (let i = 0; i < 60 && !mounted; i += 1) {
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
    if (!mounted) await sleep(250)
  }
  if (!mounted) throw new Error('界面没有挂载（服务起着吗？）')
  await cdp.evaluate('(() => { window.localStorage.clear(); return true })()')
  await cdp.send('Page.navigate', { url: `${BASE}/` })
  for (let i = 0; i < 60; i += 1) {
    if (await cdp.evaluate("!!document.querySelector('.mode-tabs')")) break
    await sleep(250)
  }
  await sleep(400)

  console.log(`验收登录门 @ ${BASE}\n`)

  check(
    await cdp.evaluate("!!document.querySelector('.account-button') && document.querySelector('.account-button').textContent.includes('登录')"),
    '没登录时顶栏是「登录 / 注册」入口',
  )
  check(
    await cdp.evaluate("!!document.querySelector('.mode-tab') && [...document.querySelectorAll('.mode-tab')].some((b) => b.textContent.trim() === '留言板')"),
    '留言板入口在没登录时也看得见（能看、不能发言）',
  )


  /*
   * 用**真实鼠标与键盘事件**填作答、点提交。
   *
   * 为什么不用 `box.value = …` + `dispatchEvent('input')`：那样能否驱动 React 的受控组件
   * 取决于它监听在哪一层，实测在这台机器上**没驱动起来**（DOM 里有字、状态里没有），
   * 于是提交被"作答为空"那道早退悄悄拦住——查了半天的"登录门 bug"其实是脚本的幻觉。
   * 真实点击 + `Input.insertText` 走的是浏览器的事件链，与用户手打没有区别。
   */
  const clickAt = async (selector, text) => {
    const box = await cdp.evaluate(`(() => {
      const node = ${selector};
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.left + Math.min(rect.width / 2, 120)), y: Math.round(rect.top + rect.height / 2) };
    })()`)
    if (!box) return false
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
      })
    }
    if (text) await cdp.send('Input.insertText', { text })
    return true
  }
  const clickButtonByText = async (label) => {
    const ok = await clickAt(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`)
    return ok
  }
  /*
   * 留言板那一页要用的正是**「地图记忆」的结构与类名**（用户要求这一批功能完全仿造它）：
   * `.board-container / board-heading / board-composer / board-empty`。
   * 只断言这几个类在 DOM 里，就算"结构搬对了"——样式本身是整块搬过来的 CSS，不由脚本验。
   */
  await clickButtonByText('留言板')
  await sleep(700)
  check(
    await cdp.evaluate(
      "!!document.querySelector('.board-container') && !!document.querySelector('.board-heading') && !!document.querySelector('.board-composer')",
    ),
    '留言板用的是地图记忆那套结构（board-container / board-heading / board-composer）',
  )
  check(
    await cdp.evaluate(
      "!!document.querySelector('.board-empty') || !!document.querySelector('.board-list') || !!document.querySelector('.announcement-item')",
    ),
    '留言板有内容区（公告 / 列表 / 空态）',
  )
  await clickButtonByText('文章')
  await sleep(400)

  const ANSWER = 'Because of the heavy rain, the football match was put off until next week. '.repeat(4)
  /*
   * 填作答用"原生 setter + input 事件"这一招（React 的受控组件认它）。
   * 真实鼠标点击在这儿不好使：textarea 的坐标点得到、焦点也给了，
   * 但 `Input.insertText` 在这台机器上没把字送进去（实测 DOM 里仍是空的）。
   */
  const typed = await cdp.evaluate(`(() => {
    const box = document.querySelector('textarea.answer-input') || document.querySelector('textarea');
    if (!box) return false;
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(ANSWER)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return box.value.length;
  })()`)
  check(typeof typed === 'number' && typed > 200, `作答框里填进了一段够长的英文（${typed} 个字符）`)
  await sleep(300)

  check(await clickButtonByText('提交批改'), '点到了「提交批改」')
  await sleep(600)

  check(judgeRequests.length === 0, `没登录时按提交 → 一次 /api/judge 都没发（实际 ${judgeRequests.length} 次）`)
  check(await cdp.evaluate("!!document.querySelector('.auth-card')"), '弹出了登录/注册窗口（地图记忆那张 .auth-card）')
  check(
    await cdp.evaluate("!!document.querySelector('.auth-reason') && document.querySelector('.auth-reason').textContent.includes('需要先登录')"),
    '弹窗里写清了为什么（"提交批改需要先登录"）',
  )

  // 走一遍真实注册（会在这台服务器背后的 D1 里建一个账号）
  const username = `vg-${Math.random().toString(36).slice(2, 8)}`
  check(await clickButtonByText('还没有账号？去注册'), '切到「注册」（地图记忆那个 auth-switch 按钮）')
  await sleep(200)
  /** 往弹窗里第 index 个输入框填值（同样走原生 setter + input 事件，见上面那段说明） */
  const fillInput = (index, value) =>
    cdp.evaluate(`(() => {
      const box = document.querySelectorAll('.auth-card .form-row input')[${index}];
      if (!box) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(value)});
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return box.value === ${JSON.stringify(value)};
    })()`)
  check(await fillInput(0, username), '填了用户名')
  check(await fillInput(1, 'verify-gate-password'), '填了密码（它那套没有"再输一遍"）')
  await sleep(200)
  check(await clickButtonByText('注册'), '点了「注册」')

  let registered = false
  for (let i = 0; i < 80 && !registered; i += 1) {
    registered = Boolean(
      await cdp.evaluate(
        `!!document.querySelector('.account-name') && document.querySelector('.account-name').textContent.includes(${JSON.stringify(username)})`,
      ),
    )
    if (!registered) await sleep(250)
  }
  check(registered, `注册之后顶栏出现用户名（${username}）`)
  check(!(await cdp.evaluate("!!document.querySelector('.auth-card')")), '注册成功之后弹窗自己关掉了')

  /*
   * ⚠️ 这里**到此为止**：本脚本负责的只有"没登录时被拦住并弹窗"这一条（用户的原始要求）。
   *
   * "登录之后同一次点击能提交"这一半**不由本脚本验**：
   * - jsdom 探针里那条路是通的（renderApp 默认就以已登录身份跑完整流程，`judgeCalls` 4 次，
   *   批改结果也渲染出来了，见 scripts/smoke.ts 的那一段）；
   * - 接口那一侧由 scripts/verify-accounts.mjs 验（42 项）。
   * 我试过在浏览器里把"注册 → 立刻提交"也串起来，但脚本里"填作答"这一步始终驱动不了
   * React 的受控组件（DOM 里有字、状态里没有），于是提交被"作答为空"那道早退悄悄拦住，
   * 看起来像"登录门不放行"——那是我这边脚本的幻觉，不是产品行为。
   * 想补这一条的话，先解决"往受控 textarea 里可靠地输入"这件事（真实键盘事件或
   * Input.insertText 都要先把焦点打准），别照抄下面这段断言。
   */

  cdp.send('Fetch.disable').catch(() => {})
  ws.close()
} catch (error) {
  results.push(false)
  console.log(`  ✗ 验收过程抛异常：${error instanceof Error ? error.message : String(error)}`)
} finally {
  browserProcess.kill()
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length} 项检查，${failed === 0 ? '全部通过' : `${failed} 项失败`}。`)
process.exit(failed === 0 ? 0 : 1)
