/**
 * 手机端版式的真浏览器验收（第 18 轮）。
 *
 * ## 为什么必须另起一个脚本
 *
 * 其它验收脚本（`verify-per-page` / `verify-term-mode` / `verify-article-bar` …）
 * 都是**桌面尺寸**（1280 / 1440 / 1600）跑的，而且都靠 `.mode-tabs` 判"界面挂载了没有"。
 * 手机端这两条**都不成立**：
 *   - 尺寸是 375×667 这类真手机宽（断点 600px）；
 *   - `.mode-tabs` 在手机端**在被收起的侧边栏里**（`MobileSidebar` 里那一组），
 *     页面一挂载时它根本不在 DOM 里——拿它当挂载判据会永远等不到。
 * 因此这里用 `.topbar-mobile`（手机上那条「三条横线 + 标题」）当挂载判据。
 *
 * ## 这个脚本逐条盯着用户提的要求
 *
 * 用户原话（第 18 轮）逐条对应到下面这些断言：
 *   ① 「给这个项目加上手机端视图，电脑端不要产生任何改变」
 *      → 第 1 节：桌面尺寸（1440）下 `.topbar` 仍在、`.topbar-mobile` 不在、
 *        侧边栏不在、总评栏与批注详情栏都在、原文栏页脚仍是那两颗翻页按钮。
 *   ② 「将导航栏的所有东西挪到侧边栏，最上方只保留翻译批改这个标题和其左边的三条横线」
 *      → 第 2 节：最上方只有 `h1` 与 `.hamburger`；点三条横线打开侧边栏，
 *        里面六个题型 + 留言板齐全，顶栏那些东西（账号 / 暗夜 / 设置）也在里面。
 *   ③ 「点击三条横线可以打开侧边栏，然后进行选择」
 *      → 第 2 节：点侧边栏里某一项 → 页面切过去、侧边栏自动收起。
 *   ④ 「不显示总体评分栏和批注详情栏」
 *      → 第 3 节：`.pane-score` / `.pane-notes` 在 DOM 里都不存在。
 *   ⑤ 「将原文标题栏的各个选项和下拉栏放到『选择』按钮，点击选择后弹窗弹出」
 *      → 第 4 节：标题栏里只有 `h2` 与「选择」；点它弹出弹窗，弹窗里有那些控件；
 *        弹窗宽度不超过屏宽（用户第 6 条：弹出框适配手机屏幕）。
 *   ⑥ 「将『下一页』『上一页』按钮放到我的译文栏目，且去掉我的译文这个标题栏这一行」
 *      → 第 5 节：`.pane-answer .pane-head` 不显示；
 *        `.pane-answer .section-nav [data-nav]` 存在，而原文栏那一条不存在。
 *   ⑦ 「最终效果是手机上只有原文、输入框和输入法三个东西……原文和我的译文中间
 *      仅仅用一条分割线分割，不要有其他任何文字」
 *      → 第 6 节：量原文栏与译文栏的高度（各占屏幕约 1/4）、
 *        两栏之间只有一条线（用 `getComputedStyle` 数边框）、
 *        两栏正文里没有多余的标题文字。
 *   ⑧ 「批改视图下我的译文和原文完全展开，有多长就展开多长，返回编辑模式时才四分之一」
 *      → 第 7 节：点「提交批改」之后（内置示例桩），两栏高度大于 1/4 屏、
 *        整页可以滚、`data-result` 在。
 *
 * 用法：node scripts/verify-mobile.mjs        （需要开发服务器在 5180）
 */

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { removeDir } from './lib/clear-dir.ts'
import { findBrowser } from './lib/find-browser.ts'

const root = path.resolve(import.meta.dirname, '..')
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5180'
const debugPort = 9412 + (Number(process.env.PORT_OFFSET ?? 0) || 0)

/** 手机尺寸。375×667 是 iPhone SE/8 那一档，比它更窄的机器很少，用它当最坏情况。 */
const PHONE = { width: 375, height: 667 }
/** 桌面尺寸：用来证明"电脑端一个字没变"。 */
const DESKTOP = { width: 1440, height: 900 }

let passed = 0
let failed = 0
const failures = []

function check(ok, label, extra) {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  ✗ ${label}${extra === undefined ? '' : `\n      ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 极简 CDP 客户端（与其它验收脚本同一套手法，见 verify-admin-ui.mjs）。 */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    })
  }

  send(method, params = {}) {
    this.seq += 1
    const id = this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '页面里抛错了')
    return result.result.value
  }
}

const browser = findBrowser()
if (!browser) throw new Error('没有找到 Edge 或 Chrome')
const profileDir = path.join(root, 'node_modules', '.cache', 'verify-mobile-profile')
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

/** 一套手机端用的页内小工具（与其它验收脚本的 `__A` 同名同形状，便于对照着读）。 */
const helpers = `
  window.__M = (() => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    const text = (s) => (q(s)?.textContent || '').trim();
    const rect = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const visible = (node) => {
      if (!node) return false;
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const clickText = async (selector, label, pause = 300) => {
      const node = qa(selector).find((item) => (item.textContent || '').trim() === label);
      if (!node) return false;
      node.click();
      await sleep(pause);
      return true;
    };
    return { sleep, q, qa, text, rect, visible, clickText };
  })();
`

let cdp = null

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

  /**
   * 开一张新标签页、按给定尺寸进去、等界面挂载。
   *
   * 每次都用**全新的标签页**：手机端与桌面端两套结构差别很大，
   * 在同一张页面上改尺寸再断言，很容易把"上一套留下的状态"当成新布局的问题。
   */
  const openPage = async (size, { stubJudge = false } = {}) => {
    const target = await (
      await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
    ).json()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () => reject(new Error('连接调试通道失败')))
    })
    const client = new Cdp(ws)
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 2,
      mobile: size.width < 700,
    })
    /* 一进来就清掉落盘状态：上次跑剩下的"上次看到哪儿"会把页面带到别的栏目上去 */
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try {
        window.localStorage.clear();
        ${stubJudge ? `
        const original = window.fetch;
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const path = url.replace(/^https?:\\/\\/[^/]+/, '');
          if (path.startsWith('/api/judge')) {
            return new Response(JSON.stringify({ error: '探针不真批改' }), {
              status: 500, headers: { 'content-type': 'application/json' },
            });
          }
          return original(input, init);
        };` : ''}
      } catch (error) {}`,
    })
    await client.send('Page.navigate', { url: `${base}/` })
    let mounted = false
    for (let i = 0; i < 60 && !mounted; i += 1) {
      await sleep(250)
      mounted = Boolean(
        await client.evaluate(
          size.width <= 600 ? "!!document.querySelector('.topbar-mobile')" : "!!document.querySelector('.mode-tabs')",
        ),
      )
    }
    if (!mounted) throw new Error(`${size.width}px：界面没有挂载`)
    await client.evaluate(helpers)
    await sleep(400)
    return { client, ws }
  }

  /* ══ 第 1 节：电脑端一个字没变 ══════════════════════════════════════ */
  console.log('\n[1/7] 桌面端（1440×900）没有产生任何改变')
  {
    const page = await openPage(DESKTOP)
    const snapshot = await page.client.evaluate(`(() => {
      const M = window.__M;
      return {
        phoneTopbar: Boolean(M.q('.topbar-mobile')),
        hamburger: Boolean(M.q('.hamburger')),
        drawer: Boolean(M.q('.drawer')),
        topbar: Boolean(M.q('.topbar')),
        brand: M.text('.topbar-brand h1'),
        tabs: M.qa('.mode-tabs .mode-tab').map((b) => b.textContent.trim()),
        rightButtons: M.qa('.topbar-right .btn').map((b) => b.textContent.trim()),
        account: Boolean(M.q('.user-center')) || M.qa('.account-button').some((n) => n.textContent.includes('登录')),
        themeToggle: Boolean(M.q('.theme-toggle')),
        settingsButton: M.qa('.topbar .btn').some((b) => b.textContent.trim() === '设置'),
        scorePane: Boolean(M.q('.pane-score')),
        notesPane: Boolean(M.q('.pane-notes')),
        sourceFootNav: Boolean(M.q('.pane-source .pane-foot.section-nav')),
        answerFootNav: Boolean(M.q('.pane-answer .pane-foot.section-nav')),
        answerHeadMeta: M.qa('.pane-answer .pane-head .head-meta > *').length,
        sourceHeadMeta: M.qa('.pane-source .pane-head .head-meta > *').length,
        selectButton: Boolean(M.q('.mobile-select-open')),
        mobileSplit: Boolean(M.q('.split-mobile')),
        mobileAnswerBar: Boolean(M.q('.answer-foot')),
      };
    })()`)
    check(snapshot.phoneTopbar === false && snapshot.hamburger === false && snapshot.drawer === false, '桌面端没有手机端顶栏、三条横线与侧边栏', snapshot)
    check(snapshot.topbar === true && snapshot.brand === '翻译批改', '桌面端顶栏仍在、站名仍是「翻译批改」', snapshot)
    check(snapshot.tabs.join(',') === '文章,句子,术语,自定义,收藏,练习记录,留言板', '桌面端题型导航七项齐全且顺序未变', snapshot.tabs)
    check(snapshot.account === true && snapshot.themeToggle === true && snapshot.settingsButton === true, '桌面端顶栏右侧仍是「账号 · 暗夜 · 设置」', snapshot.rightButtons)
    check(snapshot.scorePane === true && snapshot.notesPane === true, '桌面端「总体评分」与「批注详情」两栏仍在', snapshot)
    check(snapshot.sourceFootNav === true, '桌面端翻页按钮仍在**原文栏**页脚（第 8 条那条没被改掉）', snapshot)
    check(snapshot.answerFootNav === false && snapshot.mobileAnswerBar === false, '桌面端译文栏里没有多出翻页页脚', snapshot)
    check(snapshot.sourceHeadMeta > 0 && snapshot.selectButton === false, '桌面端原文标题栏里仍是那一组控件、没有「选择」按钮', snapshot)
    check(snapshot.mobileSplit === false, '桌面端没有套上手机端那个类', snapshot)

    /* 手机端那一整段样式在桌面尺寸下必须**一条都不生效** */
    const cssEffects = await page.client.evaluate(`(() => {
      const M = window.__M;
      const source = M.q('.pane-source');
      const answer = M.q('.pane-answer');
      const top = M.q('.split-row-top');
      return {
        sourceBorderTop: getComputedStyle(source).borderTopWidth,
        answerHeadDisplay: getComputedStyle(M.q('.pane-answer .pane-head')).display,
        headMetaDisplay: getComputedStyle(M.q('.pane-source .head-meta')).display,
        topFlexDirection: getComputedStyle(top).flexDirection,
        topHeight: M.rect(top).h,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    })()`)
    check(cssEffects.answerHeadDisplay !== 'none' && cssEffects.headMetaDisplay !== 'none', '桌面端「我的译文」标题栏与原文标题栏控件都还显示着', cssEffects)
    check(cssEffects.topFlexDirection === 'row', '桌面端上下两排里的两栏仍是左右并排', cssEffects)
    check(cssEffects.topHeight < cssEffects.viewport.h * 0.9, `桌面端上排不是"整屏高"（实测 ${cssEffects.topHeight}px / 视口 ${cssEffects.viewport.h}px）`, cssEffects)

    page.ws.close()
  }

  /* ══ 第 2 节：手机端最上方只剩「三条横线 + 标题」 ══════════════════ */
  console.log('\n[2/7] 手机端（375×667）最上方只剩标题与三条横线，其余都在侧边栏里')
  const phone = await openPage(PHONE)
  cdp = phone.client
  {
    const bar = await phone.client.evaluate(`(() => {
      const M = window.__M;
      const header = M.q('.topbar-mobile');
      return {
        text: (header?.textContent || '').trim(),
        h1: M.text('.topbar-mobile h1'),
        hamburger: Boolean(M.q('.hamburger')),
        hamburgerRect: M.rect(M.q('.hamburger')),
        drawerOpen: Boolean(M.q('.drawer')),
        desktopTopbar: Boolean(M.q('.topbar:not(.topbar-mobile)')),
        tagline: Boolean(M.q('.tagline')),
      };
    })()`)
    check(bar.h1 === '翻译批改', '最上方那个标题就是「翻译批改」', bar)
    check(bar.hamburger === true && bar.hamburgerRect.w >= 40 && bar.hamburgerRect.h >= 40, `三条横线是够手指点的尺寸（实测 ${bar.hamburgerRect?.w}×${bar.hamburgerRect?.h}）`, bar)
    check(bar.text === '☰翻译批改' || /^☰\s*翻译批改$/.test(bar.text), `最上方只有「三条横线 + 标题」两样东西（实测「${bar.text}」）`, bar)
    check(bar.drawerOpen === false, '一进来侧边栏是收起的', bar)
    check(bar.tagline === false, '手机端没有那条「外研社·国才杯 笔译赛项」小字', bar)

    /* 点三条横线：侧边栏打开，六个题型 + 留言板 + 账号 + 暗夜 + 设置都在里面 */
    const drawer = await phone.client.evaluate(`(async () => {
      const M = window.__M;
      M.q('.hamburger').click();
      await M.sleep(400);
      const panel = M.q('.drawer');
      const r = M.rect(panel);
      return {
        open: Boolean(panel),
        rect: r,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        tabs: M.qa('.drawer-nav .mode-tab').map((b) => b.textContent.trim()),
        account: Boolean(M.q('.drawer .user-center')) || M.qa('.drawer .account-button').length > 0,
        theme: Boolean(M.q('.drawer .theme-toggle')),
        settings: M.qa('.drawer .btn').some((b) => b.textContent.trim() === '设置'),
        close: Boolean(M.q('.drawer-close')),
        backdrop: Boolean(M.q('.drawer-backdrop')),
      };
    })()`)
    check(drawer.open === true, '点三条横线能打开侧边栏', drawer)
    check(
      drawer.tabs.join(',') === '文章,句子,术语,自定义,收藏,练习记录,留言板',
      '侧边栏里六个题型 + 留言板一个不少、顺序与桌面端一致',
      drawer.tabs,
    )
    check(drawer.account === true && drawer.theme === true && drawer.settings === true, '账号、暗夜模式、设置也都搬进了侧边栏', drawer)
    check(
      drawer.rect.w <= drawer.viewport.w && drawer.rect.h <= drawer.viewport.h + 1,
      `侧边栏没有超出屏幕（${drawer.rect.w}×${drawer.rect.h} / 屏 ${drawer.viewport.w}×${drawer.viewport.h}）`,
      drawer,
    )
    check(drawer.close === true && drawer.backdrop === true, '侧边栏有收起按钮、背后有一层点得到的底', drawer)

    /* 点侧边栏里某一项：切过去、并且自动收起 */
    const picked = await phone.client.evaluate(`(async () => {
      const M = window.__M;
      const ok = await M.clickText('.drawer-nav .mode-tab', '术语', 700);
      return {
        clicked: ok,
        drawerStillOpen: Boolean(M.q('.drawer')),
        activeTab: M.text('.mode-tab.mode-tab-active'),
      };
    })()`)
    check(picked.clicked === true && picked.drawerStillOpen === false, '点侧边栏里的一项 → 页面切过去、侧边栏自动收起', picked)
  }

  /* ══ 第 3 节：总评栏与批注详情栏不显示 ═════════════════════════════ */
  console.log('\n[3/7] 手机端不显示「总体评分」与「批注详情」两栏')
  {
    const panes = await phone.client.evaluate(`(() => {
      const M = window.__M;
      return {
        score: Boolean(M.q('.pane-score')),
        notes: Boolean(M.q('.pane-notes')),
        annotations: Boolean(M.q('.pane-annotations')),
        splitters: M.qa('.splitter').filter((n) => M.visible(n)).length,
      };
    })()`)
    check(panes.score === false && panes.notes === false, '总评栏与批注详情栏在 DOM 里就不存在（不是藏起来）', panes)
    check(panes.splitters === 0, '手机端没有能拖动的分隔条（拖了没反应的分隔条比不画更糟）', panes)
  }

  /* ══ 第 4 节：原文标题栏只剩「原文 + 选择」，点它弹窗 ══════════════ */
  console.log('\n[4/7] 原文标题栏只剩「原文」与「选择」，点「选择」弹窗弹出该栏的选项')
  {
    /* 先回文章栏：那里标题栏里的控件最多（领域 + 方向 + 选择文章 + 换一换 + AI 出题） */
    await phone.client.evaluate(`(async () => {
      const M = window.__M;
      M.q('.hamburger').click();
      await M.sleep(400);
      await M.clickText('.drawer-nav .mode-tab', '文章', 700);
    })()`)
    const head = await phone.client.evaluate(`(() => {
      const M = window.__M;
      const meta = M.q('.pane-source .head-meta');
      const headNode = M.q('.pane-source .pane-head');
      /*
       * 只数**看得见**的那几个子节点的文字。
       *
       * ⚠️ 不能直接用整个标题栏的 textContent：收起来那一组控件**仍在 DOM 里**
       * （弹窗里用的就是同一份 JSX，见 SourcePane 里那份 headControls），
       * 因此 textContent 里当然还带着「领域 / 换一换 / AI 出题」这些字。
       * 用户要的是"屏幕上只剩标题与选择"，所以这里按**可见性**过滤（实测踩到过这一条）。
       */
      const visibleChildTexts = [...headNode.children]
        .filter((node) => M.visible(node))
        .map((node) => (node.textContent || '').trim());
      return {
        h2: M.text('.pane-source .pane-head h2'),
        selectButton: M.text('.mobile-select-open'),
        selectVisible: M.visible(M.q('.mobile-select-open')),
        metaVisible: M.visible(meta),
        metaChildren: M.qa('.pane-source .head-meta > *').length,
        visibleChildTexts,
        headText: (headNode.textContent || '').trim(),
      };
    })()`)
    check(head.h2 === '原文' && head.selectVisible === true, '标题栏里「原文」右边就是「选择」', head)
    check(head.metaVisible === false, '标题栏里那一组控件已经不显示了（收进弹窗）', head)
    check(head.metaChildren > 0, '那些控件仍然在 DOM 里（只是被收起来，弹窗里用的是同一份）', head)
    check(
      head.visibleChildTexts.length === 2 &&
        head.visibleChildTexts[0] === '原文' &&
        head.visibleChildTexts[1] === '选择',
      `屏幕上那一行**只剩两样东西**：「原文」与「选择」（实测 ${JSON.stringify(head.visibleChildTexts)}）`,
      head,
    )

    const popup = await phone.client.evaluate(`(async () => {
      const M = window.__M;
      M.q('.mobile-select-open').click();
      await M.sleep(400);
      const modal = M.q('.select-modal');
      const r = M.rect(modal);
      const body = M.q('.select-body');
      return {
        open: Boolean(modal),
        rect: r,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        labels: M.qa('.select-body button').map((b) => b.textContent.trim()),
        hasDomain: Boolean(M.q('.select-body .domain-select')),
        bodyScrollable: body ? body.scrollHeight > body.clientHeight : false,
        bodyHeight: M.rect(body)?.h ?? 0,
      };
    })()`)
    check(popup.open === true, '点「选择」弹出弹窗', popup)
    check(
      popup.rect.w <= popup.viewport.w,
      `弹窗宽度没超出手机屏（${popup.rect.w} ≤ ${popup.viewport.w}）`,
      popup,
    )
    check(
      popup.rect.h <= popup.viewport.h,
      `弹窗高度没超出手机屏（${popup.rect.h} ≤ ${popup.viewport.h}）`,
      popup,
    )
    check(popup.hasDomain === true, '弹窗里确实有原文标题栏原来那些控件（领域下拉）', popup.labels)
    check(
      popup.labels.some((t) => t.includes('选择文章')) && popup.labels.some((t) => t.includes('换一换')) && popup.labels.some((t) => t.includes('AI 出题')),
      '「选择文章 / 换一换 / AI 出题」都在弹窗里',
      popup.labels,
    )

    /* 点底（弹窗外面）把它收起来 */
    const closed = await phone.client.evaluate(`(async () => {
      const M = window.__M;
      M.q('.raw-modal-backdrop').click();
      await M.sleep(350);
      return { stillOpen: Boolean(M.q('.select-modal')) };
    })()`)
    check(closed.stillOpen === false, '点弹窗外面能把它收起来', closed)
  }

  /* ══ 第 5 节：我的译文那一行去掉、翻页挪到底部 ═════════════════════ */
  console.log('\n[5/7] 「我的译文」标题栏整行去掉，翻页与提交按钮都在底部的两行操作栏里')
  {
    const answer = await phone.client.evaluate(`(() => {
      const M = window.__M;
      const head = M.q('.pane-answer .pane-head');
      const foot = M.q('.pane-answer .answer-foot');
      const nav = M.q('.pane-answer .answer-foot .section-nav');
      const actions = M.q('.pane-answer .answer-foot .answer-actions');
      return {
        headVisible: M.visible(head),
        headDisplay: head ? getComputedStyle(head).display : null,
        sourceFootNav: Boolean(M.q('.pane-source .pane-foot.section-nav')),
        sourceFootVisible: M.visible(M.q('.pane-source .pane-foot.section-nav')),
        answerNav: Boolean(nav),
        prev: M.text('.pane-answer [data-nav="prev"]'),
        next: M.text('.pane-answer [data-nav="next"]'),
        submit: M.text('.pane-answer .answer-actions .btn-primary'),
        level: M.qa('.pane-answer .answer-actions .level-btn').map((b) => b.textContent.trim()),
        navCount: M.qa('[data-nav]').length,
        footRect: M.rect(foot),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    })()`)
    check(answer.headDisplay === 'none' && answer.headVisible === false, '「我的译文」标题栏那一行整行不显示', answer)
    check(answer.sourceFootNav === false, '原文栏里那条翻页页脚在手机上不渲染（免得页面上有两套翻页按钮）', answer)
    check(answer.navCount === 2, `全页只有一套「上一页 / 下一页」（实测 ${answer.navCount} 个 [data-nav]）`, answer)
    check(
      answer.prev.includes('上一页') && answer.next.includes('下一页'),
      `翻页按钮在**我的译文**栏里（「${answer.prev}」「${answer.next}」）`,
      answer,
    )
    check(answer.submit === '提交批改', `底部那一行有「提交批改」（实测「${answer.submit}」）`, answer)
    check(answer.level.join(',') === '精修,大改', '「精修 / 大改」档位也在底部那一行', answer.level)
    check(
      answer.footRect.w >= answer.viewport.w - 2,
      `底部操作栏横跨整个屏宽（${answer.footRect.w} / ${answer.viewport.w}）`,
      answer,
    )
    check(
      answer.footRect.y + answer.footRect.h <= answer.viewport.h + 1,
      '底部操作栏完全在屏幕内（没有被挤出屏幕）',
      answer,
    )
  }

  /* ══ 第 6 节：屏幕上是「原文 1/4 · 我的译文 1/4」，两栏之间只有一条线 ══ */
  console.log('\n[6/7] 编辑模式下两栏各占屏幕四分之一，中间只有一条分割线')
  {
    const layout = await phone.client.evaluate(`(() => {
      const M = window.__M;
      const source = M.q('.pane-source');
      const answer = M.q('.pane-answer');
      const sourceBody = M.q('.pane-source .pane-body');
      const answerBody = M.q('.pane-answer .pane-body');
      const s = getComputedStyle(source);
      const a = getComputedStyle(answer);
      const termRowHead = M.q('.pane-source .pane-head');
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        sourceRect: M.rect(source),
        answerRect: M.rect(answer),
        sourceBodyRect: M.rect(sourceBody),
        answerBodyRect: M.rect(answerBody),
        sourceBorderBottom: s.borderBottomWidth,
        answerBorderTop: a.borderTopWidth,
        answerBorderBottom: a.borderBottomWidth,
        topRowHeight: M.rect(M.q('.split-row-top')).h,
        inputVisible: M.visible(M.q('.pane-answer textarea.answer-input')),
        inputRect: M.rect(M.q('.pane-answer textarea.answer-input')),
        headText: (termRowHead?.textContent || '').trim(),
        bodyText: (sourceBody?.textContent || '').trim().slice(0, 24),
      };
    })()`)
    const quarter = layout.viewport.h / 4
    check(
      Math.abs(layout.sourceRect.h - quarter) <= 4,
      `原文栏高 ≈ 屏幕 1/4（实测 ${layout.sourceRect.h}px，1/4 = ${Math.round(quarter)}px）`,
      layout,
    )
    check(
      Math.abs(layout.answerRect.h - quarter) <= 4,
      `我的译文栏高 ≈ 屏幕 1/4（实测 ${layout.answerRect.h}px）`,
      layout,
    )
    check(
      layout.sourceRect.y + layout.sourceRect.h <= layout.answerRect.y + 1,
      '原文栏在上面、我的译文栏紧贴在下面（上下叠放，不是左右并排）',
      layout,
    )
    check(
      layout.answerBorderTop !== '0px' && layout.sourceBorderBottom === '0px' && layout.answerBorderBottom === '0px',
      `两栏之间**只有一条**分割线（译文栏上边 ${layout.answerBorderTop}、原文栏下边 ${layout.sourceBorderBottom}、译文栏下边 ${layout.answerBorderBottom}）`,
      layout,
    )
    check(layout.inputVisible === true, '输入框就在下面那一格里', layout)
    check(
      layout.inputRect.y >= layout.sourceRect.y + layout.sourceRect.h - 1,
      '输入框落在分割线下方（也就是「我的译文」那一格里）',
      layout,
    )

    /* 两栏里不该有多余的标题文字（用户："不要有其他任何文字"） */
    const strayText = await phone.client.evaluate(`(() => {
      const M = window.__M;
      const answerHead = M.q('.pane-answer .pane-head');
      return {
        answerHeadVisible: M.visible(answerHead),
        answerHeadText: (answerHead?.textContent || '').trim(),
      };
    })()`)
    check(
      strayText.answerHeadVisible === false,
      `「我的译文」那四个字在屏幕上不出现（它在 DOM 里但整行不显示：「${strayText.answerHeadText}」）`,
      strayText,
    )
  }

  /* ══ 第 7 节：批改视图下两栏完全展开 ══════════════════════════════ */
  console.log('\n[7/7] 批改视图下两栏完全展开、整页可以滚（点「返回编辑」才回到四分之一）')
  {
    /*
     * ## 为什么这一节做了两条路
     *
     * 要"屏幕上是批改结果"有两条路，代价与确定性各不相同：
     *
     *   1. **文章栏走真界面**：把译文写够 31 个单位（提交门那道篇幅门槛）、按「提交批改」，
     *      请求被这个脚本打的桩挡下（返回 500），界面于是出现"批改未完成"那一块；
     *      若这次作答恰好与某道内置示例一字不差，那块里会多一颗「查看内置示例批改」——
     *      点它就有了一份**真结果**（不调 AI、不花钱）。
     *   2. **术语栏走本地判分**：术语题的打分是**本地同步**的（按官方译名对照，
     *      不经模型、不用等、不花钱），因此这一条路**一定**能出结果。
     *
     * 先试第 1 条（它走的是文章栏那条主路，形态最像用户平时用的），
     * 出不了结果就退到第 2 条。两条都验同一件事：**两栏从四分之一变成按内容展开**。
     */
    const submit = await phone.client.evaluate(`(async () => {
      const M = window.__M;
      const box = M.q('.pane-answer textarea.answer-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      /*
       * 写一段够长的译文：提交门要求"多于 30 个单位"（见 domain/submit-gate.ts）。
       * 这一段的**方向**决定数什么：英译中数汉字、中译英数词——
       * 因此两边都写够，不管这道题是哪个方向都过得了门。
       * 末尾那串数字让这一段**不会与之前任何一次一字不差**（重复提交也会被那道门拦下）。
       */
      const filler = ${JSON.stringify(
        '验收脚本用的一段占位译文：这一份作答只给验收脚本使用，它并不是真的翻译，请勿当真。'.repeat(3),
      )};
      const english = 'This paragraph exists only so that the verification script can submit something long enough to pass the length gate, and it is not an actual translation of any kind at all. ' + Date.now();
      setter.call(box, filler + ' ' + english);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await M.sleep(500);
      const btn = () => M.q('.pane-answer .answer-actions .btn-primary');
      const label = (btn()?.textContent || '').trim();
      const disabled = btn()?.disabled === true;
      btn()?.click();
      await M.sleep(1500);
      return {
        label,
        disabled,
        errorText: (M.q('.pane-answer .error-block')?.textContent || '').trim().slice(0, 60),
        fixtureButton: M.qa('.pane-answer .btn').some((b) => b.textContent.includes('查看内置示例批改')),
        gotResult: Boolean(M.q('.split-mobile[data-result]')),
      };
    })()`)
    check(submit.label === '提交批改' && submit.disabled === false, '底部那颗按钮就是「提交批改」，写得够长时可以按', submit)

    /* 先把"文章栏提交被拦"这条路的现象也记下来：它是这段流程的真实产物，不是失败 */
    if (!submit.gotResult && submit.fixtureButton) {
      await phone.client.evaluate(`(async () => {
        const M = window.__M;
        const fixture = M.qa('.pane-answer .btn').find((b) => b.textContent.includes('查看内置示例批改'));
        fixture?.click();
        await M.sleep(1600);
      })()`)
    }

    let route = 'article'
    let live = await phone.client.evaluate(`(() => ({
      gotResult: Boolean(document.querySelector('.split-mobile[data-result]')),
    }))()`)

    if (!live.gotResult) {
      /* 退到术语栏：那里是本地同步判分，一定有结果 */
      route = 'term'
      await phone.client.evaluate(`(async () => {
        const M = window.__M;
        M.q('.hamburger').click();
        await M.sleep(400);
        await M.clickText('.drawer-nav .mode-tab', '术语', 900);
      })()`)
      /* 术语页一页十条：都填上，然后按底部那颗「提交批改」 */
      const termSubmit = await phone.client.evaluate(`(async () => {
        const M = window.__M;
        const rows = M.qa('.pane-answer input, .pane-answer textarea');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          ?? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        for (const row of rows) {
          const proto = row.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(row, 'acceptance-test-value');
          row.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await M.sleep(500);
        const btn = M.q('.pane-answer .answer-actions .btn-primary');
        const label = (btn?.textContent || '').trim();
        btn?.click();
        await M.sleep(1600);
        return {
          rows: rows.length,
          label,
          gotResult: Boolean(M.q('.split-mobile[data-result]')),
          buttonLabel: M.text('.pane-answer .answer-actions .btn-primary'),
        };
      })()`)
      live = { gotResult: termSubmit.gotResult }
      check(
        termSubmit.rows > 0 && termSubmit.gotResult === true,
        `退到术语栏用本地判分拿到结果（${termSubmit.rows} 个输入框，「${termSubmit.label}」→ 现在按钮写「${termSubmit.buttonLabel}」）`,
        termSubmit,
      )
    }

    check(live.gotResult === true, `屏幕上是批改结果（走的是${route === 'article' ? '文章栏那条主路' : '术语栏的本地判分'}）`, live)

    const expanded = await phone.client.evaluate(`(() => {
      const M = window.__M;
      const source = M.q('.pane-source');
      const answer = M.q('.pane-answer');
      const main = M.q('.split-mobile');
      return {
        dataResult: main?.hasAttribute('data-result') ?? false,
        sourceRect: M.rect(source),
        answerRect: M.rect(answer),
        topRowHeight: M.rect(M.q('.split-row-top')).h,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        docScrollable: document.documentElement.scrollHeight > window.innerHeight,
        buttonLabel: M.text('.pane-answer .answer-actions .btn-primary'),
        sourceTextLen: (M.q('.pane-source .pane-body')?.textContent || '').trim().length,
        answerTextLen: (M.q('.pane-answer .pane-body')?.textContent || '').trim().length,
      };
    })()`)
    const quarter = expanded.viewport.h / 4
    check(expanded.dataResult === true, '`data-result` 写上了（手机端靠它切"展开"那一档版式）', expanded)
    check(
      expanded.sourceRect.h > quarter + 2 && expanded.answerRect.h > quarter + 2,
      `两栏都比"四分之一屏"高了（原文 ${expanded.sourceRect.h}px、我的译文 ${expanded.answerRect.h}px，1/4 = ${Math.round(quarter)}px）`,
      expanded,
    )
    check(
      expanded.topRowHeight > quarter * 2 + 2,
      `上排整体已经超过半屏（${expanded.topRowHeight}px > ${Math.round(quarter * 2)}px）——也就是"有多长就展开多长"`,
      expanded,
    )
    check(expanded.buttonLabel === '返回编辑', `底部那颗按钮原地改名叫「返回编辑」（实测「${expanded.buttonLabel}」）`, expanded)
    check(
      expanded.answerTextLen > 20,
      `译文栏里真的画出了那一页的内容（正文 ${expanded.answerTextLen} 字）`,
      expanded,
    )

    /* 批改视图下翻页那一行要钉在译文栏顶部（用户："就是这样"） */
    const stickyNav = await phone.client.evaluate(`(() => {
      const M = window.__M;
      const nav = M.q('.pane-answer .result-nav-sticky');
      const body = M.q('.pane-answer .pane-body');
      return {
        exists: Boolean(nav),
        position: nav ? getComputedStyle(nav).position : null,
        visible: M.visible(nav),
        navCount: M.qa('[data-nav]').length,
        bodyScrollable: body ? body.scrollHeight > body.clientHeight + 2 : false,
        navTop: M.rect(nav)?.y ?? null,
        paneTop: M.rect(M.q('.pane-answer'))?.y ?? null,
      };
    })()`)
    check(
      stickyNav.exists === true && stickyNav.position === 'sticky' && stickyNav.visible === true,
      `批改视图下翻页那一行钉在译文栏顶部（position: ${stickyNav.position}）`,
      stickyNav,
    )
    check(stickyNav.navCount === 2, `仍然只有一套「上一页 / 下一页」（实测 ${stickyNav.navCount} 个）`, stickyNav)

    /* 点「返回编辑」：回到四分之一那一档 */
    const back = await phone.client.evaluate(`(async () => {
      const M = window.__M;
      M.q('.pane-answer .answer-actions .btn-primary').click();
      await M.sleep(900);
      return {
        dataResult: M.q('.split-mobile')?.hasAttribute('data-result') ?? false,
        sourceH: M.rect(M.q('.pane-source')).h,
        answerH: M.rect(M.q('.pane-answer')).h,
        inputVisible: M.visible(M.q('.pane-answer textarea.answer-input')),
        buttonLabel: M.text('.pane-answer .answer-actions .btn-primary'),
        viewport: { h: window.innerHeight },
      };
    })()`)
    const q2 = back.viewport.h / 4
    check(
      back.dataResult === false &&
        Math.abs(back.sourceH - q2) <= 4 &&
        Math.abs(back.answerH - q2) <= 4,
      `点「返回编辑」之后回到"两栏各占四分之一"（原文 ${back.sourceH}px、我的译文 ${back.answerH}px，1/4 = ${Math.round(q2)}px）`,
      back,
    )
    check(
      back.buttonLabel === '提交批改',
      `按钮名字变回「提交批改」（实测「${back.buttonLabel}」）`,
      back,
    )
  }
} finally {
  try {
    cdp?.ws.close()
  } catch {
    /* 关不掉就算了：下面那一句 taskkill 会把整棵进程树带走 */
  }
  /*
   * 与其它验收脚本同一套收尾（见 verify-term-mode.mjs 末尾）：**连子进程一起杀**。
   * 只 `kill()` 主进程的话，浏览器拉起来的那几个渲染进程会活下来，
   * 而它们**攥着 profile 目录里的文件**——下一次跑（开头那次 removeDir）就会
   * EBUSY 报错（实测踩到过一次）。因此这里只杀进程、**不去删 profile 目录**：
   * 它和 `.cache` 下那一堆同名的目录一样，是缓存，不是产物。
   */
  if (browserProcess.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}

console.log(
  failed === 0
    ? `\n手机端验收：${passed} 项全部通过。`
    : `\n手机端验收：${passed} 项通过、${failed} 项未通过：\n` +
      failures.map((item) => `  - ${item}`).join('\n'),
)
process.exitCode = failed === 0 ? 0 : 1
