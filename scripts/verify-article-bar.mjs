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
  check(bar.domainLabel === '经济建设', `老按钮条已去掉、领域显示默认值（${bar.domainLabel}）`)
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
  check(menu.items.length === 8, `下拉里有八个赛制主题域（实际 ${menu.items.length}）`)
  check(
    menu.items.every((label) => label.includes('经济建设') || label.includes('政治建设') || label.includes('文化建设') ||
      label.includes('社会建设') || label.includes('生态文明建设') || label.includes('科技创新') ||
      label.includes('教育强国') || label.includes('国际传播')),
    '八个领域的名字都对',
    menu.items.join(' / '),
  )

  // 选「生态文明建设」——按设计，选完领域会**紧接着弹出选文章的框**
  const clicked = await cdp.evaluate(
    `(() => {
       const item = [...document.querySelectorAll('.domain-item')].find((b) => b.textContent.includes('生态文明建设'));
       if (!item) return 'no-item';
       item.click();
       return 'clicked';
     })()`,
  )
  check(clicked === 'clicked', '能在下拉里点到「生态文明建设」', clicked)
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
  check(afterPick.domain === '生态文明建设', `选完领域后显示新领域（${afterPick.domain}）`)
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
  check(modal.cards.length === 3, `该领域该方向下有 3 张卡片（实际 ${modal.cards.length}）`)
  check(
    modal.cards.every((c) => c.title.length > 5),
    '每张卡片都有标题',
    modal.cards.map((c) => c.title.slice(0, 30)).join(' ｜ '),
  )
  check(
    modal.cards.every((c) => /\d+\s*(词|字)/.test(c.meta)),
    '卡片上显示了来源与篇幅',
    modal.cards[0]?.meta ?? '',
  )
  console.log(`      示例卡片：${modal.cards[0]?.title ?? ''}`)

  console.log('\n=== 4. 点一张卡片即开始练 ===')
  await cdp.evaluate("document.querySelectorAll('.article-card')[1].click()")
  await sleep(600)
  const picked = await cdp.evaluate(
    `({
       modalClosed: !document.querySelector('.article-cards'),
       sourceText: (document.querySelector('.pane-source .source-text')?.textContent ?? ''),
       hasInput: !!document.querySelector('.answer-input'),
       referenceShown: !!document.querySelector('.reference'),
     })`,
  )
  check(picked.modalClosed === true, '选完之后弹窗自动关闭')
  check(picked.sourceText.length > 100, `原文栏加载了选中的那一篇（${picked.sourceText.length} 字符）`)
  check(picked.hasInput === true, '可以开始作答（输入框在）')
  check(picked.referenceShown === false, '文章库没有参考译文，那一栏不摆空壳子')

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
  check(zhModal.cards.length === 3, `中译英方向也有 3 张卡片（实际 ${zhModal.cards.length}）`)
  check(
    zhModal.units.every((u) => /字/.test(u)),
    '中译英的篇幅按「字」计（不是词）',
    zhModal.units.join(' ｜ '),
  )
  console.log(`      示例卡片：${zhModal.cards[0] ?? ''}　${zhModal.units[0] ?? ''}`)
  await cdp.evaluate("document.querySelector('.raw-modal-close')?.click()")
  await sleep(300)

  console.log('\n=== 7. 页面错误 ===')
  check(cdp.errors.length === 0, '全程没有页面异常', cdp.errors.join(' ｜ '))

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
  process.exitCode = failed === 0 ? 0 : 1

  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
