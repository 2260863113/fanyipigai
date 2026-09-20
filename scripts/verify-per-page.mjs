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
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

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
      if (!url.includes('/api/judge')) return original(input, init);

      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (error) { body = {}; }
      const sections = body.answerSections || [];
      const submitted = sections.map((s) => s.text).join('\\n\\n');
      window.__judgeCalls.push({
        start: sections[0] ? sections[0].start : -1,
        text: submitted,
        direction: body.direction || '',
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

       // 「返回编辑」：结果作废、可以接着改，按钮变成手动的那个
       const mark = document.querySelector('.pane-answer [data-mark-id]');
       if (mark) mark.click();
       await sleep(400);
       const bubbleBefore = {
         卡片在: !!document.querySelector('.pane-answer .ann-bubble'),
         收藏按钮: (document.querySelector('.pane-answer .ann-bubble button')?.textContent || '').trim(),
       };
       const bubbleFavorite = document.querySelector('.pane-answer .ann-bubble button');
       if (bubbleFavorite) bubbleFavorite.click();
       await sleep(400);
       const bubbleAfter = {
         卡片在: !!document.querySelector('.pane-answer .ann-bubble'),
         收藏按钮: (document.querySelector('.pane-answer .ann-bubble button')?.textContent || '').trim(),
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
        * 「查看上次批改」：按「返回编辑」之后**一个字都没改**时，应该还能点回那份批改。
        * 点回去之后：结果回来、这一页重新只读、而且**不再发请求**（不是重新提交）。
        */
       let returnToResult = null;
       {
         const unlockBtn = [...document.querySelectorAll('.pane-answer .btn')]
           .find((b) => (b.textContent || '').trim() === '返回编辑');
         if (unlockBtn) unlockBtn.click();
         await sleep(500);
         const before = {
           有返回按钮: [...document.querySelectorAll('.pane-answer .btn')].some(
             (b) => (b.textContent || '').trim() === '查看上次批改',
           ),
           有输入框: document.querySelector('.answer-input') !== null,
         };
         const callsBeforeReturn = window.__judgeCalls.length;
         const back = [...document.querySelectorAll('.pane-answer .btn')]
           .find((b) => (b.textContent || '').trim() === '查看上次批改');
         if (back) back.click();
         await sleep(500);
         returnToResult = {
           点之前: before,
           点之后: {
             有批注译文: document.querySelector('.pane-answer .annotated-lines') !== null,
             有输入框: document.querySelector('.answer-input') !== null,
             又是只读: [...document.querySelectorAll('.pane-answer .btn')].some(
               (b) => (b.textContent || '').trim() === '返回编辑',
             ),
           },
           新增调用: window.__judgeCalls.length - callsBeforeReturn,
         };
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
          * 还没动字时：按钮是普通的「提交批改」，而且给着「查看上次批改」。
          * 改过字之后才会变成「提交批改（手动）」并撤掉「查看上次批改」——
          * 这两条在下面改字之后各量一次。
          */
         有查看上次批改: [...document.querySelectorAll('.pane-answer .btn')].some(
           (b) => (b.textContent || '').trim() === '查看上次批改',
         ),
       };

       // 改一个字，再翻到下一页：改过的页**不该**自动提交
       const area2 = document.querySelector('.answer-input');
       if (area2) { setValue(area2, '改过之后的内容'); await sleep(250); }
       const afterEdit = {
         按钮: (document.querySelector('.pane-answer .btn-primary')?.textContent || '').trim(),
         有查看上次批改: [...document.querySelectorAll('.pane-answer .btn')].some(
           (b) => (b.textContent || '').trim() === '查看上次批改',
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

       return {
         total,
         sources,
         trace,
         callsAfterAll,
         revisit,
         afterUnlock,
         afterEdit,
         editedTurn,
         lineHeights,
         bubbleBefore,
         bubbleAfter,
         favoriteCount,
         favoriteStored,
         returnToResult,
         requests: window.__judgeCalls.map((call) => ({
           start: call.start,
           text: call.text.slice(0, 30),
           answerSectionCount: call.answerSectionCount,
           sourceSectionCount: call.sourceSectionCount,
           body: call.body,
         })),
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
  check(walked.afterUnlock.hasInput && !walked.afterUnlock.hasAnnotated, '点「返回编辑」回到作答框，可以接着改')
  check(
    walked.afterUnlock.button === '提交批改',
    `还没动字时按钮是普通的「提交批改」（实际 ${JSON.stringify(walked.afterUnlock.button)}）`,
  )
  check(walked.afterUnlock.有查看上次批改, '还没动字时给着「查看上次批改」')
  console.log('改过之后 =', JSON.stringify(walked.afterEdit))
  check(
    walked.afterEdit.按钮.includes('手动'),
    `改过字之后按钮变成手动的「提交批改（手动）」（实际 ${JSON.stringify(walked.afterEdit.按钮)}）`,
  )
  check(!walked.afterEdit.有查看上次批改, '改过字之后「查看上次批改」消失了（批注已经对不上那段文字）')
  console.log('小卡片收藏 =', JSON.stringify({ 点之前: walked.bubbleBefore, 点之后: walked.bubbleAfter, 收藏条数: walked.favoriteCount, 落盘内容: walked.favoriteStored }))
  check(walked.bubbleBefore.卡片在, '点一处勾画，小卡片出来了')
  check(walked.bubbleBefore.收藏按钮 === '收藏', '小卡片自己带一颗「收藏」按钮', walked.bubbleBefore.收藏按钮)
  check(walked.bubbleAfter.卡片在, '点小卡片里的「收藏」之后，卡片**不消失**（点它不算"点外面"）')
  check(walked.bubbleAfter.收藏按钮 === '已收藏', '收藏之后按钮文案变成「已收藏」', walked.bubbleAfter.收藏按钮)
  check(walked.favoriteCount === 1, `收藏落盘了（localStorage 里 ${walked.favoriteCount} 条）`)
  check(
    Boolean(walked.favoriteStored?.id) && (walked.favoriteStored?.why ?? '').length > 0 && (walked.favoriteStored?.整句 ?? '').length > 0,
    '落盘的这条带 id、说明与所在整句（不是只有个空壳）',
    JSON.stringify(walked.favoriteStored),
  )
  console.log('返回上次批改 =', JSON.stringify(walked.returnToResult))
  check(walked.returnToResult?.点之前.有返回按钮 === true, '按「返回编辑」之后，还能看到「查看上次批改」')
  check(walked.returnToResult?.点之后.有批注译文 === true, '点它就回到那份带批注的批改')
  check(walked.returnToResult?.点之后.有输入框 === false, '回去之后这一页又是只读的（没在作答状态）')
  check(walked.returnToResult?.点之后.又是只读 === true, '回去之后又能按「返回编辑」，可以再来一轮')
  check(walked.returnToResult?.新增调用 === 0, `回去看**不是**重新提交（多发 ${walked.returnToResult?.新增调用} 次请求）`)
  check(
    walked.editedTurn.calls === 0,
    `改过之后翻页**没有**自动提交（多发 ${walked.editedTurn.calls} 次）`,
  )
  check(cdp.errors.length === 0, '整条流程没有页面异常', JSON.stringify(cdp.errors.slice(0, 3)))

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
     * 要求"明显更疏"，而不是钉死一个像素：行距来自设置（默认 3）再乘一倍，
     * 因此这里按"相对字号"判：批改视图的行高应当 ≥ 字号的 4 倍。
     * 这样换字号、换默认值都不会误报，而"没加倍"一定会被抓到。
     */
    check(
      correction >= font * 4,
      `批改视图的行距确实加大了（行高 ${correction}px ≥ 字号 ${font}px 的 4 倍）`,
    )
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
