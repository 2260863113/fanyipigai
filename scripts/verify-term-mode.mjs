/**
 * 验收术语模式（第 13 轮之后的**新**术语题）：两个范围、每页五条、一页一页翻、本地判分。
 *
 * 为什么要在真浏览器里验：术语题是**另一条渲染路径**（不走 AnswerPane），
 * 而且这一轮的规则几乎全是"时序 + 计数 + 版式"类的规则——
 *   - 点「范围」弹出的**两屏弹窗**（卡片 → 中英对照平表 → 确定）只有真 DOM 才看得出对不对；
 *   - 「末页只有三条」这件事要数**真的**几个框可填、几个框是禁用的；
 *   - 「翻页只是翻页」「判分完全本地」要数**真的**发了几次 /api/judge（jsdom 里没有网络）；
 *   - 「返回编辑之后五条各就各位」是用户报过的那个 bug，只有真界面能证明它好了。
 *
 * 老版脚本验的是**已经不存在**的那套：一个固定五条的小组、判完给一颗「重新作答」把结果丢掉。
 * 现在一颗按钮两个名字（提交批改 / 返回编辑）、结果不丢、一页一页翻，因此断言整批重写。
 *
 * 覆盖的规矩（与用户第 13 轮的拍板一一对应）：
 *   1. 术语栏原文标题栏里是「范围 + 方向」两个控件，没有「换一换 / AI 出题 / 重新作答 / 重新贴一篇」；
 *   2. 「范围」弹窗两屏：两张卡片（83 条 · 17 页 / 60 条 · 12 页）→ 中英对照平表（83 / 60 行）→ 返回 / 确定；
 *   3. 国内 17 页、页脚写「第 N / 17 页 · 状态」，第 1 页没有「上一页」、第 17 页没有「下一页」，
 *      翻页只是翻页（不提交、草稿留着）；
 *   4. 末页照旧五等分：五行照画、只有三条能填，另外两条是禁用空框，只填那三条就能提交；
 *   5. 提交之后由**程序本地**对照官方译名判分：✓/✗、错的那条划掉 + 同一行给出官方译名、0 次接口调用；
 *   6. 「返回编辑」不丢结果、不删草稿，五条**各回各的框**（用户报的"五条全挤进第一个框"）；
 *      一个字没改就翻页往返仍是批改界面，改一个字就作废；
 *   7. 切「英译中」题干换成**官方英文**、按中文判分，一英多中那条两个中文用「／」列出来；
 *   8. 顶栏没有「内置示例批改」芯片（这一轮删掉了），最右边是「暗夜 · 设置」。
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
 * 为什么要有一份：下面十几段断言都要"点翻页、读第几页、往第几行写字"，
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
      for (let guard = 0; guard < 40 && pageNo().index !== target; guard += 1) {
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
        await sleep(70);
      }
      return qa('.pane-answer .term-input').map((input) => input.value);
    };
    const inputs = () => qa('.pane-answer .term-input').map((input) => input.value);
    const primary = () => q('.pane-answer .pane-head .btn-primary');
    const apiCalls = () => (window.__apiCalls || []).slice();
    const judgeCalls = () => apiCalls().filter((url) => url.includes('/api/judge') || url.includes('/api/refine'));
    const clickFoot = async (label, pause) => {
      const button = [...document.querySelectorAll('.gen-foot .btn')].find(
        (item) => (item.textContent || '').trim() === label,
      );
      if (!button) return false;
      button.click();
      await sleep(pause === undefined ? 350 : pause);
      return true;
    };
    const clickScopeCard = async (title, pause) => {
      const card = [...document.querySelectorAll('.scope-cards .scope-card')].find(
        (item) => (item.querySelector('.scope-card-title')?.textContent || '').trim() === title,
      );
      if (!card) return false;
      card.click();
      await sleep(pause === undefined ? 350 : pause);
      return true;
    };
    /** 打开「范围」弹窗（在两张卡片那一屏上），并抓一眼当前范围 */
    const openScopeDialog = async (pause) => {
      const scope = q('.pane-source .domain-trigger');
      if (!scope) return false;
      scope.click();
      await sleep(pause === undefined ? 400 : pause);
      return Boolean(document.querySelector('.scope-cards'));
    };
    return {
      sleep, q, qa, text, texts, pageNo, clickNav, goto, setInput, fill, inputs, primary,
      apiCalls, judgeCalls, clickFoot, clickScopeCard, openScopeDialog,
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
   * 术语题现在按「范围 + 方向」分成四道独立的题（term-v3-cn-org-zh-to-en 等），
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
    console.log('\n=== 1. 切到术语栏：原文标题栏里是「范围 + 方向」，没有旧按钮 ===')
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
         const headButtons = T.qa('.pane-source .pane-head .btn');
         const submit = T.primary();
         return {
           activeTab: T.text('.mode-tab.mode-tab-active'),
           headChildren: head ? [...head.children].map((node) => ((node.className || node.tagName) + '').split(' ')[0]) : [],
           metaChildren: meta ? [...meta.children].map((node) => ((node.className || node.tagName) + '').split(' ')[0]) : [],
           范围是第一个控件: Boolean(meta && trigger && meta.firstElementChild === trigger.parentElement),
           方向是第二个控件: Boolean(meta && dir && meta.children[1] === dir),
           rangeLabel: T.text('.pane-source .domain-trigger-label'),
           rangeValue: T.text('.pane-source .domain-trigger-value'),
           carets: T.texts('.pane-source .domain-trigger-caret'),
           dirLabels: T.texts('.pane-source .dir-btn'),
           dirActive: T.text('.pane-source .dir-btn-active'),
           dirDisabled: T.qa('.pane-source .dir-btn').map((b) => b.disabled),
           headButtons: headButtons.map((b) => (b.textContent || '').trim() + (b.disabled ? '(禁用)' : '')),
           hasRotate: headButtons.some((b) => (b.textContent || '').trim() === '换一换'),
           hasGenerator: headButtons.some((b) => (b.textContent || '').trim() === 'AI 出题'),
           hasRedo: headButtons.some((b) => (b.textContent || '').includes('重新作答')),
           hasRepaste: headButtons.some((b) => (b.textContent || '').includes('重新贴一篇')),
           hasPickArticle: headButtons.some((b) => (b.textContent || '').includes('选择文章') || (b.textContent || '').includes('换一句')),
           sourceList: T.qa('.pane-source .term-source-list').length,
           sourceRows: T.qa('.pane-source .term-source-row').length,
           sourceIndexes: T.texts('.pane-source .term-source-index'),
           sourceTexts: T.texts('.pane-source .term-source-text'),
           answerRows: T.qa('.pane-answer .term-row').length,
           inputs: T.qa('.pane-answer .term-input').length,
           chips: T.texts('.pane-answer .pane-head .chip'),
           submitInAnswerHead: Boolean(submit),
           submitLabel: submit ? (submit.textContent || '').trim() : null,
           submitDisabled: submit ? submit.disabled : null,
           historyPicker: T.qa('.pane-answer .pane-head .domain-trigger').length,
           navInSource: Boolean(T.q('.pane-source .pane-foot.section-nav')),
           hint: T.pageNo(),
           topbarHasFixtureChip: (T.q('.topbar')?.innerText || '').includes('内置示例批改'),
           topbarChips: T.texts('.topbar .chip'),
         };
       })()`,
    )
    if (enter?.error) throw new Error(enter.error)

    check(enter.activeTab === '术语', `切到了术语栏（当前 ${enter.activeTab}）`)
    check(
      enter.范围是第一个控件 === true && enter.方向是第二个控件 === true,
      '「范围」与方向就在「原文」右边、顺序是「范围 → 方向」（用户要求"模仿文章模式，紧挨原文"）',
      JSON.stringify({ 顺序: enter.metaChildren }),
    )
    check(
      enter.rangeLabel === '范围' && enter.rangeValue === '国内机关名称' && enter.carets.join('') === '▾',
      `按钮上写着「范围 · ${enter.rangeValue} ▾」（术语栏用「范围」而不是「领域」：两张平行的表）`,
      JSON.stringify({ label: enter.rangeLabel, value: enter.rangeValue, carets: enter.carets }),
    )
    check(
      enter.dirLabels.join(',') === '中译英,英译中' && enter.dirDisabled.every((flag) => flag === false),
      '方向两段「中译英 / 英译中」都在，而且**两个都能点**（每条术语两侧都有材料）',
      JSON.stringify({ labels: enter.dirLabels, disabled: enter.dirDisabled }),
    )
    check(enter.dirActive === '中译英', `默认方向是中译英（${enter.dirActive}）`)
    /*
     * 术语栏的原文标题栏里**一颗按钮都不该有**：第 13 轮拍板"「换一换」与「AI 出题」一起撤掉"，
     * 理由是术语题只有一个来源（这一个范围），换一换永远是灰的——一颗永远点不动、
     * 又解释不出所以然的按钮比不画更让人困惑。
     *
     * 早先这里断的是"没有**点得动**的「换一换」"（那时 SourcePane 只挡住了「AI 出题」，
     * 「换一换」照旧画出来、只是禁用）。src 里已经把两颗一起挡在 `mode !== 'term'` 后面
     * （见 SourcePane.tsx），因此这里收紧成**严格的"不存在"**：
     * 先断这一栏里没有任何 `.btn`，再逐个点名那四颗旧按钮都不在——
     * 只断"点不动"是不够的，一颗灰按钮照样是"界面在向用户提供这个入口"。
     */
    check(
      enter.headButtons.length === 0,
      '术语栏的原文标题栏里**一颗按钮都没有**（只剩「范围」与方向两段控件，位置与文章栏的「领域 × 方向」一致）',
      JSON.stringify(enter.headButtons),
    )
    check(
      enter.hasRotate === false && enter.hasGenerator === false,
      '「换一换」与「AI 出题」都**不存在**（术语题只来自两个范围：换一换没有备选篇目，AI 现出的题没有页码）',
      JSON.stringify(enter.headButtons),
    )
    check(
      enter.hasRedo === false && enter.hasRepaste === false && enter.hasPickArticle === false,
      '也没有「重新作答」（它并入「返回编辑」了）、「重新贴一篇」（原文栏自己就是输入框了）、' +
        '「选择文章 / 换一句」（那是文章栏与句子栏的入口）',
      JSON.stringify(enter.headButtons),
    )

    check(enter.sourceList === 1 && enter.sourceRows === 5, `原文栏是五等分的术语列表（${enter.sourceRows} 行）`)
    check(
      enter.sourceIndexes.join(',') === '1,2,3,4,5',
      '五行各带序号 1–5（一眼看出哪个框对应哪条术语）',
      JSON.stringify(enter.sourceIndexes),
    )
    check(
      enter.sourceTexts.length === 5 && enter.sourceTexts.every((item) => item.length > 0),
      `第 1 页五条术语都画出来了：${enter.sourceTexts.join(' ｜ ')}`,
    )
    check(enter.answerRows === 5 && enter.inputs === 5, `作答栏也是五行五个框（行 ${enter.answerRows} / 框 ${enter.inputs}）`)
    check(
      enter.chips.some((chip) => chip.includes('术语翻译 · 第 1 页 · 5 条')) && enter.chips.includes('本地判分'),
      `译文栏标题上写明"第几页几条"与「本地判分」（${JSON.stringify(enter.chips)}）`,
    )
    check(
      enter.submitInAnswerHead === true && enter.submitLabel === '提交批改' && enter.submitDisabled === true,
      '「提交批改」在译文栏标题栏右边（与文章模式同一个位置），没写满这一页时是禁用的',
      JSON.stringify({ label: enter.submitLabel, disabled: enter.submitDisabled }),
    )
    check(enter.historyPicker === 0, '一次都没批过时没有「批改记录」下拉（有历史才出现）')
    check(
      enter.navInSource === true && enter.hint.count === 17 && enter.hint.index === 0,
      `翻页导航在原文那栏的页脚里，写着「${enter.hint.hint}」`,
      JSON.stringify(enter.hint),
    )
    check(
      enter.topbarHasFixtureChip === false,
      '一进来顶栏就没有「内置示例批改」芯片（这一轮整枚删掉了）',
      JSON.stringify(enter.topbarChips),
    )

    console.log('\n=== 2. 「范围」弹窗：两张卡片 → 中英对照平表 → 确定 ===')
    const scopeUi = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         // 先翻两页：这样下面「确定 → 落到第 1 页」不是一句空话
         await T.goto(2);
         out.切之前 = T.pageNo();
         out.opened = await T.openScopeDialog();
         out.backdrop = Boolean(T.q('.raw-modal-backdrop'));
         out.dialogClass = T.q('.raw-modal-backdrop .raw-modal')?.className || '';
         out.title1 = T.text('.raw-modal-head > span');
         out.modalLabel1 = T.q('.raw-modal')?.getAttribute('aria-label') || null;
         out.note1 = T.text('.raw-modal-note');
         out.cards = T.qa('.scope-cards .scope-card').map((card) => ({
           title: (card.querySelector('.scope-card-title')?.textContent || '').trim(),
           meta: (card.querySelector('.scope-card-meta')?.textContent || '').trim(),
           now: (card.querySelector('.scope-card-now')?.textContent || '').trim(),
           active: card.classList.contains('scope-card-active'),
         }));
         out.foot1 = T.texts('.gen-foot .btn');
         // 点「国内机关名称」那张卡片 → 换到第二屏
         out.clickedCard = await T.clickScopeCard('国内机关名称');
         out.title2 = T.text('.raw-modal-head > span');
         out.note2 = T.text('.raw-modal-note');
         out.cardsGone = !T.q('.scope-cards');
         const wrap = T.q('.scope-table-wrap');
         out.wrap = wrap
           ? {
               overflowY: getComputedStyle(wrap).overflowY,
               // 83 行放不进弹窗，因此它必须**自己滚**（否则「确定 / 返回」会被顶到屏幕外）
               scrolls: wrap.scrollHeight > wrap.clientHeight,
               maxHeight: getComputedStyle(wrap).maxHeight,
             }
           : null;
         out.headers = T.texts('.scope-table th');
         out.tableDataScope = wrap ? wrap.getAttribute('data-scope-table') : null;
         const cnRows = T.qa('.scope-table tbody tr').map((tr) =>
           [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()),
         );
         window.__cnTable = cnRows;
         out.cnRows = cnRows.length;
         out.cnFirst = cnRows.slice(0, 2);
         out.cnLast = cnRows.slice(-1);
         out.foot2 = T.texts('.gen-foot .btn');
         // 「返回」→ 退回两张卡片那一屏
         out.clickedBack = await T.clickFoot('返回');
         out.backToCards = Boolean(T.q('.scope-cards'));
         out.tableGone = !T.q('.scope-table');
         // 再看一眼国际那一张表（60 行）
         out.clickedIntl = await T.clickScopeCard('国际机关名称');
         out.intlTitle = T.text('.raw-modal-head > span');
         out.intlNote = T.text('.raw-modal-note');
         const intlRows = T.qa('.scope-table tbody tr').map((tr) =>
           [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()),
         );
         window.__intlTable = intlRows;
         out.intlRows = intlRows.length;
         out.intlFoot = T.texts('.gen-foot .btn');
         // 「确定」→ 切到国际、一律落到第 1 页
         out.clickedConfirm = await T.clickFoot('确定', 600);
         out.closed = !T.q('.raw-modal-backdrop');
         out.scopeAfter = T.text('.pane-source .domain-trigger-value');
         out.pageAfter = T.pageNo();
         out.sourceAfter = T.texts('.pane-source .term-source-text');
         // 题干取的是**中文那一列**：此时方向是中译英，题目给的就是中文名
         out.intlFirst5 = intlRows.slice(0, 5).map((row) => row[0]);
         out.api = T.judgeCalls().length;
         return out;
       })()`,
    )
    check(scopeUi.opened === true && scopeUi.backdrop === true, '点「范围」弹出弹窗')
    check(
      scopeUi.dialogClass.includes('raw-modal') && scopeUi.dialogClass.includes('gen-modal'),
      `弹窗用的是站里同一个外壳（${scopeUi.dialogClass}）`,
    )
    check(
      scopeUi.title1 === '选择范围' && scopeUi.modalLabel1 === '选择范围',
      `第一屏的标题是「选择范围」（${scopeUi.title1}）`,
      scopeUi.modalLabel1,
    )
    check(scopeUi.cards.length === 2, `第一屏是两张范围卡片（实际 ${scopeUi.cards.length} 张）`)
    check(
      scopeUi.cards.map((card) => card.title).join(',') === '国内机关名称,国际机关名称',
      '两张卡片的名字与顺序：国内机关名称 / 国际机关名称',
      JSON.stringify(scopeUi.cards.map((card) => card.title)),
    )
    check(
      (scopeUi.cards[0]?.meta ?? '').includes('83 条 · 共 17 页') && (scopeUi.cards[0]?.meta ?? '').includes('末页 3 条'),
      `国内那张卡片写清"多少条 · 共几页"：${scopeUi.cards[0]?.meta}`,
    )
    check(
      (scopeUi.cards[1]?.meta ?? '').includes('60 条 · 共 12 页') && (scopeUi.cards[1]?.meta ?? '').includes('末页 5 条'),
      `国际那张卡片写清"多少条 · 共几页"：${scopeUi.cards[1]?.meta}`,
    )
    check(
      scopeUi.cards[0]?.active === true && scopeUi.cards[0]?.now === '正在练' && scopeUi.cards[1]?.now === '',
      '正在练的那个范围在卡片上有标记（另一张没有）',
      JSON.stringify(scopeUi.cards.map((card) => ({ title: card.title, now: card.now, active: card.active }))),
    )
    check(
      scopeUi.foot1.join('/') === '关闭',
      `第一屏底部是「关闭」（${JSON.stringify(scopeUi.foot1)}）`,
    )
    check(
      scopeUi.clickedCard === true && scopeUi.cardsGone === true && scopeUi.title2 === '国内机关名称',
      `点一张卡片就换到第二屏：大卡片的标题就是那个范围名（${scopeUi.title2}）`,
    )
    check(
      (scopeUi.note2 ?? '').includes('83 条') && (scopeUi.note2 ?? '').includes('17 页'),
      `第二屏的副标题写着这个范围的条数与页数（${scopeUi.note2}）`,
    )
    check(scopeUi.headers.join(',') === '中文名称,官方英文名称', `对照表两列：${scopeUi.headers.join(' / ')}`)
    check(scopeUi.cnRows === 83, `国内那张表是平的 83 行（实际 ${scopeUi.cnRows} 行）`)
    check(
      scopeUi.tableDataScope === 'cn-org',
      `表上标着它是哪一个范围（data-scope-table=${scopeUi.tableDataScope}）`,
    )
    check(
      (scopeUi.cnFirst?.[0]?.[0]?.length ?? 0) > 0 && (scopeUi.cnFirst?.[0]?.[1]?.length ?? 0) > 0,
      `每一行都是"中文 + 官方英文"两格：${JSON.stringify(scopeUi.cnFirst)}`,
    )
    console.log(`      表的第一行：${JSON.stringify(scopeUi.cnFirst?.[0])}`)
    console.log(`      表的最后一行：${JSON.stringify(scopeUi.cnLast?.[0])}`)
    check(
      scopeUi.wrap?.overflowY === 'auto' && scopeUi.wrap?.scrolls === true,
      `对照表自己滚（83 行放不进弹窗，"确定 / 返回"才不会被顶到屏幕外）`,
      JSON.stringify(scopeUi.wrap),
    )
    check(
      scopeUi.foot2.join('/') === '返回/确定',
      `第二屏底部是「返回」与「确定」（${JSON.stringify(scopeUi.foot2)}）`,
    )
    check(
      scopeUi.clickedBack === true && scopeUi.backToCards === true && scopeUi.tableGone === true,
      '「返回」退回两张卡片那一屏（表收起来）',
    )
    check(
      scopeUi.intlTitle === '国际机关名称' && scopeUi.intlRows === 60,
      `国际那张表是 60 行（实际 ${scopeUi.intlRows} 行，标题 ${scopeUi.intlTitle}）`,
    )
    check(
      scopeUi.closed === true && scopeUi.scopeAfter === '国际机关名称',
      `「确定」切到那个范围并关掉弹窗（现在范围是 ${scopeUi.scopeAfter}）`,
    )
    check(
      scopeUi.pageAfter.index === 0 && scopeUi.pageAfter.count === 12,
      `切范围**一律落到第 1 页**（刚才在第 ${scopeUi.切之前.index + 1} 页，现在 ${scopeUi.pageAfter.hint}）`,
      JSON.stringify({ 切之前: scopeUi.切之前, 切之后: scopeUi.pageAfter }),
    )
    check(
      scopeUi.sourceAfter.length === 5 && scopeUi.sourceAfter.join('|') === scopeUi.intlFirst5.join('|'),
      '换了范围，题干也跟着换成国际那 60 条的前五条（题干与题干表对得上）',
      JSON.stringify({ 屏幕上: scopeUi.sourceAfter, 表里: scopeUi.intlFirst5 }),
    )
    check(scopeUi.api === 0, '开弹窗、翻表、切范围全程没有批改接口调用（弹窗只是本地数据）')

    // 再切回国内：后面几节都在国内那 17 页上验
    const backToCn = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         out.opened = await T.openScopeDialog();
         out.clicked = await T.clickScopeCard('国内机关名称');
         out.confirmed = await T.clickFoot('确定', 700);
         out.scope = T.text('.pane-source .domain-trigger-value');
         out.page = T.pageNo();
         out.source = T.texts('.pane-source .term-source-text');
         // 中译英方向下题干是中文名，因此与表里**第一列**比
         out.cnFirst5 = (window.__cnTable || []).slice(0, 5).map((row) => row[0]);
         out.closed = !T.q('.raw-modal-backdrop');
         return out;
       })()`,
    )
    check(
      backToCn.scope === '国内机关名称' && backToCn.page.index === 0 && backToCn.page.count === 17 && backToCn.closed,
      `再选回「国内机关名称」→ 又落到第 1 页共 17 页（${backToCn.page.hint}）`,
      JSON.stringify(backToCn),
    )
    check(
      backToCn.source.join('|') === backToCn.cnFirst5.join('|'),
      '换回国内之后题干是中译英那一侧（中文名）',
      JSON.stringify({ 屏幕上: backToCn.source, 表里: backToCn.cnFirst5 }),
    )

    console.log('\n=== 3. 翻页：17 页、页脚写明状态、翻页只是翻页 ===')
    const paging = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = { 起点: T.pageNo(), 请求前: T.apiCalls().length };
         out.nav在原文栏 = Boolean(T.q('.pane-source .pane-foot.section-nav'));
         out.nav在作答栏 = Boolean(T.q('.pane-answer .pane-foot.section-nav'));
         const prev = T.q('.pane-source .section-nav [data-nav="prev"]');
         const next = T.q('.pane-source .section-nav [data-nav="next"]');
         out.第一页上一个 = prev ? prev.disabled : null;
         out.第一页下一个 = next ? next.disabled : null;
         out.按钮文字 = [prev, next].map((b) => (b ? (b.textContent || '').trim() : null));
         // 第 1 页写一行草稿
         T.setInput(T.qa('.pane-answer .term-input')[0], '草稿一号');
         await T.sleep(200);
         out.写完 = T.inputs();
         // 下一页：只是翻页
         await T.clickNav('next');
         out.第二页 = { page: T.pageNo(), values: T.inputs(), hint: T.text('.pane-source .section-nav .hint') };
         out.翻页后按钮 = T.text('.pane-answer .pane-head .btn-primary');
         out.翻页后判分标记 = T.qa('.pane-answer .term-mark').length;
         out.翻页后输入框 = T.qa('.pane-answer .term-input').length;
         await T.clickNav('prev');
         out.回第一页 = { page: T.pageNo(), values: T.inputs(), hint: T.text('.pane-source .section-nav .hint') };
         out.请求后 = T.apiCalls().length;
         // 一路翻到末页
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
         out.请求末页 = T.apiCalls().length;
         return out;
       })()`,
    )
    check(
      paging.nav在原文栏 === true && paging.nav在作答栏 === false,
      '「上一页 / 下一页」在左边原文那一栏的页脚里（翻页是为了换一段原文）',
      JSON.stringify({ 原文栏: paging.nav在原文栏, 作答栏: paging.nav在作答栏 }),
    )
    check(
      paging.起点.count === 17,
      `国内机关名称一共 17 页（页脚写着「${paging.起点.hint}」）`,
      JSON.stringify(paging.起点),
    )
    check(
      paging.第一页上一个 === true && paging.第一页下一个 === false,
      `第 1 页没有「上一页」（下一颗是 ${JSON.stringify(paging.按钮文字)}）`,
      JSON.stringify({ prev: paging.第一页上一个, next: paging.第一页下一个 }),
    )
    check(
      paging.翻了几次 === 16 && paging.末页.index === 16,
      `一路点「下一页」正好走完 17 页（点了 ${paging.翻了几次} 次到「${paging.末页.hint}」）`,
      JSON.stringify(paging.末页),
    )
    check(
      paging.末页下一个 === true && paging.末页上一个 === false,
      '第 17 页没有「下一页」（不会翻到不存在的第 18 页）',
      JSON.stringify({ prev: paging.末页上一个, next: paging.末页下一个 }),
    )
    check(
      paging.第二页.values.every((value) => value === '') && paging.第二页.hint.includes('第 2 / 17 页'),
      `翻到第 2 页是一张干净的作答栏（${paging.第二页.hint}）`,
      JSON.stringify(paging.第二页),
    )
    check(
      paging.回第一页.values[0] === '草稿一号' && paging.回第一页.hint.includes('第 1 / 17 页'),
      '翻走再翻回来，第 1 页的草稿原样还在（翻页保留输入缓存）',
      JSON.stringify(paging.回第一页),
    )
    check(
      paging.翻页后按钮 === '提交批改' && paging.翻页后判分标记 === 0 && paging.翻页后输入框 === 5,
      '翻页**不提交**：翻过去还是作答框 + 「提交批改」，没有冒出判分标记',
      JSON.stringify({ 按钮: paging.翻页后按钮, 标记: paging.翻页后判分标记, 输入框: paging.翻页后输入框 }),
    )
    check(
      paging.请求末页 === paging.请求前,
      `翻满 17 页一次批改接口都没发（全程 ${paging.请求末页} 次 /api 调用）`,
      JSON.stringify({ 前: paging.请求前, 后: paging.请求末页 }),
    )
    check(
      paging.起点.hint.includes('待批改'),
      `还没提交时页脚说「${paging.起点.hint}」`,
      paging.起点.hint,
    )
    /*
     * 页状态那四句里，术语题只量得到三句：待批改 / 已批改 / 编辑中。
     * 「批改中…」是给**异步等 AI 批改**那一刻写的，而术语判分是同步本地算的
     * （点下去同一拍就出结果），因此这一档在术语题上不可达——不是没验，是无处可验。
     */

    console.log('\n=== 4. 末页：照旧五等分，只有三条能填 ===')
    const lastPage = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = { page: T.pageNo() };
         out.sourceRows = T.qa('.pane-source .term-source-row').length;
         out.sourceIndexes = T.texts('.pane-source .term-source-index');
         out.sourceTexts = T.texts('.pane-source .term-source-text');
         out.answerRows = T.qa('.pane-answer .term-row').length;
         out.inputs = T.qa('.pane-answer .term-input').length;
         out.disabled = T.qa('.pane-answer .term-input').map((input) => input.disabled);
         out.blankRows = T.qa('.pane-answer .term-row-blank').length;
         out.blankInputs = T.qa('.pane-answer .term-row-blank .term-input').map((input) => ({
           disabled: input.disabled,
           readOnly: input.readOnly,
           value: input.value,
         }));
         const submit = T.primary();
         out.提交前 = { label: (submit.textContent || '').trim(), disabled: submit.disabled, title: submit.title };
         // 末页那三条 = 术语库里第 81–83 条（表里的最后三行）
         const tail = (window.__cnTable || []).slice(-3).map((row) => row[1]);
         out.答案 = tail;
         T.setInput(T.qa('.pane-answer .term-input')[0], tail[0]);
         await T.sleep(150);
         T.setInput(T.qa('.pane-answer .term-input')[1], tail[1]);
         await T.sleep(150);
         out.写两条 = { disabled: T.primary().disabled, title: T.primary().title, values: T.inputs() };
         T.setInput(T.qa('.pane-answer .term-input')[2], tail[2]);
         await T.sleep(150);
         out.写三条 = { disabled: T.primary().disabled, title: T.primary().title, values: T.inputs() };
         return out;
       })()`,
    )
    check(
      lastPage.sourceRows === 5 && lastPage.answerRows === 5,
      `末页两栏照旧各画五行（原文 ${lastPage.sourceRows} / 作答 ${lastPage.answerRows}）——两栏的横线才对得上`,
      JSON.stringify(lastPage.page),
    )
    check(
      lastPage.sourceIndexes.join(',') === '1,2,3,4,5',
      '末页的序号仍是 1–5（缺的两行不编号也不跳号）',
      JSON.stringify(lastPage.sourceIndexes),
    )
    check(
      lastPage.sourceTexts.slice(0, 3).every((item) => item.length > 0) &&
        lastPage.sourceTexts[3] === '' &&
        lastPage.sourceTexts[4] === '',
      `末页真实的三条画在前三行，后两行留空：${JSON.stringify(lastPage.sourceTexts)}`,
    )
    check(
      lastPage.disabled.filter((flag) => flag === true).length === 2 &&
        lastPage.disabled.slice(0, 3).every((flag) => flag === false),
      `五 个框里只有三个可填、后两个是禁用的（${JSON.stringify(lastPage.disabled)}）`,
      JSON.stringify(lastPage.disabled),
    )
    check(
      lastPage.blankRows === 2 && lastPage.blankInputs.every((item) => item.disabled && item.readOnly && item.value === ''),
      '缺的那两行是空的只读禁用框（不可填、也不计分）',
      JSON.stringify({ blankRows: lastPage.blankRows, blankInputs: lastPage.blankInputs }),
    )
    check(
      lastPage.提交前.disabled === true && (lastPage.提交前.title || '').includes('3 条'),
      '提交按钮的拦住条件只管**这一页真实的那几条**（悬停说明写「' + lastPage.提交前.title + '」）',
      JSON.stringify(lastPage.提交前),
    )
    check(
      lastPage.写两条.disabled === true,
      '只填两条时仍然不能提交（门槛是"这一页的三条都写上"）',
      JSON.stringify(lastPage.写两条),
    )
    check(
      lastPage.写三条.disabled === false && lastPage.写三条.title === '',
      '填满那三条之后「提交批改」就亮起来了（少了的那两条不参与门槛）',
      JSON.stringify(lastPage.写三条),
    )
    console.log(`      [诊断] 末页三条 = ${JSON.stringify(lastPage.答案)}`)

    console.log('\n=== 5. 提交 → 本地判分：✓/✗、划掉 + 官方译名、0 次接口调用 ===')
    const grading = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         await T.goto(0);
         out.page = T.pageNo();
         const rows = (window.__cnTable || []).slice(0, 5);
         const wrong = ['definitely not the official name', 'nope'];
         // 前三条照官方译名写、第 3 与第 5 条故意胡写 → 预期 ✓✓✗✓✗
         const answers = [rows[0][1], rows[1][1], wrong[0], rows[3][1], wrong[1]];
         out.answers = answers;
         out.官方译名 = rows.map((row) => row[1]);
         out.中文名 = rows.map((row) => row[0]);
         out.填完 = await T.fill(answers);
         out.可以提交 = !T.primary().disabled;
         out.请求前 = T.apiCalls().length;
         T.primary().click();
         // 本地判分是同步算的，等它画出五条标记就够
         for (let i = 0; i < 40 && T.qa('.pane-answer .term-mark').length < 5; i += 1) await T.sleep(100);
         out.请求后 = T.apiCalls().length;
         out.apiUrls = T.apiCalls();
         out.marks = T.texts('.pane-answer .term-mark');
         out.markIds = T.qa('.pane-answer [data-mark-id]').map((node) => node.getAttribute('data-mark-id'));
         out.rowClasses = T.qa('.pane-answer .term-row').map((node) => node.className);
         out.inputs = T.qa('.pane-answer .term-input').length;
         out.struck = T.texts('.pane-answer .mk-delete .mk-deleted');
         out.struckDecoration = (() => {
           const node = T.q('.pane-answer .mk-delete .mk-deleted');
           return node ? getComputedStyle(node).textDecorationLine : null;
         })();
         out.fixes = T.texts('.pane-answer .term-fix');
         out.arrows = T.texts('.pane-answer .term-arrow');
         out.highlights = T.qa('.pane-answer .mk-highlight').length;
         out.fixSameRow = T.qa('.pane-answer .term-result > .term-fix').length;
         out.inputReadOnly = T.qa('.pane-answer .term-input').map((input) => input.readOnly);
         out.hint = T.text('.pane-source .section-nav .hint');
         out.button = T.text('.pane-answer .pane-head .btn-primary');
         out.chips = T.texts('.pane-answer .pane-head .chip');
         out.historyPicker = T.qa('.pane-answer .pane-head .domain-trigger').map((node) => (node.textContent || '').trim());
         out.viewSwitch = T.texts('.pane-answer .view-switch .view-btn');
         out.hasRedo = T.qa('.pane-answer .pane-head .btn').some((b) => (b.textContent || '').includes('重新作答'));
         out.topbarHasFixtureChip = (T.q('.topbar')?.innerText || '').includes('内置示例批改');
         // 对照视图：一条术语一行对照
         const toCompare = [...document.querySelectorAll('.pane-answer .view-switch .view-btn')].find(
           (b) => (b.textContent || '').trim() === '对照视图',
         );
         if (toCompare) { toCompare.click(); await T.sleep(450); }
         out.compareLines = T.qa('.pane-answer .compare-list .compare-line').map((li) => ({
           original: (li.querySelector('.compare-original')?.textContent || '').trim(),
           corrected: (li.querySelector('.compare-corrected')?.textContent || '').trim(),
         }));
         const toCorrection = [...document.querySelectorAll('.pane-answer .view-switch .view-btn')].find(
           (b) => (b.textContent || '').trim() === '批改视图',
         );
         if (toCorrection) { toCorrection.click(); await T.sleep(350); }
         out.backToCorrection = T.qa('.pane-answer .term-mark').length;
         return out;
       })()`,
    )
    check(
      grading.填完.join('|') === grading.answers.join('|') && grading.可以提交 === true,
      '五条都写进了各自的框，写满之后「提交批改」可以点',
      JSON.stringify(grading.填完),
    )
    check(
      grading.marks.join('') === '✓✓✗✓✗',
      `照官方译名写的判对、胡写的判错（实际 ${grading.marks.join('')}）——术语判分是**严格对照**，不是"看着像就算对"`,
      JSON.stringify(grading.marks),
    )
    check(
      grading.markIds.join(',') === 'h1,h2,t3,h4,t5',
      `每条批注的编号 h1..h5（对）与 t1..t5（错）与它的下标对得上（${grading.markIds.join(',')}）`,
      JSON.stringify(grading.markIds),
    )
    check(
      grading.inputs === 0 && grading.hint.includes('已批改'),
      `判完之后这一页是**只读**的（输入框整批换成批注行，不是"框还在只是灰着"），页脚写着「${grading.hint}」`,
      JSON.stringify({ 输入框: grading.inputs, 只读框: grading.inputReadOnly.length, hint: grading.hint }),
    )
    check(
      grading.struck.length === 2 && grading.inputs === 0,
      `译错的两条整条划掉（${JSON.stringify(grading.struck)}）`,
      JSON.stringify(grading.struck),
    )
    check(
      grading.struckDecoration === 'line-through',
      `划掉是**真的横线**（computed text-decoration-line 实际 ${grading.struckDecoration}）`,
      grading.struckDecoration,
    )
    check(
      grading.fixes.join('|') === [grading.官方译名[2], grading.官方译名[4]].join('|'),
      `译错的两条在同一行右边给出**官方译名**：${grading.fixes.join(' ｜ ')}`,
      JSON.stringify({ 实际: grading.fixes, 期望: [grading.官方译名[2], grading.官方译名[4]] }),
    )
    check(
      grading.arrows.length === 2 && grading.arrows.every((arrow) => arrow === '→'),
      `标准译法前面有一个「→」把"你写的"与"应该怎么写"连起来（${JSON.stringify(grading.arrows)}）`,
      JSON.stringify(grading.arrows),
    )
    check(
      grading.fixSameRow === 2,
      '官方译名与答案在**同一行**（另起一行会把两行字挤进五等份里的一份）',
      String(grading.fixSameRow),
    )
    check(
      grading.highlights === 3,
      `译对的三条用绿色底色勾画（实际 ${grading.highlights} 条）`,
      String(grading.highlights),
    )
    check(
      grading.button === '返回编辑' && grading.hasRedo === false,
      `判完之后那颗按钮原地改名成「返回编辑」（不再有把结果丢掉的「重新作答」）`,
      JSON.stringify({ 按钮: grading.button, 有重新作答: grading.hasRedo }),
    )
    check(
      grading.chips.some((chip) => chip.includes('术语翻译 · 第 1 页 · 5 条')),
      `译文栏标题上仍写明这是第几页几条（${JSON.stringify(grading.chips)}）`,
    )
    check(
      grading.historyPicker.some((item) => item.includes('批改记录')),
      `批过一次之后出现「批改记录」下拉（${JSON.stringify(grading.historyPicker)}）`,
    )
    check(
      grading.viewSwitch.join(',') === '批改视图,对照视图',
      `判完之后能切「批改视图 / 对照视图」（与文章模式同一个开关）`,
      JSON.stringify(grading.viewSwitch),
    )
    check(
      grading.compareLines.length === 5,
      `对照视图里五条术语各出一行对照（实际 ${grading.compareLines.length} 行）`,
      JSON.stringify(grading.compareLines.slice(0, 2)),
    )
    check(
      grading.compareLines.every((line) => line.original.startsWith('原译') && line.corrected.startsWith('改后')),
      '每一行都是"原译 / 改后"两行交替',
      JSON.stringify(grading.compareLines.slice(0, 1)),
    )
    check(
      (grading.compareLines[2]?.corrected ?? '').includes(grading.官方译名[2]) &&
        (grading.compareLines[4]?.corrected ?? '').includes(grading.官方译名[4]),
      '写错的那两条在「改后」里给出官方译名',
      JSON.stringify([grading.compareLines[2], grading.compareLines[4]]),
    )
    check(grading.backToCorrection === 5, '切回「批改视图」还是那五条勾画', String(grading.backToCorrection))
    check(
      grading.请求后 === grading.请求前 && grading.apiUrls.filter((url) => url.includes('/api/judge')).length === 0,
      `判分**完全本地**：一条 /api/judge 都没发（全程 ${grading.apiUrls.length} 次 /api 调用）`,
      JSON.stringify(grading.apiUrls),
    )
    check(
      grading.topbarHasFixtureChip === false,
      '批过一次术语之后，顶栏仍然没有「内置示例批改」芯片（判分来源标的是 local 而不是 fixture）',
    )

    console.log('\n=== 5b. 范围切换在有进度时**仍然落到第 1 页** ===')
    const scopeSwitch = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         await T.clickNav('next');
         out.切之前 = T.pageNo();
         out.打开 = await T.openScopeDialog();
         out.点卡片 = await T.clickScopeCard('国际机关名称');
         out.确定 = await T.clickFoot('确定', 700);
         out.切到国际 = { scope: T.text('.pane-source .domain-trigger-value'), page: T.pageNo() };
         await T.clickNav('next');
         out.国际第二页 = T.pageNo();
         out.再打开 = await T.openScopeDialog();
         out.再点卡片 = await T.clickScopeCard('国内机关名称');
         out.再确定 = await T.clickFoot('确定', 700);
         out.切回国内 = {
           scope: T.text('.pane-source .domain-trigger-value'),
           page: T.pageNo(),
           marks: T.qa('.pane-answer .term-mark').length,
           button: T.text('.pane-answer .pane-head .btn-primary'),
         };
         return out;
       })()`,
    )
    check(
      scopeSwitch.切到国际.page.index === 0 && scopeSwitch.切到国际.page.count === 12,
      `在第 ${scopeSwitch.切之前.index + 1} 页切到国际 → 落到第 1 页共 12 页（${scopeSwitch.切到国际.page.hint}）`,
      JSON.stringify(scopeSwitch.切到国际),
    )
    check(
      scopeSwitch.切回国内.page.index === 0 && scopeSwitch.切回国内.scope === '国内机关名称',
      `切回国内也落在第 1 页（${scopeSwitch.切回国内.page.hint}）——注意此时国内第 1 页**已经批过**了，` +
        '所以"落到第 1 页"不是碰巧：确定按钮显式把页号置 0，而不是走"第一个没批过的页"那条路',
      JSON.stringify({ 切回国内: scopeSwitch.切回国内, 国际第二页: scopeSwitch.国际第二页 }),
    )
    check(
      scopeSwitch.切回国内.marks === 5 && scopeSwitch.切回国内.button === '返回编辑',
      '切走一圈回来，这一页的批改结果还在（换范围不删任何东西，两边的进度各存各的）',
      JSON.stringify(scopeSwitch.切回国内),
    )

    console.log('\n=== 6. 「返回编辑」：结果不丢、五条各回各的框 ===')
    const reedit = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         out.按钮 = T.text('.pane-answer .pane-head .btn-primary');
         T.primary().click();
         await T.sleep(500);
         out.放开后 = {
           button: T.text('.pane-answer .pane-head .btn-primary'),
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
           values: T.inputs(),
           hint: T.text('.pane-source .section-nav .hint'),
           button: T.text('.pane-answer .pane-head .btn-primary'),
         };
         // 再放开、改一个字 → 这一页的结果作废
         T.primary().click();
         await T.sleep(450);
         const before = T.inputs();
         out.改之前 = before;
         T.setInput(T.qa('.pane-answer .term-input')[0], before[0] + 'X');
         await T.sleep(300);
         out.改字后 = {
           values: T.inputs(),
           marks: T.qa('.pane-answer .term-mark').length,
           hint: T.text('.pane-source .section-nav .hint'),
           button: T.text('.pane-answer .pane-head .btn-primary'),
         };
         await T.clickNav('next');
         await T.clickNav('prev');
         out.改字往返后 = {
           page: T.pageNo(),
           values: T.inputs(),
           marks: T.qa('.pane-answer .term-mark').length,
           inputs: T.qa('.pane-answer .term-input').length,
           hint: T.text('.pane-source .section-nav .hint'),
         };
         out.api = T.judgeCalls().length;
         return out;
       })()`,
    )
    check(
      reedit.放开后.inputs === 5 &&
        reedit.放开后.editable === true &&
        reedit.放开后.button === '提交批改' &&
        reedit.放开后.hint.includes('编辑中'),
      `点「返回编辑」回到五个**可写**的框、那颗按钮改回「提交批改」（${reedit.放开后.hint}）`,
      JSON.stringify(reedit.放开后),
    )
    /*
     * 用户报过的那个 bug：按「返回编辑」之后**五条译文全挤进第一个框**。
     * 原因是存储按"页号"索引，而回填时被当成"第几行"用了。判据必须落在**单个框**上：
     * 只看"五个框里有没有字"是查不出来的（五个框里都有字也算通过），
     * 因此这里逐框比：第 i 个框必须正好是第 i 条答案，且**不含换行**。
     */
    check(
      reedit.放开后.values.join('|') === grading.answers.join('|'),
      `五条**各回各的框**：第 i 个框正好是第 i 条答案（不是五条全挤进第一个框）`,
      JSON.stringify({ 框里: reedit.放开后.values, 交的: grading.answers }),
    )
    check(
      reedit.放开后.values[0] === grading.answers[0] && !reedit.放开后.values[0].includes('\n'),
      `第一个框里**只有第一条**（${JSON.stringify(reedit.放开后.values[0])}），没有把五条拼在一起`,
      JSON.stringify(reedit.放开后.values),
    )
    check(
      reedit.往返后.marks === 5 && reedit.往返后.inputs === 0 && reedit.往返后.hint.includes('已批改'),
      `放开之后**一个字都没改**就翻走再回来：屏幕上仍是那份批改（${reedit.往返后.hint}）——「返回编辑」不把结果扔掉`,
      JSON.stringify(reedit.往返后),
    )
    check(
      reedit.改字后.values.join('|') === [grading.answers[0] + 'X', ...grading.answers.slice(1)].join('|') &&
        reedit.改字后.marks === 0,
      '改一个字之后结果立刻作废（回到作答框），而且**其余四条原样留着**（草稿不丢）',
      JSON.stringify(reedit.改字后),
    )
    check(
      reedit.改字往返后.inputs === 5 &&
        reedit.改字往返后.marks === 0 &&
        reedit.改字往返后.values[0] === grading.answers[0] + 'X',
      '作废之后翻页往返仍是作答框 + 改过的草稿（那一页现在是一道待提交的题）',
      JSON.stringify(reedit.改字往返后),
    )
    check(reedit.api === 0, '「返回编辑」与翻页全程 0 次批改接口调用', String(reedit.api))

    console.log('\n=== 7. 方向切换：题干换成官方英文、按中文判分、一英多中给「／」 ===')
    const dir7 = await cdp.evaluate(
      `(async () => {
         const T = window.__T;
         const out = {};
         out.切之前 = {
           page: T.pageNo(),
           dir: T.text('.pane-source .dir-btn-active'),
           origin: T.texts('.pane-source .term-source-text'),
         };
         out.期望中文 = (window.__cnTable || []).slice(0, 5).map((row) => row[0]);
         out.期望英文 = (window.__cnTable || []).slice(0, 5).map((row) => row[1]);
         out.切前两个方向都可点 = T.qa('.pane-source .dir-btn').every((b) => !b.disabled);
         const enButton = [...document.querySelectorAll('.pane-source .dir-btn')].find(
           (b) => (b.textContent || '').trim() === '英译中',
         );
         if (enButton) enButton.click();
         await T.sleep(800);
         out.切之后 = {
           page: T.pageNo(),
           dir: T.text('.pane-source .dir-btn-active'),
           origin: T.texts('.pane-source .term-source-text'),
           scope: T.text('.pane-source .domain-trigger-value'),
           chips: T.texts('.pane-answer .pane-head .chip'),
         };
         out.请求切方向后 = T.apiCalls().length;
         /*
          * 一英多中的那几行**从表里现找**，不写死下标：同一条官方英文对应两个中文名。
          *
          * 为什么不写死：材料换一批（或 build-terms.mjs 重排）之后写死的下标会指向别的术语，
          * 那时失败信息看着像"功能坏了"。按"哪几行的官方英文相同"找，并当场确认找到的
          * 就是材料里那一对（直辖市人民政府 / 设区的市人民政府）。
          */
         const table = window.__cnTable || [];
         const byEnglish = {};
         table.forEach((row, index) => {
           byEnglish[row[1]] = (byEnglish[row[1]] || []).concat([index]);
         });
         const groups = Object.keys(byEnglish)
           .map((english) => ({ english, rows: byEnglish[english] }))
           .filter((group) => group.rows.length > 1);
         const municipal = groups.find((group) => group.rows.some((index) => table[index][0] === '直辖市人民政府'));
         out.一英多中 = groups.map((group) => ({
           english: group.english,
           zh: group.rows.map((index) => table[index][0]),
           pages: group.rows.map((index) => Math.floor(index / 5) + 1),
         }));
         if (!municipal) return out;
         const dupPage = Math.floor(municipal.rows[0] / 5);
         const dupRows = municipal.rows.map((index) => index - dupPage * 5);
         out.一英多中的页 = dupPage + 1;
         out.一英多中在页内的行号 = dupRows;
         await T.goto(dupPage);
         out.这一页 = { page: T.pageNo(), origin: T.texts('.pane-source .term-source-text') };
         const rows = table.slice(dupPage * 5, dupPage * 5 + 5);
         out.这一页词条 = rows;
         /*
          * 这一页的作答：一英多中的**头一行故意写错**（要看它把两个中文用「／」列出来），
          * 它的配对行填**另一个中文**（一英多中写哪个都算对，这一条也要在真界面上验）。
          */
         const answers = rows.map((row) => row[0]);
         answers[dupRows[0]] = '某某市人民政府';
         answers[dupRows[1]] = table[municipal.rows[0]][0];
         out.answers = answers;
         await T.fill(answers);
         out.填完 = T.inputs();
         T.primary().click();
         for (let i = 0; i < 40 && T.qa('.pane-answer .term-mark').length < 5; i += 1) await T.sleep(100);
         out.marks = T.texts('.pane-answer .term-mark');
         out.fixes = T.texts('.pane-answer .term-fix');
         out.hint = T.text('.pane-source .section-nav .hint');
         out.请求判分后 = T.apiCalls().length;
         /**
          * 顺带看一眼**从别的页切方向**会落在哪一页（诊断用）。术语题的两个方向是
          * 两道独立的题（term-v3-…-zh-to-en / -en-to-zh），各自的页号与进度分开存，
          * 因此这里量到的是"另一道题的落点"，不是"同一页"。
          */
         const zhButton = [...document.querySelectorAll('.pane-source .dir-btn')].find(
           (b) => (b.textContent || '').trim() === '中译英',
         );
         if (zhButton) zhButton.click();
         await T.sleep(800);
         out.切回中译英 = {
           page: T.pageNo(),
           dir: T.text('.pane-source .dir-btn-active'),
           originHead: T.texts('.pane-source .term-source-text').slice(0, 2),
           期望中文头两条: (window.__cnTable || []).slice(0, 2).map((row) => row[0]),
         };
         return out;
       })()`,
    )
    check(
      dir7.切之前.dir === '中译英' && dir7.切之前.origin.join('|') === dir7.期望中文.join('|'),
      '切之前是中译英：题干是**中文名**',
      JSON.stringify(dir7.切之前.origin),
    )
    check(
      dir7.切之后.dir === '英译中' && dir7.切之后.origin.join('|') === dir7.期望英文.join('|'),
      `切到「英译中」之后题干换成**官方英文**（${dir7.切之后.origin[0]} …）`,
      JSON.stringify({ 屏幕上: dir7.切之后.origin, 表里: dir7.期望英文 }),
    )
    check(
      dir7.切之后.origin.join('|') !== dir7.期望中文.join('|') && dir7.切之后.scope === '国内机关名称',
      '切方向只换题干那一侧，范围不动（两个控件各管各的）',
      JSON.stringify(dir7.切之后),
    )
    check(
      dir7.切之后.page.index === dir7.切之前.page.index && dir7.切之后.page.count === 17,
      `从第 ${dir7.切之前.page.index + 1} 页切方向仍停在第 ${dir7.切之后.page.index + 1} 页（共 17 页，两个方向都能练）——` +
        '两个方向是**两道独立的题**（term-v3-<范围>-<方向>），各自的页号 / 进度 / 作答分开存，' +
        '因此"切方向停在原地"这件事靠的是两边的落点一致（见下面的落点诊断）',
      JSON.stringify({ 切之前: dir7.切之前.page, 切之后: dir7.切之后.page }),
    )
    check(
      (dir7.一英多中 ?? []).length >= 1 && dir7.一英多中的页 === 16,
      `材料里真有"一英多中"：${JSON.stringify(dir7.一英多中)}（两行同一条官方英文，落在同一页上）`,
      JSON.stringify(dir7.一英多中),
    )
    check(
      (dir7.这一页?.origin ?? [])[dir7.一英多中在页内的行号?.[0]] ===
        (dir7.这一页?.origin ?? [])[dir7.一英多中在页内的行号?.[1]] &&
        (dir7.这一页?.origin ?? [])[dir7.一英多中在页内的行号?.[0]] === dir7.一英多中?.[0]?.english,
      `一英多中那两条（${dir7.一英多中?.[0]?.zh?.join(' / ')}）的题干**是同一条英文**：${dir7.一英多中?.[0]?.english}`,
      JSON.stringify(dir7.这一页),
    )
    check(
      (dir7.marks ?? []).join('') === '✓✗✓✓✓',
      `英译中时写**中文**判对、胡写判错（实际 ${(dir7.marks ?? []).join('')}）——切方向之后判分跟着换到中文那一侧；` +
        '其中配对那一行填的是**另一个中文名**，照样判对（一英多中写哪个都算对）',
      JSON.stringify(dir7.marks),
    )
    check(
      (dir7.fixes ?? []).length === 1 && dir7.fixes[0] === '直辖市人民政府／设区的市人民政府',
      `一英多中那条写错时，官方答案把两个中文都用「／」列出来：${(dir7.fixes ?? []).join(' ｜ ')}`,
      JSON.stringify(dir7.fixes),
    )
    check(
      (dir7.fixes ?? []).every((item) => item.includes('／')),
      '「／」是真的画在屏幕上的（不是测试里记的一个常量）',
      JSON.stringify(dir7.fixes),
    )
    check(
      dir7.请求判分后 === dir7.请求切方向后,
      '英译中这一次判分同样没发任何批改接口（切方向也没有）',
      JSON.stringify({ 前: dir7.请求切方向后, 后: dir7.请求判分后 }),
    )
    check(
      dir7.切回中译英.dir === '中译英' && dir7.切回中译英.originHead.join('|') === dir7.切回中译英.期望中文头两条.join('|'),
      '切回「中译英」题干又是中文名了',
      JSON.stringify(dir7.切回中译英),
    )
    console.log(
      `      [诊断] 从第 ${(dir7.这一页?.page?.index ?? -1) + 1} 页切回中译英 → 落在第 ` +
        `${dir7.切回中译英.page.index + 1} 页：两个方向是两道独立的题，各自的页号与进度分开存，` +
        '因此"切方向仍停在第 N 页"这件事只在两边落点恰好一致时成立（上面那条断言量的就是两页相同的那一段）',
    )

    console.log('\n=== 8. 顶栏：没有「内置示例批改」，最右边是「暗夜 · 设置」 ===')
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
           chips: T.texts('.topbar .chip'),
           buttons: buttons.map((b) => (b.textContent || '').trim()),
           lastButton: last ? (last.textContent || '').trim() : null,
           themeIsSecondLast: Boolean(theme && buttons[buttons.length - 2] === theme),
           themeLeftOfLast: Boolean(themeRect && themeRect.right <= lastRect.left + 1),
           lastIsLastInTopbar: Boolean(last && allTopbarButtons[allTopbarButtons.length - 1] === last),
           右边缘差: Math.round(barRect.right - lastRect.right),
           topbarRight差: Math.round(barRect.right - rightRect.right),
           barWidth: Math.round(barRect.width),
         };
       })()`,
    )
    check(
      topbar.hasFixtureChip === false,
      '顶栏里没有「内置示例批改」那枚芯片（用户要求删掉；批过一次术语之后也没有冒出来）',
      topbar.text.slice(0, 80),
    )
    check(
      topbar.buttons.join(',') === '☾ 暗夜,设置' || topbar.buttons.join(',') === '☀ 日间,设置',
      `顶栏最右边那一组就是「暗夜 / 设置」两颗（实际 ${JSON.stringify(topbar.buttons)}）`,
      JSON.stringify(topbar.buttons),
    )
    check(
      topbar.lastButton === '设置' && topbar.lastIsLastInTopbar === true,
      '「设置」是整个顶栏里最后一颗按钮（用户最后一句："设置最右边，暗夜次右边"）',
      JSON.stringify({ 最后一颗: topbar.lastButton, 是顶栏最后一颗: topbar.lastIsLastInTopbar }),
    )
    check(
      topbar.themeIsSecondLast === true && topbar.themeLeftOfLast === true,
      '暗夜那一颗紧挨在「设置」左边',
      JSON.stringify({ themeIsSecondLast: topbar.themeIsSecondLast, themeLeftOfLast: topbar.themeLeftOfLast }),
    )
    check(
      topbar.右边缘差 >= 0 && topbar.右边缘差 <= 24,
      `「设置」的右边缘就贴着顶栏右边缘（差 ${topbar.右边缘差}px，顶栏宽 ${topbar.barWidth}px）——` +
        '顶栏里那枚芯片删掉之后，topbar-right 的 margin-left:auto 自然把它推到了最右',
      JSON.stringify(topbar),
    )

    console.log('\n=== 9. 全程干净：没有页面异常、没有批改接口 ===')
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
