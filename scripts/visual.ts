/**
 * 真实浏览器截屏。
 *
 * 为什么需要它：结构断言（有没有某个 class、有没有某段文字）证明不了"看起来对不对"。
 * 两栏是不是真的各占半屏、批注的小字有没有被上方内容盖住、中文有没有换行错位，
 * 这些只有看像素才能确认。截图留给人看，不做自动比对。
 *
 * 做法：起一个 vite 服务 → 用 CDP 驱动无头 Edge/Chrome：
 *   1. 在页面加载前注入接口桩，把 /api/judge 换成本地假批改（不花 API 钱）
 *   2. 首屏截一张
 *   3. 真的点一下「提交批改」，等右屏换成批改结果，再截一张
 *   4. 窄屏再截一张，用来检查手机上两栏叠放的效果
 *
 * 产物在 .screenshots/（已 gitignore）。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { findBrowser, BROWSER_HINT } from './lib/find-browser'
import { removeDir } from './lib/clear-dir'

export interface ScreenshotResult {
  ok: boolean
  files: string[]
  /** 失败或跳过时的原因 */
  note?: string
  /**
   * 环境不具备时跳过（例如这台机器没装 Edge/Chrome）。
   *
   * 与"失败"必须分开：没有浏览器**不是本项目的缺陷**，不该让冒烟测试变红——
   * 否则这套测试在 Linux/CI 上永远绿不了（vite.config.ts 说明将来要部署到 Cloudflare）。
   * 而"浏览器在、但截图流程出 bug"仍然是真失败，必须继续报红。
   */
  skipped?: boolean
}

export interface ShotSpec {
  name: string
  width: number
  height: number
  /** submit = 点提交后截批改结果；plain = 直接截首屏 */
  action: 'plain' | 'submit'
  /** 这一张用哪道题的示例作答（默认题目编号由调用方在题库里的第一道决定） */
  exerciseId?: string
  /** 截图前先点一下顶部导航里的某个题型（用来截某类题的样子） */
  clickTab?: string
  /** 截图前先点一下题目切换条里的某道题 */
  clickCase?: string
  /**
   * 批改结果出来后，再点第几处勾画（从 0 开始）。
   * 用来截"点了某一处之后"的样子：那一行下面的气泡 + 右下角的单处说明。
   */
  clickMark?: number
}

/** 不指定题目时用哪一道（与题库第一道一致）。 */
const DEFAULT_EXERCISE_ID = 'article-001'

/** 极简 CDP 客户端。错误响应会被抛出，不静默吞掉。 */
class Cdp {
  private ws: import('ws').WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>()

  constructor(ws: import('ws').WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number
        result?: unknown
        error?: { message: string }
      }
      if (typeof message.id !== 'number') return
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${entry.method} 失败：${message.error.message}`))
      else entry.resolve(message.result ?? {})
    })
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send<{ result?: { value?: unknown }; exceptionDetails?: { text: string } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    )
    if (result.exceptionDetails) throw new Error(`页面脚本出错：${result.exceptionDetails.text}`)
    return result.result?.value
  }

  close(): void {
    this.ws.close()
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(400)
  }
  return false
}

async function connectCdp(wsUrl: string): Promise<Cdp> {
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('无法连接浏览器调试通道')))
  })
  return new Cdp(ws)
}

export async function captureScreens(shots: readonly ShotSpec[]): Promise<ScreenshotResult> {
  const browser = findBrowser()
  if (!browser) return { ok: false, files: [], note: BROWSER_HINT, skipped: true }

  const root = process.cwd()
  const outDir = path.join(root, '.screenshots')
  const port = 5399
  const debugPort = 9227
  // 探测确定的静态文件，而不是根路径：根路径会经过 /api/judge 中间件，GET 在那里被跳过
  const probeUrl = `http://127.0.0.1:${port}/index.html`
  const pageUrl = `http://127.0.0.1:${port}/`

  let server: ChildProcess | undefined
  let browserProcess: ChildProcess | undefined
  const files: string[] = []

  try {
    // 用 removeDir 而不是 rmSync：后者在受管环境里是静默空操作，
    // 曾经导致这两处（截图目录、浏览器 profile）越堆越大——profile 实测堆到 122 MB
    removeDir(outDir)
    mkdirSync(outDir, { recursive: true })

    // 直接调用 vite，不经过 npm：Windows 上通过 shell 传参给 npm 不可靠，而且 npm 输出会污染测试日志
    const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
    if (!existsSync(viteBin)) return { ok: false, files: [], note: '没有找到 vite 可执行文件', skipped: true }
    server = spawn(process.execPath, [viteBin, '--port', String(port), '--host', '127.0.0.1'], {
      cwd: root,
      stdio: 'ignore',
    })
    if (!(await waitForServer(probeUrl, 45_000))) return { ok: false, files: [], note: '预览服务未能就绪' }

    const profileDir = path.join(root, 'node_modules', '.cache', 'cdp-profile')
    removeDir(profileDir)
    browserProcess = spawn(
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

    let ready = false
    for (let i = 0; i < 40 && !ready; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        ready = true
      } catch {
        await sleep(300)
      }
    }
    if (!ready) return { ok: false, files: [], note: '无头浏览器的调试端口未就绪' }

    const { buildStubSource } = await import('./fixture-stub.mjs')
    const { buildFixturePayload } = await import('./fixture-payload.mjs')

    // 为每一张需要提交的截图所涉及的题目各准备一份假批改。
    // 桩会按提交回来的作答文字自动挑对应那份，因此切题型后仍然拿到对的批改。
    // 没写 exerciseId 的那张要用默认题目补上，否则 undefined 会被当成一个键，
    // 后面按真实编号去查就查不到（实际踩过这个坑）
    const wantedIds = [
      ...new Set(shots.filter((shot) => shot.action === 'submit').map((shot) => shot.exerciseId ?? DEFAULT_EXERCISE_ID)),
    ]
    if (wantedIds.length === 0) wantedIds.push(DEFAULT_EXERCISE_ID)

    const stubTable: Array<{ answer: string; payload: unknown }> = []
    const answerSectionsByExercise = new Map<string, string[]>()
    for (const id of wantedIds) {
      const fixture = await buildFixturePayload(root, id)
      stubTable.push({ answer: fixture.answer, payload: fixture.payload })
      answerSectionsByExercise.set(id, fixture.answerSections)
    }

    for (const shot of shots) {
      const target = (await (
        await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
      ).json()) as { webSocketDebuggerUrl: string }
      const cdp = await connectCdp(target.webSocketDebuggerUrl)

      try {
        await cdp.send('Page.enable')
        await cdp.send('Runtime.enable')
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: shot.width,
          height: shot.height,
          deviceScaleFactor: 2,
          mobile: shot.width < 700,
        })
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildStubSource(stubTable) })
        await cdp.send('Page.navigate', { url: pageUrl })

        let mounted = false
        for (let i = 0; i < 60 && !mounted; i += 1) {
          mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
          if (!mounted) await sleep(250)
        }
        if (!mounted) return { ok: false, files, note: `${shot.name}：界面没有挂载` }
        await sleep(500)

        // 需要时先切到指定题型 / 题目，再截图
        if (shot.clickTab || shot.clickCase) {
          const switched = await cdp.evaluate(
            `(async () => {
               const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
               const tab = ${JSON.stringify(shot.clickTab ?? '')};
               const caseName = ${JSON.stringify(shot.clickCase ?? '')};
               if (tab) {
                 const btn = [...document.querySelectorAll('.mode-tab')]
                   .find((b) => b.textContent.trim() === tab);
                 if (!btn) return '找不到题型标签：' + tab;
                 btn.click();
                 await sleep(400);
               }
               if (caseName) {
                 const item = [...document.querySelectorAll('.case-tab')]
                   .find((b) => b.textContent.includes(caseName));
                 if (!item) return '找不到题目：' + caseName;
                 item.click();
                 await sleep(400);
               }
               return 'ok';
             })()`,
          )
          if (switched !== 'ok') return { ok: false, files, note: `${shot.name}：${String(switched)}` }
        }

        if (shot.action === 'submit') {
          // 真的把示例作答打进输入框再点提交，这样截到的是真实交互后的界面。
          // 必须用原生 setter + input 事件，React 才会收到这次受控更新。
          // 分段题要求每段都写完才允许提交，因此这里逐段填入。
          const sections = answerSectionsByExercise.get(shot.exerciseId ?? DEFAULT_EXERCISE_ID) ?? []
          const outcome = await cdp.evaluate(
            `(async () => {
               const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
               const setValue = (el, value) => {
                 const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                 setter.call(el, value);
                 el.dispatchEvent(new Event('input', { bubbles: true }));
               };
               const sections = ${JSON.stringify(sections)};
               for (let i = 0; i < sections.length; i++) {
                 if (i > 0) {
                   const next = [...document.querySelectorAll('.section-nav .btn')]
                     .find((b) => b.textContent.includes('下一段'));
                   if (!next) return '分段导航里找不到「下一段」按钮（本张用了 ' + sections.length + ' 段，第 ' + (i + 1) + ' 段）';
                   next.click();
                   await sleep(250);
                 }
                 const ta = document.querySelector('.answer-input');
                 if (!ta) return '找不到输入框（第 ' + (i + 1) + ' 段）';
                 setValue(ta, sections[i]);
                 await sleep(250);
               }
               const btn = document.querySelector('.btn-primary');
               if (!btn) return '找不到提交按钮';
               if (btn.disabled) return '提交按钮是禁用的（共 ' + sections.length + ' 段）';
               btn.click();
               for (let i = 0; i < 80; i++) {
                 // 批改结果出来的标志：输入框被带批注的译文替换掉了
                 if (!document.querySelector('.answer-input') && document.querySelector('.pane-answer .annotated-lines')) {
                   await sleep(600);
                   return 'ok';
                 }
                 const err = document.querySelector('.error-block');
                 if (err) return '页面报错：' + err.textContent.slice(0, 200);
                 await sleep(200);
               }
               return '提交后没有出现批改结果';
             })()`,
          )
          if (outcome !== 'ok') return { ok: false, files, note: `${shot.name}：${String(outcome)}` }

          // 再点一处勾画：截到气泡与右下角单处说明
          if (typeof shot.clickMark === 'number') {
            const clicked = await cdp.evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
                 const marks = [...document.querySelectorAll('.pane-answer [data-mark-id]')];
                 const target = marks[${shot.clickMark}];
                 if (!target) return '译文里没有第 ${shot.clickMark + 1} 处可点的勾画（共 ' + marks.length + ' 处）';
                 target.click();
                 await sleep(300);
                 return 'ok';
               })()`,
            )
            if (clicked !== 'ok') return { ok: false, files, note: `${shot.name}：${String(clicked)}` }
          }
        }

        const captured = await cdp.send<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        })
        const file = path.join(outDir, `${shot.name}.png`)
        writeFileSync(file, Buffer.from(captured.data, 'base64'))
        files.push(file)
      } finally {
        cdp.close()
      }
    }

    return { ok: files.length === shots.length, files }
  } finally {
    if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
    if (server?.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}
