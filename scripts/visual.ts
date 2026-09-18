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

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export interface ScreenshotResult {
  ok: boolean
  files: string[]
  /** 失败或跳过时的原因 */
  note?: string
}

export interface ShotSpec {
  name: string
  width: number
  height: number
  /** submit = 点提交后截批改结果；plain = 直接截首屏 */
  action: 'plain' | 'submit'
}

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

function findBrowser(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => existsSync(candidate))
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
  if (!browser) return { ok: false, files: [], note: '没有找到 Edge 或 Chrome' }

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
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })

    // 直接调用 vite，不经过 npm：Windows 上通过 shell 传参给 npm 不可靠，而且 npm 输出会污染测试日志
    const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
    if (!existsSync(viteBin)) return { ok: false, files: [], note: '没有找到 vite 可执行文件' }
    server = spawn(process.execPath, [viteBin, '--port', String(port), '--host', '127.0.0.1'], {
      cwd: root,
      stdio: 'ignore',
    })
    if (!(await waitForServer(probeUrl, 45_000))) return { ok: false, files: [], note: '预览服务未能就绪' }

    const profileDir = path.join(root, 'node_modules', '.cache', 'cdp-profile')
    rmSync(profileDir, { recursive: true, force: true })
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
    const fixture = await buildFixturePayload(root)

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
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildStubSource(fixture.payload) })
        await cdp.send('Page.navigate', { url: pageUrl })

        let mounted = false
        for (let i = 0; i < 60 && !mounted; i += 1) {
          mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
          if (!mounted) await sleep(250)
        }
        if (!mounted) return { ok: false, files, note: `${shot.name}：界面没有挂载` }
        await sleep(500)

        if (shot.action === 'submit') {
          // 真的把示例作答打进输入框再点提交，这样截到的是真实交互后的界面。
          // 必须用原生 setter + input 事件，React 才会收到这次受控更新。
          const outcome = await cdp.evaluate(
            `(async () => {
               const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
               const ta = document.querySelector('.answer-input');
               if (!ta) return '找不到输入框';
               const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
               setter.call(ta, ${JSON.stringify(fixture.answerText)});
               ta.dispatchEvent(new Event('input', { bubbles: true }));
               await sleep(300);
               const btn = document.querySelector('.btn-primary');
               if (!btn) return '找不到提交按钮';
               if (btn.disabled) return '提交按钮是禁用的';
               btn.click();
               for (let i = 0; i < 80; i++) {
                 if (document.querySelector('.result-panel')) {
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
