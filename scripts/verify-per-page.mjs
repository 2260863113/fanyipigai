/**
 * 逐页批改的**真实浏览器**验收：一页一页译、一页一页交、翻回去看结果。
 *
 * 为什么必须有它：逐页批改的规矩几乎都是"时序 + 计数"类的规矩，
 * jsdom 里的探针能验结构，但验不了"到底发了几次请求、每次发的是哪一页的文字"。
 * 这里对着**已经在跑的那个** dev server，用真实浏览器把整条流程走一遍，
 * 接口用桩（不花 API 钱，并且把每一次请求都记下来）。
 *
 * 走的就是用户描述的那套：
 *   1. 第 1 页写完 → 点「下一页」→ 这一页**自动**交出去批；
 *   2. 每一页各交一次、各发自己那段文字（不多不少、不串页）；
 *   3. 末页没有「下一页」，只能手动按「提交批改」；
 *   4. 翻回第 1 页：直接看到当时的批改结果、**只读**、**不再发请求**；
 *   5. 按「返回编辑」：结果作废、可以接着改，而且按钮变成手动的「提交批改（手动）」。
 *
 * 用法：node scripts/verify-per-page.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const debugPort = 9234
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

/**
 * 批改接口桩：记下每一次请求，并回一份**与提交文字自洽**的批改。
 *
 * 自洽很重要：批注是"按提交的那段文字算出来的位置"，凭空的批注会被位置校验拒掉，
 * 于是界面上一处勾画都不显示——那样"这一页真的拿到结果了"就验不出来。
 */
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
      window.__judgeCalls.push({
        start: sections[0] ? sections[0].start : -1,
        text: submitted,
        direction: body.direction || '',
        at: Date.now(),
      });

      const excerpt = submitted.trim().split(/\\s+/).slice(0, 4).join(' ') || submitted.slice(0, 4);
      const start = excerpt ? submitted.indexOf(excerpt) : 0;
      const highlight = {
        id: 'h1',
        anchor: { start: Math.max(0, start), end: Math.max(0, start) + excerpt.length, snippet: excerpt },
        comment: '逐页批改验收用的固定亮点',
      };
      const payload = {
        ok: true,
        attempts: 1,
        sectionCount: sections.length,
        repaired: [],
        correction: { errors: [], highlights: [highlight] },
        validated: {
          errors: [],
          highlights: [{ highlight, span: { start: Math.max(0, start), end: Math.max(0, start) + excerpt.length } }],
          rejections: [],
        },
        raw: JSON.stringify({ errors: [], highlights: [highlight] }, null, 2),
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    window.__judgeStub = true;
  })();
`

const browser = findBrowser()
if (!browser) throw new Error('没有找到 Edge 或 Chrome')

const profileDir = path.join(root, 'node_modules', '.cache', 'verify-per-page-profile')
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

/** 逐条断言；任何一条不过就整体失败 */
const results = []
function check(ok, label, detail) {
  results.push({ ok: Boolean(ok), label })
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`)
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
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource })

  await cdp.send('Page.navigate', { url: `${base}/` })
  let mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  if (!mounted) throw new Error('界面没有挂载')
  await sleep(500)

  // 清掉可能残留的本地存档（上一次跑留下的记录不该影响这一次的计数）
  await cdp.evaluate("(() => { window.localStorage.clear(); return true })()")
  await cdp.send('Page.navigate', { url: `${base}/` })
  mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  await sleep(600)

  console.log('\n== 逐页批改 · 真实浏览器验收 ==')

  const setup = await cdp.evaluate(
    `({
       stub: window.__judgeStub === true,
       tab: (document.querySelector('.mode-tab.mode-tab-active')?.textContent || '').trim(),
       pages: (() => {
         const hint = document.querySelector('.section-nav .hint')?.textContent || '';
         const m = /第\\s*\\d+\\s*\\/\\s*(\\d+)\\s*页/.exec(hint);
         return m ? Number(m[1]) : 0;
       })(),
     })`,
  )
  console.log('起始状态 =', JSON.stringify(setup))
  check(setup.stub, '批改接口桩已注入（不花 API 钱）')
  check(setup.tab === '文章', '默认落在「文章」栏（逐页批改就是文章题的主循环）', setup.tab)
  check(setup.pages >= 3, `这一篇有 ${setup.pages} 页（够走完"填一页 / 交一页 / 翻一页"）`)

  /*
   * 读下每一页的原文，然后逐页走：
   *   写 → 点「下一页」（自动提交 + 翻页）→ 等新的一页出现 → 下一轮；
   *   末页没有「下一页」，手动按「提交批改」。
   *
   * 全部在页面里跑完再回传结果，避免几十次 CDP 往返把时序搅乱。
   */
  const walked = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
       const pageNo = () => {
         const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(text('.section-nav .hint'));
         return m ? { index: Number(m[1]) - 1, count: Number(m[2]) } : { index: -1, count: 0 };
       };
       const setValue = (el, value) => {
         const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
         setter.call(el, value);
         el.dispatchEvent(new Event('input', { bubbles: true }));
       };
       const waitFor = async (probe, tries = 120) => {
         for (let i = 0; i < tries; i++) {
           const value = probe();
           if (value) return value;
           await sleep(200);
         }
         return null;
       };

       const total = pageNo().count;
       if (!total) return { error: '界面上没有翻页导航，这道题不是多页题' };

       const trace = [];
       const sources = [];
       for (let page = 0; page < total; page++) {
         const source = text('.pane-source .source-text');
         sources.push(source);
         const typed = '第 ' + (page + 1) + ' 页译文：' + source.slice(0, 24);

         const area = await waitFor(() => document.querySelector('.answer-input'));
         if (!area) return { error: '第 ' + (page + 1) + ' 页没有可写的输入框' };
         setValue(area, typed);
         await sleep(200);

         const before = window.__judgeCalls.length;
         const last = page === total - 1;
         const button = document.querySelector('.pane-answer .btn-primary');
         const label = (button?.textContent || '').trim();

         if (last) {
           if (!button) return { error: '末页没有「提交批改」按钮' };
           button.click();
         } else {
           const next = document.querySelector('.section-nav [data-nav="next"]');
           if (!next) return { error: '第 ' + (page + 1) + ' 页没有「下一页」' };
           next.click();
         }

         // 等这一页真的交出去（请求数 +1）
         const submitted = await waitFor(() => window.__judgeCalls.length > before, 150);
         if (!submitted) return { error: '第 ' + (page + 1) + ' 页点完之后没有发出批改请求' };

         /*
          * ⚠️ 只有**末页**才在这里验"提交之后变成只读、界面说已批改"。
          *
          * 前面那些页点的是「下一页」，它会把这一页交出去批、然后**立刻切页**，
          * 因此"这一页变成只读"在画面上只存在一瞬间，之后人已经在下一页上了。
          * 那一刻去读，读到的是新的一页（输入框在），会误判成"批完还是可写的"。
          * 要验"翻走之后那一页确实是已批改"，用**翻回去看**那一段（revisit）来验，
          * 那才是用户真能看到的样子。
          */
         let arrived = null;
         if (!last) {
           arrived = await waitFor(
             () => (pageNo().index === page + 1 ? document.querySelector('.answer-input') : null),
             150,
           );
           if (!arrived) return { error: '点了「下一页」但没有翻到第 ' + (page + 2) + ' 页' };
         }
         const readOnly = last
           ? await waitFor(() => (document.querySelector('.answer-input') === null ? 'readonly' : null), 150)
           : 'readonly';
         trace.push({
           page,
           typed,
           label,
           last,
           calls: window.__judgeCalls.length,
           readOnly: readOnly === 'readonly',
           state: text('.section-nav .hint'),
         });
       }

       const callsAfterAll = window.__judgeCalls.length;

       // 翻回第 1 页：应当直接看到结果、只读，而且**不再发请求**
       const prev = document.querySelector('.section-nav [data-nav="prev"]');
       if (!prev) return { error: '最后一页没有「上一页」' };
       for (let i = 0; i < total - 1; i++) {
         document.querySelector('.section-nav [data-nav="prev"]')?.click();
         await sleep(300);
       }
       const back = await waitFor(
         () => (pageNo().index === 0 ? true : null),
         60,
       );
       const revisit = {
         back: Boolean(back),
         index: pageNo().index,
         hasInput: document.querySelector('.answer-input') !== null,
         hasAnnotated: document.querySelector('.pane-answer .annotated-lines') !== null,
         calls: window.__judgeCalls.length - callsAfterAll,
         state: text('.section-nav .hint'),
       };

       // 「返回编辑」：结果作废、可以接着改，按钮变成手动的那个
       const unlock = [...document.querySelectorAll('.pane-answer .btn')]
         .find((b) => (b.textContent || '').trim() === '返回编辑');
       if (unlock) unlock.click();
       await sleep(500);
       const afterUnlock = {
         hasInput: document.querySelector('.answer-input') !== null,
         hasAnnotated: document.querySelector('.pane-answer .annotated-lines') !== null,
         button: (document.querySelector('.pane-answer .btn-primary')?.textContent || '').trim(),
       };

       // 改一个字，再翻到下一页：改过的页**不该**自动提交
       const area2 = document.querySelector('.answer-input');
       if (area2) { setValue(area2, '改过之后的内容'); await sleep(200); }
       const callsBeforeEdit = window.__judgeCalls.length;
       const nextAfterEdit = document.querySelector('.section-nav [data-nav="next"]');
       if (nextAfterEdit) nextAfterEdit.click();
       await sleep(1500);
       const editedTurn = {
         calls: window.__judgeCalls.length - callsBeforeEdit,
         state: text('.section-nav .hint'),
       };

       return {
         total,
         sources,
         trace,
         callsAfterAll,
         revisit,
         afterUnlock,
         editedTurn,
         requests: window.__judgeCalls.map((call) => ({ start: call.start, text: call.text.slice(0, 30) })),
       };
     })()`,
  )

  if (walked?.error) throw new Error(walked.error)
  console.log('\n逐页轨迹 =', JSON.stringify(walked.trace, null, 0))
  console.log('翻回第 1 页 =', JSON.stringify(walked.revisit))
  console.log('返回编辑后 =', JSON.stringify(walked.afterUnlock))
  console.log('改过再翻页 =', JSON.stringify(walked.editedTurn))

  const total = walked.total
  check(walked.trace.length === total, `每一页都走了一遍（${walked.trace.length} / ${total}）`)
  check(
    walked.trace.every((item) => item.readOnly),
    '提交之后这一页变成只读（输入框与提交按钮都不在了）',
    JSON.stringify(walked.trace.filter((item) => !item.readOnly).map((item) => item.page)),
  )
  check(
    walked.trace.filter((item) => item.last).every((item) => item.state.includes('已批改')),
    '末页提交后界面说"已批改（只读）"',
    walked.trace.at(-1)?.state,
  )
  check(
    walked.callsAfterAll === total,
    `${total} 页各发了一次批改请求、不多不少（实际 ${walked.callsAfterAll} 次）`,
  )
  /*
   * 每次请求发的都必须是**那一页自己**的文字。
   * 这条最要紧：逐页批改一旦串页，用户会看到"批的是别人那一段"，
   * 而那在界面上完全看不出来（分数、勾画都长得对）。
   */
  const perPageMatch = walked.requests.map((request, index) => {
    const expected = walked.trace[index]?.typed ?? ''
    return request.text.startsWith(expected.slice(0, 12))
  })
  check(
    perPageMatch.every(Boolean),
    '每一次请求发的都是那一页自己的文字（没有串页）',
    JSON.stringify(walked.requests.map((request, index) => `${index + 1}:${request.text.slice(0, 14)}`)),
  )
  check(walked.revisit.back && walked.revisit.index === 0, '能翻回第 1 页')
  check(walked.revisit.hasAnnotated && !walked.revisit.hasInput, '第 1 页显示的是当时的结果，而且是只读的')
  check(walked.revisit.calls === 0, `翻回已批过的页没有重新提交（多发 ${walked.revisit.calls} 次）`)
  check(
    walked.revisit.state.includes('已批改'),
    '翻回第 1 页时界面说"已批改"而不是"待批改"',
    walked.revisit.state,
  )
  check(walked.afterUnlock.hasInput && !walked.afterUnlock.hasAnnotated, '点「返回编辑」回到作答框，结果作废')
  check(
    walked.afterUnlock.button.includes('手动'),
    '放开之后提交按钮变成手动的「提交批改（手动）」',
    walked.afterUnlock.button,
  )
  check(
    walked.editedTurn.calls === 0,
    `改过之后翻页**没有**自动提交（多发 ${walked.editedTurn.calls} 次）`,
  )
  check(cdp.errors.length === 0, '整条流程没有页面异常', JSON.stringify(cdp.errors.slice(0, 3)))

  const failed = results.filter((item) => !item.ok)
  console.log(
    failed.length === 0
      ? `\n✓ 验收通过：${results.length} 项断言全过（逐页提交、不串页、翻回不重提、改过不自动提交）`
      : `\n✗ 验收未通过：${failed.length} / ${results.length} 项未过`,
  )
  process.exitCode = failed.length === 0 ? 0 : 1

  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
