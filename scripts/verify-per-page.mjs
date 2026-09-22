/**
 * 逐页批改的**真实浏览器**验收：一页一页译、一页一页交、翻回去看结果。
 *
 * 为什么必须有它：逐页批改的规矩几乎都是"时序 + 计数"类的规矩，
 * jsdom 里的探针能验结构，但验不了"到底发了几次请求、每次发的是哪一页的文字"，
 * 也验不了"批改还在跑的时候界面到底能不能动"。这里对着**已经在跑的那个** dev server，
 * 用真实浏览器把整条流程走一遍，接口用桩（不花 API 钱，并且把每一次请求都记下来）。
 *
 * 走的就是用户描述的那套（第三版：翻页不再自动提交）：
 *   1. 第 1 页写完 → 点「下一页」→ **只是翻页**，不发请求、草稿留着；
 *   2. 写完一页按「提交批改」：按钮立刻变成"批改中…"、作答框只读、弹出等待窗；
 *   3. 等待窗里点「进入下一页」：**批改还没回来**就已经翻到下一页接着译；
 *      这时在别的页上写了字也提交不了（一次只批一页）；
 *   4. 批完右下角弹「第 x 页已经批改完成」，点它跳回那一页看结果；
 *   5. 每一页各交一次、各发自己那段文字（不多不少、不串页）；
 *   6. 翻回已批过的页：直接看到当时的批改结果、**只读**、**不再发请求**；
 *      按「返回编辑」可以接着改，改完自己再按「提交批改」（翻页不会替他交）。
 *
 * 用法：node scripts/verify-per-page.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
// 造"能过提交门"的假作答（第 3 条之后必须有它，见该文件的说明）
import { answerForPage } from './lib/probe-answer.mjs'

/**
 * 取出**服务端那道请求判据本身**，用来检查捕获到的请求。
 *
 * 为什么要绕一圈：接口桩只记录请求、不做校验，因此"原文分段与作答分段段数对不上"
 * 这类错误在桩里永远看不出来——它只在真服务器的那道门里才露头。
 * 曾经就有过一次真实故障：逐页批改时发的是"整篇原文分段（N）+ 一页作答（1）"，
 * 长度对不上 → 每次提交都 400"请求缺少必要字段或字段取值不合法"，一页都批不了。
 *
 * 判据在 vite 插件里（`.ts`，且引用了无法在裸 Node 里解析的无后缀导入），
 * 因此这里用 esbuild 把它打包成一个临时 `.mjs` 再 import——与 npm run smoke 同一套办法。
 */
async function loadRequestPredicate() {
  const outFile = path.join(process.cwd(), 'node_modules', '.cache', 'verify-per-page', 'predicate.mjs')
  await build({
    entryPoints: [path.join(process.cwd(), 'vite-plugin-judge-api.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['vite'],
    logLevel: 'silent',
  })
  const module = await import(pathToFileURL(outFile).href)
  if (typeof module.isCorrectionRequest !== 'function') {
    throw new Error('没能从 vite 插件里取到 isCorrectionRequest')
  }
  return module.isCorrectionRequest
}

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
      /*
       * 大改档（/api/refine）：第 4 条之后它有一套**自己的版式**（左栏上下、右栏整栏），
       * 因此这里也补一份与真实接口同形的响应，供"大改档的真实浏览器验收"用。
       * 形状与 domain/refine.ts 解析出来的完全一致（sourceText / sourceAnchor / sourceMatched 都要有）。
       */
      if (url.includes('/api/refine')) {
        let refineBody = {};
        try { refineBody = JSON.parse((init && init.body) || '{}'); } catch (error) { refineBody = {}; }
        const rSections = refineBody.answerSections || [];
        const rAnswer = rSections.map((s) => s.text).join('\\n\\n');
        const rSource = refineBody.source || '';
        const rFirst = (rSource.split(/(?<=[.。!！?？])\\s*/)[0] || '').trim();
        const rRewritten = rAnswer.length > 0 ? rAnswer[0].toUpperCase() + rAnswer.slice(1) : rAnswer;
        const rMatched = rFirst.length > 0 && rSource.includes(rFirst);
        const rStart = rSections[0] ? rSections[0].start : 0;
        window.__judgeCalls.push({
          start: rStart,
          text: rAnswer,
          direction: refineBody.direction || '',
          source: rSource,
          body: refineBody,
          at: Date.now(),
          endpoint: 'refine',
        });
        const payload = {
          ok: true,
          attempts: 1,
          raw: JSON.stringify({ sentences: [] }),
          refine: {
            sentences: [
              {
                id: 'r1',
                sourceText: rFirst,
                sourceAnchor: rMatched ? { start: 0, end: rFirst.length, snippet: rFirst } : null,
                sourceMatched: rMatched,
                oldText: rAnswer,
                anchor: { start: rStart, end: rStart + rAnswer.length, snippet: rAnswer },
                rewritten: rRewritten,
                explanation: '句首字母要大写；其余保持不变。',
                praise: '',
                changed: rAnswer !== rRewritten,
              },
            ],
          },
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!url.includes('/api/judge')) return original(input, init);
      /*
       * 两次"拖慢"，用途不同：
       *   - __judgeDelayOnce：**第一次**批改慢 5 秒，用来密集采样进度条
       *     （它只在"批改还没回来"的那段时间里看得见）；
       *   - __judgeDelayMs：**每一次**批改都慢这么多（默认 0 = 立刻返回），
       *     用来观察"批改中"那一刻的界面：按钮变成"批改中…"、作答框只读、
       *     别的页上也提交不了、等待窗可以点「进入下一页」。
       *     没有它，桩在同一个微任务里就把结果还给界面了，那段时间宽度为零，什么都读不到。
       *
       * ⚠️ 拖的是**返回**那一侧：请求本身照旧先记进 __judgeCalls（那才是"发出去了"的时刻），
       * 因此"等它发出去"那几处不会凭空多等一个延迟——否则等到的时候批改早就结束了，
       * "批改中"的界面状态一个都读不到（踩过）。
       *
       * ⚠️ 这段字符串整体躺在一个模板字符串里，**不能出现反引号**（写进去会把它截断）。
       */
      const delay = window.__judgeDelayOnce ? 5000 : (window.__judgeDelayMs || 0);
      if (window.__judgeDelayOnce) window.__judgeDelayOnce = false;

      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (error) { body = {}; }
      const sections = body.answerSections || [];
      const submitted = sections.map((s) => s.text).join('\\n\\n');
      window.__judgeCalls.push({
        start: sections[0] ? sections[0].start : -1,
        text: submitted,
        direction: body.direction || '',
        /*
         * 发给模型的 source 也记一份：用户要求"只截取当前段落，不要把整篇原文都发过去"，
         * 而界面上看不出这件事——只有请求体里才看得到。
         */
        source: body.source || '',
        /*
         * 整个请求体原样记下来：验证脚本要拿**服务端那道判据**去检查它
         *（见下面 isCorrectionRequest 的用法），而不是只数段数。
         */
        body,
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
      if (delay) await new Promise((r) => setTimeout(r, delay));
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

  /*
   * 「上次选了中译英，下次打开要落在中文那一篇上」。
   *
   * 用户报过："文章模式，在中译英的选项下，进去后要显示中译英的原文，不要显示英译中的"。
   * 这一条只在**重新打开页面**时才看得到，因此先单独跑一趟：把"上次的选择"写进浏览器、
   * 重新加载，再看原文栏里是中文还是英文。看完清掉，后面的检查仍基于原来的落点。
   */
  const startupDirection = await (async () => {
    await cdp.evaluate(
      `(() => {
         window.localStorage.setItem(
           'translation-practice.article-selection.v2',
           JSON.stringify({ domain: 'economy', direction: 'zh-to-en' }),
         );
         /*
          * 还要把"上次停在哪一栏/哪一题/第几页"擦掉（见 components/last-view.ts）：
          * 它比这张领域/方向表**优先级更高**，留着它的话落点是"上次那一篇"，
          * 这条检查就验不到"记住的方向"了。
          */
         window.localStorage.removeItem('translation-practice.last-view.v1');
         return true;
       })()`,
    )
    await cdp.send('Page.navigate', { url: `${base}/` })
    let ready = false
    for (let i = 0; i < 40 && !ready; i += 1) {
      await sleep(250)
      ready = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
    }
    await sleep(600)
    const observed = await cdp.evaluate(
      `({
         高亮方向: (document.querySelector('.dir-btn.dir-btn-active')?.textContent || '').trim(),
         原文开头: (document.querySelector('.pane-source .source-text')?.textContent || '').trim().slice(0, 24),
         有汉字: /[\\u4e00-\\u9fff]/.test((document.querySelector('.pane-source .source-text')?.textContent || '')),
       })`,
    )
    // 清掉这个"上次的选择"，后面那些检查要在默认落点上跑
    await cdp.evaluate("(() => { window.localStorage.removeItem('translation-practice.article-selection.v2'); window.localStorage.removeItem('translation-practice.last-view.v1'); return true })()")
    await cdp.send('Page.navigate', { url: `${base}/` })
    ready = false
    for (let i = 0; i < 40 && !ready; i += 1) {
      await sleep(250)
      ready = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
    }
    await sleep(600)
    return observed
  })()
  console.log('\n== 上次选「中译英」时的落点 ==', JSON.stringify(startupDirection))
  check(
    startupDirection.高亮方向 === '中译英',
    `记住的方向仍然是「中译英」（实际 ${startupDirection.高亮方向}）`,
  )
  check(
    startupDirection.有汉字 === true,
    `原文就是中译英那一篇（中文）：${startupDirection.原文开头}`,
  )

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
       /*
        * 翻页导航必须落在**左边「原文」那一栏**（用户要求）：放在那边，
        * 人的眼睛在原文上，翻页是为了换一段原文；放右栏会和「提交批改」挤在一起。
        */
       导航在左栏: document.querySelector('.pane-source .section-nav') !== null,
       导航在右栏: document.querySelector('.pane-answer .section-nav') !== null,
     })`,
  )
  console.log('起始状态 =', JSON.stringify(setup))
  check(setup.stub, '批改接口桩已注入（不花 API 钱）')
  check(setup.tab === '文章', '默认落在「文章」栏（逐页批改就是文章题的主循环）', setup.tab)
  check(setup.pages >= 3, `这一篇有 ${setup.pages} 页（够走完"填一页 / 交一页 / 翻一页"）`)
  check(setup.导航在左栏 && !setup.导航在右栏, '「上一页 / 下一页」在左边「原文」那一栏，不在作答栏')

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
        const answerForPage = ${answerForPage.toString()};
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
       /*
        * 进度条只在"批改还没回来"的那段时间里看得到，因此让桩把**第一次**批改拖慢 3 秒，
        * 在那段时间里密集采样几次宽度：应当一点点变大、并且**不超过 88%**
        * （用户要求"到 80–90 就保持不动，直到结果返回；提前返回就直接 100%"）。
        */
       window.__judgeDelayOnce = true;
       /* 每一次批改都慢 1.5 秒：下面那些"批改中"的界面状态全在这段时间里读 */
       window.__judgeDelayMs = 1500;
       const progressSamples = [];
       /** 点「下一页」**不**提交批改、草稿留着——新规矩，只在前两页各验一次 */
       const navOnly = [];
       /** 提交之后"批改还没回来"那一刻的界面状态 */
       const judgingStates = [];
       /** 右下角那条"第 x 页已经批改完成"通知，以及点它跳回去的结果 */
       const toasts = [];

       const clickNav = async (which) => {
         const node = document.querySelector('.section-nav [data-nav="' + which + '"]');
         if (!node || node.disabled) return false;
         node.click();
         await sleep(350);
         return true;
       };
       /** 站到指定的一页上（上一轮的收尾位置不一定就在它上面） */
       const ensureOnPage = async (target) => {
         for (let guard = 0; guard < 20 && pageNo().index !== target; guard++) {
           if (!(await clickNav(pageNo().index < target ? 'next' : 'prev'))) return false;
         }
         return pageNo().index === target;
       };
       const modalButtons = () =>
         [...document.querySelectorAll('.raw-modal-backdrop .gen-foot .btn')].map((b) => (b.textContent || '').trim());
       const clickModalButton = async (label) => {
         const node = [...document.querySelectorAll('.raw-modal-backdrop .gen-foot .btn')].find(
           (b) => (b.textContent || '').trim() === label,
         );
         if (!node) return false;
         node.click();
         await sleep(350);
         return true;
       };

       const sources = [];
       for (let page = 0; page < total; page++) {
         if (!(await ensureOnPage(page))) return { error: '没能翻到第 ' + (page + 1) + ' 页' };
         const source = text('.pane-source .source-text');
         sources.push(source);
         const typed = answerForPage(source, page);
         const area = await waitFor(() => document.querySelector('.answer-input'));
         if (!area) return { error: '第 ' + (page + 1) + ' 页没有可写的输入框' };
         setValue(area, typed);
         await sleep(200);

         /*
          * 规矩一：**翻页只是翻页**（用户要求："点击下一页或者上一页，不触发提交批改，
          * 而是保留当前页面输入缓存，后面返回时可以继续作答"）。
          * 翻过去、再翻回来，两头各问一句：有没有偷偷提交？草稿还在不在？
          */
         if (page < 2) {
           const callsBeforeNav = window.__judgeCalls.length;
           await clickNav('next');
           const callsAfterNav = window.__judgeCalls.length;
           await clickNav('prev');
           const kept = (document.querySelector('.answer-input')?.value || '') === typed;
           navOnly.push({ page, 多发的请求: callsAfterNav - callsBeforeNav, 草稿还在: kept });
         }

         const before = window.__judgeCalls.length;
         const button = document.querySelector('.pane-answer .btn-primary');
         const label = (button?.textContent || '').trim();
         if (!button) return { error: '第 ' + (page + 1) + ' 页没有「提交批改」按钮' };
         button.click();
         /*
          * 交出去之后**立刻**看这一页：按钮变成按不动的"批改中…"、作答框只读，
          * 而且弹出等待窗（还有下一页时）。这些都是"批改还没回来"那一刻的样子，
          * 必须趁桩被拖慢的这 3 秒里读到。
          */
         await sleep(80);
         const judgingButton = document.querySelector('.pane-answer .btn-primary');
         judgingStates.push({
           page,
           按钮: (judgingButton?.textContent || '').trim(),
           按钮禁用: judgingButton ? judgingButton.disabled === true : null,
           作答框只读: document.querySelector('.answer-input')?.readOnly === true,
           等待窗按钮: modalButtons(),
           别处按钮禁用: null,
           别处可以翻页: null,
         });

         /*
          * 趁这 3 秒密集采样进度条。采样要在"翻走"**之前**做完：
          * 进度条只画在**正在批的那一页**上，一翻页它就随这一页一起离开了。
          */
         if (page === 0) {
           for (let k = 0; k < 6; k++) {
             const bar = document.querySelector('.pane-answer .judge-progress');
             const fill = document.querySelector('.pane-answer .judge-progress-bar');
             const head = document.querySelector('.pane-answer .pane-head');
             const input = document.querySelector('.pane-answer .answer-input');
             progressSamples.push({
               出现了: !!bar,
               宽度: fill ? fill.style.width : '',
               背景色: fill ? getComputedStyle(fill).backgroundColor : '',
               高度: bar ? getComputedStyle(bar).height : '',
               在标题栏下面: !!(bar && head && (head.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING)),
               在作答框上面: !!(bar && input && (bar.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)),
             });
             await sleep(430);
           }
         }

         // 等这一页真的交出去（请求数 +1）
         const submitted = await waitFor(() => window.__judgeCalls.length > before, 150);
         if (!submitted) return { error: '第 ' + (page + 1) + ' 页点了「提交批改」却没有发出批改请求' };

         const last = page === total - 1;
         /*
          * 规矩二：等待窗里点「进入下一页」——**批改还在跑**就已经翻到了下一页。
          * 末页后面没有下一页，因此那一页不该弹窗（下面按"等待窗按钮为空"验它）。
          */
         let arrived = null;
         if (!last) {
           const wentNext = await clickModalButton('进入下一页');
           if (!wentNext) return { error: '第 ' + (page + 1) + ' 页提交之后没有弹出等待提示（或没有「进入下一页」）' };
           arrived = await waitFor(() => (pageNo().index === page + 1 ? true : null), 60);
           if (!arrived) return { error: '点了「进入下一页」但没有翻到第 ' + (page + 2) + ' 页' };
           /*
            * 批改还在跑的时候，**别处也不能提交**（用户要求"批改过程中不能提交"）：
            * 落到新的一页上先写两个字，排除"按钮禁用是因为没写东西"这条歧义。
            */
           const nextArea = document.querySelector('.answer-input');
           if (nextArea) {
             setValue(nextArea, '下一页的草稿');
             await sleep(200);
           }
           const elsewhere = document.querySelector('.pane-answer .btn-primary');
           const current = judgingStates[judgingStates.length - 1];
           current.别处按钮禁用 = elsewhere ? elsewhere.disabled === true : null;
           current.别处可以翻页 = pageNo().index === page + 1;
         }

         /*
          * 规矩三：批完右下角弹通知，点它跳回那一页看结果。
          * 通知是"批改返回之后"才画的，因此这里等它出现。
          */
         const toastText = await waitFor(() => {
           const node = document.querySelector('.judge-toast');
           return node ? (node.textContent || '').trim() : null;
         }, 200);
         document.querySelector('.judge-toast-main')?.click();
         await sleep(450);
         toasts.push({
           page,
           通知: toastText || '',
           跳到第几页: pageNo().index,
           跳过去之后通知没了: document.querySelector('.judge-toast') === null,
           有批注译文: document.querySelector('.pane-answer .annotated-lines') !== null,
         });

         /*
          * 这一页收尾：它现在是"已批改"（只读）。
          * 判据：**没有作答框**，而标题栏那颗按钮原地写着「返回编辑」
          * （第 2 条：提交批改与返回编辑是**同一颗**按钮，只换名字——
          * 因此这里不能再要求"没有那个按钮"）。
          */
         const gradedButton = document.querySelector('.pane-answer .btn-primary');
         const readOnly =
           document.querySelector('.answer-input') === null &&
           (gradedButton?.textContent || '').trim() === '返回编辑';
         trace.push({
           page,
           typed,
           label,
           last,
           calls: window.__judgeCalls.length,
           readOnly,
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
         /*
          * 「批改记录」下拉**在只读的已批改状态下也在**。
          * 这一条是这一轮改的：批完不再自动翻页，人就停在这一页看结果，
          * 要是下拉只在"返回编辑"之后才出现，他想回看前几次就得先按一下「返回编辑」——纯属绕路。
          */
         有批改记录下拉: [...document.querySelectorAll('.pane-answer .domain-trigger')].some(
           (b) => (b.textContent || '').includes('批改记录'),
         ),
       };

       // ── 行距：批改视图加倍，对照视图不受影响（用户要求） ──
       const clickView = async (label) => {
         const btn = [...document.querySelectorAll('.view-btn')].find((b) => (b.textContent || '').trim() === label);
         if (!btn) return false;
         btn.click();
         await sleep(400);
         return true;
       };
       const annotatedLineHeight = () => {
         const el = document.querySelector('.annotated-lines');
         return el ? getComputedStyle(el).lineHeight : '(没有批改视图)';
       };
       const annotatedInline = () => document.querySelector('.annotated-lines')?.getAttribute('style') || '';
       const fontSize = getComputedStyle(document.documentElement).fontSize;
       const correctionView = { 行高: annotatedLineHeight(), 行内样式: annotatedInline(), 根字号: fontSize };
       const switchedToCompare = await clickView('对照视图');
       const compareView = {
         切过去了: switchedToCompare,
         有对照列表: document.querySelector('.compare-list') !== null,
         有批注译文: document.querySelector('.annotated-lines') !== null,
       };
       await clickView('批改视图');
       const backToCorrection = { 行高: annotatedLineHeight() };
       // 收起选中，别把它带进后面的检查
       document.querySelector('.pane-source')?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
       await sleep(200);

       /*
        * 小卡片现在**挂在 document.body 上**（position: fixed，见 AnnotationText 的 createPortal），
        * 因此要在 document 上找它——它已经从各栏那棵子树里搬出去了。这正是
        * "小卡片应该位于最上层，不能被下面的区域栏目所挡住"那条要求的实现方式：
        * 译文栏的正文盒子是 overflow-y: auto 的滚动容器，卡片留在里面一定会被剪掉。
        *（⚠️ 这段整块躺在一个模板字符串里，注释里**不能出现反引号**。）
        */
       const bubbleEl = () => document.querySelector('.ann-bubble');
       const mark = document.querySelector('.pane-answer [data-mark-id]');
       if (mark) mark.click();
       await sleep(400);
       const bubbleBefore = {
         卡片在: !!bubbleEl(),
         收藏按钮: (document.querySelector('.ann-bubble button')?.textContent || '').trim(),
       };

       /*
        * ── 卡片的两条规矩（这一轮的用户要求）──
        *   ① 点**卡片里任何地方**都不关（只有点两张卡片之外才关）；
        *   ② 小卡片在最上层，不被下面的栏目盖住。
        * ② 只能用**真实命中测试**来验：jsdom 没有命中测试，样式表断言也只证明
        * "写了 position: fixed 与 z-index"；而"有没有被别的栏盖住"终究是排版问题。
        */
       const 卡片几何 = (() => {
         const node = bubbleEl();
         if (!node) return null;
         const rect = node.getBoundingClientRect();
         const paneBody = document.querySelector('.pane-answer .pane-body')?.getBoundingClientRect() ?? null;
         const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
         return {
           定位: getComputedStyle(node).position,
           挂在body下: node.parentElement === document.body,
           /* 卡片底边超出译文栏多少像素——正数说明它确实画到了栏外（而栏里那两栏没盖住它） */
           底边超出译文栏: paneBody ? Math.round(rect.bottom - paneBody.bottom) : null,
           卡片中心命中的是卡片: hit ? node.contains(hit) : null,
           命中到什么: hit ? (hit.className || hit.tagName) : '(视口外)',
         };
       })();
       // 点小卡片的**正文**（用命中测试拿到的元素点，等于真实鼠标）
       const whyNode = document.querySelector('.ann-bubble-why');
       if (whyNode) {
         const whyRect = whyNode.getBoundingClientRect();
         const hit = document.elementFromPoint(whyRect.left + 2, whyRect.top + 2) || whyNode;
         hit.click();
         await sleep(250);
       }
       const 点小卡片之后 = {
         卡片还在: !!bubbleEl(),
         右下角还在: !!document.querySelector('.pane-notes .detail-list'),
       };
       // 点右下角那张**大卡片**的正文（说明那几行）
       const detailBody = document.querySelector('.pane-notes .detail-body');
       if (detailBody) {
         detailBody.click();
         await sleep(250);
       }
       const 点大卡片之后 = {
         卡片还在: !!bubbleEl(),
         右下角还在: !!document.querySelector('.pane-notes .detail-list'),
       };

       const bubbleFavorite = document.querySelector('.ann-bubble button');
       /*
        * 点它之前先确认"它真的能收到点击"。
        *
        * 卡片从前整张是 pointer-events: none（免得挡住底下的勾画），而那条规则是**整棵子树**
        * 一起生效的——里面的按钮曾因此永远点不动（用户报过两次"小卡片无法点击收藏"）。
        * 现在整张卡片都收事件（点卡片才不算点外面），按钮自然也在里面；
        * 这里沿 DOM 往上走一遍，确认没有任何一层把鼠标事件关掉。
        *
        * ⚠️ 只用 .click() 是查不出来的：那是脚本直接调方法、**绕过了命中测试**，
        * jsdom 里更是压根没有命中测试（所以这个 bug 在原来的脚本里一直是绿的）。
        */
       const 指针事件链 = (() => {
         const chain = [];
         let node = bubbleFavorite;
         while (node && node !== document.body) {
           chain.push((node.className || node.tagName) + '=' + getComputedStyle(node).pointerEvents);
           node = node.parentElement;
         }
         return chain;
       })();
       /*
        * 判据看**按钮自己算出来的** pointer-events：它是个继承属性，
        * 祖先设了 none、而某一层又写回 auto 时，按钮上算出来的就是 auto。
        * 修好之前这里是 none（继承自 .ann-bubble），点不动。
        */
       const 能收到点击 = bubbleFavorite ? getComputedStyle(bubbleFavorite).pointerEvents !== 'none' : false;
       // 再用一次真实命中测试复核（先把按钮滚进视口，否则点不到它）
       if (bubbleFavorite) bubbleFavorite.scrollIntoView({ block: 'nearest' });
       await sleep(150);
       const 命中 = (() => {
         if (!bubbleFavorite) return '(没有按钮)';
         const rect = bubbleFavorite.getBoundingClientRect();
         const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
         if (!hit) return '(点位在视口外，跳过)';
         return hit === bubbleFavorite || bubbleFavorite.contains(hit) ? '是' : '否：' + (hit.className || hit.tagName);
       })();
       if (bubbleFavorite) bubbleFavorite.click();
       await sleep(400);
       const bubbleAfter = {
         卡片在: !!bubbleEl(),
         收藏按钮: (document.querySelector('.ann-bubble button')?.textContent || '').trim(),
         能收到点击,
         指针事件链,
         命中,
       };
       let favoriteCount = 0;
       let favoriteStored = null;
       try {
         const raw = JSON.parse(window.localStorage.getItem('translation-practice.favorites') || '[]') || [];
         favoriteCount = raw.length;
         favoriteStored = raw[0]
           ? { id: raw[0].id, why: (raw[0].why || '').slice(0, 20), 整句: (raw[0].sentenceBefore || '').slice(0, 30) }
           : null;
       } catch (error) {
         favoriteCount = -1;
       }
       // 收起卡片，别把选中状态带进后面的检查
       document.querySelector('.pane-source')?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
       await sleep(200);

       /*
        * 「批改记录」下拉：按「返回编辑」之后打开它，能看到这一页之前每一次批改，
        * 点其中一条就显示当时那份批改——结果回来、这一页重新只读、而且**不再发请求**。
        *
        * 它取代了原来的「查看上次批改」按钮：那颗按钮只在"一个字都没改"时出现，
        * 而这条记录是落盘的，改过字之后照样能回看（下面 afterEdit 那一段就量这一点）。
        */
       let returnToResult = null;
       {
         const unlockBtn = [...document.querySelectorAll('.pane-answer .btn')]
           .find((b) => (b.textContent || '').trim() === '返回编辑');
         if (unlockBtn) unlockBtn.click();
         await sleep(500);
         const trigger = document.querySelector('.pane-answer .domain-trigger');
         if (trigger) trigger.click();
         await sleep(400);
         const items = [...document.querySelectorAll('.pane-answer .domain-item')];
         const before = {
           有返回按钮: Boolean(trigger),
           有输入框: document.querySelector('.answer-input') !== null,
           历史条数: items.length,
         };
         const callsBeforeReturn = window.__judgeCalls.length;
         if (items[0]) items[0].click();
         await sleep(500);
         /*
          * 第 6 条之后**没有「回到作答」了**：正在看历史时标题栏那颗按钮写「返回编辑」，
          * 它既是"离开历史视图"的出口，也把这一页还回可写。
          */
         const backToWriting = [...document.querySelectorAll('.pane-answer .btn-primary')]
           .find((b) => (b.textContent || '').trim() === '返回编辑');
         returnToResult = {
           点之前: before,
           点之后: {
             有批注译文: document.querySelector('.pane-answer .annotated-lines') !== null,
             有输入框: document.querySelector('.answer-input') !== null,
             又是只读: Boolean(backToWriting),
           },
           新增调用: window.__judgeCalls.length - callsBeforeReturn,
         };
         // 回到作答框（点「返回编辑」），后面的检查仍在"正在写"的状态上跑
         if (backToWriting) backToWriting.click();
         await sleep(400);
       }

       const unlock = [...document.querySelectorAll('.pane-answer .btn')]
         .find((b) => (b.textContent || '').trim() === '返回编辑');
       if (unlock) unlock.click();
       await sleep(500);
       const afterUnlock = {
         hasInput: document.querySelector('.answer-input') !== null,
         hasAnnotated: document.querySelector('.pane-answer .annotated-lines') !== null,
         button: (document.querySelector('.pane-answer .btn-primary')?.textContent || '').trim(),
         /*
          * 还没动字时：按钮是普通的「提交批改」，而且「批改记录」下拉在。
          * 改过字之后按钮会变成「提交批改（手动）」，但下拉**仍然在**——
          * 这一条正是它比旧的「查看上次批改」强的地方，下面 afterEdit 量它。
          */
         有批改记录下拉: [...document.querySelectorAll('.pane-answer .domain-trigger')].some(
           (b) => (b.textContent || '').includes('批改记录'),
         ),
         /* 两档修改风格的**界面名**（用户改过：润色→精修、精修→大改） */
         档位按钮: [...document.querySelectorAll('.pane-answer .level-btn')].map((b) => (b.textContent || '').trim()),
       };

       // 改一个字，再翻到下一页：翻页**不该**提交（自动提交已经取消了）
       const area2 = document.querySelector('.answer-input');
       if (area2) { setValue(area2, '改过之后的内容'); await sleep(250); }
       const afterEdit = {
         按钮: (document.querySelector('.pane-answer .btn-primary')?.textContent || '').trim(),
         有批改记录下拉: [...document.querySelectorAll('.pane-answer .domain-trigger')].some(
           (b) => (b.textContent || '').includes('批改记录'),
         ),
       };
       const callsBeforeEdit = window.__judgeCalls.length;
       const nextAfterEdit = document.querySelector('.section-nav [data-nav="next"]');
       if (nextAfterEdit) nextAfterEdit.click();
       await sleep(1500);
       const editedTurn = {
         calls: window.__judgeCalls.length - callsBeforeEdit,
         state: text('.section-nav .hint'),
       };

       /*
        * 行距：批改视图那一段要明显更疏（用户要求"加大一倍"）；
        * 对照视图仍然是"一句对一句"，不画勾画、也不受行距设置影响。
        */
       const lineHeights = {
         批改视图: correctionView,
         对照视图: compareView,
         切回批改视图: backToCorrection,
       };

       /*
        * ── 批改后的页来回翻，必须停在**批改界面**（用户报过两次）──
        *
        * 三种前情各走一遍，因为正确答案并不一样：
        *   ① 刚批完、从来没按过「返回编辑」→ 回来必须是批改界面；
        *   ② 按过「返回编辑」但**一个字都没改**就翻走 → 回来仍是批改界面（用户这次报的就是它）；
        *   ③ 放开之后**真的改了字**再翻走 → 回来是作答框（那一页的批改这时已经作废了）。
        *
        * ⚠️ 必须挑一页**没被前面的步骤动过**的来做。
        * 第 1 页在这一段之前已经被"返回编辑 + 改字"折腾过（那是 afterEdit 那一段），
        * 它的批改本来就该作废——拿它当"刚批完"来量，得到的是"编辑中"，
        * 看着像功能坏了，其实是量错了对象（第一次写这段时事就这么栽了）。
        * 第 2 页（index 1）走完逐页流程之后一直没人碰过，正是干净的那一页。
        */
       const 干净页 = total > 1 ? 1 : 0;
       const 界面态 = () => ({
         有作答框: document.querySelector('.answer-input') !== null,
         有批注译文: document.querySelector('.pane-answer .annotated-lines') !== null,
         导航说: text('.section-nav .hint'),
       });
       const 翻页往返 = async () => {
         await clickNav('next');
         await clickNav('prev');
         await sleep(300);
         return 界面态();
       };
       await ensureOnPage(干净页);
       await sleep(300);
       const 刚批完 = { 停在这一页: 界面态(), 往返后: await 翻页往返() };
       let 放开未改 = null;
       {
         const unlockBtn = [...document.querySelectorAll('.pane-answer .btn')].find(
           (b) => (b.textContent || '').trim() === '返回编辑',
         );
         if (unlockBtn) unlockBtn.click();
         await sleep(300);
         放开未改 = { 放开后: 界面态(), 往返后: await 翻页往返() };
       }
       let 放开改过 = null;
       {
         const unlockBtn = [...document.querySelectorAll('.pane-answer .btn')].find(
           (b) => (b.textContent || '').trim() === '返回编辑',
         );
         if (unlockBtn) unlockBtn.click();
         await sleep(300);
         const area3 = document.querySelector('.answer-input');
         if (area3) { setValue(area3, '（改一个字再翻走）'); await sleep(250); }
         放开改过 = { 往返后: await 翻页往返() };
       }

       return {
         total,
         sources,
         trace,
         callsAfterAll,
         revisit,
         afterUnlock,
         afterEdit,
         editedTurn,
         navOnly,
         judgingStates,
         toasts,
         刚批完,
         放开未改,
         放开改过,
         progress: progressSamples,
         lineHeights,
         bubbleBefore,
         bubbleAfter,
         favoriteCount,
         favoriteStored,
         returnToResult,
         /* 卡片的两条规矩（点卡片不关 + 小卡片在最上层）的观测点 */
         卡片几何,
         点小卡片之后,
         点大卡片之后,
         requests: window.__judgeCalls.map((call) => ({
           start: call.start,
           text: call.text.slice(0, 30),
           source: call.source || '',
           sourceHead: (call.source || '').slice(0, 24),
           answerSectionCount: call.answerSectionCount,
           sourceSectionCount: call.sourceSectionCount,
           body: call.body,
         })),
         /** 逐页读到的原文（与 requests 一一对应），用来核对"这一页发的是这一页的原文" */
         pageSources: sources,
       };
     })()`,
  )

  if (walked?.error) throw new Error(walked.error)
  console.log('\n逐页轨迹 =', JSON.stringify(walked.trace, null, 0))
  console.log('翻页不提交 =', JSON.stringify(walked.navOnly))
  console.log('批改中的样子 =', JSON.stringify(walked.judgingStates))
  console.log('批完的通知 =', JSON.stringify(walked.toasts))
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
   * ── 这一轮新增的三条规矩（都在真实浏览器里验） ──
   *
   * 一、**翻页只是翻页**：点「下一页」/「上一页」不发请求，而且草稿留着
   *    （用户要求："点击下一页或者上一页，不触发提交批改，而是保留当前页面输入缓存，
   *     后面返回时可以继续作答"）。这条早先是反的：翻页会自动把这一页交出去批。
   */
  check(
    (walked.navOnly ?? []).length >= 2 && walked.navOnly.every((item) => item.多发的请求 === 0),
    '点「下一页」不触发提交批改（翻页只翻页）',
    JSON.stringify(walked.navOnly),
  )
  check(
    walked.navOnly.every((item) => item.草稿还在 === true),
    '翻走再翻回来，草稿原样还在（可以接着往下写）',
    JSON.stringify(walked.navOnly),
  )
  /*
   * 二、提交之后：等待窗两个按钮 + "批改中"这三样状态，而且**批改没回来就能翻页**。
   *    末页不弹窗（后面没有下一页可去）。
   */
  const judging = walked.judgingStates ?? []
  check(
    judging.length === total && judging.every((item) => item.按钮 === '批改中…' && item.按钮禁用 === true),
    '提交之后按钮立刻变成按不动的「批改中…」',
    JSON.stringify(judging.map((item) => `${item.page}:${item.按钮}/${item.按钮禁用}`)),
  )
  check(
    judging.every((item) => item.作答框只读 === true),
    '交出去之后作答框只读（这一刻改字，回来的批注就画错了）',
    JSON.stringify(judging.map((item) => `${item.page}:${item.作答框只读}`)),
  )
  check(
    judging.slice(0, total - 1).every((item) => item.等待窗按钮.join('/') === '停留此页/进入下一页'),
    '提交之后弹出等待提示，两个按钮都在（停留此页 / 进入下一页）',
    JSON.stringify(judging.map((item) => `${item.page}:[${item.等待窗按钮.join('/')}]`)),
  )
  check(
    judging.at(-1)?.等待窗按钮.length === 0,
    '末页提交时不弹等待提示（后面没有下一页可去）',
    JSON.stringify(judging.at(-1)?.等待窗按钮),
  )
  check(
    judging.slice(0, total - 1).every((item) => item.别处可以翻页 === true),
    '批改还没回来就已经翻到了下一页（等待过程中可以继续翻译）',
    JSON.stringify(judging.map((item) => `${item.page}:${item.别处可以翻页}`)),
  )
  check(
    judging.slice(0, total - 1).every((item) => item.别处按钮禁用 === true),
    '批改进行中，翻到下一页写了字也提交不了（一次只批一页）',
    JSON.stringify(judging.map((item) => `${item.page}:${item.别处按钮禁用}`)),
  )
  /*
   * 三、批完右下角弹出通知，点它跳回那一页。
   */
  const toasts = walked.toasts ?? []
  check(
    toasts.length === total && toasts.every((item) => item.通知.includes(`第 ${item.page + 1} 页已经批改完成`)),
    '每批完一页，右下角都弹出"第 x 页已经批改完成"',
    JSON.stringify(toasts.map((item) => item.通知)),
  )
  check(
    toasts.every((item) => item.跳到第几页 === item.page),
    '点那条通知直接路由到批完的那一页',
    JSON.stringify(toasts.map((item) => `${item.page}→${item.跳到第几页}`)),
  )
  check(
    toasts.every((item) => item.跳过去之后通知没了 && item.有批注译文),
    '跳过去就看到了那一页的批注译文，通知随之消失',
    JSON.stringify(toasts.map((item) => ({ 页: item.page, 通知没了: item.跳过去之后通知没了, 有批注: item.有批注译文 }))),
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
  /*
   * 用**服务端那道判据本身**去检查每一次请求。
   *
   * 这条是回归闸，写下它的时候正好踩了一次真故障：请求发的是"整篇原文分段（N）"配
   * "一页作答（1）"，服务端要求两边一一对应，于是每次提交都 400
   * "请求缺少必要字段或字段取值不合法"，一页都批不了。接口桩只记录请求、不做校验，
   * 所以这类错误只有在真服务器的这道门里才会露头——把判据交给测试，才不会又靠人记得。
   *
   * 判据里已经包含"两边段数必须相同"，因此这里不再单独数一遍段数。
   */
  const isCorrectionRequest = await loadRequestPredicate()
  const rejected = walked.requests
    .map((request, index) => ({ index, ok: isCorrectionRequest(request.body) }))
    .filter((item) => !item.ok)
  check(
    rejected.length === 0,
    '每一次请求都通过服务端那道判据（isCorrectionRequest）——不会再 400',
    JSON.stringify(
      rejected.map((item) => ({
        第几次: item.index + 1,
        段数: `${walked.requests[item.index]?.answerSectionCount}/${walked.requests[item.index]?.sourceSectionCount}`,
      })),
    ),
  )
  check(walked.revisit.back && walked.revisit.index === 0, '能翻回第 1 页')
  check(walked.revisit.hasAnnotated && !walked.revisit.hasInput, '第 1 页显示的是当时的结果，而且是只读的')
  check(walked.revisit.calls === 0, `翻回已批过的页没有重新提交（多发 ${walked.revisit.calls} 次）`)
  check(
    walked.revisit.state.includes('已批改'),
    '翻回第 1 页时界面说"已批改"而不是"待批改"',
    walked.revisit.state,
  )
  check(
    walked.revisit.有批改记录下拉 === true,
    '只读的已批改状态下「批改记录」下拉也在（批完就停在这一页，回看不必先按「返回编辑」）',
  )
  check(
    walked.afterUnlock.hasInput && !walked.afterUnlock.hasAnnotated,
    '点「返回编辑」回到作答框，可以接着改',
    JSON.stringify(walked.afterUnlock),
  )
  check(
    walked.afterUnlock.button === '提交批改',
    `放开之后按钮是普通的「提交批改」（实际 ${JSON.stringify(walked.afterUnlock.button)}）`,
  )
  check(walked.afterUnlock.有批改记录下拉, '「批改记录」下拉在（它取代了旧的「查看上次批改」按钮）')
  console.log('改过之后 =', JSON.stringify(walked.afterEdit))
  check(
    walked.afterEdit.按钮 === '提交批改',
    `改过字之后按钮仍是「提交批改」，要自己按（实际 ${JSON.stringify(walked.afterEdit.按钮)}）`,
  )
  check(walked.afterEdit.有批改记录下拉, '改过字之后「批改记录」下拉仍然在（落盘的记录不受改过字影响）')
  console.log('小卡片收藏 =', JSON.stringify({ 点之前: walked.bubbleBefore, 点之后: walked.bubbleAfter, 收藏条数: walked.favoriteCount, 落盘内容: walked.favoriteStored }))
  check(walked.bubbleBefore.卡片在, '点一处勾画，小卡片出来了')
  check(walked.bubbleBefore.收藏按钮 === '收藏', '小卡片自己带一颗「收藏」按钮', walked.bubbleBefore.收藏按钮)
  /*
   * 这颗按钮必须**真的收得到点击**：气泡是 pointer-events: none，不把事件收回来就点不动。
   * 用户报过两次这个毛病，而 `.click()` 查不出来（它绕过命中测试），因此这里单独验两件事。
   */
  check(
    walked.bubbleAfter.能收到点击 === true,
    '小卡片里那颗「收藏」真的能收到点击（pointer-events 没有被祖先关掉）',
    JSON.stringify(walked.bubbleAfter.指针事件链),
  )
  check(
    !String(walked.bubbleAfter.命中).startsWith('否'),
    '真实命中测试：点那个位置落到的就是这颗按钮',
    String(walked.bubbleAfter.命中),
  )
  check(walked.bubbleAfter.卡片在, '点小卡片里的「收藏」之后，卡片**不消失**（点它不算"点外面"）')
  check(walked.bubbleAfter.收藏按钮 === '已收藏', '收藏之后按钮文案变成「已收藏」', walked.bubbleAfter.收藏按钮)
  /*
   * ── 卡片的两条规矩（这一轮用户要求）──
   * ① "点击任意卡片都不会关掉这两个卡片，当且仅当点击这两个卡片之外的地方才消失"；
   * ② "小卡片应该位于最上层，不能被下面的区域栏目所挡住"。
   */
  console.log('小卡片几何 =', JSON.stringify(walked.卡片几何))
  check(
    walked.卡片几何?.定位 === 'fixed' && walked.卡片几何?.挂在body下 === true,
    '小卡片是固定定位、挂在 document.body 上（不在译文栏那棵子树里，因此不被滚动容器剪掉）',
    JSON.stringify(walked.卡片几何),
  )
  check(
    walked.卡片几何?.卡片中心命中的是卡片 === true,
    '小卡片中心点上的就是卡片本身（没有被下面任何一栏盖住）',
    JSON.stringify({ 命中: walked.卡片几何?.命中到什么, 超出译文栏: walked.卡片几何?.底边超出译文栏 }),
  )
  check(
    walked.点小卡片之后?.卡片还在 === true && walked.点小卡片之后?.右下角还在 === true,
    '点小卡片的**正文**，两张卡片都还在（用真实命中测试拿到的元素点，不是 .click() 直调）',
    JSON.stringify(walked.点小卡片之后),
  )
  check(
    walked.点大卡片之后?.卡片还在 === true && walked.点大卡片之后?.右下角还在 === true,
    '点右下角那张**大卡片的正文**（说明那几行），两张卡片也都还在',
    JSON.stringify(walked.点大卡片之后),
  )
  check(
    walked.afterUnlock.档位按钮.join('/') === '精修/大改',
    `两档修改风格的界面名是「精修」「大改」（实际 ${JSON.stringify(walked.afterUnlock.档位按钮)}）`,
  )
  /*
   * ── 批改后的页来回翻，必须停在批改界面（用户报过两次）──
   * 真实浏览器里的三条前情；jsdom 探针里那两条只覆盖了 ② 的一半。
   */
  console.log('翻页往返 =', JSON.stringify({ 刚批完: walked.刚批完, 放开未改: walked.放开未改, 放开改过: walked.放开改过 }))
  check(
    walked.刚批完?.停在这一页?.有批注译文 === true &&
      walked.刚批完?.往返后?.有批注译文 === true &&
      walked.刚批完?.往返后?.有作答框 === false,
    '① 刚批完的页，翻到别的页再翻回来，仍然是批改界面',
    JSON.stringify(walked.刚批完),
  )
  check(
    walked.放开未改?.放开后?.有作答框 === true,
    '② 按「返回编辑」之后这一页确实变成作答框（前置条件成立）',
    JSON.stringify(walked.放开未改?.放开后),
  )
  check(
    walked.放开未改?.往返后?.有批注译文 === true && walked.放开未改?.往返后?.有作答框 === false,
    '② 一个字没改就翻走再翻回来，仍然是批改界面（用户这次报的那一条）',
    JSON.stringify(walked.放开未改?.往返后),
  )
  check(
    walked.放开改过?.往返后?.有作答框 === true && walked.放开改过?.往返后?.有批注译文 === false,
    '③ 放开之后改了字再翻走，回来是作答框（那一页的批改那时已经作废了）',
    JSON.stringify(walked.放开改过?.往返后),
  )
  check(walked.favoriteCount === 1, `收藏落盘了（localStorage 里 ${walked.favoriteCount} 条）`)
  check(
    Boolean(walked.favoriteStored?.id) && (walked.favoriteStored?.why ?? '').length > 0 && (walked.favoriteStored?.整句 ?? '').length > 0,
    '落盘的这条带 id、说明与所在整句（不是只有个空壳）',
    JSON.stringify(walked.favoriteStored),
  )
  /*
   * ⚠️ 每一条请求里的**答案起点必须是 0**。
   *
   * 服务端会把批注按 `answerSections[0].start` 平移之后再返回（mergeSectionCorrections），
   * 而界面是拿**这一页的文字**去画勾画的。起点一旦填成"这一页在整篇里的位置"，
   * 第 2 页以后的批注就整体被推出这一页——勾画一处都画不出来，分数却照常显示。
   * 用 scripts/probe-section-offset.mjs 实测确认过这个平移是真的（start=0 报 17–30，start=50 报 67–80）。
   */
  const starts = await cdp.evaluate(`window.__judgeCalls.map((call) => call.start)`)
  check(
    starts.length > 0 && starts.every((value) => value === 0),
    `每一次请求里的答案起点都是 0（逐页提交的服务端坐标就是那一页的坐标）：${JSON.stringify(starts)}`,
  )

  /*
   * ── 刷新之后：批改过的页**仍然是批改界面**（用户报的现象最可能的来源）──
   *
   * 会话只在内存里，练习记录是落盘的。刷新一下、或者页面被热更新重载一下，
   * 会话就没了——刚批完的段落于是变成一张空作答框，而左侧进度还写着"已批 N 页"。
   * 现在打开时会把记录里有、会话里没有的那几页接回来，因此刷新之后再翻到那一页，
   * 看到的仍是那次批改（连同箭头、批注与只读态），按「返回编辑」还能拿到当时那段文字。
   */
  console.log('\n== 刷新之后，批改过的页还在不在 ==')
  /*
   * 刷新前先把**落盘的页状态**读出来看一眼（第 10 条：草稿、在编辑、正在看第几次都在这里）。
   * 这一条既是诊断，也是断言：刷新前必须真的存着"那一页在编辑、草稿是什么"。
   */
  const stateBeforeReload = await cdp.evaluate(
    `JSON.parse(window.localStorage.getItem('translation-practice.page-state.v1') || '{}')`,
  )
  const beforeReloadView = await cdp.evaluate(
    `({
       exerciseId: document.querySelector('.app')?.dataset.exerciseId ?? '',
       lastView: window.localStorage.getItem('translation-practice.last-view.v1'),
     })`,
  )
  console.log('刷新前落盘的页状态 =', JSON.stringify(stateBeforeReload))
  console.log('刷新前停在哪 =', JSON.stringify(beforeReloadView))
  /*
   * 让刷新**落回刚刚练过的那一篇**，否则下面测不到"把记录接回会话"这件事。
   *
   * 为什么要特地摆一下这个现场（两条都是用户定过的规矩，叠加起来会挡住测试）：
   *   1. 用户拍板"「返回编辑」不再撤进度"（进度只增不减）→ 这一篇到这会儿已经**整篇批完**了；
   *   2. 另一条老规矩是"整篇练完的文章不主动打开，下一次打开落到同格里没练完的那一篇"。
   * 两条一叠加，刷新就落到**下一篇**（实测落在 -2），而那篇从没练过、自然无从"接回"。
   * 因此这里先把这篇从"整篇已完成"里撤掉一页——**这一条测的是接回，不是落点**；
   * 落点本身在 verify-article-bar.mjs 里有专门的断言。
   */
  await cdp.evaluate(
    `(() => {
       const id = ${JSON.stringify(beforeReloadView?.exerciseId ?? '')};
       window.localStorage.setItem(
         'translation-practice.last-view.v1',
         JSON.stringify({ tab: 'article', exerciseId: id, origin: 'article-bank', sectionIndex: 1 }),
       );
       const key = 'translation-practice.article-progress.v1';
       const map = JSON.parse(window.localStorage.getItem(key) || '{}');
       const entry = map[id] || { graded: [], updatedAt: '' };
       map[id] = { graded: (entry.graded || []).filter((index) => index !== 0), updatedAt: entry.updatedAt || '' };
       window.localStorage.setItem(key, JSON.stringify(map));
       return true;
     })()`,
  )
  await cdp.send('Page.reload')
  let remounted = false
  for (let i = 0; i < 40 && !remounted; i += 1) {
    await sleep(250)
    remounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  await sleep(800)
  const afterReload = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
       const pageNo = () => {
         const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(text('.section-nav .hint'));
         return m ? { index: Number(m[1]) - 1, count: Number(m[2]) } : { index: -1, count: 0 };
       };
       const 界面态 = () => ({
         有作答框: document.querySelector('.answer-input') !== null,
         有批注译文: document.querySelector('.pane-answer .annotated-lines') !== null,
         草稿: (document.querySelector('.answer-input')?.value || ''),
         导航说: text('.section-nav .hint'),
       });
       /*
        * 刷新之后**落在哪一页**、那一页长什么样。
        *
        * 用户第三轮的口径："刷新之后旧结果不算了，自己去「批改记录」下拉栏里重新调出来"
        * （他先说"顺便把编辑态与草稿也落盘"，接着说旧结果不必再挂在页上）。
        * 因此这一页应当是**可写的、草稿还在**，而不是批改界面。
        */
       const 落地后 = { 在第几页: pageNo().index, ...界面态() };
       const 题号 = document.querySelector('.app')?.dataset.exerciseId ?? '';
       /* 再把每一页走一遍：**没被「返回编辑」碰过**的那几页，刷新后仍该是批改界面 */
       const 批改界面页 = [];
       const 有作答框页 = [];
       for (let page = 0; page < pageNo().count; page++) {
         for (let guard = 0; guard < 12 && pageNo().index !== page; guard++) {
           const step = pageNo().index < page ? '[data-nav="next"]' : '[data-nav="prev"]';
           document.querySelector('.section-nav ' + step)?.click();
           await sleep(200);
         }
         const state = 界面态();
         if (state.有批注译文 && !state.有作答框) 批改界面页.push(page);
         if (state.有作答框) 有作答框页.push(page);
       }
       return { 题号, 落地后, 批改界面页, 有作答框页 };
     })()`,
  )
  console.log('刷新之后 =', JSON.stringify(afterReload))
  check(
    afterReload?.落地后?.有作答框 === true,
    '刷新之后落在「编辑态」的那一页仍是可写的（第 10 条：编辑态落盘）',
    JSON.stringify(afterReload?.落地后),
  )
  check(
    (afterReload?.落地后?.草稿 ?? '').length > 0,
    '刷新之后当时写的那段文字还在（第 10 条：草稿落盘）',
    JSON.stringify(afterReload?.落地后),
  )
  check(
    afterReload?.落地后?.有批注译文 === false,
    '刷新之后旧批改**不再挂在这一页上**（用户第三轮：不算了，自己从「批改记录」下拉里调出来）',
    JSON.stringify(afterReload?.落地后),
  )
  check(
    (afterReload?.批改界面页?.length ?? 0) >= 1,
    `没被「返回编辑」碰过的页，刷新后仍是批改界面（${JSON.stringify(afterReload?.批改界面页)}）`,
  )
  check(
    (stateBeforeReload && Object.keys(stateBeforeReload).length > 0) === true &&
      afterReload?.题号 === beforeReloadView?.exerciseId,
    `刷新前后落在同一道题上（刷新前 ${beforeReloadView?.exerciseId}，刷新后 ${afterReload?.题号}）`,
    JSON.stringify(stateBeforeReload).slice(0, 200),
  )

  /*
   * ── 提交前那两道门（第 3 条）——在真实界面上走一遍 ──
   *
   * 用户原话："每次提交批改需要进行检测才能提交，要求字数必须大于30字（英文30个单词），
   * 且不能与这一段之前任意一次提交内容100%相同（防止重复提交），一旦违反，
   * 用吐司提示用户，并不提交批改。"
   *
   * 四步：太短 → 拦；够长且是新的 → 放行；同一段再交一次 → 拦；改一句 → 再放行。
   * 每一步都量"批改调用有没有多出来"，因为这条要求的要害正是**不提交**。
   */
  console.log('\n== 提交前那两道门（第 3 条）==')
  const gate = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const setValue = (el, value) => {
         const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
         setter.call(el, value);
         el.dispatchEvent(new Event('input', { bubbles: true }));
       };
       /* 造一段"过得了门"的作答（每个 evaluate 都是独立作用域，因此这里要再注入一次） */
       const answerForPage = ${answerForPage.toString()};
       /* 站到一页可写的页上：先看当前页能不能写，不能就按「返回编辑」或翻到别页 */
       for (let page = 0; page < 8 && !document.querySelector('.answer-input'); page++) {
         const unlock = [...document.querySelectorAll('.pane-answer .btn')].find(
           (b) => (b.textContent || '').trim() === '返回编辑',
         );
         if (unlock) {
           unlock.click();
           await sleep(400);
           break;
         }
         const step = document.querySelector('.section-nav [data-nav="next"]');
         if (!step || step.disabled) break;
         step.click();
         await sleep(350);
       }
       const area = document.querySelector('.answer-input');
       if (!area) return { error: '找不到可写的作答框' };
       const source = (document.querySelector('.pane-source .source-text')?.textContent ?? '').trim();
       const toastText = () => {
         const node = document.querySelector('.toast');
         return node ? (node.textContent || '').trim() : '';
       };
       const dismissToast = () => document.querySelector('.toast-close')?.click();

       /* ① 太短：拦下，而且**别提交** */
       const callsBefore = window.__judgeCalls.length;
       setValue(area, '太短了');
       await sleep(200);
       document.querySelector('.pane-answer .btn-primary').click();
       await sleep(600);
       const tooShort = { toast: toastText(), calls: window.__judgeCalls.length - callsBefore };
       dismissToast();
       await sleep(200);

       /* ② 够长而且是新的：放行 */
       const good = answerForPage(source, 99) + '\\n（这一条只给"提交门"测试用）';
       const callsBeforeGood = window.__judgeCalls.length;
       setValue(area, good);
       await sleep(200);
       document.querySelector('.pane-answer .btn-primary')?.click();
       const submitted = await (async () => {
         for (let i = 0; i < 60; i++) {
           if (window.__judgeCalls.length > callsBeforeGood) return true;
           await sleep(200);
         }
         return false;
       })();
       await sleep(1200);
       const passed = { toast: toastText(), calls: window.__judgeCalls.length - callsBeforeGood, submitted };

       /* ③ 同一段再交一次：拦下（"不能与之前任意一次提交 100% 相同"） */
       const unlock = [...document.querySelectorAll('.pane-answer .btn')].find(
         (b) => (b.textContent || '').trim() === '返回编辑',
       );
       if (unlock) unlock.click();
       await sleep(400);
       const area2 = document.querySelector('.answer-input');
       if (area2) setValue(area2, good);
       await sleep(250);
       const callsBeforeDup = window.__judgeCalls.length;
       document.querySelector('.pane-answer .btn-primary')?.click();
       await sleep(800);
       const duplicated = { toast: toastText(), calls: window.__judgeCalls.length - callsBeforeDup };
       dismissToast();
       await sleep(200);

       /* ④ 改一句：又放行（门拦的是"重复"，不是"再交一次"） */
       const area3 = document.querySelector('.answer-input');
       if (area3) setValue(area3, good + '（又改了一句）');
       await sleep(250);
       const callsBeforeEdit = window.__judgeCalls.length;
       document.querySelector('.pane-answer .btn-primary')?.click();
       const resubmitted = await (async () => {
         for (let i = 0; i < 60; i++) {
           if (window.__judgeCalls.length > callsBeforeEdit) return true;
           await sleep(200);
         }
         return false;
       })();
       await sleep(1000);
       const edited = { toast: toastText(), calls: window.__judgeCalls.length - callsBeforeEdit, submitted: resubmitted };

       return { tooShort, passed, duplicated, edited };
     })()`,
  )
  console.log('提交门 =', JSON.stringify(gate))
  check(gate?.tooShort?.calls === 0, '太短的一段：**一个批改请求都没发出去**（不提交批改）', JSON.stringify(gate?.tooShort))
  check(
    (gate?.tooShort?.toast ?? '').includes('还不够'),
    `太短的提示用吐司说清"还差多少"（${gate?.tooShort?.toast}）`,
    JSON.stringify(gate?.tooShort),
  )
  check(gate?.passed?.submitted === true && gate?.passed?.calls === 1, '够长而且是新的一段：正常交出去', JSON.stringify(gate?.passed))
  check(gate?.duplicated?.calls === 0, '与之前某次一字不差：**拦住，不发请求**', JSON.stringify(gate?.duplicated))
  check(
    (gate?.duplicated?.toast ?? '').includes('一字不差'),
    `重复提交的吐司说的是"一字不差"这件事（${gate?.duplicated?.toast}）`,
    JSON.stringify(gate?.duplicated),
  )
  check(
    gate?.edited?.submitted === true && gate?.edited?.calls === 1,
    '改一句之后再交：照旧放行（门拦的是重复，不是"再交一次"）',
    JSON.stringify(gate?.edited),
  )

  /*
   * ── 删掉一条批改记录（第 11 条）──
   * 用户原话："允许在批改记录的下拉栏中点击叉号删除记录，练习记录同步删除。"
   * 连带口径（他选的那一档）：撤掉进度 + 当前视图退回最新一次 + 点叉号确认一次。
   */
  console.log('\n== 删掉一条批改记录（第 11 条）==')
  const deletion = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const countRecords = () =>
         JSON.parse(window.localStorage.getItem('translation-practice.records.v2') || '[]').length;
       /* 站到一页"批过"的页上：只有那样的页才会列出批改记录 */
       for (let page = 0; page < 6; page++) {
         if (document.querySelector('.pane-answer .domain-trigger')) break;
         const next = document.querySelector('.section-nav [data-nav="next"]');
         if (!next || next.disabled) break;
         next.click();
         await sleep(300);
       }
       const trigger = [...document.querySelectorAll('.pane-answer .domain-trigger')].find((b) =>
         (b.textContent || '').includes('批改记录'),
       );
       if (!trigger) return { error: '这一页没有「批改记录」下拉' };
       const before = countRecords();
       trigger.click();
       await sleep(300);
       const itemsBefore = document.querySelectorAll('.pane-answer .domain-item').length;
       const cross = document.querySelector('.pane-answer .history-delete');
       if (!cross) return { error: '下拉里没有删除叉号' };
       cross.click();
       await sleep(300);
       const askText = (document.querySelector('.pane-answer .history-confirm')?.textContent || '').trim();
       const confirm = [...document.querySelectorAll('.pane-answer .history-confirm .btn')].find(
         (b) => (b.textContent || '').trim() === '删除',
       );
       if (!confirm) return { error: '点了叉号却没有出现确认按钮' };
       confirm.click();
       await sleep(600);
       const after = countRecords();
       const openAgain = [...document.querySelectorAll('.pane-answer .domain-trigger')].find((b) =>
         (b.textContent || '').includes('批改记录'),
       );
       /*
        * 删完之后下拉往往还开着，那时再点一次触发器等于把它**关掉**（读到的就是 0 条）。
        * 因此先看菜单在不在，不在才点开。
        */
       if (!document.querySelector('.pane-answer .domain-menu') && openAgain) {
         openAgain.click();
         await sleep(350);
       }
       const itemsAfter = document.querySelectorAll('.pane-answer .domain-item').length;
       return { before, itemsBefore, askText, after, itemsAfter, notice: (document.querySelector('.notice')?.textContent || '').trim() };
     })()`,
  )
  console.log('删记录 =', JSON.stringify(deletion))
  check(deletion?.itemsBefore >= 1, `下拉里列出了这一页的批改记录（${deletion?.itemsBefore} 条）`, JSON.stringify(deletion))
  check(
    (deletion?.askText ?? '').includes('删除') && (deletion?.askText ?? '').includes('取消'),
    '点叉号先问一句「删除 / 取消」（误点不能不可挽回）',
    JSON.stringify(deletion?.askText),
  )
  check(
    deletion?.after === (deletion?.before ?? 0) - 1,
    `删掉之后练习记录里也少了一条（${deletion?.before} → ${deletion?.after}，两处读的是同一份数据）`,
    JSON.stringify(deletion),
  )
  check(
    deletion?.itemsAfter === (deletion?.itemsBefore ?? 0) - 1,
    `下拉里也少了一条（${deletion?.itemsBefore} → ${deletion?.itemsAfter}）`,
    JSON.stringify(deletion),
  )

  /*
   * ── 分割线位置记不记得住（第 5 条）──
   * 用户原话："所有界面可移动分割线的位置需要个性化记忆，下次打开时按照相同位置的分割线展示。"
   * 追问"双击恢复默认算不算数"时他答："你走的时候什么位置，下次回来之后，还是在那个位置"——
   * 因此恢复默认（自动布局）也必须记住。
   */
  console.log('\n== 分割线位置记忆（第 5 条）==')
  const splitMemory = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const split = document.querySelector('.split');
       const handle = document.querySelector('.splitter-v');
       if (!split || !handle) return { error: '找不到四栏或竖分割线' };
       const styles = () => split.getAttribute('style') || '';
       const before = styles();
       const rect = handle.getBoundingClientRect();
       const fire = (type, x) =>
         handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: rect.top + 5, pointerId: 1 }));
       fire('pointerdown', rect.left);
       await sleep(60);
       fire('pointermove', rect.left + 180);
       await sleep(60);
       fire('pointerup', rect.left + 180);
       await sleep(300);
       const dragged = styles();
       return { before, dragged, manual: split.classList.contains('split-manual') };
     })()`,
  )
  console.log('分割线 =', JSON.stringify(splitMemory))
  check(splitMemory?.manual === true, '拖过之后切成手动比例（split-manual）', JSON.stringify(splitMemory))
  check((splitMemory?.dragged ?? '').includes('--col-left'), '位置写进了内联样式（--col-left）', JSON.stringify(splitMemory))
  await cdp.send('Page.reload')
  await sleep(2400)
  const splitAfterReload = await cdp.evaluate(
    `(() => {
       const split = document.querySelector('.split');
       return {
         style: split?.getAttribute('style') || '',
         manual: !!split?.classList.contains('split-manual'),
         stored: window.localStorage.getItem('translation-practice.split-layout.v1'),
       };
     })()`,
  )
  console.log('刷新之后的分割线 =', JSON.stringify(splitAfterReload))
  check(
    splitAfterReload?.manual === true && splitAfterReload?.style === splitMemory?.dragged,
    '刷新之后分割线还在你放的那个位置（第 5 条：个性化记忆）',
    JSON.stringify(splitAfterReload),
  )
  // 双击恢复默认 —— 用户口径："你走的时候什么位置，下次回来还是那个位置"，因此这一下也要记住
  const afterReset = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const read = () => window.localStorage.getItem('translation-practice.split-layout.v1');
       const handle = document.querySelector('.splitter-v');
       const before = read();
       handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
       await sleep(50);
       const at50 = read();
       await sleep(400);
       const at450 = read();
       const split = document.querySelector('.split');
       return {
         before,
         at50,
         at450,
         manual: !!split?.classList.contains('split-manual'),
         style: split?.getAttribute('style') || '',
         stored: read(),
       };
     })()`,
  )
  check(afterReset?.manual === false, '双击恢复默认：回到自动比例', JSON.stringify(afterReset))
  console.log('恢复默认之后 =', JSON.stringify(afterReset))
  await cdp.send('Page.reload')
  await sleep(2400)
  const splitAfterResetReload = await cdp.evaluate(
    `({
       manual: !!document.querySelector('.split')?.classList.contains('split-manual'),
       style: document.querySelector('.split')?.getAttribute('style') || '',
     })`,
  )
  check(
    splitAfterResetReload?.manual === false && splitAfterResetReload?.style === '',
    '刷新之后仍然是自动比例——"恢复默认"也是你走的时候那个位置（记的是自动，不是上一次拖过的值）',
    JSON.stringify(splitAfterResetReload),
  )

  /*
   * ── 记住"正在看的是第几次批改"（第 10 条）──
   * 用户原话："切换下一段，再切换回来时……对于批改后的界面，我希望能记住显示的是批改的第几次，
   * 而不是每次都默认回到批改的最新一次的页面。"
   *
   * 判据取「批改记录」下拉触发器上那行小字：在看某一次时写的是"第 N 次 · 时间"，
   * 没在看时写的是"共 N 次"——一眼可分。
   */
  console.log('\n== 记住正在看第几次（第 10 条）==')
  const rememberRound = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const trigger = () =>
         [...document.querySelectorAll('.pane-answer .domain-trigger')].find((b) =>
           (b.textContent || '').includes('批改记录'),
         );
       const triggerText = () => (trigger()?.textContent || '').trim();
       /* 找一页有**两次以上**批改记录的页（下面要比"第几次"） */
       let found = false;
       for (let page = 0; page < 6; page++) {
         const t = trigger();
         if (t) {
           t.click();
           await sleep(300);
           const items = document.querySelectorAll('.pane-answer .domain-item').length;
           if (items >= 2) { found = true; break; }
           t.click();
           await sleep(200);
         }
         const next = document.querySelector('.section-nav [data-nav="next"]');
         if (!next || next.disabled) break;
         next.click();
         await sleep(350);
       }
       if (!found) return { error: '没找到有两条以上批改记录的页' };
       const before = triggerText();
       /* 选**较旧**的那一次（列表最新的在前，因此取第 2 条） */
       const items = [...document.querySelectorAll('.pane-answer .domain-item')];
       const pickedLabel = (items[1]?.textContent || '').trim();
       items[1].click();
       await sleep(400);
       const afterPick = triggerText();
       /* 翻到别的页再翻回来（末页没有「下一页」，那就反过来走一趟） */
       const nextBtn = document.querySelector('.section-nav [data-nav="next"]');
       const prevBtn = document.querySelector('.section-nav [data-nav="prev"]');
       if (nextBtn && !nextBtn.disabled) {
         nextBtn.click();
         await sleep(400);
         document.querySelector('.section-nav [data-nav="prev"]')?.click();
         await sleep(500);
       } else if (prevBtn && !prevBtn.disabled) {
         prevBtn.click();
         await sleep(400);
         document.querySelector('.section-nav [data-nav="next"]')?.click();
         await sleep(500);
       }
       const afterRoundTrip = triggerText();
       return { before, pickedLabel, afterPick, afterRoundTrip };
     })()`,
  )
  console.log('批改记录下拉 =', JSON.stringify(rememberRound))
  check(
    /第\s*\d+\s*次/.test(rememberRound?.afterPick ?? ''),
    `选了一次之后下拉上写着"第 N 次"（${rememberRound?.afterPick}）`,
    JSON.stringify(rememberRound),
  )
  check(
    rememberRound?.afterRoundTrip === rememberRound?.afterPick,
    `翻到下一页再翻回来，看的**仍是那一次**，不会弹回最新一次（${rememberRound?.afterRoundTrip}）`,
    JSON.stringify(rememberRound),
  )
  await cdp.send('Page.reload')
  await sleep(2400)
  const rememberedAfterReload = await cdp.evaluate(
    `(() => {
       const t = [...document.querySelectorAll('.pane-answer .domain-trigger')].find((b) =>
         (b.textContent || '').includes('批改记录'),
       );
       return { text: (t?.textContent || '').trim() };
     })()`,
  )
  check(
    rememberedAfterReload?.text === rememberRound?.afterPick,
    `刷新之后记着的还是那一次（${rememberedAfterReload?.text}；落盘了，不只是内存）`,
    JSON.stringify(rememberedAfterReload),
  )

  /*
   * ── 最高分标签会跟着批改写（第 12 条）──
   * 前面已经批过好几页，因此当前这一篇的最高分应当是**真实分数**，不再是 0 分。
   */
  console.log('\n== 文章卡片上的最高分（第 12 条）==')
  const bestAfterGrading = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const open = [...document.querySelectorAll('.pane-source .pane-head .btn')].find((b) =>
         (b.textContent || '').includes('选择文章'),
       );
       if (!open) return { error: '找不到「选择文章」入口' };
       open.click();
       await sleep(700);
       const active = document.querySelector('.article-card-active');
       const value = (active?.querySelector('.article-card-best')?.textContent || '').trim();
       const all = [...document.querySelectorAll('.article-card-best')].map((b) => b.textContent.trim());
       document.querySelector('.raw-modal-close')?.click();
       await sleep(300);
       return { value, all, count: all.length };
     })()`,
  )
  console.log('最高分 =', JSON.stringify(bestAfterGrading))
  check(
    /^最高分\s*\d+\s*分$/.test(bestAfterGrading?.value ?? ''),
    `当前这一篇的卡片上有最高分标签（${bestAfterGrading?.value}）`,
    JSON.stringify(bestAfterGrading),
  )
  check(
    Number.parseInt((bestAfterGrading?.value ?? '').replace(/\D+/g, ''), 10) > 0,
    `批过之后它显示的是真实分数（${bestAfterGrading?.value}），不再是 0 分`,
    JSON.stringify(bestAfterGrading),
  )

  /*
   * ── 大改档的版式（第 4 条）──
   *
   * 用户对第 4 条的答复："相当于分成左右两个部分，左边部分再分成上下两个部分，
   * 左上角为原文，左下角为总评，右边整个为批改界面。"
   * 落地方式是只加一个类 `.split-refine`（样式表里用 `display: contents` 把那两排摊开），
   * 因此这里量的是**真实矩形**：右栏是不是整栏高、左栏是不是上下两块、右下角那一栏有没有了。
   */
  console.log('\n== 大改档的版式（第 4 条）==')
  const refineLayout = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const setValue = (el, value) => {
         const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
         setter.call(el, value);
         el.dispatchEvent(new Event('input', { bubbles: true }));
       };
       const answerForPage = ${answerForPage.toString()};
       /* 站到一页可写的页上：历史视图先「回到作答」，只读的页按「返回编辑」，都不行就翻页 */
       for (let page = 0; page < 8 && !document.querySelector('.answer-input'); page++) {
         const backToWriting = [...document.querySelectorAll('.pane-answer .btn')].find(
           (b) => (b.textContent || '').trim() === '回到作答',
         );
         if (backToWriting) { backToWriting.click(); await sleep(400); continue; }
         const unlock = [...document.querySelectorAll('.pane-answer .btn')].find(
           (b) => (b.textContent || '').trim() === '返回编辑',
         );
         if (unlock) { unlock.click(); await sleep(400); continue; }
         const step = document.querySelector('.section-nav [data-nav="next"]');
         if (!step || step.disabled) break;
         step.click();
         await sleep(350);
       }
       const area = document.querySelector('.answer-input');
       if (!area) return { error: '找不到可写的作答框' };
       const source = (document.querySelector('.pane-source .source-text')?.textContent || '').trim();
       /* 先切档位到大改，再填一段"过得了门"的新作答 */
       const levelBtn = [...document.querySelectorAll('.level-btn')].find((b) => (b.textContent || '').trim() === '大改');
       if (!levelBtn) return { error: '找不到「大改」档位按钮' };
       levelBtn.click();
       await sleep(300);
       setValue(area, answerForPage(source, 7) + '\\n（大改版式验收用的作答）');
       await sleep(250);
       const callsBefore = window.__judgeCalls.length;
       document.querySelector('.pane-answer .btn-primary').click();
       let got = null;
       for (let i = 0; i < 80; i++) {
         if (document.querySelector('.pane-answer .compare-list')) { got = window.__judgeCalls.length - callsBefore; break; }
         const err = document.querySelector('.error-block');
         if (err) return { error: '页面报错：' + (err.textContent || '').slice(0, 200) };
         await sleep(200);
       }
       if (got === null) {
         const toast = (document.querySelector('.toast')?.textContent || '').trim();
         return { error: '大改提交之后没有出现对照列表' + (toast ? '；吐司：' + toast : '') };
       }
       await sleep(600);
       const rect = (sel) => {
         const node = document.querySelector(sel);
         if (!node) return null;
         const box = node.getBoundingClientRect();
         return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), w: Math.round(box.width), h: Math.round(box.height) };
       };
       const split = rect('.split');
       const sourcePane = rect('.pane-source');
       const scorePane = rect('.pane-score');
       const answerPane = rect('.pane-answer');
       const notesPane = (() => {
         const node = document.querySelector('.pane-notes');
         if (!node) return null;
         const style = getComputedStyle(node);
         return { display: style.display, w: Math.round(node.getBoundingClientRect().width), h: Math.round(node.getBoundingClientRect().height) };
       })();
       return {
         calls: got,
         hasRefineClass: !!document.querySelector('.split-refine'),
         splitSpans: { source: !!document.querySelector('.pane-source'), answer: !!document.querySelector('.pane-answer') },
         geometry: { split, sourcePane, scorePane, answerPane, notesPane },
         labels: {
           source: (document.querySelector('.pane-answer .compare-label-source')?.textContent || '').trim(),
           original: (document.querySelector('.compare-original .compare-label')?.textContent || '').trim(),
           corrected: (document.querySelector('.compare-corrected .compare-label')?.textContent || '').trim(),
         },
         sourceLines: document.querySelectorAll('.pane-answer .compare-source').length,
         noteLines: document.querySelectorAll('.pane-answer .compare-note').length,
         scorePaneText: (document.querySelector('.pane-score')?.textContent || '').trim(),
         scoreChips: [...document.querySelectorAll('.pane-score .chip')].map((c) => (c.textContent || '').trim()),
         historyScoreCells: [...document.querySelectorAll('.pane-answer .domain-item')].map((n) => (n.textContent || '').trim()).slice(0, 3),
       };
     })()`,
  )
  console.log('大改版式 =', JSON.stringify(refineLayout))
  check(!refineLayout?.error, '大改档能提交并拿到对照', refineLayout?.error)
  if (!refineLayout?.error) {
    check(refineLayout.hasRefineClass === true, '大改档用的是它自己那套版式（.split-refine）')
    const g = refineLayout.geometry ?? {}
    check(
      g.answerPane && g.split && Math.abs(g.answerPane.top - g.split.top) <= 3 && Math.abs(g.answerPane.bottom - g.split.bottom) <= 3,
      `右栏是**整栏**（对照从上到下占满：${g.answerPane?.top}→${g.answerPane?.bottom}，整块 ${g.split?.top}→${g.split?.bottom}）`,
    )
    check(
      g.sourcePane && g.scorePane && g.sourcePane.bottom <= g.scorePane.top + 1,
      `左栏分成上下两块（原文 ${g.sourcePane?.top}→${g.sourcePane?.bottom}，总评 ${g.scorePane?.top}→${g.scorePane?.bottom}）`,
    )
    check(
      g.answerPane && g.scorePane && g.scorePane.right <= g.answerPane.left,
      '左下角那块**在左栏里**（总评的右边缘不越过对照栏的左边缘）',
    )
    check(
      g.notesPane === null || g.notesPane.display === 'none' || g.notesPane.h === 0,
      `右下角「批注详情」那一栏**整块不画了**（${JSON.stringify(g.notesPane)}）`,
    )
    check(
      refineLayout.labels.source === '原文' &&
        refineLayout.labels.original === '我的译文' &&
        refineLayout.labels.corrected === '修改译文',
      `三行的标签是「原文 / 我的译文 / 修改译文」（实际 ${JSON.stringify(refineLayout.labels)}）`,
    )
    check(
      refineLayout.sourceLines >= 1 && refineLayout.noteLines >= 1,
      `每组是"一句原文 + 一句我的译文 + 一句修改译文 + 一段说明"（原文行 ${refineLayout.sourceLines}、说明 ${refineLayout.noteLines}）`,
    )
    check(
      (refineLayout.scorePaneText ?? '').includes('大改档不打分') && !/\d/.test(refineLayout.scorePaneText ?? ''),
      `左下角只写「大改档不打分」，一个数字都没有（实际 ${JSON.stringify((refineLayout.scorePaneText ?? '').slice(0, 40))}）`,
    )
    check(
      (refineLayout.historyScoreCells ?? []).every((text) => !/\d+\s*分/.test(text)),
      `「批改记录」下拉里那几次也不再显示分数（${JSON.stringify(refineLayout.historyScoreCells)}）`,
    )
  }
  /*
   * ── 用户报的四件事：叉号删不掉、按钮文案、"回到作答"、批改后还能点提交 ──
   *
   * ⚠️ 这里**用真实鼠标事件**（CDP Input.dispatchMouseEvent）点那颗叉号：
   * 用户遇到的现象是"点叉号下拉直接收起、而且什么都没删"，而脚本里原来的
   * `element.click()` **测不出这个 bug**（它只发一个 click 事件，走不到真实鼠标那条路）。
   */
  console.log('\n== 批改记录下拉：叉号、按钮文案（用户报的 1／3／4／6）==')
  {
    /*
     * ⚠️ 这里**用真实鼠标**点触发器（与下面点叉号同一套）：合成的 `element.click()`
     * 在某些状态下打不开这个下拉，而用户用的是真鼠标——验就要验用户那条路。
     */
    const triggerBox = await cdp.evaluate(
      `(() => {
         const wasOpen = !!document.querySelector('.pane-answer .domain-menu');
         if (wasOpen) return { wasOpen: true };
         const trigger = [...document.querySelectorAll('.pane-answer .domain-trigger')].find((b) =>
           (b.textContent || '').includes('批改记录'),
         );
         if (!trigger) return { error: '这一页没有「批改记录」下拉' };
         const box = trigger.getBoundingClientRect();
         const x = Math.round(box.left + box.width / 2);
         const y = Math.round(box.top + box.height / 2);
         const hit = document.elementFromPoint(x, y);
         return {
           wasOpen: false,
           x, y,
           hitIsTrigger: hit === trigger || (hit ? trigger.contains(hit) : false),
           hit: hit ? String(hit.className || hit.tagName) : null,
         };
       })()`,
    )
    if (triggerBox && triggerBox.wasOpen === false && triggerBox.hitIsTrigger) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', {
          type,
          x: triggerBox.x,
          y: triggerBox.y,
          button: 'left',
          clickCount: 1,
        })
      }
      await sleep(350)
    }
    const beforeCross = await cdp.evaluate(
      `({
         open: !!document.querySelector('.pane-answer .domain-menu'),
         items: document.querySelectorAll('.pane-answer .domain-item').length,
         buttons: [...document.querySelectorAll('.pane-answer .btn-primary')].map((b) => (b.textContent || '').trim()),
         nav: (document.querySelector('.section-nav .hint') || {}).textContent || '',
       })`,
    )
    check(
      beforeCross?.open === true && (beforeCross?.items ?? 0) > 0,
      `「批改记录」下拉能用真实鼠标点开（${JSON.stringify(beforeCross)}）`,
      JSON.stringify({ triggerBox, beforeCross }),
    )

    /* 找到叉号的屏幕坐标，用真实鼠标点它 */
    const crossBox = await cdp.evaluate(
      `(() => {
         const node = document.querySelector('.pane-answer .history-delete');
         if (!node) return null;
         const box = node.getBoundingClientRect();
         const x = Math.round(box.left + box.width / 2);
         const y = Math.round(box.top + box.height / 2);
         const hit = document.elementFromPoint(x, y);
         return {
           x, y,
           box: { left: Math.round(box.left), top: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) },
           hit: hit ? String(hit.className || hit.tagName) : null,
           hitIsCross: hit === node,
         };
       })()`,
    )
    console.log('叉号的位置 =', JSON.stringify(crossBox))
    if (crossBox) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', {
          type,
          x: crossBox.x,
          y: crossBox.y,
          button: 'left',
          clickCount: 1,
        })
      }
    }
    await sleep(400)
    const afterCross = await cdp.evaluate(
      `({
         menuOpen: !!document.querySelector('.pane-answer .domain-menu'),
         hasConfirm: !!document.querySelector('.pane-answer .history-confirm'),
         confirmText: (document.querySelector('.pane-answer .history-confirm')?.textContent || '').trim(),
         menuHtml: (document.querySelector('.pane-answer .domain-menu')?.innerHTML || '').slice(0, 160),
       })`,
    )
    console.log('点叉号之后 =', JSON.stringify(afterCross))
    check(crossBox !== null, '下拉里有一颗删除叉号', JSON.stringify(crossBox))
    check(
      afterCross.menuOpen === true,
      '**真实鼠标点叉号，下拉不会收起**（用户报的：以前一点就关，还什么都没删）',
      JSON.stringify(afterCross),
    )
    check(
      afterCross.hasConfirm === true && afterCross.confirmText.includes('删除'),
      `叉号点左右就地展开「删除 / 取消」（${afterCross.confirmText}）`,
      JSON.stringify(afterCross),
    )
    /* 收尾：取消掉，别把记录删了（后面的断言还要用） */
    await cdp.evaluate(
      `[...document.querySelectorAll('.pane-answer .history-confirm .btn')].find((b) => (b.textContent || '').trim() === '取消')?.click()`,
    )
    await sleep(200)
  }

  {
    /*
     * 按钮文案（用户第 3／4／6 条）：
     *   1. 刚拿到批改（graded）→ 只有「返回编辑」，**看不到「提交批改」**；
     *   2. 从「批改记录」里翻出旧的一次看着 → 仍然是「返回编辑」，而且**没有「回到作答」**；
     *   3. 点它 → 回到作答框（历史视图一起退出）。
     */
    const gradedButtons = await cdp.evaluate(
      `(() => {
         const texts = [...document.querySelectorAll('.pane-answer .btn, .pane-answer .btn-primary')].map((b) =>
           (b.textContent || '').trim(),
         );
         return {
           texts,
           primary: (document.querySelector('.pane-answer .btn-primary')?.textContent || '').trim(),
           hasSubmit: texts.includes('提交批改'),
           hasReturn: texts.includes('返回编辑'),
           hasBackToWriting: texts.includes('回到作答'),
         };
       })()`,
    )
    console.log('批改后的按钮 =', JSON.stringify(gradedButtons))
    check(
      gradedButtons.hasReturn === true && gradedButtons.hasSubmit === false,
      '批改后的视图下：按钮是「返回编辑」，**没有可点的「提交批改」**（第 3、4 条）',
      JSON.stringify(gradedButtons),
    )

    const inHistory = await cdp.evaluate(
      `(async () => {
         const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
         const trigger = [...document.querySelectorAll('.pane-answer .domain-trigger')].find((b) =>
           (b.textContent || '').includes('批改记录'),
         );
         if (!trigger) return { error: '没有「批改记录」下拉' };
         /* 菜单可能还开着（上一段点过叉号又取消了），那就别再点一次触发器把它关掉 */
         if (!document.querySelector('.pane-answer .domain-menu')) {
           trigger.click();
           await sleep(300);
         }
         const items = [...document.querySelectorAll('.pane-answer .domain-item')];
         const last = items[items.length - 1];
         if (!last) return { error: '下拉里没有记录', count: items.length };
         last.click();
         await sleep(500);
         const texts = [...document.querySelectorAll('.pane-answer .btn, .pane-answer .btn-primary')].map((b) =>
           (b.textContent || '').trim(),
         );
         return {
           texts,
           triggerText: (trigger.textContent || '').trim(),
           hasReturn: texts.includes('返回编辑'),
           hasBackToWriting: texts.includes('回到作答'),
         };
       })()`,
    )
    console.log('翻旧记录时 =', JSON.stringify(inHistory))
    check(
      inHistory.hasBackToWriting === false,
      '「回到作答」已经删掉了（第 6 条）',
      JSON.stringify(inHistory),
    )
    check(
      inHistory.hasReturn === true,
      '正在看旧的那一次时，按钮也是「返回编辑」（第 3 条：不必先点「回到作答」再点一次）',
      JSON.stringify(inHistory),
    )

    const backToEdit = await cdp.evaluate(
      `(async () => {
         const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
         const btn = [...document.querySelectorAll('.pane-answer .btn-primary')].find(
           (b) => (b.textContent || '').trim() === '返回编辑',
         );
         if (!btn) return { error: '找不到「返回编辑」' };
         btn.click();
         await sleep(500);
         return {
           有作答框: document.querySelector('.answer-input') !== null,
           按钮: (document.querySelector('.pane-answer .btn-primary')?.textContent || '').trim(),
           下拉说: ([...document.querySelectorAll('.pane-answer .domain-trigger')]
             .find((b) => (b.textContent || '').includes('批改记录'))?.textContent || '').trim(),
         };
       })()`,
    )
    console.log('点返回编辑之后 =', JSON.stringify(backToEdit))
    check(
      backToEdit.有作答框 === true && backToEdit.按钮 === '提交批改',
      '点「返回编辑」→ 回到作答框，按钮变回「提交批改」',
      JSON.stringify(backToEdit),
    )
    check(
      !backToEdit.下拉说.includes('第'),
      `历史视图也一起退出了（下拉上不再写着"第 N 次"：${backToEdit.下拉说}）`,
    )
  }

  /*
   * ── 练习记录页：竖线能拖（第 5 条）──
   *
   * 用户报的是"右下角批注栏很窄、右边一大片空白"。根因是那一排**少了一条竖分割线**：
   * `.split-manual > .split-row` 按**三列**排（左 / 8px / 右），而记录页的底部那排
   * 原来只有两块内容（评分、批注）——一旦拖过任意一条分割线（现在还会落盘），
   * 批注就被塞进那 8px 的第二列、第三列空着。这里量真实矩形。
   */
  console.log('\n== 练习记录页的版式与拖动（第 5 条）==')
  /*
   * 先给这一节一个**明确的视口**：无头浏览器默认窗口很窄很矮
   * （实测 `.app` 只有 127px 高），那样量出来的"记录页版式"全是塌的，
   * 与用户看到的东西不是一回事。
   */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(400)
  const recordsLayout = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const tab = [...document.querySelectorAll('.mode-tab')].find((b) => (b.textContent || '').trim() === '练习记录');
       if (!tab) return { error: '导航栏里没有「练习记录」' };
       tab.click();
       await sleep(800);
       const first = document.querySelector('.record-item');
       if (!first) return { error: '练习记录页里没有记录可点' };
       first.click();
       await sleep(700);
       const nested = document.querySelector('.split-nested');
       if (!nested) return { error: '记录页右侧没有嵌套布局' };
       const rect = (sel) => {
         const node = document.querySelector(sel);
         if (!node) return null;
         const box = node.getBoundingClientRect();
         return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), w: Math.round(box.width), h: Math.round(box.height) };
       };
       const before = {
         nested: rect('.split-nested'),
         /* 容器链：量不到高度时才知道是哪一层塌了（用户报的"记录页版式"问题要靠它定位） */
         chain: ['.app', 'main.split-records', '.screen-right', '.split-nested'].map((sel) => {
           const node = document.querySelector(sel);
           const box = node?.getBoundingClientRect();
           return { sel, h: box ? Math.round(box.height) : null, display: node ? getComputedStyle(node).display : null };
         }),
         viewport: { w: window.innerWidth, h: window.innerHeight },
         bottomRowPanes: [...document.querySelectorAll('.split-nested > .split-row-bottom > .pane')].map((node) => {
           const box = node.getBoundingClientRect();
           return { cls: node.className.replace('pane ', ''), w: Math.round(box.width), right: Math.round(box.right) };
         }),
         bottomRowSplitters: document.querySelectorAll('.split-nested > .split-row-bottom > .splitter').length,
         hSplitter: rect('.split-nested > .splitter-h'),
         style: nested.getAttribute('style') || '',
       };
       /* 拖那条横线：上排该变矮、下排该变高 */
       const handle = document.querySelector('.split-nested > .splitter-h');
       if (!handle) return { error: '记录页里没有横分割线', before };
       const box = handle.getBoundingClientRect();
       const fire = (type, y) =>
         handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: box.left + 20, clientY: y, pointerId: 3 }));
       fire('pointerdown', box.top + 4);
       await sleep(80);
       fire('pointermove', box.top + 120);
       await sleep(80);
       fire('pointerup', box.top + 120);
       await sleep(400);
       const after = {
         style: nested.getAttribute('style') || '',
         manual: nested.classList.contains('split-manual'),
         topRowH: rect('.split-nested > .split-row-top')?.h ?? null,
         bottomRowH: rect('.split-nested > .split-row-bottom')?.h ?? null,
         bottomRowPanes: [...document.querySelectorAll('.split-nested > .split-row-bottom > .pane')].map((node) => {
           const box = node.getBoundingClientRect();
           return { cls: node.className.replace('pane ', ''), w: Math.round(box.width), right: Math.round(box.right) };
         }),
       };
       return { before, after };
     })()`,
  )
  console.log('记录页版式 =', JSON.stringify(recordsLayout))
  check(!recordsLayout?.error, '练习记录页能打开一条记录', recordsLayout?.error)
  if (!recordsLayout?.error) {
    const before = recordsLayout.before
    const after = recordsLayout.after
    check(
      before.bottomRowSplitters >= 1,
      `底部那一排有竖分割线（实际 ${before.bottomRowSplitters} 条）——缺了它，手动比例下批注栏会被塞进 8px 那一列`,
    )
    const panes = before.bottomRowPanes
    check(
      panes.length === 2 && Math.abs(panes[0].w - panes[1].w) <= 12,
      `评分与批注两栏宽度基本相等（${JSON.stringify(panes.map((p) => p.w))}）`,
    )
    check(
      panes.length === 2 && Math.abs(panes[1].right - (before.nested?.right ?? 0)) <= 3,
      `批注栏一直铺到右边缘（右边不该留一大片空白：批注右边缘 ${panes[1]?.right}、容器右边缘 ${before.nested?.right}）`,
    )
    check(after.manual === true && after.style.includes('--row-top'), '横分割线**拖得动**（拖完写成手动比例）', JSON.stringify(after))
    check(
      after.topRowH !== null && before.nested && after.topRowH > (before.hSplitter?.top ?? 0) - (before.nested.top ?? 0),
      `拖动之后上排真的变高了（${JSON.stringify({ 上排: after.topRowH, 下排: after.bottomRowH })}）`,
    )
  }

  // 收藏页：每一条要给出"这一处是从哪一段原文里来的"（用户要求：当前一段，不是整篇）
  await cdp.evaluate(
    `[...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '收藏').click()`,
  )
  await sleep(600)
  const favView = await cdp.evaluate(
    `({
       items: document.querySelectorAll('.fav-item').length,
       sources: [...document.querySelectorAll('.fav-source')].map((p) => p.textContent.trim().slice(0, 60)),
     })`,
  )
  check(favView.items >= 1, `收藏页里有 ${favView.items} 条`, JSON.stringify(favView))
  check(
    favView.sources.length === favView.items && favView.sources.every((text) => text.length > 20),
    `每条收藏都贴出"这一处所在的那一段原文"（不是整篇）：${JSON.stringify(favView.sources)}`,
  )
  console.log('返回上次批改 =', JSON.stringify(walked.returnToResult))
  check(walked.returnToResult?.点之前.有返回按钮 === true && (walked.returnToResult?.点之前.历史条数 ?? 0) >= 1, `按「返回编辑」之后打开「批改记录」，看得到这一页之前那几次（${walked.returnToResult?.点之前.历史条数} 条）`)
  check(walked.returnToResult?.点之后.有批注译文 === true, '点它就回到那份带批注的批改')
  check(walked.returnToResult?.点之后.有输入框 === false, '回去之后这一页又是只读的（没在作答状态）')
  check(walked.returnToResult?.点之后.又是只读 === true, '回去之后又能按「返回编辑」，可以再来一轮')
  check(walked.returnToResult?.新增调用 === 0, `回去看**不是**重新提交（多发 ${walked.returnToResult?.新增调用} 次请求）`)
  check(
    walked.editedTurn.calls === 0,
    `改过之后翻页**没有**提交（多发 ${walked.editedTurn.calls} 次）`,
  )
  check(cdp.errors.length === 0, '整条流程没有页面异常', JSON.stringify(cdp.errors.slice(0, 3)))

  console.log('进度条 =', JSON.stringify(walked.progress))
  {
    const samples = walked.progress ?? []
    // 第一次采样往往还没轮到 React 重渲染（点完立刻读），因此从"出现过"的那些里看趋势
    const seen = samples.filter((item) => item.出现了)
    const widths = seen.map((item) => Number.parseFloat(String(item.宽度 || '0').replace('%', '')) || 0)
    check(seen.length > 0, `提交之后「我的译文」栏里出现了进度条（${samples.length} 次采样里 ${seen.length} 次看到）`)
    check(
      widths.length >= 2 && widths[widths.length - 1] >= widths[0] && widths[widths.length - 1] > widths[0],
      `进度条一点点往前走（采到的宽度：${widths.join(' → ')}）`,
      JSON.stringify(widths),
    )
    check(
      widths.every((width) => width <= 88),
      `等待期间进度条**不超过 88%**（不会假装走完）（采到的宽度：${widths.join(' → ')}）`,
    )
    check(
      seen.every((item) => (item.背景色 ?? '').includes('44, 107, 237')) ||
        (await cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`) ===
          '#6f9bff' &&
          seen.every((item) => (item.背景色 ?? '').includes('111, 155, 255'))),
      `进度条用的是站点主色（${seen[0]?.背景色}）——日间是 rgb(44, 107, 237)，暗夜是 rgb(111, 155, 255)`,
    )
    check(
      seen.every((item) => Number.parseFloat(String(item.高度 || '99')) <= 4),
      `进度条比较细（${seen[0]?.高度}）`,
    )
    check(
      seen.every((item) => item.在标题栏下面 === true && item.在作答框上面 === true),
      '进度条的位置在「我的译文」标题栏下方、作答框上方',
    )
  }

  console.log('行距 =', JSON.stringify(walked.lineHeights))
  {
    const correction = Number.parseFloat(String(walked.lineHeights?.批改视图.行高 ?? ''))
    const font = Number.parseFloat(String(walked.lineHeights?.批改视图.根字号 ?? '16')) || 16
    check(
      Number.isFinite(correction) && correction > 0,
      `批改视图量到了行高（${walked.lineHeights?.批改视图.行高}）`,
      JSON.stringify(walked.lineHeights?.批改视图),
    )
    /*
     * 行距口径是"设置里多少就是多少"（默认 1.6，范围 1–3），
     * 因此这里按行高与字号的比值判：默认值下应当在 1.6 倍上下，而且要在 1–3 这个区间里。
     * 不再要求"加倍"——那一版已经按用户要求取消了。
     */
    const em = correction / font
    check(em > 1 && em <= 3, `批改视图的行距在 1–3 之间（实测 ${em.toFixed(2)} 倍）`)
    /*
     * 要求"明显更疏"，而不是钉死一个像素：行距来自设置（默认 3）再乘一倍，
     * 因此这里按"相对字号"判：批改视图的行高应当 ≥ 字号的 4 倍。
     * 这样换字号、换默认值都不会误报，而"没加倍"一定会被抓到。
     */
    check(walked.lineHeights?.对照视图.切过去了 === true, '能切到对照视图')
    check(walked.lineHeights?.对照视图.有对照列表 === true, '对照视图仍然是"一句对一句"的清单')
    check(
      walked.lineHeights?.对照视图.有批注译文 === false,
      '对照视图里没有带勾画的译文（它与行距设置无关）',
    )
    check(
      walked.lineHeights?.切回批改视图.行高 === walked.lineHeights?.批改视图.行高,
      '切回批改视图后行距还是加大后的那个值',
    )
  }

  /*
   * 发给模型的 `source` 只能是**当前这一页**的原文（用户要求"不要把整篇原文都发过去"）。
   *
   * 判据是"与这一页屏幕上那段逐字相同"，不是"比整篇短"——后者会误判：
   * 8 页里第 2 页本身就比别的页长，拿它跟"整篇"比长度根本说明不了问题（我第一版就这么写错了）。
   * 注意 requests 与 pageSources 一一对应：每页各提交一次，顺序相同。
   */
  const sourceMismatch = walked.requests
    .map((request, index) => ({
      page: index + 1,
      发出的: (request.source || '').slice(0, 24),
      这一页的: (walked.pageSources?.[index] ?? '').slice(0, 24),
      一致: (request.source || '').trim() === (walked.pageSources?.[index] ?? '').trim(),
    }))
    .filter((item) => !item.一致)
  check(
    sourceMismatch.length === 0,
    '每一次请求发的原文都只是**那一页**（不是整篇）——与屏幕上那一页逐字相同',
    JSON.stringify(sourceMismatch),
  )
  check(
    walked.requests.every((request) => (request.source || '').trim().length > 0),
    '每一次请求都带着它那一页的原文（不会串到别的页）',
  )

  console.log(
    '请求里的原文 =',
    JSON.stringify(walked.requests.map((request) => `${(request.source || '').length}：${request.sourceHead}`)),
  )

  const failed = results.filter((item) => !item.ok)
  console.log(
    failed.length === 0
      ? `\n✓ 验收通过：${results.length} 项断言全过（翻页不提交、批改中可翻页、一次只批一页、` +
          `批完的通知可跳转、逐页提交不串页、翻回不重提）`
      : `\n✗ 验收未通过：${failed.length} / ${results.length} 项未过`,
  )
  process.exitCode = failed.length === 0 ? 0 : 1

  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
