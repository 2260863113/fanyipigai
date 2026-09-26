/**
 * 验收「文章库」这一行的界面：领域下拉、方向切换、选文章弹窗、以及选中之后的界面。
 *
 * 为什么不能只靠冒烟测试：冒烟测试跑在 jsdom 里，Click 与下拉都是模拟事件；
 * 而这一行是纯界面交互（下拉展开、弹窗、卡片点击），正是"只有真浏览器才看得出来"
 * 的那一类。它连的是**已经在跑的那个服务**，因此也能顺带发现服务端缓存陈旧。
 *
 * 用法：node scripts/verify-article-bar.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const debugPort = 9235
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

const profileDir = path.join(root, 'node_modules', '.cache', 'verify-bar-profile')
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

const results = []
function check(ok, label, detail) {
  results.push({ ok, label, detail })
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

  // 每次从干净状态开始：清掉本地的选择，验证默认落点
  await cdp.send('Page.navigate', { url: `${base}/` })
  await sleep(1500)
  await cdp.evaluate('try { localStorage.clear() } catch (e) {}')
  await cdp.send('Page.reload')
  let mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  if (!mounted) throw new Error('界面没有挂载')
  await sleep(500)

  console.log('\n=== 1. 范围控件现在长在原文标题栏里 ===')
  const bar = await cdp.evaluate(
    `({
       /*
        第 7 条之后这里不再有那一行：领域与方向都搬进了原文标题栏。
        因此判据反过来——顶层不该再有 .article-bar（那一行整个删掉了）。
       */
       hasBar: !!document.querySelector('.article-bar'),
       在原文标题栏: (() => {
         const head = document.querySelector('.pane-source .pane-head');
         if (!head) return { 有原文标题栏: false };
         const children = [...head.children];
         const domain = head.querySelector('.domain-select');
         const dir = head.querySelector('.dir-switch');
         return {
           有原文标题栏: true,
           领域在标题栏里: !!domain,
           方向在标题栏里: !!dir,
           /* 领域必须**紧挨「原文」**（用户原话"紧靠原文的右边"）：
              它是标题栏 meta 组里的**第一个**控件（标题右边第一样东西就是它）。 */
           领域紧挨标题: (() => {
              const meta = head.querySelector('.head-meta');
              return !!(meta && domain && meta.firstElementChild === domain);
            })(),
           横向顺序: children.map((node) =>
             node.tagName === 'H2' ? '原文' : (node.className || '').split(' ')[0],
           ),
         };
       })(),
       domainLabel: document.querySelector('.pane-source .domain-trigger-value')?.textContent?.trim() ?? null,
       dirButtons: [...document.querySelectorAll('.pane-source .dir-btn')].map((b) => b.textContent.trim()),
       dirActive: document.querySelector('.pane-source .dir-btn-active')?.textContent?.trim() ?? null,
       dirDisabled: [...document.querySelectorAll('.pane-source .dir-btn')].map((b) => b.disabled),
       hasPickButton: [...document.querySelectorAll('.btn')].some((b) => b.textContent.includes('选择文章')),
       /*
        「选择文章」仍要在**原文标题栏**里（只是排在领域与方向之后——头一组的位置让给了范围控件）。
       */
       pickInSourceHead: (() => {
         const head = document.querySelector('.pane-source .pane-head');
         const btn = [...(head ? head.querySelectorAll('.btn') : [])].find((b) => b.textContent.includes('选择文章'));
         if (!btn) return { 在原文标题栏: false };
         const buttons = [...head.querySelectorAll('.btn')].map((b) => b.textContent.trim());
         return { 在原文标题栏: true, 该栏按钮顺序: buttons };
       })(),
       topbarHasSettings: [...document.querySelectorAll('.topbar .btn')].some((b) => b.textContent.trim() === '设置'),
       /* 第 9 条：顶栏那三枚小标签（方向 / 文体 / 话题）都删掉了 */
       topbarChips: [...document.querySelectorAll('.topbar .chip')].map((c) => c.textContent.trim()),
       noOldCaseStrip: !document.querySelector('.case-strip'),
       noOldCaseTabs: document.querySelectorAll('.case-tab').length === 0,
     })`,
  )
  check(bar.hasBar === false, '顶部那条「文章库那一行」整个删掉了（第 7 条：领域挪进原文标题栏）')
  check(bar.在原文标题栏?.领域在标题栏里 === true, '领域下拉现在在**原文标题栏**里')
  check(bar.在原文标题栏?.领域紧挨标题 === true, '它**紧挨着「原文」三个字**（用户原话"紧靠原文的右边"）', JSON.stringify(bar.在原文标题栏?.横向顺序))
  check(bar.在原文标题栏?.方向在标题栏里 === true, '方向切换也在原文标题栏里（第 7 条追问：整条删掉，方向一起搬）')
  check(bar.domainLabel === '社会', `老按钮条已去掉、领域显示默认值（${bar.domainLabel}）`)
  check(bar.dirButtons.join(',') === '中译英,英译中', `方向切换还是两段：${bar.dirButtons.join(' / ')}`)
  check(bar.dirActive === '英译中', `默认方向为英译中（${bar.dirActive}）`)
  check(
    bar.dirDisabled.includes(false),
    '至少有一个方向是可点的（不是两边都灰着）',
    JSON.stringify(bar.dirDisabled),
  )
  check(bar.hasPickButton === true, '有「选择文章」入口')
  check(
    bar.pickInSourceHead?.在原文标题栏 === true,
    '「选择文章」在**原文标题栏**里',
    JSON.stringify(bar.pickInSourceHead),
  )
  check(
    bar.topbarChips.every((chip) => !['中译英', '英译中', '新闻编译', '社会'].includes(chip)),
    `顶栏不再挂方向/文体/话题三枚标签（现在的芯片：${JSON.stringify(bar.topbarChips)}）`,
  )
  check(bar.topbarHasSettings === true, '「设置」仍在顶栏（每一栏都够得着）')
  check(bar.noOldCaseStrip === true && bar.noOldCaseTabs === true, '旧的一排题目按钮已彻底移除')

  console.log('\n=== 2. 左边是下拉，能选领域 ===')
  await cdp.evaluate("document.querySelector('.domain-trigger').click()")
  await sleep(350)
  const menu = await cdp.evaluate(
    `({
       open: !!document.querySelector('.domain-menu'),
       items: [...document.querySelectorAll('.domain-item')].map((b) => b.textContent.trim()),
     })`,
  )
  check(menu.open === true, '点领域展开下拉')
  /*
   * 现在是**七个板块**：五个**话题领域**（社会、经济、文化、生态、科技）
   * 之后是两类**卷子**（真题、样题），顺序也定了。
   * 政治建设、教育强国、国际传播三个领域已从全站删掉（见 ADR 0010），
   * 真题/样题是后来进来的两类（见 ADR 0029），因此这里连"顺序"一起钉住——
   * 它是用户挑的，不该被随手改。
   *
   * ⚠️ 句子栏是**另一张表**：那边只给五个话题领域、不列真题与样题（也是 ADR 0029 定的），
   * 所以这条只对**文章栏**成立（本脚本量的就是文章栏）。
   */
  check(menu.items.length === 7, `下拉里是七个板块（实际 ${menu.items.length}）`)
  check(
    menu.items.join('/') === '社会/经济/文化/生态/科技/真题/样题',
    '七个板块的名字与顺序都对',
    menu.items.join(' / '),
  )

  // 选「生态」——按设计，选完领域会**紧接着弹出选文章的框**
  const clicked = await cdp.evaluate(
    `(() => {
       const item = [...document.querySelectorAll('.domain-item')].find((b) => b.textContent.trim() === '生态');
       if (!item) return 'no-item';
       item.click();
       return 'clicked';
     })()`,
  )
  check(clicked === 'clicked', '能在下拉里点到「生态」', clicked)
  await sleep(700)
  const afterPick = await cdp.evaluate(
    `({
       domain: document.querySelector('.domain-trigger-value')?.textContent?.trim() ?? null,
       menuClosed: !document.querySelector('.domain-menu'),
       pickerOpened: !!document.querySelector('.article-cards'),
       modalInDom: !!document.querySelector('.raw-modal'),
       bodyHead: (document.body.innerText || '').slice(0, 80),
       sourceTitle: (document.querySelector('.pane-source .source-text')?.textContent ?? '').slice(0, 60),
     })`,
  )
  console.log(`      领域=${afterPick.domain} 菜单已收=${afterPick.menuClosed} 弹窗=${afterPick.pickerOpened} modal=${afterPick.modalInDom}`)
  if (cdp.errors.length > 0) console.log(`      ⚠ 页面异常：${cdp.errors.join(' ｜ ')}`)
  if (afterPick.bodyHead.includes('界面出错了')) {
    // 兜底界面已经在页面上——把它显示的报错原样打出来，这比"白屏"有用得多
    const detail = await cdp.evaluate(
      `(document.querySelector('#root > div')?.innerText ?? '').slice(0, 900)`,
    )
    console.log('      ── 兜底界面显示的错误 ──')
    console.log(String(detail).split('\n').slice(0, 14).map((line) => '      ' + line).join('\n'))
  }
  console.log(`      页面开头：${afterPick.bodyHead.replace(/\n/g, ' / ')}`)
  check(afterPick.domain === '生态', `选完领域后显示新领域（${afterPick.domain}）`)
  check(afterPick.pickerOpened === true, '点领域后自动弹出选文章的框（用户点领域就是为了挑文章）')
  check(afterPick.sourceTitle.length > 20, '左侧原文栏先落到该领域的第一篇', afterPick.sourceTitle)

  console.log('\n=== 3. 弹窗里以卡片罗列文章 ===')
  const modal = await cdp.evaluate(
    `({
       open: !!document.querySelector('.article-cards'),
       hasDirectionSwitch: document.querySelectorAll('.picker-dirs .gen-chip').length,
       cards: [...document.querySelectorAll('.article-card')].map((c) => ({
         title: c.querySelector('.article-card-title')?.textContent?.trim() ?? '',
         meta: c.querySelector('.article-card-meta')?.textContent?.trim() ?? '',
       })),
     })`,
  )
  check(modal.open === true, '弹窗里以卡片罗列文章')
  check(modal.hasDirectionSwitch === 2, '弹窗里也能切方向（不必关掉再回那一行）')
  /*
   * **生态 / 英译中 只有 3 篇**：那五组材料里第 1、2、4 组讲的是同一件事（南岭猕猴），
   * 三篇文本相似度 87%–98%，按用户决定只留第 1 组。其余格子都是 5 篇。
   */
  check(modal.cards.length === 3, `生态 / 英译中 有 3 张卡片（去重后的实际篇数，实际 ${modal.cards.length}）`)
  check(
    modal.cards.every((c) => c.title.length > 10),
    '每张卡片的标题就是那一篇的「事件锚点」',
    modal.cards.map((c) => c.title.slice(0, 30)).join(' ｜ '),
  )
  check(
    modal.cards.every((c) => /\d+\s*(词|字)/.test(c.meta) && /共\s*\d+\s*页/.test(c.meta)),
    '卡片上说明了篇幅与"会切成几页"',
    modal.cards[0]?.meta ?? '',
  )
  check(
    modal.cards.every((c) => !/China Daily|Xinhua|新华社|人民日报|光明日报/.test(c.meta)),
    '卡片上不再显示"来源媒体"（这批材料没有来源，也不该编一个）',
    modal.cards.map((c) => c.meta).join(' ｜ '),
  )
  /*
   * 最高分标签（第 12 条）：每篇文章都挂一枚，没得分的显示 0 分。
   * 这一轮前面清过 localStorage，因此这里量的是"0 分也照实写出来"这件事；
   * "批过之后会变成真实分数"由 verify-per-page 在批改之后量。
   */
  const bestBadges = await cdp.evaluate(
    `[...document.querySelectorAll('.article-card')].map((card) => ({
       title: card.querySelector('.article-card-title')?.textContent?.trim() ?? '',
       best: card.querySelector('.article-card-best')?.textContent?.trim() ?? null,
     }))`,
  )
  check(
    bestBadges.every((item) => /^最高分\s*\d+\s*分$/.test(item.best ?? '')),
    `每张卡片都有一枚「最高分 N 分」标签（${JSON.stringify(bestBadges.map((item) => item.best))}）`,
  )
  check(
    bestBadges.every((item) => (item.best ?? '').includes('最高分 0 分')),
    '还没练过 / 没得分的那些显示的是 0 分（不是把标签藏起来）',
  )
  console.log(`      最高分标签：${bestBadges[0]?.best ?? ''}`)
  console.log(`      示例卡片：${modal.cards[0]?.title ?? ''}`)
  console.log(`      卡片元信息：${modal.cards[0]?.meta ?? ''}`)

  console.log('\n=== 4. 点一张卡片即开始练 ===')
  await cdp.evaluate("document.querySelectorAll('.article-card')[1].click()")
  await sleep(600)
  const picked = await cdp.evaluate(
    `({
       modalClosed: !document.querySelector('.article-cards'),
       sourceText: (document.querySelector('.pane-source .source-text')?.textContent ?? ''),
       hasInput: !!document.querySelector('.answer-input'),
       buttons: [...document.querySelectorAll('.pane-source .pane-head .btn')].map((b) => b.textContent.trim()),
       /*
        第 7 条：标题栏那颗「对照译文」按钮删掉了，参考译文改成**正文末尾可折叠的一块**。
        这里量三件事：按钮没了、折叠块在（当前这一页确实有参考译文时）、默认是**折着**的。
       */
       hasCompareButton: [...document.querySelectorAll('.pane-source .pane-head .btn')].some(
         (b) => b.textContent.includes('对照译文'),
       ),
       pairs: document.querySelectorAll('.pair-list').length,
       referenceBlock: !!document.querySelector('.reference'),
       referenceOpen: document.querySelector('.reference')?.open === true,
       referenceSummary: document.querySelector('.reference summary')?.textContent?.trim() ?? null,
       /* 它还必须在**正文之后**（用户原话"原文结束后有『参考译文』几个字"） */
       afterSourceText: (() => {
         const text = document.querySelector('.pane-source .source-text');
         const ref = document.querySelector('.reference');
         if (!text || !ref) return null;
         return !!(text.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING);
       })(),
     })`,
  )
  check(picked.modalClosed === true, '选完之后弹窗自动关闭')
  check(picked.sourceText.length > 60, `原文栏加载了选中的那一页（${picked.sourceText.length} 字符）`)
  check(picked.hasInput === true, '可以开始作答（输入框在）')
  check(picked.hasCompareButton === false, '标题栏那颗「对照译文」按钮已经删掉（第 7 条）')
  check(picked.referenceBlock === true, '正文末尾有「参考译文」折叠块（文章库自带参考译文）')
  check(picked.referenceSummary === '参考译文', `折叠块上就写着「参考译文」（实际 ${picked.referenceSummary}）`)
  check(picked.referenceOpen === false, '默认是**折着**的（不占地方）')
  check(picked.afterSourceText === true, '它在**正文之后**（用户原话："原文结束后有『参考译文』几个字"）')
  check(picked.pairs === 0, '旧的"一段原文一段译文交替铺开"那条路已经没有了')

  console.log('\n=== 4b. 点「参考译文」铺开、再点折回（第 7 条）===')
  const opened = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const summary = document.querySelector('.reference summary');
       if (!summary) return { error: '没有「参考译文」这一行' };
       summary.click();
       await sleep(300);
       const text = document.querySelector('.reference p')?.textContent?.trim() ?? '';
       const afterOpen = {
         打开了: document.querySelector('.reference')?.open === true,
         译文长度: text.length,
         译文片段: text.slice(0, 40),
       };
       summary.click();
       await sleep(300);
       const afterClose = {
         折叠回去了: document.querySelector('.reference')?.open === false,
         译文还看得见: (document.querySelector('.reference p')?.textContent?.trim() ?? '').length > 0,
       };
       return { afterOpen, afterClose };
     })()`,
  )
  check(opened?.afterOpen?.打开了 === true, '点一下就铺开', JSON.stringify(opened?.afterOpen))
  check(
    (opened?.afterOpen?.译文长度 ?? 0) > 20,
    `铺开的是这一页的参考译文（${opened?.afterOpen?.译文长度} 字：${opened?.afterOpen?.译文片段}…）`,
  )
  check(opened?.afterClose?.折叠回去了 === true, '再点同一处就折回去（用户原话："点击相同位置，参考译文折叠回来"）')

  console.log('\n=== 4c. 没有参考译文的题连这四个字都不出现 ===')
  const noReference = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       /* 自己贴一篇：贴进来的题没有参考译文（见 custom.ts） */
       const tab = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '自定义');
       if (tab) tab.click();
       await sleep(500);
       const paste = [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('贴') || b.textContent.includes('重新贴'));
       if (paste) paste.click();
       await sleep(400);
       const area = document.querySelector('.gen-textarea');
       if (area) {
         const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
         setter.call(area, '第一段自己贴进来的原文，用来验参考译文那块不出现。\\n\\n第二段也要有，这样题型会判成段落题。');
         area.dispatchEvent(new Event('input', { bubbles: true }));
         await sleep(200);
         const apply = [...document.querySelectorAll('.raw-modal-backdrop .gen-foot .btn')].find(
           (b) => b.textContent.includes('开始') || b.textContent.includes('确定') || b.textContent.includes('导入'),
         );
         if (apply) apply.click();
         await sleep(700);
       }
       return {
         有折叠块: !!document.querySelector('.reference'),
         有原文: (document.querySelector('.pane-source .source-text')?.textContent ?? '').length > 10,
       };
     })()`,
  )
  check(
    noReference?.有原文 === true ? noReference?.有折叠块 === false : true,
    '自己贴的题没有参考译文，因此连「参考译文」四个字都不出现',
    JSON.stringify(noReference),
  )
  /*
   * 切回「文章」栏再往下走：上面为了造一道"没有参考译文"的题切到了「自定义」栏，
   * 而后面几节量的都是文章栏上的东西（方向切换、换一换……）。
   */
  await cdp.evaluate(
    `[...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '文章').click()`,
  )
  await sleep(700)
  const backToArticle = await cdp.evaluate(
    `({
       有原文: (document.querySelector('.pane-source .source-text')?.textContent ?? '').length > 60,
       又出现参考译文块: !!document.querySelector('.reference'),
     })`,
  )
  check(
    backToArticle?.有原文 === true && backToArticle?.又出现参考译文块 === true,
    '切回文章栏，参考译文块又回来了（它跟着"这一页有没有译文"走）',
    JSON.stringify(backToArticle),
  )

  console.log('\n=== 5. 方向切换确实换了一批文章（中译英现在也有文章了）===')
  const englishSource = await cdp.evaluate(
    "(document.querySelector('.pane-source .source-text')?.textContent ?? '').slice(0, 40)",
  )
  await cdp.evaluate(
    `[...document.querySelectorAll('.dir-btn')].find((b) => b.textContent.trim() === '中译英').click()`,
  )
  await sleep(700)
  const afterDir = await cdp.evaluate(
    `({
       dirActive: document.querySelector('.dir-btn-active')?.textContent?.trim() ?? null,
       source: (document.querySelector('.pane-source .source-text')?.textContent ?? '').slice(0, 40),
     })`,
  )
  check(afterDir.dirActive === '中译英', `切到中译英（当前 ${afterDir.dirActive}）`)
  check(afterDir.source.length > 10, '中译英方向也有原文可练', afterDir.source)
  check(afterDir.source !== englishSource, '换方向确实换了另一批文章（不是同一篇）')
  // 中译英的原文应当是中文
  check(/[\u4e00-\u9fff]/.test(afterDir.source), '中译英方向的原文是中文', afterDir.source)

  console.log('\n=== 6. 中译英方向也能选文章 ===')
  await cdp.evaluate(
    `[...document.querySelectorAll('.pane-source .pane-head .btn')].find((b) => b.textContent.includes('选择文章')).click()`,
  )
  await sleep(600)
  const zhModal = await cdp.evaluate(
    `({
       cards: [...document.querySelectorAll('.article-card')].map((c) => c.querySelector('.article-card-title')?.textContent?.trim() ?? ''),
       units: [...document.querySelectorAll('.article-card-units')].map((s) => s.textContent.trim()),
     })`,
  )
  check(zhModal.cards.length === 5, `中译英方向有 5 张卡片（每个板块 5 篇，实际 ${zhModal.cards.length}）`)
  check(
    zhModal.units.every((u) => /字/.test(u)),
    '中译英的篇幅按「字」计（不是词）',
    zhModal.units.join(' ｜ '),
  )
  console.log(`      示例卡片：${zhModal.cards[0] ?? ''}　${zhModal.units[0] ?? ''}`)
  await cdp.evaluate("document.querySelector('.raw-modal-close')?.click()")
  await sleep(300)

  /*
   * ── 续做与记忆：两个来源，记住的那一页优先 ──
   *
   * 两条要求都建立在"哪几页批过"这份进度上（见 components/article-progress.ts），
   * 而用户后来又加了一条「个性化记忆，下一次落到上一次关掉时的界面」
   * （见 components/last-view.ts）。两者会同时给出一个页号，因此这一节要把**优先级**也验掉：
   *   ① **没有记住页号时**（第一次来 / 换了台电脑）：从没有批完的那一段继续；
   *   ② **记住了页号时**：回到那一页——哪怕它已经批过、哪怕后面还有没批的。
   */
  console.log('\n=== 7. 续做与记忆：没记住页号时从没批完的那一段继续 ===')
  const current = await cdp.evaluate(
    `(() => {
       const hint = (document.querySelector('.section-nav .hint') || {}).textContent || '';
       const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(hint);
       return {
         id: document.querySelector('.app')?.getAttribute('data-exercise-id') || '',
         page: m ? Number(m[1]) : 1,
         total: m ? Number(m[2]) : 1,
       };
     })()`,
  )
  check(current.id.length > 0 && current.total >= 2, `当前这一篇是多页的（${current.id} 共 ${current.total} 页）`)
  check(
    current.total === 3 || current.total >= 3,
    '一页 = 一个自然段：这一篇 3 段以上就至少 3 页',
    `${current.id} 共 ${current.total} 页`,
  )

  const partial = Math.min(3, current.total - 1)
  await cdp.evaluate(
    `(() => {
       window.localStorage.setItem('translation-practice.article-progress.v1', JSON.stringify({
         ${JSON.stringify(current.id)}: { graded: ${JSON.stringify(Array.from({ length: partial }, (_, i) => i))}, updatedAt: new Date().toISOString() },
       }));
       // 把"上次停在哪一页"擦掉，模拟第一次来这台机器
       window.localStorage.removeItem('translation-practice.last-view.v1');
     })()`,
  )
  await cdp.send('Page.reload')
  await sleep(2200)
  const resumed = await cdp.evaluate(
    `(() => {
       const hint = (document.querySelector('.section-nav .hint') || {}).textContent || '';
       const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(hint);
       return {
         id: document.querySelector('.app')?.getAttribute('data-exercise-id') || '',
         page: m ? Number(m[1]) : 1,
         chips: [...document.querySelectorAll('.pane-source .chip')].map((c) => c.textContent.trim()),
         落盘进度: JSON.parse(window.localStorage.getItem('translation-practice.article-progress.v1') || '{}')[
           document.querySelector('.app')?.getAttribute('data-exercise-id') || ''
         ]?.graded ?? [],
         hasResult: !!document.querySelector('.annotated-lines'),
       };
     })()`,
  )
  check(resumed.id === current.id, '没练完的那一篇仍然主动打开（不会被赶走）', `${resumed.id} vs ${current.id}`)
  check(
    resumed.page === partial + 1,
    `下次打开从没有批完的那一段继续：第 ${resumed.page} 页（已批 ${partial} 页）`,
    JSON.stringify(resumed),
  )
  /*
   * 「已批 N 页」那枚芯片**按用户要求删掉了**（第 7 条：去掉"已批x页""官方建议xx分钟"这些标签），
   * 因此这条断言改成量它**背后的那份进度**：进度照旧落盘、照旧决定落点，
   * 只是不再画在原文栏上。删的若是这份进度本身，"从没批完的那一段继续"就失效了。
   */
  check(
    resumed.chips.every((text) => !text.includes('已批') && !text.includes('官方建议')),
    `原文栏不再显示「已批 N 页」「官方建议 N 分钟」两枚芯片（现在的芯片：${JSON.stringify(resumed.chips)}）`,
  )
  check(
    Array.isArray(resumed.落盘进度) && resumed.落盘进度.length === partial,
    `进度本身照旧落盘、照旧管着落点（这一篇记着已批 ${JSON.stringify(resumed.落盘进度)} 页）`,
    JSON.stringify(resumed.落盘进度),
  )
  check(resumed.hasResult === false, '接着做的那一页是待批改的（不会把上一页的结果搬过来）')

  console.log('\n=== 7b. 记住了页号时，回到上次关掉的那一页（优先于"没批完的那一段"）===')
  /*
   * 直接把 last-view 写成"停在第 2 页"，同时把这一篇的第 1、2 页都算作已批——
   * 于是两个来源给出**互相矛盾**的答案（记忆说第 2 页，进度说第 3 页），
   * 谁优先一目了然。用户选的是"记住的那一页优先"。
   */
  await cdp.evaluate(
    `(() => {
       window.localStorage.setItem('translation-practice.article-progress.v1', JSON.stringify({
         ${JSON.stringify(current.id)}: { graded: [0, 1], updatedAt: new Date().toISOString() },
       }));
       window.localStorage.setItem('translation-practice.last-view.v1', JSON.stringify({
         tab: 'article',
         exerciseId: ${JSON.stringify(current.id)},
         origin: 'article-bank',
         sectionIndex: 1,
       }));
     })()`,
  )
  await cdp.send('Page.reload')
  await sleep(2200)
  const remembered = await cdp.evaluate(
    `(() => {
       const hint = (document.querySelector('.section-nav .hint') || {}).textContent || '';
       const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(hint);
       return {
         id: document.querySelector('.app')?.getAttribute('data-exercise-id') || '',
         page: m ? Number(m[1]) : 1,
         tab: document.querySelector('.mode-tab-active')?.textContent?.trim() ?? '',
       };
     })()`,
  )
  check(remembered.id === current.id, '回到记住的那一篇', remembered.id)
  check(
    remembered.page === 2,
    `回到记住的那一页（第 ${remembered.page} 页；进度本会把人送到第 3 页）`,
    JSON.stringify(remembered),
  )
  check(remembered.tab.includes('文章'), '也回到了记住的那一栏', remembered.tab)

  console.log('\n=== 8. 整篇练完：不主动显示它，列表里排到最后 ===')
  await cdp.evaluate(
    `window.localStorage.setItem('translation-practice.article-progress.v1', JSON.stringify({
       ${JSON.stringify(current.id)}: {
         graded: ${JSON.stringify(Array.from({ length: current.total }, (_, i) => i))},
         updatedAt: new Date().toISOString(),
       },
     }))`,
  )
  await cdp.send('Page.reload')
  await sleep(2200)
  const afterDone = await cdp.evaluate(
    `({
       id: document.querySelector('.app')?.getAttribute('data-exercise-id') || '',
       hint: (document.querySelector('.section-nav .hint') || {}).textContent || '',
     })`,
  )
  check(afterDone.id !== current.id, `练完的那一篇不再主动显示（换成了 ${afterDone.id}）`, JSON.stringify(afterDone))
  check(afterDone.id.length > 0, '换过去的那一篇照样能打开', afterDone.hint)

  // 列表里：练完的排到最后，并且挂着「已完成」
  await cdp.evaluate(
    `[...document.querySelectorAll('.pane-source .pane-head .btn')].find((b) => b.textContent.includes('选择文章'))?.click()`,
  )
  await sleep(600)
  const ordered = await cdp.evaluate(
    `({
       titles: [...document.querySelectorAll('.article-card-title')].map((t) => t.textContent.trim()),
       doneAt: [...document.querySelectorAll('.article-card')].map((c, i) => (c.querySelector('.article-card-done') ? i : -1)).filter((i) => i >= 0),
       doneLabels: [...document.querySelectorAll('.article-card-done')].map((d) => d.textContent.trim()),
       cards: document.querySelectorAll('.article-card').length,
     })`,
  )
  check(ordered.cards === 5, `这一格仍然是 5 篇（实际 ${ordered.cards}）`)
  check(
    ordered.doneAt.length === 1 && ordered.doneAt[0] === ordered.cards - 1,
    '练完的那一篇排在**最后**（"以后换一换留到最后"）',
    JSON.stringify(ordered.doneAt),
  )
  check(
    ordered.doneLabels.length === 1 && ordered.doneLabels[0] === '已完成',
    '最后那张卡片标着「已完成」',
    JSON.stringify(ordered.doneLabels),
  )
  await cdp.evaluate("document.querySelector('.raw-modal-close')?.click()")
  await sleep(300)

  console.log('\n=== 8b. 记住的是句子栏时，打开就落在句子栏 ===')
  await cdp.evaluate(
    `window.localStorage.setItem('translation-practice.last-view.v1', JSON.stringify({
       tab: 'sentence', exerciseId: 'sentence-v2-ecology-2', origin: 'sentence', sectionIndex: 0,
     }))`,
  )
  await cdp.send('Page.reload')
  await sleep(2200)
  const sentenceLanding = await cdp.evaluate(
    `({
       tab: document.querySelector('.mode-tab-active')?.textContent?.trim() ?? '',
       id: document.querySelector('.app')?.getAttribute('data-exercise-id') || '',
       hasInput: !!document.querySelector('.answer-input'),
     })`,
  )
  check(sentenceLanding.tab.includes('句子'), `打开就落在句子栏（${sentenceLanding.tab}）`)
  check(sentenceLanding.id === 'sentence-v2-ecology-2', `落在那一道句子题上（${sentenceLanding.id}）`)
  check(sentenceLanding.hasInput === true, '照样能直接作答')

  console.log('\n=== 8c. 暗夜模式（第 9 条）===')
  /*
   * 用户原话："给整个网站添加暗夜模式，在导航栏最右边（设置按钮挪到最左边，
   * 暗夜模式按钮在设置按钮的右边）切换。"随后又改口成"设置最右边，暗夜次右边"——以最后一次为准。
   * 默认跟随系统，手动切过之后记住（见 settings.ts 的 resolveTheme）。
   */
  const themeUi = await cdp.evaluate(
    `(() => {
       const buttons = [...document.querySelectorAll('.topbar-right .btn')].map((b) => b.textContent.trim());
       const dark = document.querySelector('.theme-toggle');
       return {
         buttons,
         theme: document.documentElement.getAttribute('data-theme'),
         darkIsLast: (() => {
           const all = [...document.querySelectorAll('.topbar-right .btn')];
           return all.length >= 2 && all[all.length - 1].textContent.trim() === '设置';
         })(),
         darkLabel: dark ? dark.textContent.trim() : null,
         paper: getComputedStyle(document.body).backgroundColor,
         /* 设置按钮在暗夜按钮**右边**（用户最后一句："设置最右边，暗夜次右边"） */
         darkBeforeSettings: (() => {
           const all = [...document.querySelectorAll('.topbar-right .btn')];
           const darkAt = all.findIndex((b) => b.textContent.includes('暗夜') || b.textContent.includes('日间'));
           const setAt = all.findIndex((b) => b.textContent.trim() === '设置');
           return darkAt >= 0 && setAt >= 0 && darkAt < setAt;
         })(),
       };
     })()`,
  )
  check(themeUi.buttons.includes('设置'), `顶栏右侧仍有「设置」（${JSON.stringify(themeUi.buttons)}）`)
  check(themeUi.darkLabel !== null, `顶栏右侧有暗夜开关（写着「${themeUi.darkLabel}」）`)
  check(themeUi.darkBeforeSettings === true && themeUi.darkIsLast === true, '顺序是「暗夜 · 设置」——设置在最右（用户最后一句）')
  check(['light', 'dark'].includes(themeUi.theme), `首屏就定好了主题（data-theme=${themeUi.theme}，不会先闪一下白屏）`)

  const toggled = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const before = document.documentElement.getAttribute('data-theme');
       document.querySelector('.theme-toggle').click();
       await sleep(400);
       const after = document.documentElement.getAttribute('data-theme');
       return {
         before,
         after,
         bodyBackground: getComputedStyle(document.body).backgroundColor,
         saved: JSON.parse(window.localStorage.getItem('translation-practice.settings.v1') || '{}').theme ?? null,
         label: document.querySelector('.theme-toggle')?.textContent?.trim() ?? '',
       };
     })()`,
  )
  check(toggled.before !== toggled.after, `点一下就换了主题（${toggled.before} → ${toggled.after}）`)
  check(
    (toggled.after === 'dark' && toggled.saved === 'dark') || (toggled.after === 'light' && toggled.saved === 'light'),
    `手动切过之后记下来了（存的是 ${toggled.saved}，不再跟随系统）`,
  )
  /*
   * 底色真的换了：不写死具体色值（那是样式表的细节，改配色就会假红），
   * 只要求"暗夜时整体是深色、日间时整体是浅色"——按通道平均值判，一眼能量出来的那种。
   */
  const backgroundIsDark = (() => {
    const channels = String(toggled.bodyBackground).match(/\d+/g)?.map(Number) ?? []
    if (channels.length < 3) return null
    const average = (channels[0] + channels[1] + channels[2]) / 3
    return average < 90
  })()
  check(
    backgroundIsDark !== null && backgroundIsDark === (toggled.after === 'dark'),
    `${toggled.after === 'dark' ? '暗夜' : '日间'}时整体底色确实是${toggled.after === 'dark' ? '深' : '浅'}色（body 底色 ${toggled.bodyBackground}）`,
  )
  await cdp.send('Page.reload')
  await sleep(2200)
  const themeAfterReload = await cdp.evaluate(
    `({
       theme: document.documentElement.getAttribute('data-theme'),
       label: document.querySelector('.theme-toggle')?.textContent?.trim() ?? '',
     })`,
  )
  check(
    themeAfterReload.theme === toggled.after,
    `刷新之后还是刚选的那一套（${themeAfterReload.theme}），不会弹回系统那一套`,
  )
  // 切回原来那一套，后面的截图与断言都在同一个主题下跑
  await cdp.evaluate(`document.querySelector('.theme-toggle').click()`)
  await sleep(400)

  console.log('\n=== 9. 页面错误 ===')
  check(cdp.errors.length === 0, '全程没有页面异常', cdp.errors.join(' ｜ '))

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
  process.exitCode = failed === 0 ? 0 : 1

  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
