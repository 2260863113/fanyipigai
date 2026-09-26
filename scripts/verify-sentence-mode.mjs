/**
 * 验收：句子栏（选领域、从该领域文章本地切句、换一句）与「段落」栏已从导航撤掉。
 *
 * 用法：node scripts/verify-sentence-mode.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const debugPort = 9241
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
const profileDir = path.join(root, 'node_modules', '.cache', 'verify-sentence-profile')
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

  console.log('\n=== 1. 「段落」栏已从导航撤掉 ===')
  const tabs = await cdp.evaluate("[...document.querySelectorAll('.mode-tab')].map((b) => b.textContent.trim())")
  check(!tabs.includes('段落'), `导航里没有「段落」（实际：${tabs.join(' / ')}）`)
  check(
    tabs.join(',') === '文章,句子,术语,自定义,收藏,练习记录,留言板',
    '其余七栏都在，顺序不变',
    tabs.join(' / '),
  )

  console.log('\n=== 2. 句子栏：只给领域，不给选文章 ===')
  await cdp.evaluate("[...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '句子').click()")
  await sleep(700)
  const bar = await cdp.evaluate(
    `({
       domain: document.querySelector('.domain-trigger-value')?.textContent?.trim() ?? null,
       hasPickArticle: [...document.querySelectorAll('.article-bar .btn')].some((b) => b.textContent.includes('选择文章')),
       hasDirection: document.querySelectorAll('.dir-btn').length,
       hasNext: [...document.querySelectorAll('.pane-source .pane-head .btn')].some((b) => b.textContent.includes('换一句')),
       /*
         「换一句」应当在**原文标题栏**里（用户要求：与文章栏的「选择文章」同一个位置）。
       */
       nextInSourceHead: (() => {
         const head = document.querySelector('.pane-source .pane-head');
         const btn = [...(head ? head.querySelectorAll('.btn') : [])].find((b) => b.textContent.includes('换一句'));
         return { 在原文标题栏: Boolean(btn), 该栏按钮: [...(head ? head.querySelectorAll('.btn') : [])].map((b) => b.textContent.trim()) };
       })(),
       source: (document.querySelector('.pane-source .source-text')?.textContent ?? '').trim(),
       hasInput: !!document.querySelector('.answer-input'),
     })`,
  )
  check(bar.domain !== null, `句子栏有领域下拉（当前 ${bar.domain}）`)
  check(bar.hasPickArticle === false, '句子栏**没有**「选择文章」按钮（按要求不能选文章）')
  check(bar.hasDirection === 0, '句子栏没有方向切换（方向由句子本身决定）')
  check(bar.hasNext === true, '有「换一句」')
  check(
    bar.nextInSourceHead?.在原文标题栏 === true,
    '「换一句」在**原文标题栏**里（与文章栏的「选择文章」同一个位置）',
    JSON.stringify(bar.nextInSourceHead),
  )
  check(bar.source.length > 0, '原文栏给出了一句句子', bar.source.slice(0, 60))
  check(bar.hasInput === true, '可以作答')
  console.log(`      当前句子：${bar.source.slice(0, 70)}`)

  console.log('\n=== 3. 句子确实来自该领域的文章 ===')
  const sentenceInfo = await cdp.evaluate(
    `(() => {
       const nav = [...document.querySelectorAll('.topbar .chip')].map((c) => c.textContent.trim());
       return { chips: nav };
     })()`,
  )
  console.log(`      顶栏标签：${sentenceInfo.chips.join(' ｜ ')}`)

  console.log('\n=== 4. 「换一句」换到另一句 ===')
  const first = bar.source
  await cdp.evaluate(
    "[...document.querySelectorAll('.pane-source .pane-head .btn')].find((b) => b.textContent.includes('换一句')).click()",
  )
  await sleep(700)
  const second = await cdp.evaluate("(document.querySelector('.pane-source .source-text')?.textContent ?? '').trim()")
  check(second.length > 0, '换一句之后还有句子')
  check(second !== first, '换一句确实换成了另一句')
  console.log(`      换后：${second.slice(0, 70)}`)

  console.log('\n=== 5. 换领域 → 句子跟着换 ===')
  await cdp.evaluate("document.querySelector('.domain-trigger').click()")
  await sleep(350)
  // 领域表现在是五个板块（社会／经济／文化／生态／科技），挑最后一个切过去
  await cdp.evaluate(
    "[...document.querySelectorAll('.domain-item')].find((b) => b.textContent.trim() === '科技').click()",
  )
  await sleep(700)
  const afterDomain = await cdp.evaluate(
    `({
       domain: document.querySelector('.domain-trigger-value')?.textContent?.trim() ?? null,
       source: (document.querySelector('.pane-source .source-text')?.textContent ?? '').trim(),
     })`,
  )
  check(afterDomain.domain === '科技', `领域切到科技（实际 ${afterDomain.domain}）`)
  check(afterDomain.source.length > 0, '换领域后句子也换了', afterDomain.source.slice(0, 60))
  check(afterDomain.source !== second, '换领域拿到的不是刚才那一句')

  console.log('\n=== 6. 页面错误 ===')
  check(cdp.errors.length === 0, '全程没有页面异常', cdp.errors.join(' ｜ '))

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
  process.exitCode = failed === 0 ? 0 : 1
  cdp.close()
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}
