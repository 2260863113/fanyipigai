/**
 * 复现"切走再切回来，批改内容被清掉"。
 *
 * 用真实浏览器、对着**已经在跑的那个** dev server，按用户的操作顺序走一遍：
 *   在文章栏某一页写下译文 → 提交 → 切到「术语」→ 切回「文章」→ 看那份批改还在不在。
 *
 * 与 jsdom 探针的区别：探针用的是内置示例作答、走的题号也是探针自己挑的；
 * 这里从**界面默认落点**开始，不指定任何题号——用户遇到的就是这个落点。
 *
 * 用法：node scripts/repro-tab-roundtrip.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const debugPort = 9235
const root = process.cwd()

function findBrowser() {
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
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
        if (text.includes('[tab]') || text.includes('[app]')) this.errors.push('LOG ' + text)
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

/** 批改接口桩：回一份与提交文字自洽的批改，并记下请求 */
const stubSource = `
  (() => {
    window.__judgeCalls = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!url.includes('/api/judge')) return original(input, init);
      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (error) { body = {}; }
      const sections = body.answerSections || [];
      const submitted = sections.map((s) => s.text).join('\\n\\n');
      window.__judgeCalls.push({ text: submitted, body });
      const excerpt = submitted.trim().split(/\\s+/).slice(0, 4).join(' ') || submitted.slice(0, 4);
      const start = excerpt ? submitted.indexOf(excerpt) : 0;
      const span = { start: Math.max(0, start), end: Math.max(0, start) + excerpt.length };
      const highlight = { id: 'h1', anchor: { ...span, snippet: excerpt }, comment: '复现脚本用的固定亮点' };
      const payload = {
        ok: true, attempts: 1, sectionCount: sections.length, repaired: [],
        correction: { errors: [], highlights: [highlight] },
        validated: { errors: [], highlights: [{ highlight, span }], rejections: [] },
        raw: JSON.stringify({ errors: [], highlights: [highlight] }, null, 2),
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  })();
`

const browser = findBrowser()
if (!browser) throw new Error('没有找到 Edge 或 Chrome')

const profileDir = path.join(root, 'node_modules', '.cache', 'repro-tab-profile')
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
    /* 占用时留着 */
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
  await cdp.send('Page.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource })
  await cdp.send('Page.navigate', { url: `${base}/` })

  let mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  if (!mounted) throw new Error('界面没有挂载')
  await sleep(600)

  const result = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
       const pageNo = () => {
         const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(text('.section-nav .hint'));
         return m ? { index: Number(m[1]) - 1, count: Number(m[2]) } : { index: 0, count: 0 };
       };
       const readState = (label) => ({
         哪一步: label,
         栏切换轨迹: document.querySelector('.app')?.dataset?.tabTrace ?? '(无)',
         题目原文开头: text('.pane-source .source-text').slice(0, 18),
         页数: pageNo().count,
         页数文字: text('.section-nav .hint'),
         批注译文长度: (document.querySelector('.pane-answer .annotated-lines')?.textContent || '').length,
         分数: text('.pane-score .score-number'),
         有输入框: !!document.querySelector('.answer-input'),
         批改调用次数: (window.__judgeCalls || []).length,
       });

       const initial = readState('刚打开');
       const initialCalls = (window.__judgeCalls || []).length;

       // 在第 1 页写下译文并提交（末页才手动交；这里只有一页时也一样）
       const total = pageNo().count;
       for (let i = 0; i < total; i++) {
         let area = null;
         for (let k = 0; k < 100 && !area; k++) {
           if (pageNo().index === i) area = document.querySelector('.answer-input');
           if (!area) await sleep(150);
         }
         if (!area) return { error: '第 ' + (i + 1) + ' 页没有输入框' };
         const onScreen = text('.pane-source .source-text');
         const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
         setter.call(area, '第 ' + (i + 1) + ' 页译文：' + onScreen.slice(0, 20));
         area.dispatchEvent(new Event('input', { bubbles: true }));
         await sleep(150);
         if (i === total - 1) {
           document.querySelector('.pane-answer .btn-primary')?.click();
         } else {
           document.querySelector('.section-nav [data-nav="next"]')?.click();
         }
       }
       for (let k = 0; k < 150; k++) {
         if ((window.__judgeCalls || []).length > initialCalls && document.querySelector('.annotated-lines')) break;
         await sleep(200);
       }
       const graded = readState('提交完成后');

       // 切到「术语」，再切回「文章」
       const clickTab = async (label) => {
         const tab = [...document.querySelectorAll('.mode-tab')].find((b) => (b.textContent || '').trim() === label);
         if (!tab) return '找不到标签：' + label;
         tab.click();
         await sleep(700);
         return 'ok';
       };
       const toTerm = await clickTab('术语');
       const onTerm = readState('切到术语之后');
       const back = await clickTab('文章');
       await sleep(700);
       const afterBack = readState('切回文章之后');

       return { initial, graded, onTerm, afterBack, toTerm, back, total };
     })()`,
  )

  console.log(JSON.stringify(result, null, 2))
  console.log('页面异常 =', JSON.stringify(cdp.errors))

  const after = result?.afterBack
  const graded = result?.graded
  const kept =
    after &&
    graded &&
    after.批注译文长度 === graded.批注译文长度 &&
    after.分数 === graded.分数 &&
    after.批注译文长度 > 0
  console.log(kept ? '\n✓ 切走再切回来，批改还在' : '\n✗ 切走再切回来，批改没了（或题目被换掉了）')
  process.exitCode = kept ? 0 : 1

  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
