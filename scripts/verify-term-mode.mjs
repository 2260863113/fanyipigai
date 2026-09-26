/**
 * 验收术语模式（第 14 轮之后的术语题）：**下拉选板块 → 弹窗选分组 → 一页十条、一页一页翻、本地判分**。
 *
 * 为什么要在真浏览器里验：术语题是**另一条渲染路径**（不走 AnswerPane），
 * 而且这一轮的规矩几乎全是"时序 + 计数 + 版式"类的：
 *   - 「范围」下拉里是**五个板块**、点一个板块才弹窗、弹窗里**按分组**列——只有真 DOM 才看得出对不对；
 *   - 分组是"每 N 条一组"（当代术语 50、其余 20），点「确定」要落到**这一组的第一页**——
 *     页号算错不会报错，只会把人送到别的一组去；
 *   - 「参考译文」开关要在**原文栏**右对齐列出每一条的标准译法（不是"我的译文"栏）；
 *   - 术语模式**不画**左下「总体评分」与右下「批注详情」两栏（不是用样式藏起来），
 *     因此要量真实矩形：原文栏与译文栏各占一半、高度都顶到栏底；
 *   - 「没答完也能提交、但只有十条全答完才落练习记录」要数**落盘的记录条数**（内存里看不出来）；
 *   - 判分完全本地：要数**真的**发了几次 /api/judge（jsdom 里没有网络）。
 *
 * 老版脚本验的是第 13 轮那套（两个范围、每页五条、两屏弹窗），第 14 轮把
 * 范围改成五板块 + 分组、页长改成十条、"没答完不许提交"改成"没答完也能提交但不落库"、
 * 版式从四栏改成两栏，因此断言整批重写。
 *
 * 覆盖的规矩（与用户第 14 条的六项一一对应）：
 *   1. 「范围」是**下拉栏**、里面五个板块（国内/国际机关名称、当代术语、必背核心术语、必背用典），
 *      点一个板块**弹出窗口选分组**，分组名形如「国内机关名称|第1组（1-20）」；
 *   2. 国内机关名称每 20 条一组 → 5 组（末组 81-83），国际 3 组；点「确定」落到**该组第一页**；
 *   3. 一页 **10 条**（原文栏十行、作答栏十个框），页脚写着「第 N / 9 页」、末页三条；
 *   4. **没答完也能提交**：按钮不因"没写满"禁用；判分照常显示；但**不落练习记录**（落盘里数得出来），
 *      刷新之后这一页仍是作答框；十条全答完的那一次才留记录；
 *   5. 「参考译文」开关在「原文」右边，点开在**原文栏**右对齐给出每一条的标准译法、再点收起，
 *      末页缺的那几行不留空占位；
 *   6. 术语模式**不画**左下与右下两栏（`.pane-score` / `.pane-notes` 在 DOM 里就不存在），
 *      原文栏与译文栏**各占一半宽、各占满整高**；别的题型照旧四栏。
 *
 * 用法：node scripts/verify-term-mode.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const debugPort = 9239
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
const profileDir = path.join(root, 'node_modules', '.cache', 'verify-term-profile')
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

/**
 * 数接口调用的探针：把 `fetch` 换成一个记账的版本，每一次请求的 URL 都记下来。
 *
 * 为什么非要有它：术语题最要紧的一条就是**判分完全本地**——它不发 /api/judge，也不花接口钱。
 * 界面上完全看不出这件事（判分结果长得和 AI 批改一模一样），只有数请求才验得了。
 * 顺带把 /api/refine（大改档）一起数上：术语题两个都不该有。
 */
const apiProbe = `
  (() => {
    window.__apiCalls = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      window.__apiCalls.push(url);
      return original(input, init);
    };
  })();
`

/**
 * 页面里的小工具。
 *
 * 为什么要有一份：下面十几段断言都要"点下拉、点分组、读第几页、往第几行写字"，
 * 每一段里各抄一遍就会各写各的（翻页等待、值怎么写进去、页号怎么解析），
 * 而这类小事一旦有出入，失败的是测试自己而不是产品。
 */
const helpers = `
  window.__T = (() => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const q = (selector) => document.querySelector(selector);
    const qa = (selector) => [...document.querySelectorAll(selector)];
    const text = (selector) => (q(selector)?.textContent || '').trim();
    const texts = (selector) => qa(selector).map((node) => (node.textContent || '').trim());
    /** 页号一律从**页脚那句话**里读——那是屏幕上真正显示的东西，不是我们另存的一份状态 */
    const pageNo = () => {
      const hint = text('.pane-source .section-nav .hint');
      const matched = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(hint);
      return { index: matched ? Number(matched[1]) - 1 : -1, count: matched ? Number(matched[2]) : 0, hint };
    };
    const clickNav = async (which, pause) => {
      const button = q('.pane-source .section-nav [data-nav="' + which + '"]');
      if (!button || button.disabled) return false;
      button.click();
      await sleep(pause === undefined ? 200 : pause);
      return true;
    };
    /** 站到第 target 页上（0 基）；翻页只是翻页，因此这里不会顺手提交任何东西 */
    const goto = async (target) => {
      for (let guard = 0; guard < 60 && pageNo().index !== target; guard += 1) {
        const ok = await clickNav(pageNo().index < target ? 'next' : 'prev');
        if (!ok) return false;
      }
      return pageNo().index === target;
    };
    /**
     * 往输入框里写字。
     *
     * 必须用原生 setter + 派发 input 事件：React 的 onChange 挂的是 input 事件，
     * 直接改 element.value 它一个字都收不到（框里看着有字，state 却是空的）。
     */
    const setInput = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    /** 逐行填一页（末页那些禁用空框跳过——它本来就不该收字） */
    const fill = async (values) => {
      for (let row = 0; row < values.length; row += 1) {
        const element = qa('.pane-answer .term-input')[row];
        if (!element || element.disabled) continue;
        setInput(element, values[row]);
        await sleep(60);
      }
      return qa('.pane-answer .term-input').map((input) => input.value);
    };
    const inputs = () => qa('.pane-answer .term-input').map((input) => input.value);
    const primary = () => q('.pane-answer .pane-head .btn-primary');
    const apiCalls = () => (window.__apiCalls || []).slice();
    const judgeCalls = () => apiCalls().filter((url) => url.includes('/api/judge') || url.includes('/api/refine'));
    /** 弹窗底下那两颗按钮（返回 / 确定 / 关闭） */
    const clickFoot = async (label, pause) => {
      const button = [...document.querySelectorAll('.gen-foot .btn')].find(
        (item) => (item.textContent || '').trim() === label,
      );
      if (!button) return false;
      button.click();
      await sleep(pause === undefined ? 350 : pause);
      return true;
    };
    /** 打开「范围」下拉（五大板块那一层） */
    const openScopeMenu = async (pause) => {
      const trigger = q('.pane-source .domain-trigger');
      if (!trigger) return false;
      trigger.click();
      await sleep(pause === undefined ? 300 : pause);
      return Boolean(document.querySelector('.domain-menu'));
    };
    /** 下拉里的五个板块（名字 + 后面那句"多少条 · 几组"或"暂无分组" + 禁不禁用） */
    const scopeItems = () =>
      [...document.querySelectorAll('.domain-menu .domain-item')].map((item) => ({
        label: (item.firstChild?.textContent || '').trim(),
        note: (item.querySelector('.domain-item-note')?.textContent || '').trim(),
        disabled: item.disabled,
        active: item.classList.contains('domain-item-active'),
      }));
    /** 点下拉里的某个板块 → 它应该换成"分组列表"那一屏的弹窗 */
    const clickScopeItem = async (label, pause) => {
      const item = [...document.querySelectorAll('.domain-menu .domain-item')].find(
        (node) => (node.firstChild?.textContent || '').trim() === label,
      );
      if (!item || item.disabled) return false;
      item.click();
      await sleep(pause === undefined ? 400 : pause);
      return Boolean(document.querySelector('.scope-cards'));
    };
    /** 弹窗里的分组卡片（名字 + 说明 + 「正在练」标记） */
    const groupCards = () =>
      [...document.querySelectorAll('.scope-cards .scope-card')].map((card) => ({
        label: (card.querySelector('.scope-card-title')?.textContent || '').trim(),
        meta: (card.querySelector('.scope-card-meta')?.textContent || '').trim(),
        now: (card.querySelector('.scope-card-now')?.textContent || '').trim(),
        active: card.classList.contains('scope-card-active'),
        index: card.getAttribute('data-group-index'),
      }));
    /** 点某一张分组卡片 → 换到"中英对照平表"那一屏 */
    const clickGroupCard = async (label, pause) => {
      const card = [...document.querySelectorAll('.scope-cards .scope-card')].find(
        (node) => (node.querySelector('.scope-card-title')?.textContent || '').trim() === label,
      );
      if (!card) return false;
      card.click();
      await sleep(pause === undefined ? 400 : pause);
      return Boolean(document.querySelector('.scope-table-wrap'));
    };
    /** 那一屏对照表的每一行（中文 / 官方英文） */
    const tableRows = () =>
      [...document.querySelectorAll('.scope-table tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()),
      );
    /**
     * 走一遍某个板块的**全部分组**，把中英对照平表拼成一整张（国内机关名称 = 83 行）。
     *
     * 为什么期望值要从界面上取、而不是在这里另抄一份数据：这个脚本要验的是
     * "屏幕上那十条题干 / 标准译法，与分组表里那十行是不是同一批"——两边都从数据现抄，
     * 就变成自己证明自己（数据错了它也说对）。因此它把**界面上的表**当成答案表读回来，
     * 再拿它去对题干、对标准译法、对判分。
     *
     * 收尾会把弹窗关掉；调用方自己负责把页号挪回要用的那一页。
     */
    const collectBlockRows = async (blockLabel, pause) => {
      const rows = [];
      const wait = pause === undefined ? 220 : pause;
      if (!(await openScopeMenu(wait))) return rows;
      if (!(await clickScopeItem(blockLabel, wait))) return rows;
      const cards = groupCards();
      for (let i = 0; i < cards.length; i += 1) {
        await clickGroupCard(cards[i].label, wait);
        rows.push(...tableRows());
        await clickFoot('返回', wait);
      }
      await clickFoot('关闭', wait);
      return rows;
    };
    /** 落盘的练习记录（按题号 + 页号数条数——"没答完不落库"这条只能从这儿看） */
    const recordsFor = (exerciseId, sectionIndex) => {
      try {
        const raw = window.localStorage.getItem('translation-practice.records.v2');
        const list = raw ? JSON.parse(raw) : [];
        return list.filter((item) => item.exerciseId === exerciseId && item.sectionIndex === sectionIndex).length;
      } catch (error) {
        return -1;
      }
    };
    /** 落盘的"哪几页批过"（进度）——只返回那一串页号，断言里比它最直接 */
    const progressFor = (exerciseId) => {
      try {
        const raw = window.localStorage.getItem('translation-practice.article-progress.v1');
        const parsed = raw ? JSON.parse(raw) : {};
        const entry = parsed[exerciseId] ?? parsed.progress?.[exerciseId] ?? null;
        return Array.isArray(entry?.graded) ? entry.graded : [];
      } catch (error) {
        return [];
      }
    };
    /** 「参考译文」开关 */
    const referenceToggle = () => {
      const button = [...document.querySelectorAll('.pane-source .pane-head .btn')].find(
        (node) => (node.textContent || '').trim() === '参考译文',
      );
      return button ?? null;
    };
    const toggleReference = async (pause) => {
      const button = referenceToggle();
      if (!button) return false;
      button.click();
      await sleep(pause === undefined ? 300 : pause);
      return true;
    };
    const rect = (selector) => {
      const node = q(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), bottom: Math.round(box.bottom) };
    };
    return {
      sleep, q, qa, text, texts, pageNo, clickNav, goto, setInput, fill, inputs, primary,
      apiCalls, judgeCalls, clickFoot, openScopeMenu, scopeItems, clickScopeItem,
      groupCards, clickGroupCard, tableRows, collectBlockRows, recordsFor, progressFor,
      referenceToggle, toggleReference, rect,
    };
  })();
`

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
  /*
   * 先把视口定成桌面宽度。
   *
   * 为什么必须定：headless 默认只有 800×600，而顶栏那一行（站名 + 六栏导航 + 暗夜 / 设置）
   * 在这个宽度下**放不下**——最右那一组被挤窄、内部换行，于是它离右边缘一百多像素
   * （实测 101px），看上去像"设置没在最右边"，其实是视口太窄。产品是桌面尺寸的应用，
   * 量出来的也该是桌面尺寸（定成 1440 之后那一段差就是顶栏自己的 18px 内边距）。
   *
   * ⚠️ 别的 verify-*.mjs 只要量的是**版式几何**（顶栏最右、两栏宽度、等分线对齐之类），
   * 同样要先定视口——verify-article-bar.mjs 量「设置在最右」时也会踩到同一条。
   */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: apiProbe })

  await cdp.send('Page.navigate', { url: `${base}/` })
  await sleep(1200)
  /*
   * 清掉上一次跑留下的存档再重载。
   *
   * 术语题按「板块 + 方向」分成十道独立的题（term-v3-<板块>-<方向>），
   * 作答、进度、页状态全按题号分开存，因此**上一轮的记录会原样接着用**：
   * 不清的话"第 1 页还没批过""草稿是空的"这些前提全都不成立，量到的是上一轮的样子。
   * （顺带把 last-view 一起清掉，免得一进来就落在上次那一页上。）
   */
  await cdp.evaluate(
    `(() => {
       try { window.localStorage.clear(); } catch (error) {}
       return true;
     })()`,
  )
  await cdp.send('Page.reload')
  let mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  if (!mounted) throw new Error('界面没有挂载')
  await cdp.evaluate(helpers)
  await sleep(400)

  try {
    console.log('\n=== 1. 切到术语栏：标题栏是「参考译文」+「范围 + 方向」，一页十条，只有两栏 ===')
    const enter = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const tab = [...document.querySelectorAll('.mode-tab')].find((b) => (b.textContent || '').trim() === '术语');
         if (!tab) return { error: '顶栏没有「术语」这一栏' };
         tab.click();
         await T.sleep(800);
         const head = T.q('.pane-source .pane-head');
         const meta = head ? head.querySelector('.head-meta') : null;
         const trigger = head ? head.querySelector('.domain-trigger') : null;
         const dir = head ? head.querySelector('.dir-switch') : null;
         const headButtons = T.qa('.pane-source .pane-head .btn').map((b) => (b.textContent || '').trim());
         const submit = T.primary();
         const main = T.q('main.split');
         const panes = T.qa('main.split .pane');
         const splitters = T.qa('main.split .splitter');
         const sourceRect = T.rect('.pane-source');
         const answerRect = T.rect('.pane-answer');
         const mainRect = T.rect('main.split');
         const sourceRows = T.qa('.pane-source .term-source-row');
         const refRow = sourceRows[0];
         return {
           activeTab: T.text('.mode-tab.mode-tab-active'),
           mainClass: main ? main.className : null,
           hasTermClass: Boolean(main && main.classList.contains('split-term')),
           paneCount: panes.length,
           paneClasses: panes.map((node) => (node.className || '').split(' ').filter((c) => c.startsWith('pane-')).join('')),
           splitterCount: splitters.length,
           scoreInDom: Boolean(T.q('.pane-score')),
           notesInDom: Boolean(T.q('.pane-notes')),
           rowsInDom: T.qa('main.split .split-row').length,
           headChildren: meta ? [...meta.children].map((node) => ((node.className || node.tagName) + '').split(' ')[0]) : [],
           headButtons,
           referenceLabel: T.referenceToggle() ? (T.referenceToggle().textContent || '').trim() : null,
           referencePressed: T.referenceToggle() ? T.referenceToggle().getAttribute('aria-pressed') : null,
           rangeLabel: T.text('.pane-source .domain-trigger-label'),
           rangeValue: T.text('.pane-source .domain-trigger-value'),
           carets: T.texts('.pane-source .domain-trigger-caret'),
           dirLabels: T.texts('.pane-source .dir-btn'),
           dirActive: T.text('.pane-source .dir-btn-active'),
           dirDisabled: T.qa('.pane-source .dir-btn').map((b) => b.disabled),
           hasRotate: headButtons.some((label) => label === '换一换'),
           hasGenerator: headButtons.some((label) => label === 'AI 出题'),
           sourceRows: sourceRows.length,
           rowHasRefBeforeToggle: Boolean(refRow && refRow.querySelector('.term-source-ref')),
           sourceIndexes: T.texts('.pane-source .term-source-index'),
           sourceTexts: T.texts('.pane-source .term-source-text'),
           answerRows: T.qa('.pane-answer .term-row').length,
           inputs: T.qa('.pane-answer .term-input').length,
           chips: T.texts('.pane-answer .pane-head .chip'),
           submitLabel: submit ? (submit.textContent || '').trim() : null,
           submitDisabled: submit ? submit.disabled : null,
           navInSource: Boolean(T.q('.pane-source .pane-foot.section-nav')),
           hint: T.pageNo(),
           sourceRect, answerRect, mainRect,
           topbarHasFixtureChip: (T.q('.topbar')?.innerText || '').includes('内置示例批改'),
         };
       })()`,
    )
    if (enter?.error) throw new Error(enter.error)

    check(enter.activeTab === '术语', `切到了术语栏（当前 ${enter.activeTab}）`)
    /*
     * 第 5 条：「参考译文」开关在**「原文」两个字的右边**——也就是标题栏 head-meta 的第一个控件。
     * 它排在「范围」之前是有意的（见 SourcePane 的注释）：先看这一栏怎么显示，再谈换哪一题。
     */
    check(
      enter.headChildren[0] === 'btn' && enter.referenceLabel === '参考译文',
      `「参考译文」开关就在「原文」右边（标题栏第一个控件是 ${JSON.stringify(enter.headChildren)}）`,
      JSON.stringify({ headChildren: enter.headChildren, label: enter.referenceLabel }),
    )
    check(
      enter.referencePressed === 'false' && enter.rowHasRefBeforeToggle === false,
      '一进来开关是**收起**的，原文栏里没有任何标准译法',
      JSON.stringify({ pressed: enter.referencePressed, 有标准译法: enter.rowHasRefBeforeToggle }),
    )
    check(
      enter.rangeLabel === '范围' && enter.rangeValue === '国内机关名称' && enter.carets.join('') === '▾',
      `「范围」还是那颗下拉按钮（写着「范围 · ${enter.rangeValue} ▾」）`,
      JSON.stringify({ label: enter.rangeLabel, value: enter.rangeValue, carets: enter.carets }),
    )
    check(
      enter.headChildren[1] === 'domain-select' && enter.headChildren[2] === 'dir-switch',
      `顺序是「参考译文 → 范围 → 方向」（实际 ${JSON.stringify(enter.headChildren)}）`,
      JSON.stringify(enter.headChildren),
    )
    check(
      enter.dirLabels.join(',') === '中译英,英译中' && enter.dirDisabled.every((flag) => flag === false),
      '方向两段「中译英 / 英译中」都在，而且**两个都能点**（每条术语两侧都有材料）',
      JSON.stringify({ labels: enter.dirLabels, disabled: enter.dirDisabled }),
    )
    check(enter.dirActive === '中译英', `默认方向是中译英（${enter.dirActive}）`)
    check(
      enter.hasRotate === false && enter.hasGenerator === false,
      '标题栏里没有「换一换」「AI 出题」（术语题只来自那几个板块：没有备选篇目、也没有页码）',
      JSON.stringify(enter.headButtons),
    )

    /*
     * 第 3 条：一页十条（原文栏十行、作答栏十个框）。
     * 第 6 条：四栏变两栏——**DOM 里就没有**左下与右下那两栏，只剩一个竖向分隔条。
     */
    check(enter.sourceRows === 10, `原文栏一页画十行（实际 ${enter.sourceRows} 行）`)
    check(
      enter.sourceIndexes.join(',') === '1,2,3,4,5,6,7,8,9,10',
      '十行各带序号 1–10（一眼看出哪个框对应哪条术语）',
      JSON.stringify(enter.sourceIndexes),
    )
    check(
      enter.sourceTexts.length === 10 && enter.sourceTexts.every((item) => item.length > 0),
      `第 1 页十条术语都画出来了：${enter.sourceTexts.slice(0, 3).join(' ｜ ')} …`,
    )
    check(enter.answerRows === 10 && enter.inputs === 10, `作答栏也是十行十个框（行 ${enter.answerRows} / 框 ${enter.inputs}）`)
    check(
      enter.hasTermClass === true && enter.mainClass.includes('split-term'),
      `版式类挂在 main 上：${enter.mainClass}`,
      enter.mainClass,
    )
    check(
      enter.scoreInDom === false && enter.notesInDom === false,
      '左下「总体评分」与右下「批注详情」在**DOM 里就不存在**（不是用样式藏起来——那样分隔条还拖得动）',
      JSON.stringify({ score: enter.scoreInDom, notes: enter.notesInDom }),
    )
    check(
      enter.paneCount === 2 && enter.splitterCount === 1,
      `术语模式只剩两块 pane 与一条分隔条（实际 ${enter.paneCount} 块 / ${enter.splitterCount} 条）`,
      JSON.stringify({ panes: enter.paneClasses, splitters: enter.splitterCount }),
    )
    check(
      enter.paneCount === 2 &&
        Math.abs((enter.sourceRect?.w ?? 0) - (enter.answerRect?.w ?? 0)) <= 2 &&
        (enter.sourceRect?.w ?? 0) > 0,
      `原文栏与作答栏**各占一半宽**（${enter.sourceRect?.w}px / ${enter.answerRect?.w}px）`,
      JSON.stringify({ source: enter.sourceRect, answer: enter.answerRect }),
    )
    check(
      Math.abs((enter.sourceRect?.bottom ?? 0) - (enter.answerRect?.bottom ?? 0)) <= 2 &&
        Math.abs((enter.mainRect?.bottom ?? 0) - (enter.sourceRect?.bottom ?? 0)) <= 2,
      `两块**都铺满整高**（原来的下排并给了它们：底边 ${enter.sourceRect?.bottom} / ${enter.answerRect?.bottom} / main ${enter.mainRect?.bottom}）`,
      JSON.stringify({ source: enter.sourceRect, answer: enter.answerRect, main: enter.mainRect }),
    )
    check(
      enter.chips.some((chip) => chip.includes('第 1 页') && chip.includes('10 条')) &&
        enter.chips.some((chip) => chip.includes('国内机关名称|第1组（1-20）')),
      `译文栏标题写明"哪一组 · 第几页 · 几条"（${JSON.stringify(enter.chips)}）`,
      JSON.stringify(enter.chips),
    )
    /*
     * 第 4 条：**没答完也能提交**——因此按钮一开始就是**可点**的（早先因为"没写满"而禁用）。
     */
    check(
      enter.submitLabel === '提交批改' && enter.submitDisabled === false,
      '「提交批改」在译文栏标题栏右边，而且**一进来就可点**（第 4 条把"没写满不许提交"去掉了）',
      JSON.stringify({ label: enter.submitLabel, disabled: enter.submitDisabled }),
    )
    check(
      enter.navInSource === true && enter.hint.count === 9 && enter.hint.index === 0,
      `翻页导航在原文那栏的页脚里，写着「${enter.hint.hint}」（国内机关名称 83 条 / 每页 10 条 = 9 页）`,
      JSON.stringify(enter.hint),
    )
    check(
      enter.topbarHasFixtureChip === false,
      '一进来顶栏就没有「内置示例批改」芯片',
    )

    /*
     * 术语模式下那条竖线**还拖得动**，而且拖完仍是两栏、仍是整高。
     *
     * 为什么要单量这一条：`.split-manual`（拖过之后按比例分）原本是按**三行**排的
     * （上排 / 8px 横线 / 下排），术语模式少了一排，样式表里必须把行模板一起改掉
     * （见 styles.css 的 `.split-term.split-manual`）。改漏了的表现很隐蔽：
     * 上排只会拿到**一半高度**，或者下面多出一条空轨道——不报错，只是"页面怪怪的"。
     */
    const dragInTermMode = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const split = T.q('main.split');
         const handle = T.q('main.split .splitter-v');
         if (!split || !handle) return { error: '找不到术语模式的竖分割线' };
         const before = { source: T.rect('.pane-source'), answer: T.rect('.pane-answer'), main: T.rect('main.split') };
         const box = handle.getBoundingClientRect();
         const fire = (type, x) =>
           handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: box.top + 5, pointerId: 7 }));
         fire('pointerdown', box.left);
         await T.sleep(60);
         fire('pointermove', box.left + 160);
         await T.sleep(60);
         fire('pointerup', box.left + 160);
         await T.sleep(320);
         const after = { source: T.rect('.pane-source'), answer: T.rect('.pane-answer'), main: T.rect('main.split') };
         const out = {
           manual: split.classList.contains('split-manual'),
           style: split.getAttribute('style') || '',
           before, after,
           panes: T.qa('main.split .pane').length,
           score: Boolean(T.q('.pane-score')),
           notes: Boolean(T.q('.pane-notes')),
         };
         // 拖完恢复默认，免得影响后面几段的几何断言（双击恢复自动）
         handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
         await T.sleep(300);
         out.resetStyle = split.getAttribute('style') || '';
         out.resetManual = split.classList.contains('split-manual');
         return out;
       })()`,
    )
    if (dragInTermMode?.error) throw new Error(dragInTermMode.error)
    check(
      dragInTermMode.manual === true && (dragInTermMode.style ?? '').includes('--col-left'),
      `术语模式那条竖线拖得动（拖过之后切成手动比例：${dragInTermMode.style}）`,
      JSON.stringify(dragInTermMode.style),
    )
    check(
      (dragInTermMode.after?.source?.w ?? 0) > (dragInTermMode.before?.source?.w ?? 0) + 50 &&
        Math.abs((dragInTermMode.after?.source?.bottom ?? 0) - (dragInTermMode.after?.main?.bottom ?? 0)) <= 2,
      `拖过之后原文栏真的变宽（${dragInTermMode.before?.source?.w}px → ${dragInTermMode.after?.source?.w}px），而且**高度仍然铺满**（下排没有留空轨道：底边 ${dragInTermMode.after?.source?.bottom} / main ${dragInTermMode.after?.main?.bottom}）`,
      JSON.stringify({ before: dragInTermMode.before, after: dragInTermMode.after }),
    )
    check(
      dragInTermMode.panes === 2 && dragInTermMode.score === false && dragInTermMode.notes === false,
      '拖过之后仍然是两栏（左下的评分栏与右下的批注栏**没有**冒出来）',
      JSON.stringify({ panes: dragInTermMode.panes, score: dragInTermMode.score, notes: dragInTermMode.notes }),
    )
    check(
      dragInTermMode.resetManual === false && (dragInTermMode.resetStyle ?? '') === '',
      '双击那条线恢复自动布局（术语模式也照旧）',
      JSON.stringify({ style: dragInTermMode.resetStyle, manual: dragInTermMode.resetManual }),
    )

    console.log('\n=== 2. 「范围」下拉：五个板块 → 弹窗选分组 → 中英对照平表 → 确定 ===')
    const scopeUi = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         await T.goto(2);
         out.切之前 = T.pageNo();
         out.opened = await T.openScopeMenu();
         out.menuItems = T.scopeItems();
         out.menuLabel = T.q('.domain-menu')?.getAttribute('aria-label') || null;
         // 点第一个板块（国内机关名称）→ 换成"分组列表"那一屏
         out.clicked国内 = await T.clickScopeItem('国内机关名称');
         out.title1 = T.text('.raw-modal-head > span');
         out.note1 = T.text('.raw-modal-note');
         out.modalLabel1 = T.q('.raw-modal')?.getAttribute('aria-label') || null;
         out.cards = T.groupCards();
         out.foot1 = T.texts('.gen-foot .btn');
         // 第 1 组：20 行对照表
         out.clicked组1 = await T.clickGroupCard('国内机关名称|第1组（1-20）');
         out.title2 = T.text('.raw-modal-head > span');
         out.note2 = T.text('.raw-modal-note');
         out.headers = T.texts('.scope-table th');
         out.wrapScrolls = (() => {
           const wrap = T.q('.scope-table-wrap');
           return wrap ? wrap.scrollHeight > wrap.clientHeight : null;
         })();
         const rows1 = T.tableRows();
         out.rows1 = rows1.length;
         out.firstRow = rows1[0];
         out.foot2 = T.texts('.gen-foot .btn');
         // 「返回」→ 退回分组列表
         out.clickedBack = await T.clickFoot('返回');
         out.backToCards = Boolean(T.q('.scope-cards'));
         out.tableGone = !T.q('.scope-table');
         // 看一下最后一组（只有 3 条）
         out.clicked组5 = await T.clickGroupCard('国内机关名称|第5组（81-83）');
         out.lastTitle = T.text('.raw-modal-head > span');
         out.lastRows = T.tableRows().length;
         // 末三条要在**点确定之前**读：确定之后弹窗就关了，表也就没了
         out.末三条 = T.tableRows().slice(-3).map((row) => row[0]);
         out.lastFoot = T.texts('.gen-foot .btn');
         // 「确定」→ 切到这一组并**落到它的第一页**（第 5 组的第一页是第 9 页）
         out.confirmed = await T.clickFoot('确定', 700);
         out.closed = !T.q('.raw-modal-backdrop');
         out.pageAfterGroup5 = T.pageNo();
         out.sourceAfterGroup5 = T.texts('.pane-source .term-source-text');
         out.groupChip = T.texts('.pane-answer .pane-head .chip');
         out.api = T.judgeCalls().length;
         return out;
       })()`,
    )
    check(scopeUi.opened === true && (scopeUi.menuItems ?? []).length === 5, '点「范围」弹出的是**下拉栏**（五个板块）')
    check(
      (scopeUi.menuItems ?? []).map((item) => item.label).join('/') ===
        '国内机关名称/国际机关名称/当代术语/必背核心术语/必背用典',
      `下拉里五个板块的顺序与名字：${(scopeUi.menuItems ?? []).map((item) => item.label).join(' → ')}`,
      JSON.stringify(scopeUi.menuItems),
    )
    check(
      (scopeUi.menuItems ?? []).every((item) => item.disabled === false && item.note.length > 0) &&
        (scopeUi.menuItems?.[0]?.note ?? '').includes('83 条 · 5 组') &&
        (scopeUi.menuItems?.[2]?.note ?? '').includes('718 条 · 15 组'),
      `每一行都写着"多少条 · 几组"：${(scopeUi.menuItems ?? []).map((item) => `${item.label} ${item.note}`).join('；')}`,
      JSON.stringify(scopeUi.menuItems),
    )
    check(
      (scopeUi.menuItems?.[0]?.active ?? false) === true && scopeUi.menuLabel === '术语板块',
      '正在练的那个板块在下拉里有标记（另一行没有）',
      JSON.stringify(scopeUi.menuItems?.map((item) => ({ label: item.label, active: item.active }))),
    )
    check(
      scopeUi.clicked国内 === true && scopeUi.title1 === '国内机关名称',
      `点一个板块才**弹出窗口**选分组（标题 ${scopeUi.title1}）`,
      JSON.stringify({ clicked: scopeUi.clicked国内, title: scopeUi.title1 }),
    )
    check(
      (scopeUi.note1 ?? '').includes('5 组') && (scopeUi.note1 ?? '').includes('每组 20 条') && (scopeUi.note1 ?? '').includes('每页 10 条'),
      `弹窗副标题写着这个板块有多少组、每组几条、每页几条（${scopeUi.note1}）`,
      scopeUi.note1,
    )
    check(
      (scopeUi.cards ?? []).length === 5,
      `国内机关名称按每 20 条一组切成 5 组（实际 ${(scopeUi.cards ?? []).length} 组）`,
      JSON.stringify(scopeUi.cards),
    )
    check(
      (scopeUi.cards ?? []).map((card) => card.label).join(' | ') ===
        '国内机关名称|第1组（1-20） | 国内机关名称|第2组（21-40） | 国内机关名称|第3组（41-60） | ' +
          '国内机关名称|第4组（61-80） | 国内机关名称|第5组（81-83）',
      `分组名沿用「板块|第N组（起-止）」这一套（用户给的命名风格）`,
      JSON.stringify((scopeUi.cards ?? []).map((card) => card.label)),
    )
    check(
      (scopeUi.cards?.[0]?.meta ?? '').includes('第 1–20 条') &&
        (scopeUi.cards?.[0]?.meta ?? '').includes('20 条') &&
        (scopeUi.cards?.[0]?.meta ?? '').includes('2 页') &&
        (scopeUi.cards?.[4]?.meta ?? '').includes('第 81–83 条') &&
        (scopeUi.cards?.[4]?.meta ?? '').includes('1 页'),
      `每张分组卡片写清"第几条到第几条 · 共几条 · 几页"：${scopeUi.cards?.[0]?.meta} ／ ${scopeUi.cards?.[4]?.meta}`,
      JSON.stringify(scopeUi.cards?.map((card) => card.meta)),
    )
    /*
     * 「正在练」标的是**你此刻站的那一组**：第 3 页（0 基 2）落在第 2 组（21-40，占第 3、4 页）。
     * 第 14 条把组做成"入口与落点"之后，这一枚标记是用户唯一能看出"我现在在哪一组"的地方。
     */
    check(
      (scopeUi.cards?.[1]?.now ?? '') === '正在练' && (scopeUi.cards?.[0]?.now ?? '') === '',
      `「正在练」标在**当前这一页所属的那一组**上（第 ${scopeUi.切之前.index + 1} 页 → 第 2 组）`,
      JSON.stringify(scopeUi.cards?.map((card) => ({ label: card.label, now: card.now }))),
    )
    check(scopeUi.foot1.join('/') === '关闭', `分组列表那一屏底部是「关闭」（${JSON.stringify(scopeUi.foot1)}）`)
    check(
      scopeUi.clicked组1 === true && scopeUi.title2 === '国内机关名称|第1组（1-20）',
      `点一张分组卡片 → 换成这个分组的**中英对照平表**（标题 ${scopeUi.title2}）`,
      JSON.stringify({ clicked: scopeUi.clicked组1, title: scopeUi.title2 }),
    )
    check(scopeUi.headers.join(',') === '中文名称,官方英文名称', `对照表两列：${scopeUi.headers.join(' / ')}`)
    check(scopeUi.rows1 === 20, `第 1 组那张表是 20 行（实际 ${scopeUi.rows1} 行）`)
    check(
      (scopeUi.firstRow?.[0]?.length ?? 0) > 0 && (scopeUi.firstRow?.[1]?.length ?? 0) > 0,
      `每一行都是"中文 + 官方英文"两格：${JSON.stringify(scopeUi.firstRow)}`,
    )
    check(scopeUi.foot2.join('/') === '返回/确定', `对照表那一屏底部是「返回」与「确定」（${JSON.stringify(scopeUi.foot2)}）`)
    check(
      scopeUi.clickedBack === true && scopeUi.backToCards === true && scopeUi.tableGone === true,
      '「返回」退回分组列表那一屏（表收起来）',
    )
    check(
      scopeUi.clicked组5 === true && scopeUi.lastTitle === '国内机关名称|第5组（81-83）' && scopeUi.lastRows === 3,
      `末组只有 3 条，表也就 3 行（${scopeUi.lastRows} 行）`,
      JSON.stringify({ title: scopeUi.lastTitle, rows: scopeUi.lastRows }),
    )
    check(
      scopeUi.closed === true && scopeUi.pageAfterGroup5.index === 8 && scopeUi.pageAfterGroup5.count === 9,
      `「确定」切到那一组并**落到这一组的第一页**：第 5 组（81-83）的第一页是第 9 页（${scopeUi.pageAfterGroup5.hint}）`,
      JSON.stringify(scopeUi.pageAfterGroup5),
    )
    check(
      (scopeUi.sourceAfterGroup5 ?? []).filter((item) => item.length > 0).join('|') ===
        (scopeUi.末三条 ?? []).join('|') &&
        (scopeUi.末三条 ?? []).length === 3,
      '落到第 9 页时题干就是第 81–83 条（题干与分组表最后三行对得上；其余七行是空的）',
      JSON.stringify({ 屏幕上: scopeUi.sourceAfterGroup5, 表里: scopeUi.末三条 }),
    )
    check(
      (scopeUi.groupChip ?? []).some((chip) => chip.includes('第5组（81-83）')),
      `译文栏那颗芯片跟着写清"现在在哪一组"（${JSON.stringify(scopeUi.groupChip)}）`,
      JSON.stringify(scopeUi.groupChip),
    )
    check(scopeUi.api === 0, '开下拉、开弹窗、翻表、切分组全程没有批改接口调用（都是本地数据）')

    /*
     * 把国内机关名称那 5 组的对照表**整张读回来**（83 行），后面所有"期望值"都用它。
     * 从界面取的原因写在 `collectBlockRows` 的注释里：两边都从数据现抄就变成自己证明自己。
     */
    const collected = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const rows = await T.collectBlockRows('国内机关名称');
         window.__allRows = rows;
         await T.goto(0);
         return { rows: rows.length, first: rows[0], last: rows.slice(-1)[0], page: T.pageNo() };
       })()`,
    )
    check(
      collected.rows === 83,
      `走一遍 5 组的分组表，拼回来正好 83 行（实际 ${collected.rows} 行）——分组不丢不重`,
      JSON.stringify({ rows: collected.rows, first: collected.first, last: collected.last }),
    )

    console.log('\n=== 3. 「确定」永远落到这一组的第一页（不是"第一个没批过的页"）===')
    const groupLanding = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         // 先在第 1 页写一行草稿，让"没批过的页"与"这一组的第一页"分得开
         await T.goto(0);
         T.setInput(T.qa('.pane-answer .term-input')[0], '草稿一号');
         await T.sleep(200);
         out.起点 = T.pageNo();
         out.打开 = await T.openScopeMenu();
         out.点板块 = await T.clickScopeItem('国内机关名称');
         out.点组3 = await T.clickGroupCard('国内机关名称|第3组（41-60）');
         out.确定 = await T.clickFoot('确定', 700);
         out.得到 = T.pageNo();
         out.题干 = T.texts('.pane-source .term-source-text');
         out.期望题干 = (window.__allRows || []).slice(40, 50).map((row) => row[0]);
         out.芯片 = T.texts('.pane-answer .pane-head .chip');
         return out;
       })()`,
    )
    check(
      groupLanding.得到.index === 4 && groupLanding.得到.count === 9,
      `选第 3 组（41-60）落到**第 5 页**（它的第一页）——不是第 1 页、也不是"第一个没批过的页"（${groupLanding.得到.hint}）`,
      JSON.stringify(groupLanding.得到),
    )
    check(
      groupLanding.题干.length === 10 && groupLanding.题干.join('|') === groupLanding.期望题干.join('|'),
      '这一页的题干正是第 41–50 条（与分组表里那十行逐条一致）',
      JSON.stringify({ 屏幕上: groupLanding.题干.slice(0, 2), 表里: groupLanding.期望题干.slice(0, 2) }),
    )
    check(
      (groupLanding.芯片 ?? []).some((chip) => chip.includes('第3组（41-60）')),
      `芯片跟着换成第 3 组（${JSON.stringify(groupLanding.芯片)}）`,
      JSON.stringify(groupLanding.芯片),
    )

    console.log('\n=== 4. 翻页：9 页、末页三条、翻页只是翻页 ===')
    const paging = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = { 起点: T.pageNo(), 请求前: T.apiCalls().length };
         out.nav在原文栏 = Boolean(T.q('.pane-source .pane-foot.section-nav'));
         out.nav在作答栏 = Boolean(T.q('.pane-answer .pane-foot.section-nav'));
         const total = T.pageNo().count;
         let steps = 0;
         while (T.pageNo().index < total - 1 && steps < 40) {
           if (!(await T.clickNav('next', 120))) break;
           steps += 1;
         }
         out.翻了几次 = steps;
         out.末页 = T.pageNo();
         const prevLast = T.q('.pane-source .section-nav [data-nav="prev"]');
         const nextLast = T.q('.pane-source .section-nav [data-nav="next"]');
         out.末页上一个 = prevLast ? prevLast.disabled : null;
         out.末页下一个 = nextLast ? nextLast.disabled : null;
         out.末页题干 = T.texts('.pane-source .term-source-text');
         out.末页行数 = T.qa('.pane-source .term-source-row').length;
         out.末页框数 = T.qa('.pane-answer .term-input').length;
         out.末页可填 = T.qa('.pane-answer .term-input').filter((input) => !input.disabled).length;
         out.末页禁用 = T.qa('.pane-answer .term-input').filter((input) => input.disabled).length;
         out.末页按钮 = (T.primary()?.textContent || '').trim();
         out.请求末页 = T.apiCalls().length;
         return out;
       })()`,
    )
    check(
      paging.起点.count === 9,
      `国内机关名称一共 **9 页**（83 条 ÷ 每页 10 条；页脚写着「${paging.起点.hint}」）`,
      JSON.stringify(paging.起点),
    )
    check(
      paging.nav在原文栏 === true && paging.nav在作答栏 === false,
      '「上一页 / 下一页」在左边原文那一栏的页脚里（翻页是为了换一段原文）',
      JSON.stringify({ 原文栏: paging.nav在原文栏, 作答栏: paging.nav在作答栏 }),
    )
    check(
      paging.翻了几次 === 9 - 1 - paging.起点.index && paging.末页.index === 8,
      `一路点「下一页」正好走完 9 页（从第 ${paging.起点.index + 1} 页点了 ${paging.翻了几次} 次到「${paging.末页.hint}」）`,
      JSON.stringify({ 起点: paging.起点, 末页: paging.末页, 翻了几次: paging.翻了几次 }),
    )
    check(
      paging.末页下一个 === true && paging.末页上一个 === false,
      '第 9 页没有「下一页」（不会翻到不存在的第 10 页）',
      JSON.stringify({ prev: paging.末页上一个, next: paging.末页下一个 }),
    )
    check(
      paging.末页行数 === 10 && paging.末页题干.filter((item) => item.length > 0).length === 3,
      `末页照旧画满十行、只有三条有内容（缺的行留空、不可填也不计分）——实际 ${paging.末页行数} 行 / 有内容的 ${paging.末页题干.filter((item) => item.length > 0).length} 条`,
      JSON.stringify(paging.末页题干),
    )
    check(
      paging.末页框数 === 10 && paging.末页可填 === 3 && paging.末页禁用 === 7,
      `末页十个框里只有三个可填、七个是禁用的（实际可填 ${paging.末页可填} / 禁用 ${paging.末页禁用}）`,
      JSON.stringify({ 框: paging.末页框数, 可填: paging.末页可填, 禁用: paging.末页禁用 }),
    )
    check(
      paging.请求末页 === paging.请求前 && paging.末页按钮 === '提交批改',
      `翻满 9 页一次批改接口都没发，按钮也还是「提交批改」（翻页不提交）`,
      JSON.stringify({ 前: paging.请求前, 后: paging.请求末页, 按钮: paging.末页按钮 }),
    )

    console.log('\n=== 5. 「参考译文」开关：原文栏右对齐给出每一条的标准译法 ===')
    const reference = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         // 回到第 1 页：那一页十条都在，正好看"右对齐 + 与题干一一对应"
         await T.goto(0);
         out.第几页 = T.pageNo();
         const table = window.__allRows || [];
         out.期望 = table.slice(0, 10).map((row) => row[1]);
         out.打开前 = {
           refs: T.texts('.pane-source .term-source-ref'),
           pressed: T.referenceToggle()?.getAttribute('aria-pressed'),
         };
         out.clicked = await T.toggleReference(400);
         out.打开后 = {
           refs: T.texts('.pane-source .term-source-ref'),
           pressed: T.referenceToggle()?.getAttribute('aria-pressed'),
           rows: T.qa('.pane-source .term-source-row').length,
         };
         // 右对齐：那一条的右边缘要贴着它所在那一行的右边缘（差 = 行自己的内边距）
         const row = T.q('.pane-source .term-source-row');
         const ref = T.q('.pane-source .term-source-row .term-source-ref');
         out.对齐 = (() => {
           if (!row || !ref) return null;
           const rowBox = row.getBoundingClientRect();
           const refBox = ref.getBoundingClientRect();
           return { gap: Math.round(rowBox.right - refBox.right), 行宽: Math.round(rowBox.width), 答案宽: Math.round(refBox.width) };
         })();
         // 题干那一侧没有变化（标准译法只加在原文栏，不写进作答）
         out.作答框里 = T.inputs();
         // 末页：缺的那几行不该有占位
         await T.goto(8);
         out.末页 = {
           rows: T.qa('.pane-source .term-source-row').length,
           refs: T.texts('.pane-source .term-source-ref'),
           texts: T.texts('.pane-source .term-source-text'),
         };
         // 再点一下收起
         out.收起 = await T.toggleReference(300);
         out.收起后 = {
           refs: T.texts('.pane-source .term-source-ref'),
           pressed: T.referenceToggle()?.getAttribute('aria-pressed'),
         };
         out.作答栏有没有标准译法 = T.qa('.pane-answer .term-source-ref').length;
         return out;
       })()`,
    )
    check(
      reference.打开前.refs.length === 0 && reference.clicked === true && reference.打开后.refs.length === 10,
      `点一下开关，原文栏十条各给出一条标准译法（${reference.打开前.refs.length} → ${reference.打开后.refs.length} 条）`,
      JSON.stringify({ 打开前: reference.打开前, 打开后: reference.打开后 }),
    )
    check(
      reference.打开后.pressed === 'true' && reference.打开后.refs.join('|') === reference.期望.join('|'),
      `给出的正是这一页每一条的**标准译法**（与分组表里英文那一列逐条一致）`,
      JSON.stringify({ 屏幕上: reference.打开后.refs.slice(0, 2), 表里: reference.期望.slice(0, 2) }),
    )
    check(
      (reference.对齐?.gap ?? 99) >= 0 && (reference.对齐?.gap ?? 99) <= 6,
      `标准译法是**右对齐**的：它右边缘离那一行右边缘 ${reference.对齐?.gap}px（行宽 ${reference.对齐?.行宽}px，答案宽 ${reference.对齐?.答案宽}px）`,
      JSON.stringify(reference.对齐),
    )
    check(
      reference.作答框里 === undefined || reference.作答栏有没有标准译法 === 0,
      '标准译法只长在**原文栏**，作答栏里没有（用户点名"不是我的译文栏"）',
      JSON.stringify({ 作答栏里的标准译法: reference.作答栏有没有标准译法 }),
    )
    check(
      reference.末页.rows === 10 && reference.末页.refs.length === 3 &&
        reference.末页.refs.every((item) => item.length > 0),
      `末页七行是空的，标准译法也只给真实存在的那三条（实际 ${reference.末页.refs.length} 条，没有空占位）`,
      JSON.stringify(reference.末页),
    )
    check(
      reference.收起 === true && reference.收起后.refs.length === 0 && reference.收起后.pressed === 'false',
      '再点一下收起（原文栏里一条标准译法都不留）',
      JSON.stringify(reference.收起后),
    )

    console.log('\n=== 6. 十条全答完 → 本地判分 + **落练习记录** ===')
    const graded = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         const exerciseId = 'term-v3-cn-org-zh-to-en';
         await T.goto(0);
         const rows = (window.__allRows || []).slice(0, 10);
         const wrong = ['definitely not the official name', 'nope'];
         // 第 3 与第 5 条故意胡写 → 预期 ✓✓✗✓✗✓✓✓✓✓
         const answers = rows.map((row, index) => (index === 2 ? wrong[0] : index === 4 ? wrong[1] : row[1]));
         out.answers = answers;
         out.官方译名 = rows.map((row) => row[1]);
         out.记录前 = T.recordsFor(exerciseId, 0);
         out.填完 = await T.fill(answers);
         out.可以提交 = !T.primary().disabled;
         out.请求前 = T.apiCalls().length;
         T.primary().click();
         for (let i = 0; i < 40 && T.qa('.pane-answer .term-mark').length < 10; i += 1) await T.sleep(100);
         out.请求后 = T.apiCalls().length;
         out.apiUrls = T.apiCalls();
         out.marks = T.texts('.pane-answer .term-mark');
         out.markIds = T.qa('.pane-answer [data-mark-id]').map((node) => node.getAttribute('data-mark-id'));
         out.inputs = T.qa('.pane-answer .term-input').length;
         out.struck = T.texts('.pane-answer .mk-delete .mk-deleted');
         out.struckDecoration = (() => {
           const node = T.q('.pane-answer .mk-delete .mk-deleted');
           return node ? getComputedStyle(node).textDecorationLine : null;
         })();
         out.fixes = T.texts('.pane-answer .term-above');
         out.highlights = T.qa('.pane-answer .mk-highlight').length;
         out.hint = T.text('.pane-source .section-nav .hint');
         out.button = T.text('.pane-answer .pane-head .btn-primary');
         out.记录后 = T.recordsFor(exerciseId, 0);
         out.进度 = T.progressFor(exerciseId);
         out.historyPicker = T.qa('.pane-answer .pane-head .domain-trigger').length;
         out.topbarHasFixtureChip = (T.q('.topbar')?.innerText || '').includes('内置示例批改');
         /* 第 16 条要的是"写在**上方**"：量一下它真的在那个词上面，以及会不会压到**上一行**的文字 */
         out.校正几何 = (() => {
           const above = T.q('.pane-answer .term-above');
           const word = above?.parentElement ?? null;
           const row = above?.closest('.term-row') ?? null;
           if (!above || !word || !row) return null;
           const a = above.getBoundingClientRect();
           const w = word.getBoundingClientRect();
           const prev = row.previousElementSibling?.querySelector('.term-result') ?? null;
           const p = prev ? prev.getBoundingClientRect() : null;
           return {
             在词的正上方: a.bottom <= w.top + 1 && a.left >= w.left - 1,
             没压住上一行的字: p === null || a.top >= p.bottom - 1,
             上方离行顶: Math.round(a.top - row.getBoundingClientRect().top),
             离上一行的字: p === null ? null : Math.round(a.top - p.bottom),
           };
         })();
         return out;
       })()`,
    )
    check(
      graded.填完.join('|') === graded.answers.join('|') && graded.可以提交 === true,
      '十条都写进了各自的框，写满之后「提交批改」可以点',
      JSON.stringify(graded.填完.slice(0, 2)),
    )
    check(
      graded.marks.join('') === '✓✓✗✓✗✓✓✓✓✓',
      `照官方译名写的判对、胡写的判错（实际 ${graded.marks.join('')}）——术语判分是**严格对照**，不是"看着像就算对"`,
      JSON.stringify(graded.marks),
    )
    check(
      graded.markIds.join(',') === 'h1,h2,t3,h4,t5,h6,h7,h8,h9,h10',
      `每条批注的编号 h1..h10（对）与 t1..t10（错）与它的下标对得上（${graded.markIds.join(',')}）`,
      JSON.stringify(graded.markIds),
    )
    check(
      graded.inputs === 0 && graded.hint.includes('已批改'),
      `判完之后这一页是**只读**的（输入框整批换成批注行），页脚写着「${graded.hint}」`,
      JSON.stringify({ 输入框: graded.inputs, hint: graded.hint }),
    )
    check(
      graded.struck.length >= 2 && graded.struckDecoration === 'line-through',
      `写错的地方被划掉，而且是**真的横线**（${graded.struckDecoration}；${JSON.stringify(graded.struck)}）`,
      JSON.stringify({ struck: graded.struck, decoration: graded.struckDecoration }),
    )
    /*
     * 第 16 条的画法：**只改不对的字或词**——写错的那截划掉、正确的写法写在**它上方**，
     * 而不是整条重写成"→ 官方译名"。这一页里那两行正好是两种典型：
     *   第 5 行整条胡写（"nope"）→ 整条划掉，官方译名**写在它上方**；
     *   第 3 行只是几个词不对 → 划掉的是**那几处词**，整条答案没有一起被划掉，
     *   上方那几处更正也都真的是官方译法里的一段（不是自己编的）。
     */
    check(
      graded.struck.includes('nope') && graded.fixes.includes(graded.官方译名[4]),
      `完全写错的那一行：整段划掉、官方译名写在它**上方**（${graded.官方译名[4]}）`,
      JSON.stringify({ struck: graded.struck, fixes: graded.fixes }),
    )
    check(
      !graded.struck.includes(graded.answers[2]) && graded.fixes.length > 0 &&
        graded.fixes.every((fix) => graded.官方译名.some((official) => official.includes(fix))),
      `只有几个词不对的那一行**不是整条重写**：划掉的是那几处词（${JSON.stringify(graded.struck)}），上方每一处更正都出自官方译法`,
      JSON.stringify({ struck: graded.struck, fixes: graded.fixes, 整条答案: graded.answers[2] }),
    )
    check(
      graded.校正几何?.在词的正上方 === true && graded.校正几何?.没压住上一行的字 === true,
      `那一行正确的写法**真的在词的上面**，而且没有压到上一行的字（离行顶 ${graded.校正几何?.上方离行顶}px、离上一行的字 ${graded.校正几何?.离上一行的字}px）`,
      JSON.stringify(graded.校正几何),
    )
    check(
      graded.highlights === 8,
      `译对的八条用绿色底色勾画（实际 ${graded.highlights} 条）`,
      String(graded.highlights),
    )
    check(
      graded.button === '返回编辑',
      `判完之后那颗按钮原地改名成「返回编辑」（${graded.button}）`,
      graded.button,
    )
    /*
     * 第 4 条的另一半：**十条全答完**的那一次才落练习记录 + 记进度。
     */
    check(
      graded.记录后 === graded.记录前 + 1,
      `十条都答完了 → 落了一条练习记录（这一页的记录数 ${graded.记录前} → ${graded.记录后}）`,
      JSON.stringify({ 前: graded.记录前, 后: graded.记录后 }),
    )
    check(
      Array.isArray(graded.进度) && graded.进度.includes(0),
      `进度里也记上了"第 1 页批过"（${JSON.stringify(graded.进度)}）`,
      JSON.stringify(graded.进度),
    )
    check(
      graded.historyPicker >= 1,
      `批过一次之后出现「批改记录」下拉（${graded.historyPicker} 个）`,
      String(graded.historyPicker),
    )
    check(
      graded.请求后 === graded.请求前 && graded.apiUrls.filter((url) => url.includes('/api/judge')).length === 0,
      `判分**完全本地**：一条 /api/judge 都没发（全程 ${graded.apiUrls.length} 次 /api 调用）`,
      JSON.stringify(graded.apiUrls),
    )
    check(
      graded.topbarHasFixtureChip === false,
      '批过一次术语之后，顶栏仍然没有「内置示例批改」芯片（判分来源标的是 local 而不是 fixture）',
    )

    console.log('\n=== 7. 没答完也能提交：判分照做，但**不落库** ===')
    const partial = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         const exerciseId = 'term-v3-cn-org-zh-to-en';
         // 第 3 页（第 2 组）从来没动过：只写三条
         await T.goto(2);
         out.第几页 = T.pageNo();
         out.记录前 = T.recordsFor(exerciseId, 2);
         const rows = (window.__allRows || []).slice(20, 30);
         const 三条 = rows.slice(0, 3).map((row) => row[1]);
         out.答案 = 三条;
         out.只写三条 = await T.fill(三条);
         out.提交按钮 = { label: (T.primary()?.textContent || '').trim(), disabled: T.primary()?.disabled, title: T.primary()?.title };
         out.请求前 = T.apiCalls().length;
         T.primary().click();
         for (let i = 0; i < 40 && T.qa('.pane-answer .term-mark').length < 10; i += 1) await T.sleep(100);
         out.请求后 = T.apiCalls().length;
         out.marks = T.texts('.pane-answer .term-mark');
         out.notice = T.text('.pane-answer .hint.notice');
         /* 第 16 条：没作答的那几行**直接用红色写正确答案**，不再写"（没作答）" */
         out.补进去的红色答案 = T.texts('.pane-answer .term-added');
         out.屏幕上有没有没作答三个字 = (T.q('.pane-answer')?.innerText || '').includes('没作答');
         out.hint = T.text('.pane-source .section-nav .hint');
         out.button = T.text('.pane-answer .pane-head .btn-primary');
         out.记录后 = T.recordsFor(exerciseId, 2);
         out.进度 = T.progressFor(exerciseId);
         out.historyPicker = T.qa('.pane-answer .pane-head .domain-trigger').length;
         return out;
       })()`,
    )
    check(
      partial.提交按钮.disabled === false && (partial.提交按钮.title ?? '').length > 0,
      `只写三条时「提交批改」**照样可点**（第 4 条："没答完也能提交"，拦住人的门槛已去掉；悬停说明写着「${partial.提交按钮.title}」）`,
      JSON.stringify(partial.提交按钮),
    )
    check(
      partial.marks.length === 10 && partial.marks.join('') === '✓✓✓✗✗✗✗✗✗✗',
      `提交之后**照常判分、照常显示**（十条标记：写对的三条 ✓、其余七条 ✗）——实际 ${partial.marks.join('')}`,
      JSON.stringify(partial.marks),
    )
    check(
      partial.button === '返回编辑' && partial.hint.includes('已批改'),
      `判完这一页也照常只读、按钮照常变「返回编辑」（${partial.hint}）`,
      JSON.stringify({ button: partial.button, hint: partial.hint }),
    )
    /*
     * 第 4 条的**核心**：只扣"练习记录"——记录数不许动，但**进度照记**（用户拍板：
     * 这一页确实批过了、结果也显示着，进条就该认它；不记的话用户会以为没交上）。
     */
    check(
      partial.记录后 === partial.记录前 && partial.记录前 === 0,
      `**没答完 → 不产生练习记录**（这一页的记录数仍是 ${partial.记录后}）`,
      JSON.stringify({ 前: partial.记录前, 后: partial.记录后 }),
    )
    check(
      Array.isArray(partial.进度) && partial.进度.includes(2),
      `进度**照记**"第 3 页批过"（只扣练习记录，不扣进度：${JSON.stringify(partial.进度)}）`,
      JSON.stringify(partial.进度),
    )
    check(
      partial.补进去的红色答案.length === 7 && partial.屏幕上有没有没作答三个字 === false,
      `没作答的七行**直接用答案补上**、屏幕上再没有"没作答"三个字（补了 ${partial.补进去的红色答案.length} 行；第 1 行「${partial.补进去的红色答案[0]}」）`,
      JSON.stringify({ 补进去: partial.补进去的红色答案.slice(0, 3), 有没有没作答: partial.屏幕上有没有没作答三个字 }),
    )
    const 红 = await cdp.evaluate(
      `(() => {
         const T = window.__T;
         const added = T.q('.pane-answer .term-added');
         const mark = T.q('.pane-answer .term-mark-bad');
         return {
           补进去的颜色: added ? getComputedStyle(added).color : null,
           错号的红色: mark ? getComputedStyle(mark).color : null,
         };
       })()`,
    )
    check(
      红.补进去的颜色 !== null && 红.补进去的颜色 === 红.错号的红色,
      `补进去的答案是**红色**的（与那枚错号同一个红：${红.补进去的颜色}）`,
      JSON.stringify(红),
    )
    check(
      partial.historyPicker === 0,
      '这一页没有「批改记录」下拉（一次都没落库）',
      String(partial.historyPicker),
    )
    /*
     * 第 16 条：**结果栏那句话整条去掉了**（用户点名去掉"这一页 10 条，错 9 条——官方译名就写在
     * 每一条右边。还有 8 条没写：这一次不留练习记录，写满了才有。"）。
     * 逐条的判分本来就已经写在那一行里，再概括一句是重复的说明。
     */
    check(
      (partial.notice ?? '') === '',
      `结果栏**不再有那句话**（第 16 条点名去掉；实际 ${JSON.stringify(partial.notice)}）`,
      partial.notice,
    )
    check(
      partial.请求后 === partial.请求前,
      '这一次判分同样没发任何批改接口（本地判分）',
      JSON.stringify({ 前: partial.请求前, 后: partial.请求后 }),
    )

    console.log('\n=== 7b. 刷新之后：刚才那一页回到作答框（没答完不落库的直接后果）===')
    await cdp.send('Page.reload')
    let remounted = false
    for (let i = 0; i < 40 && !remounted; i += 1) {
      await sleep(250)
      remounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
    }
    check(remounted === true, '刷新之后界面重新挂载了')
    await cdp.evaluate(helpers)
    await sleep(600)
    /*
     * 刷新会把页面里的东西全清掉（包括我们抓的那张对照表），因此**重新走一遍分组表**。
     * 后面两段（「返回编辑」逐框比对、方向切换）都要拿它当期望值。
     */
    const recollected = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const tab = [...document.querySelectorAll('.mode-tab')].find((b) => (b.textContent || '').trim() === '术语');
         if (tab && !document.querySelector('.pane-source .term-source-list')) { tab.click(); await T.sleep(800); }
         const rows = await T.collectBlockRows('国内机关名称');
         window.__allRows = rows;
         return { rows: rows.length };
       })()`,
    )
    check(
      recollected.rows === 83,
      `刷新之后再走一遍分组表，还是 83 行（实际 ${recollected.rows} 行）`,
      JSON.stringify(recollected),
    )
    const afterReload = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         await T.goto(2);
         out.第几页 = T.pageNo();
         out.框数 = T.qa('.pane-answer .term-input').length;
         out.值 = T.inputs();
         out.标记 = T.qa('.pane-answer .term-mark').length;
         out.按钮 = (T.primary()?.textContent || '').trim();
         out.hint = T.text('.pane-source .section-nav .hint');
         out.第1页 = {
           记录: T.recordsFor('term-v3-cn-org-zh-to-en', 0),
           进度: T.progressFor('term-v3-cn-org-zh-to-en'),
         };
         return out;
       })()`,
    )
    check(
      afterReload.框数 === 10 && afterReload.标记 === 0 && afterReload.按钮 === '提交批改',
      `没答完的那一页刷新之后是**作答框**（没落库→没结果可接回；${afterReload.hint}）`,
      JSON.stringify(afterReload),
    )
    check(
      afterReload.值.slice(0, 3).join('|') === (partial.答案 ?? []).join('|') &&
        afterReload.值.slice(3).every((value) => value === ''),
      `写过的三条**草稿还在**（逐条与提交前一致）、其余七条是空的（草稿按页落盘，与"落不落库"是两件事）`,
      JSON.stringify({ 刷新后: afterReload.值.slice(0, 3), 提交前: partial.答案 }),
    )
    check(
      afterReload.第1页.记录 === 1 && afterReload.第1页.进度.includes(0),
      `答完的那一页（第 1 页）的记录与进度都还在（${JSON.stringify(afterReload.第1页)}）`,
      JSON.stringify(afterReload.第1页),
    )

    console.log('\n=== 8. 「返回编辑」：结果不丢、十条各回各的框 ===')
    const reedit = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         await T.goto(0);
         out.按钮 = (T.primary()?.textContent || '').trim();
         T.primary().click();
         await T.sleep(500);
         out.放开后 = {
           button: (T.primary()?.textContent || '').trim(),
           inputs: T.qa('.pane-answer .term-input').length,
           values: T.inputs(),
           editable: T.qa('.pane-answer .term-input').every((input) => !input.disabled && !input.readOnly),
           marks: T.qa('.pane-answer .term-mark').length,
           hint: T.text('.pane-source .section-nav .hint'),
         };
         // 一个字没改就翻页往返 → 仍是批改界面（结果没被丢掉）
         await T.clickNav('next');
         await T.clickNav('prev');
         out.往返后 = {
           page: T.pageNo(),
           marks: T.qa('.pane-answer .term-mark').length,
           inputs: T.qa('.pane-answer .term-input').length,
           hint: T.text('.pane-source .section-nav .hint'),
         };
         out.api = T.judgeCalls().length;
         return out;
       })()`,
    )
    check(
      reedit.放开后.inputs === 10 &&
        reedit.放开后.editable === true &&
        reedit.放开后.button === '提交批改' &&
        reedit.放开后.hint.includes('编辑中'),
      `点「返回编辑」回到十个**可写**的框、按钮改回「提交批改」（${reedit.放开后.hint}）`,
      JSON.stringify(reedit.放开后),
    )
    /*
     * 用户报过的那个 bug：按「返回编辑」之后**各条译文全挤进第一个框**。
     * 判据必须落在**单个框**上：只看"十个框里有没有字"是查不出来的，
     * 因此逐框比：第 i 个框必须正好是第 i 条答案（对照第 6 段实际写进去的那十条）。
     */
    check(
      reedit.放开后.values.join('|') === (graded.answers ?? []).join('|'),
      `十条**各回各的框**：第 i 个框正好是第 i 条答案（不是十条全挤进第一个框）`,
      JSON.stringify({ 框里: reedit.放开后.values, 交的: graded.answers }),
    )
    check(
      reedit.往返后.marks === 10 && reedit.往返后.inputs === 0 && reedit.往返后.hint.includes('已批改'),
      `放开之后**一个字都没改**就翻走再回来：屏幕上仍是那份批改（${reedit.往返后.hint}）——「返回编辑」不把结果扔掉`,
      JSON.stringify(reedit.往返后),
    )
    check(reedit.api === 0, '「返回编辑」与翻页全程 0 次批改接口调用', String(reedit.api))

    console.log('\n=== 9. 方向切换：题干换成官方英文、按中文判分 ===')
    const dir9 = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         await T.goto(0);
         out.切之前 = { page: T.pageNo(), dir: T.text('.pane-source .dir-btn-active'), origin: T.texts('.pane-source .term-source-text') };
         out.期望英文 = (window.__allRows || []).slice(0, 10).map((row) => row[1]);
         const enButton = [...document.querySelectorAll('.pane-source .dir-btn')].find(
           (b) => (b.textContent || '').trim() === '英译中',
         );
         if (enButton) enButton.click();
         await T.sleep(900);
         out.切之后 = {
           dir: T.text('.pane-source .dir-btn-active'),
           origin: T.texts('.pane-source .term-source-text'),
           scope: T.text('.pane-source .domain-trigger-value'),
           chips: T.texts('.pane-answer .pane-head .chip'),
         };
         // 一英多中的那两条（直辖市人民政府 / 设区的市人民政府）从表里现找，不写死下标
         const table = window.__allRows || [];
         const byEnglish = {};
         table.forEach((row, index) => { byEnglish[row[1]] = (byEnglish[row[1]] || []).concat([index]); });
         const groups = Object.keys(byEnglish).map((english) => ({ english, rows: byEnglish[english] })).filter((g) => g.rows.length > 1);
         out.一英多中 = groups.map((g) => ({ english: g.english, zh: g.rows.map((i) => table[i][0]), rows: g.rows }));
         /*
          * 那一对在**哪一页**（题号里没有组号，页号才是落点）：下标 ÷ 每页 10 条。
          * 英译中方向下要把那一页十条都写上，其中那一对故意一个写对、一个写**另一个中文名**
          * （一英多中写哪个都算对），再判一次——这是"两种中文都算对"在真界面上的验收。
          */
         // 那一对优先挑"直辖市人民政府"那一组（找不到就退回第一组），中文名从表里现取
         const zhOf = (group) => group.rows.map((index) => table[index][0]);
         const first = groups.find((group) => zhOf(group).includes('直辖市人民政府')) || groups[0];
         if (first) {
           const page = Math.floor(first.rows[0] / 10);
           out.一英多中的页 = page + 1;
           await T.goto(page);
           out.这一页题干 = T.texts('.pane-source .term-source-text');
           out.这一页期望英文 = table.slice(page * 10, page * 10 + 10).map((row) => row[1]);
           const 这一页 = table.slice(page * 10, page * 10 + 10);
           const answers = 这一页.map((row) => row[0]);
           // 那一对的第一条写"另一个中文名"、第二条写它自己的中文名（两条都该判对）
           answers[first.rows[0] - page * 10] = '某某市人民政府';
           answers[first.rows[1] - page * 10] = 这一页[first.rows[1] - page * 10][0];
           out.答案 = answers;
           await T.fill(answers);
           out.填完 = T.inputs();
           T.primary().click();
           for (let i = 0; i < 40 && T.qa('.pane-answer .term-mark').length < 10; i += 1) await T.sleep(100);
           out.marks = T.texts('.pane-answer .term-mark');
           out.fixes = T.texts('.pane-answer .term-above');
         }
         out.请求 = T.apiCalls().length;
         return out;
       })()`,
    )
    check(
      dir9.切之后.dir === '英译中' && dir9.切之后.origin.join('|') === dir9.期望英文.join('|'),
      `切到「英译中」之后题干换成**官方英文**（${dir9.切之后.origin[0]} …）`,
      JSON.stringify({ 屏幕上: dir9.切之后.origin.slice(0, 2), 表里: dir9.期望英文.slice(0, 2) }),
    )
    check(
      dir9.切之后.scope === '国内机关名称' && dir9.切之后.origin.join('|') !== dir9.切之前.origin.join('|'),
      '切方向只换题干那一侧，板块不动（两个控件各管各的）',
      JSON.stringify(dir9.切之后),
    )
    check(
      (dir9.一英多中 ?? []).length >= 1,
      `材料里确实还有"一英多中"（${JSON.stringify(dir9.一英多中)}）`,
      JSON.stringify(dir9.一英多中),
    )
    /*
     * 一英多中那一页：题干是**同一条官方英文**出现两行，而两种中文写哪个都算对。
     * 这一条同时验了两件事：题干确实换成了英文那一侧，以及判分表把两个中文都算对
     * （只算一个的话，写"另一个中文名"的那一行会被判错）。
     */
    check(
      (dir9.这一页题干 ?? []).join('|') === (dir9.这一页期望英文 ?? []).join('|') &&
        (dir9.这一页题干 ?? []).length === 10,
      `第 ${dir9.一英多中的页} 页的题干就是表里那十条官方英文（逐条一致）`,
      JSON.stringify({ 屏幕上: (dir9.这一页题干 ?? []).slice(0, 2), 表里: (dir9.这一页期望英文 ?? []).slice(0, 2) }),
    )
    /*
     * 期望值**由答案现算**：那一页十条里，只有"某某市人民政府"那一行该判错，
     * 其余九条（含写"另一个中文名"的那一条）都该判对。
     */
    const wrongRow = (dir9.答案 ?? []).findIndex((answer) => answer === '某某市人民政府')
    check(
      wrongRow >= 0 &&
        (dir9.marks ?? []).join('') ===
          (dir9.答案 ?? []).map((_, index) => (index === wrongRow ? '✗' : '✓')).join(''),
      `英译中时写**中文**判对、胡写判错；其中一英多中那一对：写"另一个中文名"的那行判对、写"某某市人民政府"的那行判错（实际 ${(dir9.marks ?? []).join('')}）`,
      JSON.stringify({ marks: dir9.marks, answers: dir9.答案 }),
    )

    console.log('\n=== 10. 别的题型照旧四栏：术语模式那套没有漏出去 ===')
    const otherMode = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const tab = [...document.querySelectorAll('.mode-tab')].find((b) => (b.textContent || '').trim() === '句子');
         if (!tab) return { error: '顶栏没有「句子」这一栏' };
         tab.click();
         await T.sleep(900);
         const main = T.q('main.split');
         return {
           activeTab: T.text('.mode-tab.mode-tab-active'),
           mainClass: main ? main.className : null,
           splitTerm: Boolean(main && main.classList.contains('split-term')),
           score: Boolean(T.q('.pane-score')),
           notes: Boolean(T.q('.pane-notes')),
           panes: T.qa('main.split .pane').length,
           splitters: T.qa('main.split .splitter').length,
           referenceButtons: T.qa('.pane-source .pane-head .btn').map((b) => (b.textContent || '').trim()),
         };
       })()`,
    )
    if (otherMode?.error) throw new Error(otherMode.error)
    check(
      otherMode.activeTab === '句子',
      `切到了句子栏（${otherMode.activeTab}）`,
    )
    check(
      otherMode.splitTerm === false && otherMode.score === true && otherMode.notes === true && otherMode.panes === 4,
      `别的题型照旧**四栏**（pane ${otherMode.panes} 块、左下 ${otherMode.score}、右下 ${otherMode.notes}、split-term=${otherMode.splitTerm}）`,
      JSON.stringify(otherMode),
    )
    check(
      otherMode.referenceButtons.includes('参考译文') === false,
      `「参考译文」开关**只长在术语栏**（句子栏标题栏里是 ${JSON.stringify(otherMode.referenceButtons)}）`,
      JSON.stringify(otherMode.referenceButtons),
    )
    // 切回术语栏，把顶栏那一段量掉
    await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const tab = [...document.querySelectorAll('.mode-tab')].find((b) => (b.textContent || '').trim() === '术语');
         if (tab) tab.click();
         await T.sleep(800);
       })()`,
    )

    console.log('\n=== 11. 顶栏：没有「内置示例批改」，最右边是「暗夜 · 设置」 ===')
    const topbar = await cdp.evaluate(
      `(() => {
         const T = window.__T;
         const bar = T.q('.topbar');
         const right = T.q('.topbar-right');
         const buttons = [...document.querySelectorAll('.topbar-right .btn')];
         const last = buttons[buttons.length - 1];
         const theme = T.q('.topbar-right .theme-toggle');
         const barRect = bar.getBoundingClientRect();
         const rightRect = right.getBoundingClientRect();
         const lastRect = last.getBoundingClientRect();
         const themeRect = theme ? theme.getBoundingClientRect() : null;
         const allTopbarButtons = [...bar.querySelectorAll('.btn')];
         return {
           text: (bar.innerText || '').replace(/\\s+/g, ' ').trim(),
           hasFixtureChip: (bar.innerText || '').includes('内置示例批改'),
           buttons: buttons.map((b) => (b.textContent || '').trim()),
           lastButton: last ? (last.textContent || '').trim() : null,
           themeIsSecondLast: Boolean(theme && buttons[buttons.length - 2] === theme),
           themeLeftOfLast: Boolean(themeRect && themeRect.right <= lastRect.left + 1),
           lastIsLastInTopbar: Boolean(last && allTopbarButtons[allTopbarButtons.length - 1] === last),
           右边缘差: Math.round(barRect.right - lastRect.right),
           barWidth: Math.round(barRect.width),
         };
       })()`,
    )
    check(
      topbar.hasFixtureChip === false,
      '顶栏里没有「内置示例批改」那枚芯片（用户要求删掉；批过术语之后也没有冒出来）',
      topbar.text.slice(0, 80),
    )
    check(
      topbar.buttons.join(',') === '☾ 暗夜,设置' ||
        topbar.buttons.join(',') === '☀ 日间,设置' ||
        // 没登录时顶栏还多一颗「登录 / 注册」——它排在暗夜之前，最右两颗仍是「暗夜 · 设置」
        (topbar.buttons.length === 3 && topbar.buttons[0] === '登录 / 注册'),
      `顶栏最右边那一组是「暗夜 / 设置」（实际 ${JSON.stringify(topbar.buttons)}）`,
      JSON.stringify(topbar.buttons),
    )
    check(
      topbar.lastButton === '设置' && topbar.lastIsLastInTopbar === true,
      '「设置」是整个顶栏里最后一颗按钮',
      JSON.stringify({ 最后一颗: topbar.lastButton, 是顶栏最后一颗: topbar.lastIsLastInTopbar }),
    )
    check(
      topbar.themeIsSecondLast === true && topbar.themeLeftOfLast === true,
      '暗夜那一颗紧挨在「设置」左边',
      JSON.stringify({ themeIsSecondLast: topbar.themeIsSecondLast, themeLeftOfLast: topbar.themeLeftOfLast }),
    )
    check(
      topbar.右边缘差 >= 0 && topbar.右边缘差 <= 24,
      `「设置」的右边缘就贴着顶栏右边缘（差 ${topbar.右边缘差}px，顶栏宽 ${topbar.barWidth}px）`,
      JSON.stringify(topbar),
    )

    console.log('\n=== 13. 第 17 条的版式：两栏标题栏等高 / 每格等高 / 参考译文一行 / 更正一行 ===')
    /*
     * 这一节量的是**第 17 条**那四条版式要求（用户原话见 README 的第 17 条）：
     *   1. 参考译文"能一行装下就一行装下，装不下才两行"；
     *   2. 我的译文里那条更正"一行就写完"——放不下时**左右加空格**把标记色那一段拓宽；
     *   3. 所有模式下「原文」与「我的译文」两个标题栏等高；
     *   4. 术语模式下两栏的**格子一格对一格**（画在同一水平线上）。
     *
     * 为什么非要真浏览器：这四条全是**像素几何**（行数、等高、有没有压到上一行、有没有出界），
     * 在 jsdom 里所有元素的 rect 都是 0×0，量什么都是 0。
     *
     * 走法：把这一页填成"官方译名里错一个词"，提交（本地判分，不发任何请求），再量。
     * 第 1 行**故意留空**——那是"没作答就用红色补上正确答案"那条的另一半。
     */
    const layout = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const lines = (node) => {
           if (!node) return 0;
           const range = document.createRange();
           range.selectNodeContents(node);
           return new Set([...range.getClientRects()].filter((r) => r.height > 0).map((r) => Math.round(r.top))).size;
         };
         const heights = (selector) => T.qa(selector).map((n) => Math.round(n.getBoundingClientRect().height * 10) / 10);
         const heads = () => ({
           source: Math.round(T.q('.pane-source .pane-head').getBoundingClientRect().height),
           answer: Math.round(T.q('.pane-answer .pane-head').getBoundingClientRect().height),
         });
         /**
          * 标题栏里"谁把这一行撑成了两行"：逐个子元素量宽度，并把每一栏的可用宽度也算出来。
          * 第 17 条第 3 条只要求**两栏等高**（它们由 --pane-head-h 保证），
          * 但真撑成两行会白白吃掉十行的高度，因此这里把证据留下来。
          */
         const headDetail = (pane) => {
           const head = T.q(pane + ' .pane-head');
           const meta = head.querySelector('.head-meta');
           const children = [...meta.children].map((node) => ({
             cls: (node.className || node.tagName).split(' ')[0],
             w: Math.round(node.getBoundingClientRect().width),
             text: (node.textContent || '').trim().slice(0, 24),
           }));
           return {
             headWidth: Math.round(head.getBoundingClientRect().width),
             metaWidth: Math.round(meta.getBoundingClientRect().width),
             titleWidth: Math.round(head.querySelector('h2').getBoundingClientRect().width),
             childrenWidthSum: children.reduce((sum, child) => sum + child.w, 0),
             rows: new Set([...meta.children].map((n) => Math.round(n.getBoundingClientRect().top))).size,
             children,
           };
         };

         // 先切回「中译英」：这样"参考译文"那一侧是**官方英文**，
         // 改坏一个字母（Committee → Comittee）就能造出"只错一个词"的答案
         const dirButton = T.qa('.pane-source .dir-btn').find((b) => (b.textContent || '').trim() === '中译英');
         if (dirButton && !dirButton.classList.contains('dir-btn-active')) {
           dirButton.click();
           await T.sleep(800);
         }

         // 站到第 1 页；如果这一页已经判过，先按「返回编辑」放开它
         await T.goto(0);
         const primary = T.primary();
         if (primary && (primary.textContent || '').trim() === '返回编辑') {
           primary.click();
           await T.sleep(300);
         }

         // 打开「参考译文」：这一页十条的官方译名就是"正确答案表"，也顺便量它占几行
         const toggle = T.referenceToggle();
         const wasOff = toggle && toggle.getAttribute('aria-pressed') !== 'true';
         if (wasOff) await T.toggleReference(400);
         const sourceRows = T.qa('.pane-source .term-source-row');
         const refs = sourceRows.map((row) => {
           const ref = row.querySelector('.term-source-ref');
           return ref ? (ref.textContent || '').trim() : '';
         });
         const refLineCounts = sourceRows.map((row) => lines(row.querySelector('.term-source-ref')));
         // 参考译文有没有**伸出这一格**（伸出就会压到下面那一格的字）
         const refOverflows = sourceRows.map((row) => {
           const ref = row.querySelector('.term-source-ref');
           return ref ? Math.round(ref.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom) : 0;
         });
         const editing = { heads: heads(), sourceRows: heights('.pane-source .term-source-row'), answerRows: heights('.pane-answer .term-row') };
         if (wasOff) await T.toggleReference(300);

         // 逐行填"官方译名里错一个词"；第 1 行**留空**（验"没作答＝红色补上"）
         const inputs = T.qa('.pane-answer .term-input');
         if (inputs[0] && !inputs[0].disabled) T.setInput(inputs[0], '');
         for (let i = 1; i < inputs.length; i += 1) {
           if (inputs[i].disabled) continue;
           const official = refs[i] || '';
           const corrupted = /Committee/.test(official)
             ? official.replace('Committee', 'Comittee')
             : official.replace(/(\\w+)/, (word) => word + 'x');
           T.setInput(inputs[i], corrupted);
           await T.sleep(30);
         }
         const filled = inputs.map((input) => input.value);

         // 提交（术语判分是本地对照官方译名，不发请求）
         T.primary().click();
         await T.sleep(700);

         const rows = T.qa('.pane-answer .term-row');
         const corrections = T.qa('.pane-answer .term-above').map((node) => {
           const anchor = node.parentElement;
           const row = node.closest('.term-row');
           return {
             text: (node.textContent || '').trim(),
             lines: lines(node),
             pad: getComputedStyle(anchor).getPropertyValue('--term-pad').trim(),
             anchorWidth: Math.round(anchor.getBoundingClientRect().width),
             // 更正那一行有没有跑出这一格（跑出去就压到 ✗ 或者栏外了）
             overRowRight: Math.round(node.getBoundingClientRect().right - row.getBoundingClientRect().right),
             // 标记色那一段够不够宽：更正的字必须落在它上方（宽度至少和它一样）
             wraps: getComputedStyle(node).whiteSpace,
           };
         });
         return {
           refs,
           refLineCounts,
           refOverflows,
           filled,
           editing,
           headDetail: { source: headDetail('.pane-source'), answer: headDetail('.pane-answer') },
           graded: {
             heads: heads(),
             sourceRows: heights('.pane-source .term-source-row'),
             answerRows: heights('.pane-answer .term-row'),
             corrections,
             aboveCount: T.qa('.pane-answer .term-above').length,
             addedCount: T.qa('.pane-answer .term-added').length,
           },
         };
       })()`,
    )

    /* 用一个块把这一节的局部名字圈起来：上面第 5 节也有一个叫 `graded` 的常量 */
    {
    const { editing, graded } = layout
    /* 诊断：标题栏里谁把这一行撑成了两行（信息量够大，失败时一眼看得出） */
    if (graded.heads.source !== graded.heads.answer || graded.heads.source > 60) {
      console.log(`      （标题栏明细：原文 ${JSON.stringify(layout.headDetail.source)}）`)
      console.log(`      （标题栏明细：译文 ${JSON.stringify(layout.headDetail.answer)}）`)
    }
    /* 3) 两个标题栏等高（改之前实测差 5px：原文栏 46、译文栏 51） */
    check(
      editing.heads.source === editing.heads.answer,
      `编辑态：原文栏与译文栏的标题栏等高（${editing.heads.source} / ${editing.heads.answer}）`,
      JSON.stringify(editing.heads),
    )
    check(
      graded.heads.source === graded.heads.answer,
      `判分后：两个标题栏仍然等高（${graded.heads.source} / ${graded.heads.answer}）`,
      JSON.stringify(graded.heads),
    )
    /* 4) 两栏的格子一格对一格（改之前 68 vs 73：差的那 5px 一路乘十） */
    const rowPairs = graded.sourceRows.map((height, index) => `${height}/${graded.answerRows[index] ?? '—'}`)
    check(
      graded.sourceRows.length === 10 &&
        graded.answerRows.length === 10 &&
        graded.sourceRows.every((height, index) => Math.abs(height - (graded.answerRows[index] ?? -1)) <= 0.5),
      `判分后：两栏十格**逐格等高**（原文/译文 ${rowPairs.join(' ')}）`,
      JSON.stringify({ 原文: graded.sourceRows, 译文: graded.answerRows }),
    )
    check(
      editing.sourceRows.length === 10 &&
        editing.sourceRows.every((height, index) => Math.abs(height - (editing.answerRows[index] ?? -1)) <= 0.5),
      `编辑态：两栏十格也逐格等高（${editing.sourceRows.map((h, i) => `${h}/${editing.answerRows[i] ?? '—'}`).join(' ')}）`,
      JSON.stringify({ 原文: editing.sourceRows, 译文: editing.answerRows }),
    )
    /* 1) 参考译文：一行装得下就一行（改之前 46% 的宽度上限把两条硬折成两行） */
    const twoLineRefs = layout.refLineCounts.filter((count) => count > 1).length
    check(
      layout.refs.filter((text) => text.length > 0).length === 10,
      `正文栏十条标准译法都画出来了（${layout.refs.filter((text) => text.length > 0).length} 条）`,
    )
    check(
      twoLineRefs <= 1,
      `十条里最多一条因为"真的装不下"才折行（实际 ${twoLineRefs} 条两行：${layout.refLineCounts.join(',')}）`,
      JSON.stringify(layout.refs.map((text, index) => `${layout.refLineCounts[index]}行 ${text.slice(0, 40)}`)),
    )
    check(
      layout.refOverflows.every((overflow) => overflow <= 0),
      `参考译文都没有伸出自己那一格（最大伸出 ${Math.max(...layout.refOverflows)}px）`,
      JSON.stringify(layout.refOverflows),
    )
    /* 2) 更正那一行只占一行，且放不下时靠"左右加空格"把标记段拓宽 */
    check(
      graded.aboveCount >= 5,
      `判分后画出了 ${graded.aboveCount} 条更正（每条都错一个词，因此每条都该有）`,
    )
    check(
      graded.corrections.every((item) => item.lines === 1),
      `每条更正都**只占一行**（${graded.corrections.map((c) => c.lines).join(',')}）`,
      JSON.stringify(graded.corrections.filter((c) => c.lines !== 1)),
    )
    check(
      graded.corrections.every((item) => item.wraps === 'nowrap' || item.overRowRight <= 0),
      '更正没有横向跑出这一格（放得下就一行，放不下才折行）',
      JSON.stringify(graded.corrections.map((c) => c.overRowRight)),
    )
    const padded = graded.corrections.filter((item) => Number.parseFloat(item.pad) > 0)
    check(
      padded.length >= 1 && padded.every((item) => item.anchorWidth >= 1),
      `标记色那一段被左右加空格拓宽了（${padded.length} 条，例如 ${JSON.stringify(padded[0] ?? null)}）`,
      JSON.stringify(graded.corrections.map((c) => ({ 更正: c.text, 空白: c.pad, 标记段宽: c.anchorWidth }))),
    )
    check(
      layout.filled.filter((value) => value.length > 0).length === 9,
      `这一页填了 9 条、第 1 行故意留空（${layout.filled.filter((v) => v.length > 0).length} 条）`,
    )
    }

    console.log('\n=== 12. 全程干净：没有页面异常、没有批改接口 ===')
    const finalApi = await cdp.evaluate('window.__T.apiCalls()')
    check(
      finalApi.filter((url) => url.includes('/api/judge')).length === 0,
      `整轮验收里 /api/judge 一次都没被调用（共 ${finalApi.length} 次 /api 调用）`,
      JSON.stringify(finalApi),
    )
    check(
      finalApi.filter((url) => url.includes('/api/refine')).length === 0,
      '也没有 /api/refine（术语题不走大改档）',
      JSON.stringify(finalApi),
    )
    check(cdp.errors.length === 0, '全程没有页面异常', cdp.errors.join(' ｜ '))
  } catch (error) {
    check(false, '整条验收流程跑完（没有中途抛错）', error instanceof Error ? (error.stack ?? error.message) : String(error))
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
  process.exitCode = failed === 0 ? 0 : 1
  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
