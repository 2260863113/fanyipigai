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
    `({
       activeTab: document.querySelector('.mode-tab-active')?.textContent?.trim() ?? null,
       rows: document.querySelectorAll('.term-row').length,
       sources: [...document.querySelectorAll('.term-source')].map((s) => s.textContent.trim()),
       inputs: document.querySelectorAll('.term-input').length,
       hasSubmit: [...document.querySelectorAll('.btn-primary')].some((b) => b.textContent.includes('提交批改')),
       hasChip: (document.body.innerText || '').includes('本地判分'),
       noAnnotated: !document.querySelector('.annotated'),
     })`,
  )
  check(pane.activeTab === '术语', `切到术语栏（当前 ${pane.activeTab}）`)
  check(pane.rows === 5, `原文是 5 行（实际 ${pane.rows}）`)
  check(pane.inputs === 5, `作答也是 5 个框（实际 ${pane.inputs}）`)
  check(pane.sources.every((s) => s.length > 0), '每行都有术语原文', pane.sources.join(' / '))
  check(pane.hasSubmit === true, '有「提交批改」按钮')
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
       buttonLabels: [...document.querySelectorAll('.pane-answer .btn')].map((b) => b.textContent.trim() + (b.disabled ? '(禁用)' : '')),
       values: [...document.querySelectorAll('.term-input')].map((i) => i.value),
       hint: (document.querySelector('.term-actions .hint')?.textContent ?? '').trim(),
     })`,
  )
  console.log(`      [诊断] 按钮=${JSON.stringify(beforeSubmit.buttonLabels)} 提示=${beforeSubmit.hint}`)
  console.log(`      [诊断] 输入框值=${JSON.stringify(beforeSubmit.values)}`)
  const crash = await cdp.evaluate(`({
    rootLen: (document.getElementById('root')?.innerText || '').length,
    head: (document.getElementById('root')?.innerText || '').slice(0, 200),
    hasTermRows: !!document.querySelector('.term-rows'),
    hasPaneAnswer: !!document.querySelector('.pane-answer'),
    full: (document.getElementById('root')?.innerText || '').slice(0, 2000),
  })`)
  console.log(`      [诊断] 页面=${JSON.stringify({ rootLen: crash.rootLen, hasTermRows: crash.hasTermRows })}`)
  console.log('      ── 兜底界面全文 ──')
  console.log(String(crash.full).split('\n').slice(0, 26).map((line) => '      ' + line).join('\n'))

  console.log('\n=== 3. 提交 → 本地判分 ===')
  await cdp.evaluate(
    "[...document.querySelectorAll('.btn-primary')].find((b) => b.textContent.includes('提交批改')).click()",
  )
  await sleep(900)
  const graded = await cdp.evaluate(
    `({
       marks: [...document.querySelectorAll('.term-mark')].map((m) => m.textContent.trim()),
       inputsDisabled: [...document.querySelectorAll('.term-input')].map((i) => i.disabled),
       hasReset: [...document.querySelectorAll('.btn')].some((b) => b.textContent.includes('重新作答')),
       notice: (document.querySelector('.notice')?.textContent ?? '').trim(),
       score: (document.querySelector('.score-number')?.textContent ?? '').trim(),
       detailText: (document.querySelector('.pane-notes')?.innerText ?? '').slice(0, 200),
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
  check(graded.inputsDisabled.every(Boolean), '判分后输入框锁住（要改得先按「重新作答」）')
  check(graded.hasReset === true, '给了「重新作答」的入口')
  check(/错 2 条/.test(graded.notice), `提示里说出了错几条（${graded.notice}）`)
  console.log(`      分数=${graded.score}　提示=${graded.notice}`)

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
    "[...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('重新作答')).click()",
  )
  await sleep(500)
  const after = await cdp.evaluate(
    `({
       marks: document.querySelectorAll('.term-mark').length,
       editable: [...document.querySelectorAll('.term-input')].every((i) => !i.disabled),
       kept: [...document.querySelectorAll('.term-input')].map((i) => i.value),
     })`,
  )
  check(after.marks === 0, '判分标记清掉了')
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
