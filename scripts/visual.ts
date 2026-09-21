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

/**
 * 不指定题目时用哪一道（截图脚本的默认落点）。
 *
 * 为什么不是 article-001：**「文章」栏现在由文章库供题**（那批练习材料自带参考译文、没有示例作答），
 * 因此不能被截图脚本自动填答并提交。
 * 句子题 sentence-002 同时含替换、插入、删除三种标记，是更好的截图样本。
 */
const DEFAULT_EXERCISE_ID = 'sentence-002'

/** 极简 CDP 客户端。错误响应会被抛出，不静默吞掉。 */
class Cdp {
  private ws: import('ws').WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>()

  constructor(ws: import('ws').WebSocket) {
    this.ws = ws
    /*
     * 这里必须用 ws 自己的 MessageEvent 类型，不能用 DOM 的：
     * `ws` 的 addEventListener 收的是它自己的事件对象（带 data，但没有 origin/source/ports 等）。
     * 显式标注 DOM 的 MessageEvent 会类型不兼容——而 `event.data` 在本函数里才是唯一用到的字段。
     */
    ws.addEventListener('message', (event: import('ws').MessageEvent) => {
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

    /*
     * 这两个是 .mjs。类型由 tsconfig.scripts.json 的 allowJs 提供：
     * TS 会直接读它们的实现来推断导出形状。若用 `declare module './x.mjs'` 是**没用的**
     * ——TS 看到真实存在的 .mjs 会先按 JS 模块解析，环境声明根本轮不到。
     * 加上 allowJs 之前这里是隐式 any（TS7016），因为 scripts/ 不在任何 tsconfig 的 include 里。
     */
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
      if (fixture.answer === null) throw new Error(`${id}：内置示例与作答对不上，无法构造假批改`)
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
                 /*
                  * 题目切换条现在只在「文章」栏有（文章库供题时按题号切），
                  * 句子栏/术语栏没有它。因此**找不到就跳过**，不要当成失败——
                  * 那些栏的题目由"切题型"这一步就定下来了。
                  */
                 const item = [...document.querySelectorAll('.case-tab')]
                   .find((b) => b.textContent.includes(caseName));
                 if (item) {
                   item.click();
                   await sleep(400);
                 }
               }
               return 'ok';
             })()`,
          )
          if (switched !== 'ok') return { ok: false, files, note: `${shot.name}：${String(switched)}` }
        }

        if (shot.action === 'submit') {
          // 真的把示例作答打进输入框再点提交，这样截到的是真实交互后的界面。
          // 必须用原生 setter + input 事件，React 才会收到这次受控更新。
          // 分段题按**逐页批改**走：填一页 → 点「下一页」（这一页自动交出去批）→ 填下一页，
          // 最后一页再手动按「提交批改」。见下面那段里的说明。
          const fixtureSections = answerSectionsByExercise.get(shot.exerciseId ?? DEFAULT_EXERCISE_ID) ?? []
          const outcome = await cdp.evaluate(
            `(async () => {
               const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
               const setValue = (el, value) => {
                 const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                 setter.call(el, value);
                 el.dispatchEvent(new Event('input', { bubbles: true }));
               };
               /*
                * 优先用"题目编号 → 示例作答"表里的那段；表里没有（文章库/句子库供题的栏，
                * 它们没有示例作答）就把**屏幕上的原文**当作答打进去。
                * 这样提交流程照样走完，截图反映的是真实交互后的界面。
                */
               const fromFixture = ${JSON.stringify(fixtureSections)};
               /*
                * 要送哪一段作答：
                *   - 屏幕上**有翻页导航**（文章题那种逐页作答）→ 用表里的示例作答逐页填；
                *   - 表里有示例、屏幕上是单页题 → 也送**表里的示例作答**，
                *     这样接口桩能认出它是哪道内置示例，从而回一批批注，
                *     截图才点得到勾画（否则回的是"没有批注"的空结果，02-result 无点可点）；
                *   - 表里没有（文章库/句子库供题）→ 只好把屏幕原文当作答。
                */
               const onScreen = (document.querySelector('.pane-source .source-text')?.textContent ?? '').trim();
               const hasSectionNav = !!document.querySelector('.section-nav');
               const sections = fromFixture.length === 0
                 ? [onScreen]
                 : hasSectionNav
                   ? fromFixture
                   : [fromFixture.join('\\n\\n')];
               if (!sections[0]) return '原文栏是空的，拿不到可填的作答';

               const waitForResult = async () => {
                 for (let i = 0; i < 80; i++) {
                   // 批改结果出来的标志：输入框被带批注的译文替换掉了
                   if (!document.querySelector('.answer-input') && document.querySelector('.pane-answer .annotated-lines')) {
                     await sleep(400);
                     return 'ok';
                   }
                   const err = document.querySelector('.error-block');
                   if (err) return '页面报错：' + err.textContent.slice(0, 200);
                   await sleep(200);
                 }
                 return '提交后没有出现批改结果';
               };

               /*
                * ⚠️ 等到**页码真的变了、而且新的一页有输入框**再写。
                *
                * 只等"有输入框"会立刻满足：点完「下一页」之后，旧那一页的输入框
                * 还在 DOM 里停一会儿（React 还没把它换掉），于是下一页的文字会被写进
                * **上一页那个正在消失的 textarea**，末页就变成空的、提交按钮禁用
                * （真踩过，表现为"末页的提交按钮是禁用的"）。
                *
                * 另一件事：**批改过的页现在是只读的**，而截图脚本每一步都重新加载页面，
                * 于是"上一张截图提交过的那一页"会被练习记录接回来、直接显示批改结果
                * （这正是用户要的行为：批改过的段落，回来还是批改界面）。
                * 要往里写就得先按一次「返回编辑」——放开之后草稿也还在。
                */
               const pageNo = () => {
                 const m = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(
                   (document.querySelector('.section-nav .hint') || {}).textContent ?? '',
                 );
                 return m ? { index: Number(m[1]) - 1, count: Number(m[2]) } : { index: 0, count: 0 };
               };
               const unlockIfNeeded = () => {
                 const unlock = [...document.querySelectorAll('.pane-answer .btn')].find(
                   (b) => (b.textContent || '').trim() === '返回编辑',
                 );
                 if (!unlock) return false;
                 unlock.click();
                 return true;
               };
               const waitForFreshInput = async (expectedPage) => {
                 let triedUnlock = false;
                 for (let k = 0; k < 150; k++) {
                   if (pageNo().index === expectedPage) {
                     const area = document.querySelector('.answer-input');
                     if (area) return area;
                     if (!triedUnlock && unlockIfNeeded()) {
                       triedUnlock = true;
                       await sleep(300);
                       continue;
                     }
                   }
                   const err = document.querySelector('.error-block');
                   if (err) return '页面报错：' + err.textContent.slice(0, 200);
                   await sleep(150);
                 }
                 return null;
               };

               const total = pageNo().count || sections.length;
               for (let i = 0; i < total; i++) {
                 /*
                  * 单页题（句子/术语/自己贴的短题）没有翻页导航，页号恒为 0；
                  * 但**批改过的单页题同样可能被记录接回来、变成只读**，
                  * 因此两条路都走 waitForFreshInput（它里面会按一次「返回编辑」）。
                  *（⚠️ 这段整块躺在模板字符串里，注释里不能出现反引号。）
                  */
                 const ta = await waitForFreshInput(hasSectionNav ? i : 0);
                 if (typeof ta === 'string') return ta;
                 if (!ta) return '第 ' + (i + 1) + ' 页没有等到可写的输入框';
                 setValue(ta, sections[i] ?? onScreen);
                 await sleep(200);

                 if (i === total - 1) {
                   // 末页没有「下一页」可点，只能手动交
                   const btn = document.querySelector('.pane-answer .btn-primary');
                   if (!btn) return '找不到提交按钮（第 ' + (i + 1) + ' 页）';
                   if (btn.disabled) return '提交按钮是禁用的（第 ' + (i + 1) + ' 页）';
                   btn.click();
                   const settled = await waitForResult();
                   if (settled !== 'ok') return settled;
                   break;
                 }
                 /*
                  * 点「下一页」本身就是提交：界面会先把这一页交出去批，再翻过去。
                  * 因此这里要等到**新的一页出现**才算真翻过去了。
                  */
                 const next = document.querySelector('.section-nav [data-nav="next"]');
                 if (!next) return '翻页导航里找不到「下一页」按钮（本张用了 ' + total + ' 页，第 ' + (i + 1) + ' 页）';
                 next.click();
                 await sleep(150);
               }
               return 'ok';
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
