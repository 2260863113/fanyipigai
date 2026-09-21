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

  console.log('\n=== 1. 那一行是否成型 ===')
  const bar = await cdp.evaluate(
    `({
       hasBar: !!document.querySelector('.article-bar'),
       domainLabel: document.querySelector('.domain-trigger-value')?.textContent?.trim() ?? null,
       dirButtons: [...document.querySelectorAll('.dir-btn')].map((b) => b.textContent.trim()),
       dirActive: document.querySelector('.dir-btn-active')?.textContent?.trim() ?? null,
       dirDisabled: [...document.querySelectorAll('.dir-btn')].map((b) => b.disabled),
       hasPickButton: [...document.querySelectorAll('.btn')].some((b) => b.textContent.includes('选择文章')),
       /*
        用户要求「选择文章」放在**原文标题栏的右侧、靠左**（与「换一换 / AI 出题」同一行，
        但排在它们前面），而不是原来那一行；这里连位置一起验。
       */
       pickInSourceHead: (() => {
         const head = document.querySelector('.pane-source .pane-head');
         const btn = [...(head ? head.querySelectorAll('.btn') : [])].find((b) => b.textContent.includes('选择文章'));
         if (!btn) return { 在原文标题栏: false };
         const buttons = [...head.querySelectorAll('.btn')].map((b) => b.textContent.trim());
         return { 在原文标题栏: true, 该栏按钮顺序: buttons };
       })(),
       topbarHasSettings: [...document.querySelectorAll('.topbar .btn')].some((b) => b.textContent.trim() === '设置'),
       noOldCaseStrip: !document.querySelector('.case-strip'),
       noOldCaseTabs: document.querySelectorAll('.case-tab').length === 0,
     })`,
  )
  check(bar.hasBar === true, '文章库那一行出现了')
  check(bar.domainLabel === '社会', `老按钮条已去掉、领域显示默认值（${bar.domainLabel}）`)
  check(bar.dirButtons.join(',') === '中译英,英译中', `中间是方向切换：${bar.dirButtons.join(' / ')}`)
  check(bar.dirActive === '英译中', `默认方向为英译中（${bar.dirActive}）`)
  check(
    bar.dirDisabled.includes(false),
    '至少有一个方向是可点的（不是两边都灰着）',
    JSON.stringify(bar.dirDisabled),
  )
  check(bar.hasPickButton === true, '有「选择文章」入口')
  check(
    bar.pickInSourceHead?.在原文标题栏 === true,
    '「选择文章」在**原文标题栏**里（不是原来那一行）',
    JSON.stringify(bar.pickInSourceHead),
  )
  check(
    (bar.pickInSourceHead?.该栏按钮顺序 ?? [])[0] === '选择文章',
    '它排在原文标题栏里最靠左的位置（在「换一换 / AI 出题」前面）',
    JSON.stringify(bar.pickInSourceHead?.该栏按钮顺序),
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
   * 现在是**五个板块**（社会、经济、文化、生态、科技），顺序也定了。
   * 政治建设、教育强国、国际传播三个领域已从全站删掉（见 ADR 0010），
   * 因此这里连"顺序"一起钉住——它是用户挑的，不该被随手改。
   */
  check(menu.items.length === 5, `下拉里是五个板块（实际 ${menu.items.length}）`)
  check(
    menu.items.join('/') === '社会/经济/文化/生态/科技',
    '五个板块的名字与顺序都对',
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
       pairs: document.querySelectorAll('.pair-list .pair').length,
       referenceBlock: !!document.querySelector('.reference'),
     })`,
  )
  check(picked.modalClosed === true, '选完之后弹窗自动关闭')
  check(picked.sourceText.length > 60, `原文栏加载了选中的那一页（${picked.sourceText.length} 字符）`)
  check(picked.hasInput === true, '可以开始作答（输入框在）')
  check(picked.buttons.includes('对照译文'), '原文标题栏有「对照译文」按钮（文章库自带参考译文）', picked.buttons.join(' / '))
  check(
    picked.pairs === 0 && picked.referenceBlock === false,
    '默认只看原文：对照没铺开，正文下面也没有那个旧的折叠块',
  )

  console.log('\n=== 4b. 「对照译文」把这一页铺成一段原文、一段译文 ===')
  await cdp.evaluate(
    `[...document.querySelectorAll('.pane-source .pane-head .btn')].find((b) => b.textContent.includes('对照译文')).click()`,
  )
  await sleep(400)
  const compared = await cdp.evaluate(
    `({
       pairs: document.querySelectorAll('.pair-list .pair').length,
       sources: [...document.querySelectorAll('.pair-list .pair-source')].map((p) => p.textContent.trim().length),
       references: [...document.querySelectorAll('.pair-list .pair-reference')].map((p) => p.textContent.trim().length),
       pressed: document.querySelector('.pane-source .pane-head .btn[aria-pressed="true"]')?.textContent?.trim() ?? null,
       plainTextGone: !document.querySelector('.pane-source .source-text'),
     })`,
  )
  check(
    compared.pairs >= 1 && compared.pairs === compared.sources.length && compared.pairs === compared.references.length,
    `原封原文与译文一段一段交替（${compared.pairs} 对）`,
    JSON.stringify(compared),
  )
  check(compared.references.every((size) => size > 0), '每一对都有译文（译文与原文逐段对齐）')
  check(compared.pressed === '对照译文', '按钮显示为"按下"的状态')
  check(compared.plainTextGone === true, '对照铺开时不再另画一遍纯原文（不会重复显示）')
  // 再点一下回到只看原文，后面的检查都依赖 .source-text
  await cdp.evaluate(
    `[...document.querySelectorAll('.pane-source .pane-head .btn')].find((b) => b.textContent.includes('对照译文')).click()`,
  )
  await sleep(400)
  const backToPlain = await cdp.evaluate(
    `({ text: (document.querySelector('.pane-source .source-text')?.textContent ?? '').length, pairs: document.querySelectorAll('.pair-list').length })`,
  )
  check(backToPlain.text > 60 && backToPlain.pairs === 0, '再点一下回到只看原文')

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
  check(
    resumed.chips.some((text) => text.includes(`已批 ${partial} 页`)),
    '原文栏报出的是**这一篇**已批几页（进度落盘之后刷新还在）',
    resumed.chips.join(' ｜ '),
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

  console.log('\n=== 9. 页面错误 ===')
  check(cdp.errors.length === 0, '全程没有页面异常', cdp.errors.join(' ｜ '))

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
  process.exitCode = failed === 0 ? 0 : 1

  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
