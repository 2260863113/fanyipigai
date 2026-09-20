/**
 * 验收术语模式：进入术语栏 → 五栏原文 + 五栏作答 → 一次填五条 → 本地判分。
 *
 * 为什么要在真浏览器里验：术语题是**另一条渲染路径**（不走 AnswerPane），
 * 它有没有正确挂上、判分有没有真的本地算出来、判完有没有锁住输入框，
 * 都是纯界面行为，jsdom 里只能验到"元素在不在"。
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

  await cdp.send('Page.navigate', { url: `${base}/` })
  await sleep(1200)
  await cdp.evaluate('try { localStorage.clear() } catch (e) {}')
  await cdp.send('Page.reload')
  let mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  if (!mounted) throw new Error('界面没有挂载')
  await sleep(500)

  console.log('\n=== 1. 切到术语栏 ===')
  await cdp.evaluate(
    "[...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '术语').click()",
  )
  await sleep(700)
  const pane = await cdp.evaluate(
    `(() => {
       const rows = [...document.querySelectorAll('.term-row')];
       const sourceRows = [...document.querySelectorAll('.term-source-row')];
       return {
         activeTab: document.querySelector('.mode-tab-active')?.textContent?.trim() ?? null,
         rows: rows.length,
         sources: sourceRows.map((s) => s.textContent.trim()),
         inputs: document.querySelectorAll('.term-input').length,
         /*
          * 提交按钮的位置（用户要求："术语模式的提交按钮改到译文栏标题的右边和文章模式的位置一样"）。
          * 因此必须在 .pane-answer .pane-head 里面——只查"页面上有没有这颗按钮"是不够的，
          * 按钮挪回作答区里它照样能满足。
          */
         submitInHead: !!document.querySelector('.pane-answer .pane-head .btn-primary'),
         输入框边框: [...document.querySelectorAll('.term-input')].map((i) => getComputedStyle(i).borderTopWidth),
         已写提示还在吗: (document.querySelector('.pane-answer')?.innerText || '').includes('已写'),
         按钮行: document.querySelectorAll('.term-actions').length,
         hasChip: (document.body.innerText || '').includes('本地判分'),
         noAnnotated: !document.querySelector('.annotated'),
         /*
          * 版式（用户要求）：五条术语在**原文栏**里五等分、用分割线隔开；
          * 作答栏只有输入框、**不再出现原文**；两栏的横线对得上。
          */
         原文栏五等分: (() => {
          const heights = sourceRows.map((r) => Math.round(r.getBoundingClientRect().height));
          if (heights.length !== 5) return { 行数: heights.length };
          const min = Math.min(...heights);
          const max = Math.max(...heights);
          return { 行数: 5, 最小: min, 最大: max, 等分: max - min <= 2 };
        })(),
        分割线: (() => {
          const withLine = (selector) =>
            [...document.querySelectorAll(selector)].filter((row) => {
              const top = getComputedStyle(row).borderTopWidth;
              return parseFloat(top) > 0;
            }).length;
          const sourceLines = withLine('.term-source-row');
          const answerLines = withLine('.term-row');
          return {
            原文有线的行: sourceLines,
            作答有线的行: answerLines,
            原文五条之间四条线: sourceLines === 4,
            作答五条之间四条线: answerLines === 4,
          };
        })(),
        作答栏里没有原文: (() => {
          const paneBody = document.querySelector('.pane-answer .pane-body');
          const box = document.querySelector('.pane-answer .term-rows');
          if (!paneBody || !box) return { 说明: '找不到作答栏' };
          const sources = sourceRows.map((s) => (s.querySelector('.term-source-text')?.textContent || '').trim()).filter(Boolean);
          const bodyText = paneBody.innerText || '';
          return { 命中: sources.filter((s) => bodyText.includes(s)) };
        })(),
       };
     })()`,
  )
  check(pane.activeTab === '术语', `切到术语栏（当前 ${pane.activeTab}）`)
  check(pane.rows === 5, `作答是 5 行（实际 ${pane.rows}）`)
  check(pane.inputs === 5, `作答也是 5 个框（实际 ${pane.inputs}）`)
  check(pane.sources.length === 5 && pane.sources.every((s) => s.length > 0), '原文栏里五行都有术语', pane.sources.join(' / '))
  check(
    pane.原文栏五等分?.等分 === true,
    `原文栏上下五等分（行高 ${pane.原文栏五等分?.最小}–${pane.原文栏五等分?.最大}px）`,
    JSON.stringify(pane.原文栏五等分),
  )
  check(pane.分割线?.原文五条之间四条线 === true, `原文五条之间有 4 条分割线（实际 ${pane.分割线?.原文有线的行}）`)
  check(pane.分割线?.作答五条之间四条线 === true, `作答五条之间有 4 条分割线（实际 ${pane.分割线?.作答有线的行}）`)
  check(
    (pane.作答栏里没有原文?.命中 ?? []).length === 0,
    '右侧作答栏里不再出现原文（只有输入框）',
    JSON.stringify(pane.作答栏里没有原文),
  )
  check(pane.submitInHead === true, '「提交批改」在译文栏**标题栏右边**（与文章模式同一个位置）')
  check(
    (pane.输入框边框 ?? []).every((width) => parseFloat(width) === 0),
    `输入框没有边框（用户要求，实际边框宽 ${JSON.stringify(pane.输入框边框)}）`,
  )
  check(pane.已写提示还在吗 === false, '去掉了"已写 0 / 5 条。术语要求一字不差…"那句提示')
  check(pane.按钮行 === 0, '作答区里不再有按钮行（按钮与提示都挪走/删掉了）')
  check(pane.hasChip === true, '标明了「本地判分」（不交给 AI）')
  check(pane.noAnnotated === true, '术语题不渲染整段勾画（没有可勾画的整段文字）')
  console.log(`      五条术语：${pane.sources.join(' ｜ ')}`)

  console.log('\n=== 2. 填五条（前三条照标准写、后两条故意写错）===')
  /*
   * 前三条必须**逐字照标准译法写**——判分是严格对照（只归一化大小写/标点/空白），
   * 写 "the new development philosophy" 会被判错，因为标准是 "a new..."。
   * 这一点在测试里也要照做，否则"测试失败"其实是在测自己的笔误。
   */
  const filled = await cdp.evaluate(
    `(async () => {
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       const inputs = [...document.querySelectorAll('.term-input')];
       const answers = ${JSON.stringify([
         'high-quality development',
         'a new stage of development',
         'the new development philosophy',
         'this is definitely wrong',
         'also wrong here',
       ])};
       for (let i = 0; i < inputs.length; i++) {
         setter.call(inputs[i], answers[i]);
         inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
         await sleep(80);
       }
       return inputs.map((i) => i.value);
     })()`,
  )
  check(filled.length === 5 && filled.every((v) => v.length > 0), '五条都写进去了')
  console.log(`      我写的五条：${filled.join(' ｜ ')}`)
  console.log('      （前三条逐字照标准写；后两条胡写，预期判错）')

  const beforeSubmit = await cdp.evaluate(
    `({
       buttonLabels: [...document.querySelectorAll('.pane-answer .pane-head .btn')].map((b) => b.textContent.trim() + (b.disabled ? '(禁用)' : '')),
       values: [...document.querySelectorAll('.term-input')].map((i) => i.value),
     })`,
  )
  console.log(`      [诊断] 标题栏按钮=${JSON.stringify(beforeSubmit.buttonLabels)}`)
  console.log(`      [诊断] 输入框值=${JSON.stringify(beforeSubmit.values)}`)

  console.log('\n=== 3. 提交 → 本地判分 → 颜色批注 ===')
  await cdp.evaluate(
    "[...document.querySelectorAll('.pane-answer .pane-head .btn-primary')].find((b) => b.textContent.includes('提交批改')).click()",
  )
  await sleep(900)
  const graded = await cdp.evaluate(
    `({
       marks: [...document.querySelectorAll('.term-mark')].map((m) => m.textContent.trim()),
       inputs: document.querySelectorAll('.term-input').length,
       results: document.querySelectorAll('.term-result').length,
       /*
        * 颜色批注与修改（用户要求："术语提交后，需要按照像文章模式一样，进行对比后，颜色批注和修改"）：
        * 译错的整条划掉（.mk-delete > .mk-deleted 才有横线）+ 给出标准译法（.term-fix）；
        * 译对的用绿色底色（.mk-highlight）。三者缺一都不算"像文章模式一样"。
        */
       struck: document.querySelectorAll('.term-result .mk-delete .mk-deleted').length,
       struckLine: (() => {
         const el = document.querySelector('.term-result .mk-delete .mk-deleted');
         return el ? getComputedStyle(el).textDecorationLine : null;
       })(),
       fixes: [...document.querySelectorAll('.term-fix')].map((f) => f.textContent.trim()),
       /*
        * 标准译法必须是**同一行里的兄弟节点**（「→ 标准译法」跟在划掉的那条后面）。
        * 另起一行的写法曾经把两行字挤进"五等份里的那一份"，术语一长就压到下一行上。
        */
       fixesInline: document.querySelectorAll('.term-result > .term-fix').length,
       correctTint: document.querySelectorAll('.term-result .mk-highlight').length,
       wrongTint: [...document.querySelectorAll('.term-result .mk-delete')].map((el) => el.style.background),
       hasReset: [...document.querySelectorAll('.pane-answer .pane-head .btn')].some((b) => b.textContent.includes('重新作答')),
       hasViewSwitch: !!document.querySelector('.pane-answer .view-switch'),
       /*
        * 判完之后仍然是"上下五等份"：批注行用的是与输入框同一套 .term-row 等分
        * （用户要的是五栏对五栏，判完也得对得上，不然两栏的横线就错位了）。
        */
       作答五等分: (() => {
         const heights = [...document.querySelectorAll('.term-row')].map((r) => Math.round(r.getBoundingClientRect().height));
         if (heights.length !== 5) return { 行数: heights.length };
         return { 最小: Math.min(...heights), 最大: Math.max(...heights) };
       })(),
       notice: (document.querySelector('.notice')?.textContent ?? '').trim(),
       score: (document.querySelector('.score-number')?.textContent ?? '').trim(),
       detailText: (document.querySelector('.pane-notes')?.innerText ?? '').slice(0, 300),
     })`,
  )
  check(graded.marks.length === 5, `五条都给出了判分标记（实际 ${graded.marks.length}）`)
  /*
   * 前三条**逐字照标准写**、后两条胡写 → 预期 ✓✓✓✗✗。
   * 顺带证实"严格对照"是真的严格：把第 3 条改写成 a new → the new 会被判错，
   * 这一点在 domain/terms.ts 的 isTermCorrect 自检里也有单独用例。
   */
  check(
    graded.marks.slice(0, 3).every((m) => m === '✓') && graded.marks.slice(3).every((m) => m === '✗'),
    `严格对照判分：照标准写的判对、胡写的判错（实际 ${graded.marks.join('')}）`,
  )
  check(graded.inputs === 0 && graded.results === 5, `判完后五条换成批注行（输入框 ${graded.inputs} 个、批注行 ${graded.results} 条）`)
  check(graded.struck === 2, `译错的两条被划掉（实际 ${graded.struck} 条）`)
  check(
    graded.struckLine === 'line-through',
    `划掉是**真的横线**（computed text-decoration-line 实际 ${graded.struckLine}）`,
  )
  check(graded.fixes.length === 2, `译错的两条给出了标准译法（实际 ${graded.fixes.length} 条）`)
  check(
    graded.fixesInline === 2,
    `标准译法与答案在**同一行**（不另起一行，免得两行字挤进五等份里的一份，实际 ${graded.fixesInline} 条）`,
  )
  check(
    graded.fixes.every((text) => text.length > 2),
    `标准译法写出来了（${graded.fixes.join(' ｜ ')}）`,
  )
  check(graded.correctTint === 3, `译对的三条用绿色底色勾画（实际 ${graded.correctTint} 条）`)
  check(
    (graded.作答五等分?.最大 ?? 0) - (graded.作答五等分?.最小 ?? 0) <= 2 && graded.results === 5,
    `判完之后作答栏仍然是上下五等份（行高 ${graded.作答五等分?.最小}–${graded.作答五等分?.最大}px，两栏横线还对得上）`,
    JSON.stringify(graded.作答五等分),
  )
  check(
    (graded.wrongTint ?? []).length === 2 && graded.wrongTint.every((bg) => String(bg).includes('--mark-red-bg')),
    `译错的两条是红色荧光底（实际 ${JSON.stringify(graded.wrongTint)}）`,
  )
  check(graded.hasReset === true, '「重新作答」在标题栏右边（与提交按钮同一个位置）')
  check(graded.hasViewSwitch === true, '判完后也有「批改视图 / 对照视图」分段按钮（像文章模式一样）')
  check(/错 2 条/.test(graded.notice), `提示里说出了错几条（${graded.notice}）`)
  console.log(`      分数=${graded.score}　提示=${graded.notice}`)
  console.log(`      改后=${graded.fixes.join(' ｜ ')}`)

  console.log('\n=== 3b. 点某一条 → 右下角说清这一条 ===')
  await cdp.evaluate("document.querySelectorAll('.term-result')[3].click()")
  await sleep(400)
  const detail = await cdp.evaluate(
    `({
       selected: document.querySelectorAll('.term-result[data-selected="true"]').length,
       notes: (document.querySelector('.pane-notes')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 240),
     })`,
  )
  check(detail.selected === 1, `点过的那一条被标为选中（实际 ${detail.selected} 条）`)
  check(
    detail.notes.includes('标准译法是') || detail.notes.includes('标准译法'),
    '右下角给出这一条的完整说明（含标准译法）',
    detail.notes,
  )
  console.log(`      [诊断] 右下角=${detail.notes}`)

  console.log('\n=== 3c. 对照视图：一条原译、一条改后 ===')
  await cdp.evaluate(
    "[...document.querySelectorAll('.pane-answer .view-switch .view-btn')].find((b) => b.textContent.includes('对照视图')).click()",
  )
  await sleep(400)
  const compare = await cdp.evaluate(
    `({
       lines: [...document.querySelectorAll('.compare-list .compare-line')].map((li) => ({
         original: (li.querySelector('.compare-original')?.textContent ?? '').trim(),
         corrected: (li.querySelector('.compare-corrected')?.textContent ?? '').trim(),
       })),
     })`,
  )
  check(compare.lines.length === 5, `五条术语各出一行对照（实际 ${compare.lines.length}）`)
  check(
    compare.lines.every((line) => line.original.startsWith('原译') && line.corrected.startsWith('改后')),
    '每一条都是"原译 / 改后"两行交替',
    JSON.stringify(compare.lines.slice(0, 2)),
  )
  check(
    compare.lines.slice(3).every((line) => line.corrected.includes('改后') && line.corrected.length > 3),
    '写错的两条在"改后"里给出标准译法',
    JSON.stringify(compare.lines.slice(3)),
  )
  console.log(`      第一行：${JSON.stringify(compare.lines[0])}`)
  await cdp.evaluate(
    "[...document.querySelectorAll('.pane-answer .view-switch .view-btn')].find((b) => b.textContent.includes('批改视图')).click()",
  )
  await sleep(300)

  console.log('\n=== 4. 判分是本地算的：没有打批改接口 ===')
  const requests = await cdp.evaluate(
    `(window.performance.getEntriesByType('resource') || []).filter((e) => e.name.includes('/api/')).map((e) => e.name)`,
  )
  check(
    requests.filter((url) => url.includes('/api/judge')).length === 0,
    '全程没有调用 /api/judge（术语判分完全本地）',
    requests.join(' ｜ '),
  )

  console.log('\n=== 5. 重新作答 → 解锁且保留已写内容 ===')
  await cdp.evaluate(
    "[...document.querySelectorAll('.pane-answer .pane-head .btn')].find((b) => b.textContent.includes('重新作答')).click()",
  )
  await sleep(500)
  const after = await cdp.evaluate(
    `({
       marks: document.querySelectorAll('.term-mark').length,
       results: document.querySelectorAll('.term-result').length,
       editable: [...document.querySelectorAll('.term-input')].every((i) => !i.disabled),
       kept: [...document.querySelectorAll('.term-input')].map((i) => i.value),
     })`,
  )
  check(after.marks === 0 && after.results === 0, '批注行与判分标记都清掉了，回到可写的五个输入框')
  check(after.editable === true, '输入框重新可编辑')
  check(
    after.kept.every((v) => v.length > 0),
    '已写的五条**留着**（重新作答不该把我的字清掉）',
    after.kept.join(' ｜ '),
  )

  console.log('\n=== 6. 页面错误 ===')
  check(cdp.errors.length === 0, '全程没有页面异常', cdp.errors.join(' ｜ '))

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
  process.exitCode = failed === 0 ? 0 : 1
  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
